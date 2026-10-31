// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The slice of a node: 1 compact brief for an agent that starts a task on the node.
// The slice holds the node, its path to the root, its parts and checks, the linked nodes, the cross links with
// their definitions, the definitions of the coded values, the gaps and the nodes below it.
// The budget counts the characters of the Markdown text. When the text is longer, the slice drops the
// least important parts first and names each cut in `cut`.
import { gapLists, graphById, nodeById, plainFields, QueryError, type Brief, type GraphIndex } from './agent.js';
import { statusOf } from './explore.js';
import { getPath, refsOf } from './profile.js';
import { derivedEdgeName, provenanceFields, provenanceOf } from './provenance.js';
import type { Concept, Index, Profile, VNode } from './types.js';

export const DEFAULT_SLICE_BUDGET = 6000;
export const MAX_SLICE_DEPTH = 5;
// A statement of a linked node or of a cross link keeps this many characters in the first cut.
const SHORT_STATEMENT = 160;

export interface SliceOptions {
  graph?: string;
  id: string;
  // The levels of nodes below the node. The default is 1.
  depth?: number;
  // The approximate size of the Markdown text, in characters. The default is 6000.
  budget?: number;
}

export interface SliceStatus {
  value: string;
  label: string;
  tone: string | null;
}

export interface SliceCheck {
  id: string;
  title: string;
  type: string;
}

export interface SlicePart {
  id: string;
  title: string;
  text: string;
  status?: SliceStatus;
  checks: SliceCheck[];
}

export interface SliceLinked {
  id: string;
  kind: string;
  title: string;
  statement?: string;
  // out: the node links to this node. in: this node links to the node.
  direction: 'out' | 'in';
  edge: string;
  label: string;
  note?: string;
  props?: Record<string, unknown>;
  lifecycle: string;
}

export interface SliceCrossLink {
  field: string;
  label: string;
  graph: string;
  id: string;
  kind?: string;
  title?: string;
  statement?: string;
}

export interface SliceCode {
  vocabulary: string;
  vocabularyLabel: string;
  code: string;
  label: string;
  definition?: string;
  // Where the code is used: a field name, or "edge.property" for an edge property.
  at: string;
}

export interface SliceChild extends Brief {
  status?: SliceStatus;
  more?: number;
  children?: SliceChild[];
}

export interface Slice {
  graph: string;
  id: string;
  kind: string;
  kindLabel: string;
  title: string;
  statement?: string;
  lifecycle: string;
  status?: SliceStatus & { own: boolean };
  fields: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  // From the root down to the parent of the node. Each item has an id, a kind and a title.
  path: Brief[];
  parts: SlicePart[];
  // The checks of the node itself.
  checks: SliceCheck[];
  linked: SliceLinked[];
  crossLinks: SliceCrossLink[];
  codes: SliceCode[];
  gaps: {
    status: { id: string; title: string; status: string; label: string }[];
    missingChecks: Brief[];
    missingSources: Brief[];
    unresolvedLinks: { from: string; edge: string; to: string }[];
    brokenCrossLinks: { from: string; field: string; graph: string; to: string }[];
  };
  below: { depth: number; total: number; nodes: SliceChild[] };
  // What the slice cut to fit the budget. Absent when nothing was cut.
  cut?: string[];
}

// How much a build shows. The fit loop starts with everything and lowers a limit at each step.
interface Shape {
  childDepth: number;
  statementMax: number;
  childMax: number;
  codes: boolean;
}

const statusOfNode = (p: Profile, value: string | null, tone: string | null): SliceStatus | undefined => {
  if (!value) return undefined;
  return { value, label: p.status?.values.find((v) => v.value === value)?.label ?? value, tone };
};

const cutText = (text: string | undefined, max: number): string | undefined => {
  if (text === undefined || max === Infinity || text.length <= max) return text;
  if (max <= 0) return undefined;
  const space = text.lastIndexOf(' ', max);
  return `${text.slice(0, space > max / 2 ? space : max).trimEnd()}…`;
};

