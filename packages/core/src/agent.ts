// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Answers for an agent: the schema of a profile, one node with its context, the path to the root, the
// tree below a node, the neighbours of a node, the impact of a node, the gaps of a scope, and the check of a new node.
// Each answer is plain data. A list that exceeds the limit is cut, and `truncated` says by how much.
import { nodeLinks } from './external-links.js';
import { deliverableFindings, type DeliverableFinding } from './deliverables.js';
import { computeScope, statusOf } from './explore.js';
import { buildModel, buildIndex } from './model.js';
import { allLinkFields, parentFields, refsOf } from './profile.js';
import { derivedEdgeName, provenanceOf, sourceCheck } from './provenance.js';
import { kindSchemas } from './schema.js';
import { validateGraph } from './validate.js';
import { incomingCrossLinks, type WorkspaceGraph } from './workspace.js';
import type { CrossLink, ExternalLink, Graph, Index, Model, Profile, VEdge, VNode } from './types.js';

export const DEFAULT_LIMIT = 50;

// A graph of a workspace with its index.
export interface GraphIndex {
  id: string;
  label: string;
  index: Index;
}

export const indexGraphs = (graphs: WorkspaceGraph[]): GraphIndex[] => graphs.map((g) => ({ id: g.id, label: g.label, index: buildIndex(g.model) }));

export interface Brief {
  id: string;
  kind: string;
  title: string;
}

// The number of omitted items, by the name of the list.
export type Truncated = Record<string, number>;

// An error that names the reason in a sentence for the caller.
export class QueryError extends Error {}

const brief = (n: VNode): Brief => ({ id: n.id, kind: n.kind, title: n.title });

// Takes the first `limit` items. It records the omitted count under `name`.
export function cap<T>(items: T[], limit: number, name: string, truncated: Truncated): T[] {
  if (items.length > limit) truncated[name] = items.length - limit;
  return items.slice(0, limit);
}

export const withTruncated = <T extends object>(result: T, truncated: Truncated): T & { truncated?: Truncated } => (Object.keys(truncated).length ? { ...result, truncated } : result);

export function graphById(graphs: GraphIndex[], id?: string): GraphIndex {
  if (!graphs.length) throw new QueryError('The workspace has no graph.');
  if (id === undefined) return graphs[0];
  const found = graphs.find((g) => g.id === id);
  if (!found) throw new QueryError(`Unknown graph "${id}". The graphs are: ${graphs.map((g) => g.id).join(', ')}.`);
  return found;
}

export function nodeById(g: GraphIndex, id: string): VNode {
  const n = g.index.byId.get(id);
  if (!n) throw new QueryError(`Unknown node id "${id}" in the graph "${g.id}".`);
  return n;
}

// ---------- schema ----------

