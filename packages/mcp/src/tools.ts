// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The tools of the MCP server. Each tool maps its input to 1 function of the core.
import Ajv from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { DEFAULT_LIMIT, QueryError, describeSchema, gaps, graphById, impact, indexGraphs, kindSchemas, nodeDetail, searchSemantic, SEARCH_MODES, slice, sliceMarkdown, DEFAULT_SLICE_BUDGET, MAX_SLICE_DEPTH, trace, validateNode, walk, MAX_WALK_DEPTH, type GraphIndex, type Graph, type SearchMode, type SearchResult, type SemanticSource, type Model, type Profile } from '@semspec/core';

// A graph as the loader returns it. `graph` is the raw graph, and `profile` is the profile with its vocabulary files read.
export interface LoadedGraph {
  id: string;
  label: string;
  graph: Graph;
  profile: Profile;
  model: Model;
  // The model and the index of vectors for the meaning search. Missing when the graph has no embedding setting.
  embedding?: SemanticSource;
}

export interface Loaded {
  title: string;
  graphs: LoadedGraph[];
  warnings: string[];
}

// Reads the inputs. It throws an error with a clear message when an input is not valid.
export type Loader = () => Loaded;

export const MAX_LIMIT = 500;

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  // A tool that calls a model returns a promise. All others return the answer.
  run(loaded: Loaded, graphs: GraphIndex[], args: Record<string, unknown>): unknown;
}

const graphProp = { type: 'string', description: 'The id of the graph in the workspace. The default is the first graph.' };
const limitProp = { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `The most items in a list. The default is ${DEFAULT_LIMIT}. An answer says in "truncated" when it cuts a list.` };

function text(args: Record<string, unknown>, name: string, required: boolean): string | undefined {
  const v = args[name];
  if (v === undefined || v === null) {
    if (required) throw new QueryError(`The input "${name}" is required.`);
    return undefined;
  }
  if (typeof v !== 'string' || (required && !v)) throw new QueryError(`The input "${name}" must be a text${required ? ' that is not empty' : ''}.`);
  return v;
}

function whole(args: Record<string, unknown>, name: string, fallback: number, max: number): number {
  const v = args[name];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > max) throw new QueryError(`The input "${name}" must be a whole number from 1 to ${max}.`);
  return v;
}

function list(args: Record<string, unknown>, name: string): string[] | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new QueryError(`The input "${name}" must be a list of texts.`);
  return v as string[];
}