function validate(options: SliceOptions): { depth: number; budget: number } {
  const depth = options.depth ?? 1;
  const budget = options.budget ?? DEFAULT_SLICE_BUDGET;
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_SLICE_DEPTH) throw new QueryError(`The input "depth" must be a whole number from 1 to ${MAX_SLICE_DEPTH}.`);
  if (!Number.isInteger(budget) || budget < 1) throw new QueryError('The input "budget" must be a whole number from 1.');
  return { depth, budget };
}

// The coded values that the node uses, with the definition of each code.
function codesOf(index: Index, n: VNode, linked: SliceLinked[]): SliceCode[] {
  const p = index.profile;
  const out: SliceCode[] = [];
  const seen = new Set<string>();
  const add = (schemeId: string | undefined, value: unknown, at: string) => {
    const scheme = schemeId === undefined ? undefined : p.vocabularies?.[schemeId];
    if (!schemeId || !scheme || !Array.isArray(scheme.concepts)) return;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v !== 'string' && typeof v !== 'number') continue;
      const code = String(v);
      const concept: Concept | undefined = scheme.concepts.find((c) => c.code === code);
      const key = `${schemeId}\u0000${code}`;
      if (!concept || seen.has(key) || (!concept.definition && concept.label === code)) continue;
      seen.add(key);
      out.push({ vocabulary: schemeId, vocabularyLabel: scheme.label, code, label: concept.label, ...(concept.definition ? { definition: concept.definition } : {}), at });
    }
  };
  for (const [field, schemeId] of Object.entries(p.fieldVocabularies ?? {})) add(schemeId, getPath(n.d, field), field);
  const marker = p.provenance?.marker;
  if (marker) add(marker.vocabulary, getPath(n.d, marker.field), marker.field);
  for (const l of linked) {
    for (const [prop, value] of Object.entries(l.props ?? {})) add(p.edges[l.edge]?.properties?.[prop]?.vocabulary, value, `${l.edge}.${prop}`);
  }
  return out;
}

// The linked nodes of a node: the nodes of a linked kind that it links to, and the ones that link to it.
// An edge that places a node in the tree, joins a check or names the source is not a link here.
function linkedOf(g: GraphIndex, n: VNode, shape: Shape, counter: { cut: number }): SliceLinked[] {
  const { index } = g;
  const p = index.profile;
  const refEdges = new Set(refsOf(p).map((r) => r.field));
  const skip = new Set<string>([p.checks?.edge ?? '', ...(p.parts ?? []).map((x) => x.edge), ...(p.provenance ? [derivedEdgeName(p.provenance)] : [])]);
  const wanted = (edge: string, other: VNode | undefined) => other && !skip.has(edge) && !p.edges[edge]?.down && (other.kind !== undefined && p.kinds.find((k) => k.id === other.kind)?.role === 'linked' || refEdges.has(edge));
  // The source, date, agent and note of an edge are provenance, not a property of the link. The slice keeps the marker.
  const hidden = new Set(provenanceFields(p.provenance).filter((f) => f !== p.provenance?.marker?.field));
  const plain = (props?: Record<string, unknown>) => {
    const kept = Object.fromEntries(Object.entries(props ?? {}).filter(([k]) => !hidden.has(k)));
    return Object.keys(kept).length ? kept : undefined;
  };
  const make = (edge: string, other: VNode, direction: 'out' | 'in', note?: string, props?: Record<string, unknown>): SliceLinked => {
    const statement = cutText(other.statement || undefined, shape.statementMax);
    if (other.statement && statement !== other.statement) counter.cut++;
    return {
      id: other.id,
      kind: other.kind,
      title: other.title,
      ...(statement ? { statement } : {}),
      direction,
      edge,
      label: p.edges[edge]?.labels[direction === 'out' ? 0 : 1] ?? edge,
      ...(note ? { note } : {}),
      ...(props ? { props } : {}),
      lifecycle: other.lifecycle,
    };
  };
  const out: SliceLinked[] = [];
  for (const e of index.out.get(n.id) ?? []) {
    const other = index.byId.get(e.t);
    if (wanted(e.k, other)) out.push(make(e.k, other!, 'out', e.n, plain(e.p)));
  }
  for (const e of index.inc.get(n.id) ?? []) {
    const other = index.byId.get(e.s);
    if (wanted(e.k, other)) out.push(make(e.k, other!, 'in', e.n, plain(e.p)));
  }
  return out;
}