// The profile as an agent needs it: the kinds, the edges, the vocabularies, the provenance and the cross links.
// With `kind`, the answer is the JSON Schema of that kind instead.
export function describeSchema(profile: Profile, kind?: string): Record<string, unknown> {
  if (kind !== undefined) {
    const schema = kindSchemas(profile)[kind];
    if (!schema) throw new QueryError(`Unknown kind "${kind}". The kinds are: ${profile.kinds.map((k) => k.id).join(', ')}.`);
    return { kind, schema };
  }
  const status = profile.status;
  return {
    project: profile.project,
    idKey: profile.source.id,
    kindKey: profile.source.kind,
    nodesKey: profile.source.nodes,
    kinds: profile.kinds.map((k) => ({
      id: k.id,
      label: k.label,
      role: k.role,
      ...(k.prefix ? { prefix: k.prefix } : {}),
      ...(parentFields(k).length ? { parentFields: parentFields(k) } : {}),
      ...(k.placedUnder ? { placedUnder: k.placedUnder } : {}),
    })),
    edges: Object.entries(profile.edges).map(([name, e]) => ({
      name,
      labels: e.labels,
      ...(e.down ? { down: true } : {}),
      ...(e.from ? { from: e.from } : {}),
      ...(e.to ? { to: e.to } : {}),
      ...(e.properties ? { properties: Object.fromEntries(Object.entries(e.properties).map(([p, d]) => [p, { type: d.type, ...(d.required ? { required: true } : {}), ...(d.vocabulary ? { vocabulary: d.vocabulary } : {}) }])) } : {}),
    })),
    linkFields: profile.links ?? [],
    lifecycle: { field: profile.lifecycle.field, fallback: profile.lifecycle.fallback, states: Object.keys(profile.lifecycle.states ?? {}) },
    ...(status ? { status: { field: status.field, values: status.values.map((v) => ({ value: v.value, label: v.label, tone: v.tone })) } } : {}),
    vocabularies: Object.entries(profile.vocabularies ?? {}).map(([id, v]) => ({ id, label: v.label, ...(v.definition ? { definition: v.definition } : {}), concepts: v.concepts.map((c) => ({ code: c.code, label: c.label, ...(c.definition ? { definition: c.definition } : {}), ...(c.broader ? { broader: c.broader } : {}) })) })),
    fieldVocabularies: profile.fieldVocabularies ?? {},
    ...(profile.provenance ? { provenance: { ...(profile.provenance.marker ? { marker: profile.provenance.marker } : {}), ...(profile.provenance.source ? { source: { ...profile.provenance.source, edge: derivedEdgeName(profile.provenance) } } : {}), ...(profile.provenance.retrieved ? { retrieved: profile.provenance.retrieved } : {}), ...(profile.provenance.agent ? { agent: profile.provenance.agent } : {}), ...(profile.provenance.note ? { note: profile.provenance.note } : {}), ...(profile.provenance.requireSource ? { requireSource: profile.provenance.requireSource } : {}) } } : {}),
    crossLinks: profile.crossLinks ?? [],
  };
}

// ---------- get ----------

// The fields of a node that no other part of the answer shows.
export function plainFields(p: Profile, n: VNode): Record<string, unknown> {
  const hidden = new Set<string>([
    ...allLinkFields(p),
    ...refsOf(p).map((r) => r.field),
    ...(p.supersededBy ? [p.supersededBy] : []),
    ...(p.crossLinks ?? []).map((c) => c.field),
    ...(p.status ? [p.status.field] : []),
    ...(p.checks ? [p.checks.field] : []),
    ...p.fields.title,
    ...p.fields.statement,
    p.lifecycle.field,
  ]);
  for (const f of [p.provenance?.marker?.field, p.provenance?.source?.field, p.provenance?.retrieved, p.provenance?.agent, p.provenance?.note]) if (f) hidden.add(f);
  return Object.fromEntries(Object.entries(n.d).filter(([k, v]) => !hidden.has(k) && v !== undefined));
}

const linksField = (links: ExternalLink[]) => (links.length ? { links } : {});

function edgeItems(g: GraphIndex, edges: VEdge[], dir: 'out' | 'in', limit: number, truncated: Truncated): Record<string, unknown[]> {
  const groups: Record<string, unknown[]> = {};
  for (const e of edges) (groups[e.k] ??= []).push(e);
  const out: Record<string, unknown[]> = {};
  for (const [name, list] of Object.entries(groups)) {
    out[name] = cap(list as VEdge[], limit, `edges.${dir}.${name}`, truncated).map((e) => {
      const other = g.index.byId.get(dir === 'out' ? e.t : e.s);
      return { id: other?.id ?? (dir === 'out' ? e.t : e.s), ...(other ? { kind: other.kind, title: other.title } : {}), ...(other && e.k === g.index.profile.checks?.edge ? linksField(nodeLinks(g.index.profile, other)) : {}), ...(e.n ? { note: e.n } : {}), ...(e.p ? { props: e.p } : {}) };
    });
  }
  return out;
}

