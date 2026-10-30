// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The tools of the MCP server. Each tool maps its input to 1 function of the core.
import Ajv from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { DEFAULT_LIMIT, QueryError, describeSchema, gaps, graphById, impact, indexGraphs, kindSchemas, nodeDetail, trace, validateNode, type GraphIndex, type Graph, type Model, type Profile } from '@semspec/core';

// A graph as the loader returns it. `graph` is the raw graph, and `profile` is the profile with its vocabulary files read.
export interface LoadedGraph {
  id: string;
  label: string;
  graph: Graph;
  profile: Profile;
  model: Model;
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
    name: 'impact',
    description: 'List the nodes that depend on a node: all nodes below it in the scope, the nodes that link to it, and the nodes of other graphs that link to it across graphs. The answer groups them by graph and kind.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The id of the node.' }, graph: graphProp, limit: limitProp }, required: ['id'], additionalProperties: false },
    run: (loaded, graphs, args) => impact(graphs, text(args, 'graph', false), text(args, 'id', true)!, whole(args, 'limit', DEFAULT_LIMIT, MAX_LIMIT)),
  },
  {
    name: 'gaps',
    description: 'List the gaps in a scope: nodes with a warn or bad status, parts with no check, facts with no source, unplaced nodes and links to missing nodes. The scope is a node id, or the whole graph.',
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