// The nodes below a node, to the depth of the shape. A part is not a child: the slice lists the parts apart.
function childrenOf(index: Index, id: string, level: number, shape: Shape, partKinds: Set<string>, seen: Set<string>): SliceChild[] {
  const p = index.profile;
  const kidsOf = (parent: string) => (index.scopeChildren.get(parent) ?? []).map((c) => index.byId.get(c)).filter((c): c is VNode => !!c && !partKinds.has(c.kind));
  const shown = kidsOf(id).filter((c) => !seen.has(c.id)).slice(0, shape.childMax);
  return shown.map((k) => {
    seen.add(k.id);
    const s = p.status ? statusOf(index, k.id) : undefined;
    const item: SliceChild = { id: k.id, kind: k.kind, title: k.title, ...(s?.value ? { status: statusOfNode(p, s.value, s.tone) } : {}) };
    const deeper = level < shape.childDepth ? childrenOf(index, k.id, level + 1, shape, partKinds, seen) : [];
    if (deeper.length) item.children = deeper;
    const more = kidsOf(k.id).length - deeper.length;
    if (more > 0) item.more = more;
    return item;
  });
}

function build(graphs: GraphIndex[], g: GraphIndex, n: VNode, depth: number, shape: Shape): Slice {
  const { index } = g;
  const p = index.profile;
  const partSpecs = p.parts ?? [];
  const partKinds = new Set(partSpecs.map((x) => x.kind));
  const checkEdge = p.checks?.edge;
  const checksOf = (id: string): SliceCheck[] =>
    checkEdge
      ? (index.out.get(id) ?? [])
          .filter((e) => e.k === checkEdge)
          .flatMap((e) => {
            const c = index.byId.get(e.t);
            return c ? [{ id: c.id, title: c.title, type: c.sub }] : [];
          })
      : [];

  const status = p.status ? statusOf(index, n.id) : undefined;
  const parts: SlicePart[] = partSpecs.length
    ? (index.inc.get(n.id) ?? [])
        .filter((e) => partSpecs.some((x) => x.edge === e.k) && partKinds.has(index.byId.get(e.s)?.kind ?? ''))
        .map((e) => index.byId.get(e.s)!)
        .map((c) => ({ id: c.id, title: c.title, text: c.statement, ...(c.status ? { status: statusOfNode(p, c.status, p.status?.values.find((v) => v.value === c.status)?.tone ?? null) } : {}), checks: checksOf(c.id) }))
    : [];

  const path: Brief[] = [];
  const seenUp = new Set<string>([n.id]);
  for (let at: VNode | undefined = n; at; ) {
    const up: VNode | undefined = at.up.map((u) => index.byId.get(u)).find((u): u is VNode => !!u && !seenUp.has(u.id));
    if (!up) break;
    seenUp.add(up.id);
    path.unshift({ id: up.id, kind: up.kind, title: up.title });
    at = up;
  }

  const counter = { cut: 0 };
  const linked = linkedOf(g, n, shape, counter);

  const crossLinks: SliceCrossLink[] = (index.crossOut.get(n.id) ?? []).map((c) => {
    const target = graphs.find((x) => x.id === c.graph)?.index.byId.get(c.t);
    const statement = cutText(target?.statement || undefined, shape.statementMax);
    if (target?.statement && statement !== target.statement) counter.cut++;
    return { field: c.field, label: p.crossLinks?.find((x) => x.field === c.field)?.label ?? c.field, graph: c.graph, id: c.t, ...(target ? { kind: target.kind, title: target.title } : {}), ...(statement ? { statement } : {}) };
  });

  const ids = new Set<string>([n.id, ...parts.map((x) => x.id)]);
  const found = gapLists(graphs, g, ids);
  const label = (v: string) => p.status?.values.find((x) => x.value === v)?.label ?? v;

  const prov = provenanceOf(p.provenance, n.d);
  const sourceNode = typeof prov.source === 'string' ? index.byId.get(prov.source) : undefined;

  const nodes = childrenOf(index, n.id, 1, shape, partKinds, new Set([n.id]));
  const total = countNodes(childrenOf(index, n.id, 1, { ...shape, childDepth: depth, childMax: Infinity }, partKinds, new Set([n.id])));

  const result: Slice = {
    graph: g.id,
    id: n.id,
    kind: n.kind,
    kindLabel: p.kinds.find((k) => k.id === n.kind)?.label ?? n.kind,
    title: n.title,
    ...(n.statement ? { statement: n.statement } : {}),
    lifecycle: n.lifecycle,
    ...(status?.value ? { status: { ...statusOfNode(p, status.value, status.tone)!, own: n.status !== undefined } } : {}),
    fields: plainFields(p, n),
    ...(Object.keys(prov).length ? { provenance: { ...prov, ...(sourceNode ? { sourceTitle: sourceNode.title } : {}) } } : {}),
    path,
    parts,
    checks: checksOf(n.id),
    linked,
    crossLinks,
    codes: shape.codes ? codesOf(index, n, linked) : [],
    gaps: {
      status: found.status.map((s) => ({ id: s.id, title: s.title, status: s.status, label: label(s.status) })),
      missingChecks: found.uncheckedParts.map(({ id, kind, title }) => ({ id, kind, title })),
      missingSources: found.withoutSource,
      unresolvedLinks: found.unresolvedLinks,
      brokenCrossLinks: found.brokenCrossLinks,
    },
    below: { depth: shape.childDepth, total, nodes },
  };
  const notes: string[] = [];
  const shown = countNodes(nodes);
  if (total > shown) notes.push(`${total - shown} of ${total} node(s) below the node are not listed.`);
  if (counter.cut) notes.push(shape.statementMax <= 0 ? `The statements of ${counter.cut} linked node(s) and cross link(s) are cut.` : `The statements of ${counter.cut} linked node(s) and cross link(s) are cut to ${shape.statementMax} characters.`);
  if (!shape.codes) notes.push('The definitions of the coded values are cut.');
  if (notes.length) result.cut = notes;
  return result;
}