// One node with its context: fields, lifecycle, status, edges, provenance and cross links.
export function nodeDetail(graphs: GraphIndex[], graphId: string | undefined, id: string, limit = DEFAULT_LIMIT): Record<string, unknown> {
  const g = graphById(graphs, graphId);
  const n = nodeById(g, id);
  const { index } = g;
  const p = index.profile;
  const truncated: Truncated = {};
  const status = statusOf(index, id);
  const statusLabel = (v: string | null) => p.status?.values.find((x) => x.value === v)?.label ?? v;
  const prov = provenanceOf(p.provenance, n.d);
  const sourceNode = typeof prov.source === 'string' ? index.byId.get(prov.source) : undefined;
  const crossOut = cap(index.crossOut.get(id) ?? [], limit, 'crossLinks', truncated).map((c) => {
    const target = graphs.find((x) => x.id === c.graph)?.index.byId.get(c.t);
    return { field: c.field, label: p.crossLinks?.find((x) => x.field === c.field)?.label ?? c.field, graph: c.graph, id: c.t, ...(target ? { title: target.title } : {}) };
  });
  const usedBy = cap(incomingCrossLinks(graphs.map((x) => ({ id: x.id, label: x.label, model: x.index.model }))).get(g.id)?.get(id) ?? [], limit, 'usedBy', truncated).map((c) => ({
    graph: c.graph,
    id: c.s,
    label: c.label,
    ...(graphs.find((x) => x.id === c.graph)?.index.byId.get(c.s) ? { title: graphs.find((x) => x.id === c.graph)!.index.byId.get(c.s)!.title } : {}),
  }));
  const parents = cap(n.up.map((u) => index.byId.get(u)).filter((x): x is VNode => !!x), limit, 'parents', truncated).map(brief);
  const result = {
    graph: g.id,
    id: n.id,
    kind: n.kind,
    title: n.title,
    ...(n.statement ? { statement: n.statement } : {}),
    lifecycle: n.lifecycle,
    ...(p.verification && n.d.verification ? { verification: n.d.verification } : {}),
    ...(p.status && status.total ? { status: { value: status.value, label: statusLabel(status.value), tone: status.tone, own: n.status !== undefined, counts: status.counts } } : {}),
    ...linksField(nodeLinks(p, n)),
    fields: plainFields(p, n),
    parents,
    childCount: (index.scopeChildren.get(id) ?? []).length,
    edges: { out: edgeItems(g, index.out.get(id) ?? [], 'out', limit, truncated), in: edgeItems(g, index.inc.get(id) ?? [], 'in', limit, truncated) },
    ...(Object.keys(prov).length ? { provenance: { ...prov, ...(sourceNode ? { sourceTitle: sourceNode.title } : {}) } } : {}),
    crossLinks: crossOut,
    usedBy,
  };
  return withTruncated(result, truncated);
}

// ---------- trace ----------

// Every path from a node up to a root, through the scope parents. A path starts at the node.
export function traceUp(index: Index, id: string, limit = DEFAULT_LIMIT): Record<string, unknown> {
  const node = index.byId.get(id);
  if (!node) throw new QueryError(`Unknown node id "${id}".`);
  const paths: string[][] = [];
  const walk = (path: string[]) => {
    const here = index.byId.get(path[path.length - 1])!;
    const parents = here.up.filter((u) => index.byId.has(u) && !path.includes(u));
    if (!parents.length) paths.push(path);
    else for (const u of parents) walk([...path, u]);
  };
  walk([id]);
  const truncated: Truncated = {};
  const shown = cap(paths, limit, 'paths', truncated);
  const used = new Set(shown.flat());
  const nodes = Object.fromEntries([...used].map((u) => [u, { kind: index.byId.get(u)!.kind, title: index.byId.get(u)!.title }]));
  return withTruncated({ direction: 'up', node: brief(node), paths: shown, nodes }, truncated);
}

interface TreeNode extends Brief {
  more?: number;
  seen?: boolean;
  children?: TreeNode[];
}

// The tree below a node, through the scope children, down to `depth` levels. `limit` caps the number of nodes shown.
export function traceDown(index: Index, id: string, depth = 2, limit = DEFAULT_LIMIT): Record<string, unknown> {
  const node = index.byId.get(id);
  if (!node) throw new QueryError(`Unknown node id "${id}".`);
  let budget = limit;
  let omitted = 0;
  const seen = new Set<string>([id]);
  const build = (n: VNode, level: number): TreeNode => {
    const out: TreeNode = brief(n);
    const kids = (index.scopeChildren.get(n.id) ?? []).map((c) => index.byId.get(c)!).filter(Boolean);
    if (!kids.length) return out;
    if (level >= depth) {
      out.more = kids.length;
      return out;
    }
    const shown: TreeNode[] = [];
    for (const k of kids) {
      if (budget <= 0) break;
      budget--;
      if (seen.has(k.id)) shown.push({ ...brief(k), seen: true });
      else {
        seen.add(k.id);
        shown.push(build(k, level + 1));
      }
    }
    if (shown.length < kids.length) out.more = kids.length - shown.length;
    if (shown.length) out.children = shown;
    return out;
  };
  const tree = build(node, 0);
  const count = (t: TreeNode): number => 1 + (t.children ?? []).reduce((a, c) => a + count(c), 0);
  const total = countBelow(index, id);
  omitted = total - (count(tree) - 1);
  return { direction: 'down', depth, tree, below: total, ...(omitted > 0 ? { truncated: { nodes: omitted } } : {}) };
}