// Parses the text of a node, as YAML or JSON.
function parseNode(source: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = parse(source);
  } catch (e) {
    throw new QueryError(`The node is not valid YAML or JSON: ${(e as Error).message.split('\n')[0]}`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new QueryError('The node must be 1 object with fields.');
  return value as Record<string, unknown>;
}

// The problems of a node against the JSON Schema of its kind.
function schemaProblems(profile: Profile, node: Record<string, unknown>): string[] {
  const kind = node[profile.source.kind] ?? profile.source.defaultKind;
  const schema = typeof kind === 'string' ? kindSchemas(profile)[kind] : undefined;
  if (!schema) return [];
  const check = new Ajv({ allErrors: true, strict: false }).compile(schema);
  if (check(node)) return [];
  return (check.errors ?? []).map((e) => `The node${e.instancePath} ${e.message}`);
}

export const TOOLS: Tool[] = [
  {
    name: 'schema',
    description: 'Describe the profile of a graph: the kinds, the edges with their properties, the vocabularies with their codes, the provenance fields and the cross links. With "kind", return the JSON Schema of that kind.',
    inputSchema: { type: 'object', properties: { graph: graphProp, kind: { type: 'string', description: 'A kind id. The answer is then the JSON Schema of this kind.' } }, additionalProperties: false },
    run: (loaded, graphs, args) => {
      const g = graphById(graphs, text(args, 'graph', false));
      return { graph: g.id, ...describeSchema(g.index.profile, text(args, 'kind', false)) };
    },
  },
  {
    name: 'search',
    description:
      'Find nodes by words. The tool ranks the nodes with BM25 over the id, title, statement, parts and coded labels, and widens the query with the synonyms of the profile. When the user configured an embedding model and built an index, the tool also ranks by meaning and merges both rankings (mode "hybrid"). It searches all graphs unless "graph" is set. Each hit has the kind, the parent, the status and a snippet with the matched words in ** marks. "notes" says when the model did not answer and the ranking used keywords only.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The words to find, as a question or as keywords.' },
        graph: { type: 'string', description: 'The id of 1 graph. The default is all graphs.' },
        kinds: { type: 'array', items: { type: 'string' }, description: 'Return only nodes of these kinds.' },
        lifecycles: { type: 'array', items: { type: 'string' }, description: 'Return only nodes in these lifecycle states.' },
        statuses: { type: 'array', items: { type: 'string' }, description: 'Return only nodes with these status values.' },
        scope: { type: 'string', description: 'The id of a node. Return only nodes in the scope of this node.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `The most hits. The default is ${DEFAULT_LIMIT}. The answer has "truncated" when it cuts the hits.` },
        mode: { type: 'string', enum: SEARCH_MODES, description: 'keyword: words only. vector: meaning only. hybrid: both. The default is hybrid when an index exists, and keyword when none exists.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    run: (loaded, graphs, args) => {
      const query = text(args, 'query', true)!;
      const mode = text(args, 'mode', false) as SearchMode | undefined;
      if (mode !== undefined && !SEARCH_MODES.includes(mode)) throw new QueryError(`The input "mode" must be one of: ${SEARCH_MODES.join(', ')}.`);
      const sources = new Map(loaded.graphs.flatMap((g) => (g.embedding ? [[g.id, g.embedding] as const] : [])));
      const shape = (found: SearchResult) => ({ query, total: found.total, hits: found.hits, ...(found.omitted ? { truncated: { hits: found.omitted } } : {}), ...(found.notes ? { notes: found.notes } : {}) });
      const found = searchSemantic(graphs, sources, query, {
        mode,
        graph: text(args, 'graph', false),
        kinds: list(args, 'kinds'),
        lifecycles: list(args, 'lifecycles'),
        statuses: list(args, 'statuses'),
        scope: text(args, 'scope', false),
        limit: whole(args, 'limit', DEFAULT_LIMIT, MAX_LIMIT),
      });
      return found instanceof Promise ? found.then(shape) : shape(found);
    },
  },
  {
    name: 'get',
    description: 'Return 1 node: its kind, title, statement, fields, lifecycle and status, its edges in and out grouped by edge name, its provenance, and its cross links out and in.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The id of the node.' }, graph: graphProp, limit: limitProp }, required: ['id'], additionalProperties: false },
    run: (loaded, graphs, args) => nodeDetail(graphs, text(args, 'graph', false), text(args, 'id', true)!, whole(args, 'limit', DEFAULT_LIMIT, MAX_LIMIT)),
  },
  {
    name: 'trace',
    description: 'Follow the scope parents. With direction "up", return the paths from the node to the roots. With direction "down", return the tree below the node to "depth" levels.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The id of the node.' },
        direction: { type: 'string', enum: ['up', 'down'], description: 'up: the paths to the roots. down: the tree below the node.' },
        depth: { type: 'integer', minimum: 1, maximum: 20, description: 'The levels of the tree for direction "down". The default is 2.' },
        graph: graphProp,
        limit: limitProp,
      },
      required: ['id', 'direction'],
      additionalProperties: false,
    },
    run: (loaded, graphs, args) => {
      const direction = text(args, 'direction', true);
      if (direction !== 'up' && direction !== 'down') throw new QueryError('The input "direction" must be "up" or "down".');
      return trace(graphs, text(args, 'graph', false), text(args, 'id', true)!, direction, whole(args, 'depth', 2, 20), whole(args, 'limit', DEFAULT_LIMIT, MAX_LIMIT));
    },
  },
  {
    name: 'walk',
    description:
      'Return the neighbours of a node, grouped by edge and direction, so that you can move through the graph step by step. A step with a depth above 1 lists the new nodes at that distance, and "paths" gives the way to each one. A node shows only once. The walk also follows the cross links into other graphs of a workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The id of the start node.' },
        graph: graphProp,
        edges: { type: 'array', items: { type: 'string' }, description: 'The edge names and cross link fields to follow. The default is all.' },
        direction: { type: 'string', enum: ['out', 'in', 'both'], description: 'out: edges that leave the node. in: edges that arrive at it. The default is both.' },
        kinds: { type: 'array', items: { type: 'string' }, description: 'Keep only nodes of these kinds. The walk does not pass through other nodes.' },
        depth: { type: 'integer', minimum: 1, maximum: MAX_WALK_DEPTH, description: `The number of steps. The default is 1 and the largest value is ${MAX_WALK_DEPTH}.` },
        crossLinks: { type: 'boolean', description: 'Also follow the cross links into other graphs. The default is true.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `The most nodes in the answer. The default is ${DEFAULT_LIMIT}. The answer has "truncated" and a note when it cuts nodes.` },
      },
      required: ['id'],
      additionalProperties: false,
    },
    run: (loaded, graphs, args) => {
      const direction = text(args, 'direction', false);
      if (direction !== undefined && direction !== 'out' && direction !== 'in' && direction !== 'both') throw new QueryError('The input "direction" must be "out", "in" or "both".');
      const cross = args.crossLinks;
      if (cross !== undefined && cross !== null && typeof cross !== 'boolean') throw new QueryError('The input "crossLinks" must be true or false.');
      return walk(graphs, text(args, 'graph', false), text(args, 'id', true)!, {
        edges: list(args, 'edges'),
        direction,
        kinds: list(args, 'kinds'),
        depth: whole(args, 'depth', 1, MAX_WALK_DEPTH),
        crossLinks: typeof cross === 'boolean' ? cross : true,
        limit: whole(args, 'limit', DEFAULT_LIMIT, MAX_LIMIT),
      });
    },
  },
  {
    name: 'slice',
    description:
      'Return the brief for a task on 1 node: the node with its fields, lifecycle, status and provenance, the path to the root, the parts with their checks, the linked nodes (decisions, rules, standards) with notes and edge properties, the cross links into other graphs with their definitions, the definitions of the coded values it uses, its gaps, its missing deliverables, and the nodes below it. Call it at the start of a task. The text stays near "budget" characters and names what it cut.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The id of the node.' },
        graph: graphProp,
        depth: { type: 'integer', minimum: 1, maximum: MAX_SLICE_DEPTH, description: `The levels of nodes below the node. The default is 1 and the largest value is ${MAX_SLICE_DEPTH}.` },
        budget: { type: 'integer', minimum: 1, description: `The approximate size of the Markdown text in characters. The default is ${DEFAULT_SLICE_BUDGET}. The slice drops the deep children first, then the long statements of linked nodes, and says what it cut.` },
        format: { type: 'string', enum: ['markdown', 'json'], description: 'markdown: text for an agent (the default). json: the structured slice.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    run: (loaded, graphs, args) => {
      const format = text(args, 'format', false) ?? 'markdown';
      if (format !== 'markdown' && format !== 'json') throw new QueryError('The input "format" must be "markdown" or "json".');
      const found = slice(graphs, { graph: text(args, 'graph', false), id: text(args, 'id', true)!, depth: whole(args, 'depth', 1, MAX_SLICE_DEPTH), budget: whole(args, 'budget', DEFAULT_SLICE_BUDGET, Number.MAX_SAFE_INTEGER) });
      return format === 'json' ? found : sliceMarkdown(found);
    },
  },
  {
    name: 'impact',
    description: 'List the nodes that depend on a node: all nodes below it in the scope, the nodes that link to it, and the nodes of other graphs that link to it across graphs. The answer groups them by graph and kind.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The id of the node.' }, graph: graphProp, limit: limitProp }, required: ['id'], additionalProperties: false },
    run: (loaded, graphs, args) => impact(graphs, text(args, 'graph', false), text(args, 'id', true)!, whole(args, 'limit', DEFAULT_LIMIT, MAX_LIMIT)),
  },
  {
    name: 'gaps',
    description: 'List the gaps in a scope: nodes with a warn or bad status, parts with no check, facts with no source, unplaced nodes, links to missing nodes and missing deliverables (what the profile says a node of its kind must deliver). The scope is a node id, or the whole graph.',
    inputSchema: { type: 'object', properties: { scope: { type: 'string', description: 'The id of a node. The default is the whole graph.' }, graph: graphProp, limit: limitProp }, additionalProperties: false },
    run: (loaded, graphs, args) => gaps(graphs, text(args, 'graph', false), text(args, 'scope', false), whole(args, 'limit', DEFAULT_LIMIT, MAX_LIMIT)),
  },
  {
    name: 'validate',
    description: 'Check 1 new node against the profile as if it were added to the graph. Give the node as YAML or JSON text. The answer lists errors and warnings. The tool writes nothing.',
    inputSchema: { type: 'object', properties: { node: { type: 'string', description: 'The node as YAML or JSON text.' }, graph: graphProp }, required: ['node'], additionalProperties: false },
    run: (loaded, graphs, args) => {
      const g = graphById(graphs, text(args, 'graph', false));
      const source = loaded.graphs.find((x) => x.id === g.id)!;
      const node = parseNode(text(args, 'node', true)!);
      const found = validateNode(source.graph, source.profile, node, graphs);
      const errors = [...schemaProblems(source.profile, node), ...found.errors];
      return { graph: g.id, valid: errors.length === 0, errors, warnings: found.warnings };
    },
  },
];

// Runs a tool on freshly loaded inputs. It throws a QueryError, or the error of the loader, with a message for the caller.
export function callTool(loader: Loader, name: string, args: Record<string, unknown> = {}): unknown {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new QueryError(`Unknown tool "${name}". The tools are: ${TOOLS.map((t) => t.name).join(', ')}.`);
  const loaded = loader();
  return tool.run(loaded, indexGraphs(loaded.graphs), args);
}