const countNodes = (nodes: SliceChild[]): number => nodes.reduce((a, c) => a + 1 + countNodes(c.children ?? []), 0);

// The steps of the fit, from the least important cut to the most important one.
function shapes(depth: number): Shape[] {
  const list: Shape[] = [{ childDepth: depth, statementMax: Infinity, childMax: Infinity, codes: true }];
  const last = () => list[list.length - 1];
  for (let d = depth - 1; d >= 1; d--) list.push({ ...last(), childDepth: d });
  list.push({ ...last(), statementMax: SHORT_STATEMENT });
  list.push({ ...last(), statementMax: 0 });
  list.push({ ...last(), childMax: 10 });
  list.push({ ...last(), childMax: 0 });
  list.push({ ...last(), codes: false });
  return list;
}

// Builds the slice of 1 node. `graphs` are the graphs of the workspace, for the cross links.
export function slice(graphs: GraphIndex[], options: SliceOptions): Slice {
  const g = graphById(graphs, options.graph);
  const n = nodeById(g, options.id);
  const { depth, budget } = validate(options);
  let result = build(graphs, g, n, depth, shapes(depth)[0]);
  for (const shape of shapes(depth).slice(1)) {
    if (sliceMarkdown(result).length <= budget) break;
    result = build(graphs, g, n, depth, shape);
  }
  return result;
}

// ---------- Markdown ----------