// The number of nodes below a node, through the scope children.
function countBelow(index: Index, id: string): number {
  return descendants(index, id).size;
}

function descendants(index: Index, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [...(index.scopeChildren.get(id) ?? [])];
  while (stack.length) {
    const next = stack.pop()!;
    if (next === id || out.has(next)) continue;
    out.add(next);
    stack.push(...(index.scopeChildren.get(next) ?? []));
  }
  return out;
}

export function trace(graphs: GraphIndex[], graphId: string | undefined, id: string, direction: 'up' | 'down', depth = 2, limit = DEFAULT_LIMIT): Record<string, unknown> {
  const g = graphById(graphs, graphId);
  nodeById(g, id);
  return { graph: g.id, ...(direction === 'up' ? traceUp(g.index, id, limit) : traceDown(g.index, id, depth, limit)) };
}

// ---------- impact ----------

// The nodes that depend on a node: the ones below it in the scope, the ones that link to it, and the cross links into it from other graphs.
export function impact(graphs: GraphIndex[], graphId: string | undefined, id: string, limit = DEFAULT_LIMIT): Record<string, unknown> {
  const g = graphById(graphs, graphId);
  const node = nodeById(g, id);
  const found = new Map<string, { graph: string; id: string; via: string }>();
  const add = (graph: string, nid: string, via: string) => {
    const key = `${graph}\u0000${nid}`;
    if (!found.has(key) && !(graph === g.id && nid === id)) found.set(key, { graph, id: nid, via });
  };
  for (const d of descendants(g.index, id)) add(g.id, d, 'below');
  for (const e of g.index.inc.get(id) ?? []) add(g.id, e.s, `edge:${e.k}`);
  const incoming = incomingCrossLinks(graphs.map((x) => ({ id: x.id, label: x.label, model: x.index.model }))).get(g.id)?.get(id) ?? [];
  for (const c of incoming) add(c.graph, c.s, `cross:${c.field}`);
  const groups = new Map<string, { graph: string; kind: string; items: { id: string; title: string; via: string }[] }>();
  for (const f of found.values()) {
    const n = graphs.find((x) => x.id === f.graph)?.index.byId.get(f.id);
    if (!n) continue;
    const key = `${f.graph}\u0000${n.kind}`;
    const group = groups.get(key) ?? { graph: f.graph, kind: n.kind, items: [] };
    group.items.push({ id: n.id, title: n.title, via: f.via });
    groups.set(key, group);
  }
  const order = (gr: { graph: string; kind: string }) => graphs.findIndex((x) => x.id === gr.graph) * 1000 + Math.max(0, graphs.find((x) => x.id === gr.graph)!.index.profile.kinds.findIndex((k) => k.id === gr.kind));
  const truncated: Truncated = {};
  const out = [...groups.values()]
    .sort((a, b) => order(a) - order(b))
    .map((gr) => ({ graph: gr.graph, kind: gr.kind, count: gr.items.length, items: cap(gr.items, limit, `${gr.graph}.${gr.kind}`, truncated) }));
  return withTruncated({ graph: g.id, node: brief(node), total: [...groups.values()].reduce((a, x) => a + x.items.length, 0), groups: out }, truncated);
}

// ---------- walk ----------

export type WalkDirection = 'out' | 'in' | 'both';

export interface WalkOptions {
  // Edge names and cross link fields to follow. The default is all.
  edges?: string[];
  direction?: WalkDirection;
  // Node kinds to keep. A node of another kind is neither shown nor followed.
  kinds?: string[];
  depth?: number;
  crossLinks?: boolean;
  limit?: number;
}

export const MAX_WALK_DEPTH = 3;

interface WalkNode {
  graph: string;
  id: string;
  kind: string;
  title: string;
  status: string | null;
  props?: Record<string, unknown>;
  note?: string;
  from?: string;
}

interface WalkGroup {
  edge: string;
  direction: 'out' | 'in';
  label: string;
  cross?: true;
  nodes: WalkNode[];
}

// The neighbours of a node, step by step. Step 1 holds the direct neighbours, step 2 the neighbours of those, down to `depth`.
// A step groups its new nodes by edge and direction. A node shows once, in the step where the walk first reaches it.
// With depth above 1, `paths` gives 1 line for each node from step 2 on: the way from the start node to it.
// The walk follows the edges of the graph and, unless `crossLinks` is false, the cross links into and out of other graphs.
export function walk(graphs: GraphIndex[], graphId: string | undefined, id: string, options: WalkOptions = {}): Record<string, unknown> {
  const g = graphById(graphs, graphId);
  const start = nodeById(g, id);
  const direction = options.direction ?? 'both';
  const depth = options.depth ?? 1;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const withCross = options.crossLinks ?? true;
  if (!['out', 'in', 'both'].includes(direction)) throw new QueryError('The input "direction" must be "out", "in" or "both".');
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_WALK_DEPTH) throw new QueryError(`The input "depth" must be a whole number from 1 to ${MAX_WALK_DEPTH}.`);
  const edgeNames = new Set(graphs.flatMap((x) => [...Object.keys(x.index.profile.edges), ...(x.index.profile.crossLinks ?? []).map((c) => c.field)]));
  for (const e of options.edges ?? []) if (!edgeNames.has(e)) throw new QueryError(`Unknown edge "${e}". The edges are: ${[...edgeNames].join(', ')}.`);
  const kindNames = new Set(graphs.flatMap((x) => x.index.profile.kinds.map((k) => k.id)));
  for (const k of options.kinds ?? []) if (!kindNames.has(k)) throw new QueryError(`Unknown kind "${k}". The kinds are: ${[...kindNames].join(', ')}.`);
  const edgeFilter = options.edges?.length ? new Set(options.edges) : undefined;
  const kindFilter = options.kinds?.length ? new Set(options.kinds) : undefined;
  const incoming = withCross && direction !== 'out' ? incomingCrossLinks(graphs.map((x) => ({ id: x.id, label: x.label, model: x.index.model }))) : undefined;

  const key = (graph: string, nid: string) => `${graph}\u0000${nid}`;
  const name = (graph: string, nid: string) => (graph === g.id ? nid : `${graph}:${nid}`);
  const visited = new Set<string>([key(g.id, id)]);
  const pathOf = new Map<string, string>([[key(g.id, id), name(g.id, id)]]);
  const steps: { step: number; groups: WalkGroup[] }[] = [];
  const paths: string[] = [];
  let frontier: { gi: GraphIndex; node: VNode }[] = [{ gi: g, node: start }];
  let budget = limit;
  let omitted = 0;

  for (let level = 1; level <= depth && frontier.length && omitted === 0; level++) {
    const groups = new Map<string, WalkGroup>();
    const next: { gi: GraphIndex; node: VNode }[] = [];
    const cut = new Set<string>();
    const reach = (from: { gi: GraphIndex; node: VNode }, targetGraph: string, targetId: string, edge: string, dir: 'out' | 'in', label: string, cross: boolean, e?: VEdge) => {
      if (edgeFilter && !edgeFilter.has(edge)) return;
      const target = graphs.find((x) => x.id === targetGraph);
      const node = target?.index.byId.get(targetId);
      if (!target || !node) return;
      if (kindFilter && !kindFilter.has(node.kind)) return;
      const k = key(targetGraph, targetId);
      if (visited.has(k)) return;
      if (budget <= 0) {
        cut.add(k);
        return;
      }
      budget--;
      visited.add(k);
      const arrow = cross ? (dir === 'out' ? ` =${edge}=> ` : ` <=${edge}= `) : dir === 'out' ? ` -${edge}-> ` : ` <-${edge}- `;
      const path = pathOf.get(key(from.gi.id, from.node.id))! + arrow + name(targetGraph, targetId);
      pathOf.set(k, path);
      if (level > 1) paths.push(path);
      const status = target.index.profile.status ? statusOf(target.index, targetId).value : null;
      const groupKey = `${cross ? 'x' : 'e'}\u0000${edge}\u0000${dir}`;
      const group = groups.get(groupKey) ?? { edge, direction: dir, label, ...(cross ? { cross: true as const } : {}), nodes: [] };
      group.nodes.push({
        graph: targetGraph,
        id: targetId,
        kind: node.kind,
        title: node.title,
        status: status ?? null,
        ...(e?.p ? { props: e.p } : {}),
        ...(e?.n ? { note: e.n } : {}),
        ...(level > 1 ? { from: from.node.id } : {}),
      });
      groups.set(groupKey, group);
      next.push({ gi: target, node });
    };
    for (const from of frontier) {
      const profile = from.gi.index.profile;
      if (direction !== 'in') {
        for (const e of from.gi.index.out.get(from.node.id) ?? []) reach(from, from.gi.id, e.t, e.k, 'out', profile.edges[e.k]?.labels[0] ?? e.k, false, e);
      }
      if (direction !== 'out') {
        for (const e of from.gi.index.inc.get(from.node.id) ?? []) reach(from, from.gi.id, e.s, e.k, 'in', profile.edges[e.k]?.labels[1] ?? e.k, false, e);
      }
      if (withCross && direction !== 'in') {
        for (const c of from.gi.index.crossOut.get(from.node.id) ?? []) reach(from, c.graph, c.t, c.field, 'out', profile.crossLinks?.find((x) => x.field === c.field)?.label ?? c.field, true);
      }
      if (incoming && direction !== 'out') {
        for (const c of incoming.get(from.gi.id)?.get(from.node.id) ?? []) reach(from, c.graph, c.s, c.field, 'in', c.label, true);
      }
    }
    omitted = cut.size;
    if (groups.size) steps.push({ step: level, groups: [...groups.values()] });
    frontier = next;
  }
  const shown = steps.reduce((a, s) => a + s.groups.reduce((b, x) => b + x.nodes.length, 0), 0);
  return {
    graph: g.id,
    node: brief(start),
    direction,
    depth,
    total: shown,
    steps,
    ...(depth > 1 ? { paths } : {}),
    ...(omitted ? { truncated: { nodes: omitted }, note: `The limit of ${limit} nodes cut ${omitted} node(s). The walk stops at this step. Raise "limit" or narrow it with "edges" or "kinds".` } : {}),
  };
}