const code = (s: string) => `\`${s}\``;
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const valueText = (v: unknown): string => (Array.isArray(v) ? v.map(valueText).join(', ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
const statusText = (s?: SliceStatus) => (s ? `${s.label}` : '');

// The slice as Markdown for an agent.
export function sliceMarkdown(s: Slice): string {
  const out: string[] = [];
  const line = (text = '') => out.push(text);
  const section = (title: string) => {
    line();
    line(`## ${title}`);
    line();
  };
  line(`# ${code(s.id)} ${s.title}`);
  line();
  const meta = [`Kind: ${s.kindLabel}`, `Graph: ${code(s.graph)}`, `Lifecycle: ${s.lifecycle}`, ...(s.status ? [`Status: ${s.status.label}${s.status.own ? '' : ' (rolled up from the nodes below)'}`] : [])];
  line(meta.join(' | '));
  if (s.statement) {
    line();
    line(oneLine(s.statement));
  }
  const fields = Object.entries(s.fields);
  if (fields.length) {
    section('Fields');
    for (const [k, v] of fields) line(`- ${k}: ${oneLine(valueText(v))}`);
  }
  if (s.provenance) {
    section('Provenance');
    for (const [k, v] of Object.entries(s.provenance)) line(`- ${k}: ${oneLine(valueText(v))}`);
  }
  if (s.path.length) {
    section('Path to the root');
    line(s.path.map((x) => `${code(x.id)} ${x.title}`).join(' > '));
  }
  if (s.parts.length) {
    section('Parts');
    for (const part of s.parts) {
      line(`- ${code(part.id)}${part.status ? ` [${statusText(part.status)}]` : ''} ${oneLine(part.text || part.title)}`);
      line(`  - ${part.checks.length ? `Checks: ${part.checks.map((c) => `${c.title}${c.type ? ` (${c.type})` : ''}`).join('; ')}` : 'No check.'}`);
    }
  }
  if (s.checks.length) {
    section('Checks');
    for (const c of s.checks) line(`- ${c.title}${c.type ? ` (${c.type})` : ''}`);
  }
  if (s.linked.length) {
    section('Linked nodes');
    for (const l of s.linked) {
      line(`- ${l.label}: ${code(l.id)} ${l.kind}, ${l.title}${l.lifecycle ? ` [${l.lifecycle}]` : ''}`);
      if (l.note) line(`  - Note: ${oneLine(l.note)}`);
      if (l.props) line(`  - ${Object.entries(l.props).map(([k, v]) => `${k}: ${valueText(v)}`).join(', ')}`);
      if (l.statement) line(`  - ${oneLine(l.statement)}`);
    }
  }
  if (s.crossLinks.length) {
    section('Cross links');
    for (const c of s.crossLinks) {
      line(`- ${c.label}: ${code(`${c.graph}:${c.id}`)}${c.title ? ` ${c.title}` : ' (missing)'}${c.kind ? ` [${c.kind}]` : ''}`);
      if (c.statement) line(`  - ${oneLine(c.statement)}`);
    }
  }
  if (s.codes.length) {
    section('Coded values');
    for (const c of s.codes) line(`- ${c.at} ${code(c.code)}: ${c.label}${c.definition ? `. ${oneLine(c.definition)}` : ''}`);
  }
  section('Gaps');
  const gaps = s.gaps;
  const none = !gaps.status.length && !gaps.missingChecks.length && !gaps.missingSources.length && !gaps.unresolvedLinks.length && !gaps.brokenCrossLinks.length;
  if (none) line('None.');
  for (const x of gaps.status) line(`- Status ${x.label}: ${code(x.id)} ${x.title}`);
  for (const x of gaps.missingChecks) line(`- No check: ${code(x.id)} ${x.title}`);
  for (const x of gaps.missingSources) line(`- No source: ${code(x.id)} ${x.title}`);
  for (const x of gaps.unresolvedLinks) line(`- Link to a missing node: ${code(x.from)} ${x.edge} ${code(x.to)}`);
  for (const x of gaps.brokenCrossLinks) line(`- Cross link to a missing node: ${code(x.from)} ${x.field} ${code(`${x.graph}:${x.to}`)}`);
  if (s.below.total) {
    section(`Below the node (${s.below.total}, to depth ${s.below.depth})`);
    const walk = (nodes: SliceChild[], indent: string) => {
      for (const c of nodes) {
        line(`${indent}- ${code(c.id)} ${c.title}${c.status ? ` [${c.status.label}]` : ''}${c.more ? ` (+${c.more})` : ''}`);
        walk(c.children ?? [], `${indent}  `);
      }
    };
    walk(s.below.nodes, '');
  }
  if (s.cut?.length) {
    section('Cut to fit the budget');
    for (const note of s.cut) line(`- ${note}`);
  }
  return `${out.join('\n')}\n`;
}