// ---------- gaps ----------

// The raw gaps of the nodes in `ids`, as the tool gaps and the check command read them.
export interface GapLists {
  status: (Brief & { status: string; tone: string | undefined })[];
  uncheckedParts: (Brief & { owner?: string })[];
  withoutSource: Brief[];
  unplaced: Brief[];
  unresolvedLinks: { from: string; edge: string; to: string }[];
  brokenCrossLinks: { from: string; field: string; graph: string; to: string }[];
  missingDeliverables: DeliverableFinding[];
}

// Finds the gaps of the nodes in `ids`. `graphs` are all graphs of the workspace, for the cross links.
export function gapLists(graphs: GraphIndex[], g: GraphIndex, ids: Set<string>): GapLists {
  const { index } = g;
  const p = index.profile;
  const inScope = (id: string) => ids.has(id);
  const tone = (v: string) => p.status?.values.find((x) => x.value === v)?.tone;
  const status = index.model.nodes.filter((n) => inScope(n.id) && n.status && tone(n.status) !== 'good').map((n) => ({ ...brief(n), status: n.status!, tone: tone(n.status!) }));
  const partKinds = new Set((p.parts ?? []).map((x) => x.kind));
  const checkEdge = p.checks && p.edges[p.checks.edge] ? p.checks.edge : undefined;
  const uncheckedParts = checkEdge ? index.model.nodes.filter((n) => inScope(n.id) && partKinds.has(n.kind) && !(index.out.get(n.id) ?? []).some((e) => e.k === checkEdge)).map((n) => ({ ...brief(n), ...(n.parents[0] ? { owner: n.parents[0] } : {}) })) : [];
  const source = sourceCheck(index, ids);
  const withoutSource = (source?.missing ?? []).map((m) => brief(index.byId.get(m)!));
  const unplaced = index.model.unplaced.filter(inScope).map((u) => brief(index.byId.get(u)!));
  const unresolvedLinks = index.model.unresolved.filter((u) => inScope(u.s)).map((u) => ({ from: u.s, edge: u.k, to: u.t }));
  const brokenCrossLinks: GapLists['brokenCrossLinks'] = [];
  for (const c of index.model.crossLinks as CrossLink[]) {
    if (!inScope(c.s)) continue;
    const target = graphs.find((x) => x.id === c.graph);
    if (target && !target.index.byId.has(c.t)) brokenCrossLinks.push({ from: c.s, field: c.field, graph: c.graph, to: c.t });
  }
  const missingDeliverables = deliverableFindings(index, g.id, ids);
  return { status, uncheckedParts, withoutSource, unplaced, unresolvedLinks, brokenCrossLinks, missingDeliverables };
}

// The gaps in a scope. A scope is a node id, or the whole graph when `scopeId` is not set.
export function gaps(graphs: GraphIndex[], graphId: string | undefined, scopeId?: string, limit = DEFAULT_LIMIT): Record<string, unknown> {
  const g = graphById(graphs, graphId);
  const { index } = g;
  const p = index.profile;
  if (scopeId !== undefined) nodeById(g, scopeId);
  const ids = scopeId === undefined ? new Set(index.model.nodes.map((n) => n.id)) : computeScope(index, { id: scopeId }).ids;
  const truncated: Truncated = {};
  const { status: badStatus, uncheckedParts: unchecked, withoutSource: noSource, unplaced, unresolvedLinks: unresolved, brokenCrossLinks: broken, missingDeliverables: missing } = gapLists(graphs, g, ids);
  const result = {
    graph: g.id,
    scope: scopeId ?? null,
    nodes: ids.size,
    counts: { status: badStatus.length, uncheckedParts: unchecked.length, withoutSource: noSource.length, unplaced: unplaced.length, unresolvedLinks: unresolved.length, brokenCrossLinks: broken.length, missingDeliverables: missing.length },
    ...(scopeId !== undefined && p.status ? { rollup: statusOf(index, scopeId) } : {}),
    status: cap(badStatus, limit, 'status', truncated),
    uncheckedParts: cap(unchecked, limit, 'uncheckedParts', truncated),
    withoutSource: cap(noSource, limit, 'withoutSource', truncated),
    unplaced: cap(unplaced, limit, 'unplaced', truncated),
    unresolvedLinks: cap(unresolved, limit, 'unresolvedLinks', truncated),
    brokenCrossLinks: cap(broken, limit, 'brokenCrossLinks', truncated),
    missingDeliverables: cap(missing, limit, 'missingDeliverables', truncated),
  };
  return withTruncated(result, truncated);
}

// ---------- deliverables ----------

export interface DeliverableReport {
  // The nodes of a kind with deliverables that the report looked at.
  nodes: number;
  findings: DeliverableFinding[];
}

export interface DeliverableOptions {
  // The graph to report. The default is every graph of the workspace, or the graph of the scope.
  graph?: string;
  // A node id. The report covers this node and the nodes in its scope.
  scope?: string;
  // Only the nodes of these kinds.
  kinds?: string[];
}

// Lists each node of a kind with deliverables and what it misses. `input` is a model, or the graphs of a workspace.
export function deliverableReport(input: Model | GraphIndex[], options: DeliverableOptions = {}): DeliverableReport {
  const graphs = Array.isArray(input) ? input : [{ id: 'graph', label: input.profile.project, index: buildIndex(input) }];
  const chosen = options.graph !== undefined || options.scope !== undefined ? [graphById(graphs, options.graph)] : graphs;
  const findings: DeliverableFinding[] = [];
  let nodes = 0;
  for (const g of chosen) {
    if (options.scope !== undefined) nodeById(g, options.scope);
    const ids = options.scope === undefined ? g.index.model.nodes.map((n) => n.id) : [...computeScope(g.index, { id: options.scope }).ids];
    const specs = g.index.profile.deliverables ?? {};
    nodes += ids.filter((id) => {
      const kind = g.index.byId.get(id)?.kind;
      return kind !== undefined && specs[kind] !== undefined && (!options.kinds?.length || options.kinds.includes(kind));
    }).length;
    findings.push(...deliverableFindings(g.index, g.id, ids, options.kinds));
  }
  return { nodes, findings };
}

// ---------- validate ----------

// The messages in `after` that `before` does not hold. A message that repeats counts by its number.
function added(after: string[], before: string[]): string[] {
  const left = new Map<string, number>();
  for (const m of before) left.set(m, (left.get(m) ?? 0) + 1);
  return after.filter((m) => {
    const n = left.get(m) ?? 0;
    if (n > 0) left.set(m, n - 1);
    return n === 0;
  });
}

const MISSING_LINKS = /^\d+ link\(s\) name a node that is not in the graph/;

// Checks 1 new node as if it were added to the graph. It reports only what the node adds: the unknown
// kind, the field types, the vocabulary codes, the link targets, the edge rules and the provenance rules.
// It changes nothing. `others` are the other graphs of the workspace, for the cross links.
export function validateNode(graph: Graph, profile: Profile, node: Record<string, unknown>, others: GraphIndex[] = [], today?: string): { valid: boolean; errors: string[]; warnings: string[] } {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return { valid: false, errors: ['The node must be an object.'], warnings: [] };
  const key = profile.source.nodes;
  const list = Array.isArray(graph[key]) ? (graph[key] as unknown[]) : [];
  const grown: Graph = { ...graph, [key]: [...list, node] };
  const before = validateGraph(graph, profile, undefined, today);
  const after = validateGraph(grown, profile, undefined, today);
  const errors = added(after.errors, before.errors);
  const warnings = added(after.warnings.filter((m) => !MISSING_LINKS.test(m)), before.warnings.filter((m) => !MISSING_LINKS.test(m)));
  const id = node[profile.source.id];
  const name = typeof id === 'string' && id ? `"${id}"` : 'the node';
  // The ids that a link can name: the nodes of the graph, the embedded nodes and the new node.
  let known: Set<string>;
  try {
    known = new Set(buildModel(grown, profile).nodes.map((n) => n.id));
  } catch {
    known = new Set(withIds(list, profile));
  }
  if (typeof id === 'string') known.add(id);
  const targets = (field: string, key2: string): string[] => {
    const v = node[field];
    if (!Array.isArray(v)) return [];
    return v.flatMap((item) => (typeof item === 'string' ? [item] : item && typeof item === 'object' && typeof (item as Record<string, unknown>)[key2] === 'string' ? [(item as Record<string, string>)[key2]] : []));
  };
  const linkChecks: [string, string][] = [
    ...allLinkFields(profile).map((f): [string, string] => [f, profile.edges[f]?.target ?? 'id']),
    ...refsOf(profile).map((r): [string, string] => [r.field, r.target]),
  ];
  for (const [field, targetKey] of linkChecks) {
    for (const t of targets(field, targetKey)) if (!known.has(t)) warnings.push(`${name} has the field "${field}" with the unknown node "${t}". The explorer skips the link.`);
  }
  const superseded = profile.supersededBy ? node[profile.supersededBy] : undefined;
  if (typeof superseded === 'string' && !known.has(superseded)) warnings.push(`${name} has the field "${profile.supersededBy}" with the unknown node "${superseded}". The explorer skips the link.`);
  const value = profile.status ? node[profile.status.field] : undefined;
  if (profile.status && value !== undefined && !profile.status.values.some((v) => v.value === value)) {
    warnings.push(`${name} has the field "${profile.status.field}" with the value ${JSON.stringify(value)}, which is not a status value. The values are: ${profile.status.values.map((v) => v.value).join(', ')}.`);
  }
  for (const c of profile.crossLinks ?? []) {
    const raw = node[c.field];
    const list2 = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    const target = others.find((o) => o.id === c.graph);
    if (list2.length && others.length && !target) errors.push(`${name} has the cross link field "${c.field}", which names the graph "${c.graph}". The workspace has no such graph.`);
    if (target) for (const t of list2) if (!target.index.byId.has(t)) warnings.push(`${name} has the cross link field "${c.field}" with the id "${t}", which is not a node of the graph "${c.graph}".`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

function withIds(list: unknown[], profile: Profile): string[] {
  return list.flatMap((n) => {
    const id = (n as Record<string, unknown> | null)?.[profile.source.id];
    return typeof id === 'string' ? [id] : [];
  });
}
