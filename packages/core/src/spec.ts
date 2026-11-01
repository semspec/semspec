// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Markdown specification documents from the graph. An author writes a template. A marked section of the
// template holds the content that comes from the graph. `fillSpecs` replaces only the marked regions.
//   <!-- semspec:section shape=tree scope=some-id -->  ...  <!-- semspec:end -->
//   <!-- semspec:node id=some-id -->  ...  <!-- semspec:end -->
// The output has a stable order, holds no time and uses only relative links, so a second run changes nothing.
import { gapLists, plainFields, type GraphIndex } from './agent.js';
import { applyFilters, computeScope, statusOf } from './explore.js';
import { getPath, kindLabel, kindsWithRole } from './profile.js';
import { provenanceOf } from './provenance.js';
import { taggedLines } from './tagged.js';
import { conceptOf, fieldLabel, schemeOfField, sortConcepts } from './vocabulary.js';
import {
  SPEC_OPTIONS,
  SPEC_NODE_OPTIONS,
  SPEC_TRACE_COLUMNS,
  allowedOptionNames,
  isTrue,
  optionValueProblems,
  presetText,
  splitList,
  type RawOptions,
  type SpecShape,
  type SpecShow,
} from './spec-options.js';
import { parseSpecMarkers, type SpecMarker } from './spec-parse.js';
import type { Filters, Profile, VNode } from './types.js';

export * from './spec-options.js';
export * from './spec-parse.js';

// A Markdown file of a run. `path` is an absolute path with forward slashes. It decides the relative links.
// `name` is the text that a finding shows. The default is the path.
export interface SpecDocument {
  path: string;
  name?: string;
  text: string;
}

export interface SpecFinding {
  // error: the template or an option is not valid. stale: the text of a section differs from the graph.
  code: 'error' | 'stale';
  file: string;
  line: number;
  // The type and the options of the marker.
  section?: string;
  message: string;
}

export interface SpecResult {
  files: { path: string; name: string; text: string; changed: boolean }[];
  findings: SpecFinding[];
  // The number of marked sections in all documents.
  sections: number;
}

export interface SpecRunOptions {
  // Reserved for later options. The header line holds no version, so a new version changes no file.
  [key: string]: never;
}

const CELL_MAX = 120;
const TEXT_MAX = 160;

// ---------- text ----------

// Escapes the characters of Markdown in a value. A `<` and a `>` become entities, so no value holds a marker.
export function escapeMd(text: string): string {
  return text.replace(/[\\`*_[\]<>&|~]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : `\\${c}`));
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

const cut = (text: string, max: number): string => {
  const t = oneLine(text);
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

const esc = (text: string): string => escapeMd(oneLine(text));
const code = (text: string): string => `\`${oneLine(text).replace(/`/g, "'")}\``;
const attr = (text: string): string => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// The anchor name of a node of a graph. It is the node id, or the node id with the graph id as a prefix when the run
// anchors the same id for more than 1 graph.
type AnchorName = (graph: string, id: string) => string;
const anchorTag = (c: Ctx, id: string): string => `<a id="${attr(c.name(c.s.g.id, id))}"></a>`;
const fragment = (id: string): string => encodeURIComponent(id).replace(/\(/g, '%28').replace(/\)/g, '%29');

// The text of 1 paragraph or more. A blank line separates paragraphs. A line start that Markdown reads as a block is escaped.
function paragraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => escapeMd(oneLine(p)))
    .filter(Boolean)
    .map((p) => p.replace(/^(#{1,6}(?=\s)|[-+](?=\s)|\d+(?=[.)]\s))/, '\\$1'));
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function tableLines(headers: string[], rows: string[][]): string[] {
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)];
}

// The path from the file `from` to the file `to`. Both are absolute with forward slashes.
export function relativePath(from: string, to: string): string {
  const a = from.split('/').slice(0, -1);
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const rel = [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
  return rel.split('/').map((s) => (s === '..' ? s : encodeURIComponent(s))).join('/');
}

// ---------- options ----------

interface Section {
  doc: SpecDocument;
  marker: SpecMarker;
  g: GraphIndex;
  shape: SpecShape;
  scope?: string;
  depth?: number;
  kinds?: string[];
  lifecycles: string[];
  statuses: string[];
  deliveries: string[];
  markers: string[];
  levels?: string[];
  fields: Record<string, string[]>;
  ids?: string[];
  columns?: string[];
  show: Set<SpecShow>;
  conditions: 'list' | 'table';
  sort?: string;
  empty: string;
  level: number;
  self: boolean;
  vocabulary?: string;
}

const DEFAULT_SHOW: Record<SpecShape, SpecShow[]> = {
  tree: ['statement', 'conditions'],
  list: ['statement'],
  table: [],
  traceability: [],
  glossary: ['statement'],
  gaps: [],
};

const markerText = (m: SpecMarker): string => `${m.type} ${Object.entries(m.options).map(([k, v]) => `${k}=${/^[^\s"']+$/.test(v) ? v : JSON.stringify(v)}`).join(' ')}`.trim();

// The options of a marker after the preset, with the problems. A problem is a sentence for the author.
function resolveSection(graphs: GraphIndex[], doc: SpecDocument, marker: SpecMarker): { section?: Section; problems: string[] } {
  const problems: string[] = [];
  let raw: RawOptions;
  if (marker.type === 'node') {
    for (const k of Object.keys(marker.options)) if (!(SPEC_NODE_OPTIONS as readonly string[]).includes(k)) problems.push(`The option "${k}" is not an option of a node marker. The options are: ${SPEC_NODE_OPTIONS.join(', ')}.`);
    if (!marker.options.id) problems.push('The node marker needs the option id.');
    const { id, ...rest } = marker.options;
    raw = { ...rest, ids: id ?? '', shape: 'tree', depth: '0' };
  } else raw = { ...marker.options };
  if (!graphs.length) return { problems: ['The workspace has no graph.', ...problems] };
  const findGraph = (id: string | undefined): GraphIndex | undefined => (id === undefined ? graphs[0] : graphs.find((x) => x.id === id));
  const home = findGraph(raw.graph);
  if (!home) return { problems: [`Unknown graph "${raw.graph}". The graphs are: ${graphs.map((x) => x.id).join(', ')}.`, ...problems] };
  if (marker.type === 'section' && raw.use !== undefined) {
    const presets = home.index.profile.spec?.presets ?? {};
    const preset = presets[raw.use];
    if (!preset) problems.push(`Unknown preset "${raw.use}". ${Object.keys(presets).length ? `The presets are: ${Object.keys(presets).join(', ')}.` : 'The profile has no preset.'}`);
    else {
      const base: RawOptions = {};
      for (const [k, v] of Object.entries(preset)) {
        const text = presetText(v);
        if (text !== undefined) base[k] = text;
      }
      const { use: _use, ...own } = raw;
      raw = { ...base, ...own };
    }
  }
  const g = findGraph(raw.graph);
  if (!g) return { problems: [`Unknown graph "${raw.graph}". The graphs are: ${graphs.map((x) => x.id).join(', ')}.`, ...problems] };
  const p = g.index.profile;
  const allowed = allowedOptionNames(p, false);
  if (marker.type === 'section') for (const k of Object.keys(raw)) if (!allowed.includes(k)) problems.push(`Unknown option "${k}". The options are: ${allowed.join(', ')}.`);
  problems.push(...optionValueProblems(raw, p));
  const shape = (raw.shape ?? 'list') as SpecShape;
  const list = (name: string): string[] | undefined => (raw[name] === undefined ? undefined : splitList(raw[name]));
  const byId = g.index.byId;
  if (raw.scope !== undefined && !byId.has(raw.scope)) problems.push(`Unknown node id "${raw.scope}" in the option scope, in the graph "${g.id}".`);
  const ids = list('ids');
  for (const id of ids ?? []) if (!byId.has(id)) problems.push(`Unknown node id "${id}" in the graph "${g.id}".`);
  if (raw.vocabulary !== undefined && !p.vocabularies?.[raw.vocabulary]) problems.push(`Unknown vocabulary "${raw.vocabulary}" in the graph "${g.id}".`);
  const columns = list('columns');
  if (shape === 'traceability') for (const c of columns ?? []) if (!(SPEC_TRACE_COLUMNS as readonly string[]).includes(c)) problems.push(`The option columns has the name "${c}", which the shape traceability does not know. The names are: ${SPEC_TRACE_COLUMNS.join(', ')}.`);
  if (problems.length) return { problems };
  const statusCode = (v: string): string => p.status?.values.find((x) => x.value === v || x.label.toLowerCase() === v.toLowerCase())?.value ?? v;
  const fields: Record<string, string[]> = {};
  const filterNames = (p.fieldFilters ?? []).map((f) => f.field);
  for (const name of filterNames) if (raw[name] !== undefined && !(SPEC_OPTIONS as readonly string[]).includes(name)) fields[name] = splitList(raw[name]).map((v) => codeOf(p, name, v));
  const hasLevelFilter = raw.priority !== undefined && !filterNames.includes('priority');
  const show = new Set<SpecShow>(raw.show === undefined ? DEFAULT_SHOW[shape] : (splitList(raw.show) as SpecShow[]));
  return {
    problems,
    section: {
      doc,
      marker,
      g,
      shape,
      scope: raw.scope,
      depth: raw.depth === undefined ? undefined : Number(raw.depth),
      kinds: list('kinds'),
      lifecycles: (list('lifecycle') ?? []).map((v) => codeOf(p, p.lifecycle.field, v)),
      statuses: (list('status') ?? []).map(statusCode),
      deliveries: list('delivery') ?? [],
      markers: list('marker') ?? [],
      levels: hasLevelFilter ? list('priority') : undefined,
      fields,
      ids,
      columns,
      show,
      conditions: (raw.conditions ?? 'list') as 'list' | 'table',
      sort: raw.sort,
      empty: raw.empty ?? '',
      level: raw.level === undefined ? 2 : Number(raw.level),
      self: raw.self === undefined ? true : isTrue(raw.self),
      vocabulary: raw.vocabulary,
    },
  };
}

// The code of a value that the author wrote as a code or as a label of the vocabulary of the field.
function codeOf(p: Profile, field: string, value: string): string {
  const found = schemeOfField(p, field);
  if (found) {
    if (conceptOf(found.scheme, value)) return value;
    const code = found.scheme.concepts.find((c) => c.label.toLowerCase() === value.toLowerCase())?.code;
    if (code !== undefined) return code;
  }
  const values = p.fieldFilters?.find((f) => f.field === field)?.values;
  if (!values || Object.prototype.hasOwnProperty.call(values, value)) return value;
  return Object.entries(values).find(([, label]) => label.toLowerCase() === value.toLowerCase())?.[0] ?? value;
}

// ---------- select ----------

function selectIds(s: Section): string[] {
  const { index } = s.g;
  const p = index.profile;
  const all = index.model.nodes.map((n) => n.id);
  let base: Set<string>;
  if (s.scope !== undefined) base = computeScope(index, { id: s.scope, maxDepth: s.depth }).ids;
  else base = new Set(all);
  if (s.ids) base = s.scope === undefined ? new Set(s.ids) : new Set(s.ids.filter((id) => base.has(id)));
  const filters: Filters = { q: '', kinds: s.kinds ?? [], lifecycles: s.lifecycles, deliveries: s.deliveries, modules: [], statuses: s.statuses, markers: s.markers, fields: s.fields };
  let ids = applyFilters(index, all.filter((id) => base.has(id)), filters);
  if (!s.kinds) {
    // Without kinds, a shape lists the nodes of the hierarchy. A glossary also lists the linked nodes.
    const hierarchy = kindsWithRole(p, ...(s.shape === 'glossary' ? (['hierarchy', 'linked'] as const) : (['hierarchy'] as const)));
    const owners = (p.parts ?? []).map((x) => x.owner);
    const wanted = s.shape === 'gaps' || s.ids ? undefined : s.shape === 'traceability' ? owners : hierarchy;
    if (wanted) ids = ids.filter((id) => wanted.includes(index.byId.get(id)!.kind));
  }
  if (s.levels) ids = ids.filter((id) => s.levels!.includes(index.byId.get(id)!.level));
  if (s.scope !== undefined && !s.self) ids = ids.filter((id) => id !== s.scope);
  return sortIds(s, ids);
}

function sortIds(s: Section, ids: string[]): string[] {
  const { index } = s.g;
  const p = index.profile;
  const order = new Map(index.model.nodes.map((n, i) => [n.id, i]));
  const sort = s.sort ?? (s.shape === 'glossary' ? 'title' : 'model');
  const node = (id: string) => index.byId.get(id)!;
  const statusRank = (id: string) => {
    const v = statusOf(index, id).value;
    const i = p.status?.values.findIndex((x) => x.value === v) ?? -1;
    return i < 0 ? 1e6 : i;
  };
  const key = (id: string): string | number => {
    if (sort === 'id') return id;
    if (sort === 'title') return node(id).title.toLowerCase();
    if (sort === 'kind') return p.kinds.findIndex((k) => k.id === node(id).kind);
    if (sort === 'lifecycle') return node(id).lifecycle;
    if (sort === 'status') return statusRank(id);
    if (sort === 'ids') return s.ids?.indexOf(id) ?? 0;
    return 0;
  };
  return [...ids].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const c = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : compare(String(ka), String(kb));
    return c || order.get(a)! - order.get(b)!;
  });
}

// ---------- render ----------

interface Ctx {
  graphs: GraphIndex[];
  s: Section;
  // The link to a node in the run, or undefined when no document of the run holds the node.
  href: (graph: string, id: string) => string | undefined;
  name: AnchorName;
  anchored: Set<string>;
}

type Block = { t: 'p' | 'ul' | 'table'; lines: string[] };

const profileOf = (c: Ctx): Profile => c.s.g.index.profile;

function nodeRef(c: Ctx, graphId: string, id: string): string {
  const n = c.graphs.find((x) => x.id === graphId)?.index.byId.get(id);
  if (!n) return code(id);
  const href = c.href(graphId, id);
  return href ? `[${esc(n.title || id)}](${href})` : `${esc(n.title || id)} (${code(id)})`;
}

// A reference to a node by its id. A part has no anchor, so it links to its owner.
function idRef(c: Ctx, n: VNode): string {
  let href = c.href(c.s.g.id, n.id);
  if (!href && n.parents[0]) href = c.href(c.s.g.id, n.parents[0]);
  return href ? `[${code(n.id)}](${href})` : code(n.id);
}

function valueLabel(p: Profile, field: string, value: unknown): string {
  if (Array.isArray(value)) {
    const tagged = (p.details?.taggedLists ?? []).find((t) => t.field === field);
    if (value.every((x) => typeof x === 'object' && x !== null && !Array.isArray(x))) return value.map((x) => taggedLines(x, tagged?.labels).join('; ')).join('; ');
    return value.map((x) => valueLabel(p, field, x)).join(', ');
  }
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  const text = String(value);
  const label = fieldLabel(p, field, text);
  return label !== text ? label : p.fieldFilters?.find((f) => f.field === field)?.values?.[text] ?? text;
}

const fieldTitle = (p: Profile, field: string): string => p.fieldFilters?.find((f) => f.field === field)?.label ?? p.details?.properties?.find((x) => x.field === field)?.label ?? field;

const filled = (v: unknown): boolean => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

function statusLabelOf(p: Profile, value: string | null | undefined): string {
  return value ? p.status?.values.find((v) => v.value === value)?.label ?? value : '';
}

const lifecycleLabel = (p: Profile, n: VNode): string => fieldLabel(p, p.lifecycle.field, n.lifecycle);

function partsOf(c: Ctx, id: string): VNode[] {
  const { index } = c.s.g;
  const p = index.profile;
  return (index.inc.get(id) ?? []).filter((e) => (p.parts ?? []).some((x) => x.edge === e.k && x.kind === index.byId.get(e.s)?.kind)).map((e) => index.byId.get(e.s)!);
}

function testsOf(c: Ctx, id: string): VNode[] {
  const { index } = c.s.g;
  const edge = index.profile.checks?.edge;
  return (index.out.get(id) ?? []).filter((e) => e.k === edge).map((e) => index.byId.get(e.t)!).filter(Boolean);
}

const testsTitle = (p: Profile): string => p.checks?.sectionTitle ?? 'Checks';
const noTests = (p: Profile): string => p.checks?.noneText ?? 'None';
const partLabel = (p: Profile): string => {
  const kinds = [...new Set((p.parts ?? []).map((x) => x.kind))];
  return kinds.length === 1 ? kindLabel(p, kinds[0]) : 'Part';
};
const ownerLabel = (p: Profile): string => {
  const kinds = [...new Set((p.parts ?? []).map((x) => x.owner))];
  return kinds.length === 1 ? kindLabel(p, kinds[0]) : 'Node';
};

function fieldLines(c: Ctx, n: VNode): string[] {
  const p = profileOf(c);
  const lines = [`- Kind: ${esc(kindLabel(p, n.kind))}`, `- Id: ${code(n.id)}`, `- ${esc(schemeOfField(p, p.lifecycle.field)?.scheme.label ?? 'Lifecycle')}: ${esc(lifecycleLabel(p, n))}`];
  if (p.status) {
    const st = statusOf(c.s.g.index, n.id);
    if (st.total) lines.push(`- ${esc(p.status.label)}: ${esc(statusLabelOf(p, st.value))}`);
  }
  for (const [field, value] of Object.entries(plainFields(p, n))) if (filled(value)) lines.push(`- ${esc(fieldTitle(p, field))}: ${esc(valueLabel(p, field, value))}`);
  return lines;
}

function linkLines(c: Ctx, n: VNode): string[] {
  const { index } = c.s.g;
  const p = index.profile;
  const skip = new Set<string>([p.checks?.edge ?? '', ...(p.parts ?? []).map((x) => x.edge)]);
  const groups = new Map<string, string[]>();
  const add = (label: string, text: string) => groups.set(label, [...(groups.get(label) ?? []), text]);
  for (const e of index.out.get(n.id) ?? []) if (!skip.has(e.k) && !p.edges[e.k]?.down) add(p.edges[e.k]?.labels[0] ?? e.k, nodeRef(c, c.s.g.id, e.t) + (e.n ? ` (${esc(e.n)})` : ''));
  for (const e of index.inc.get(n.id) ?? []) if (!skip.has(e.k) && !p.edges[e.k]?.down) add(p.edges[e.k]?.labels[1] ?? e.k, nodeRef(c, c.s.g.id, e.s) + (e.n ? ` (${esc(e.n)})` : ''));
  return [...groups].map(([label, refs]) => `- ${esc(label)}: ${refs.join(', ')}`);
}

function crossLines(c: Ctx, n: VNode): string[] {
  const { index } = c.s.g;
  const p = index.profile;
  const groups = new Map<string, string[]>();
  for (const x of index.crossOut.get(n.id) ?? []) {
    const label = p.crossLinks?.find((s) => s.field === x.field)?.label ?? x.field;
    groups.set(label, [...(groups.get(label) ?? []), nodeRef(c, x.graph, x.t)]);
  }
  return [...groups].map(([label, refs]) => `- ${esc(label)}: ${refs.join(', ')}`);
}

function provenanceLines(c: Ctx, n: VNode): string[] {
  const p = profileOf(c);
  const v = provenanceOf(p.provenance, n.d);
  const lines: string[] = [];
  if (v.marker !== undefined) {
    const scheme = p.provenance?.marker ? p.vocabularies?.[p.provenance.marker.vocabulary] : undefined;
    lines.push(`- ${esc(p.provenance?.label ?? 'Provenance')}: ${esc(scheme && Array.isArray(scheme.concepts) ? conceptOf(scheme, String(v.marker))?.label ?? String(v.marker) : String(v.marker))}`);
  }
  if (v.source !== undefined) lines.push(`- Source: ${p.provenance?.source?.kind && typeof v.source === 'string' && c.s.g.index.byId.has(v.source) ? nodeRef(c, c.s.g.id, v.source) : esc(String(v.source))}`);
  if (v.retrieved !== undefined) lines.push(`- Retrieved: ${esc(String(v.retrieved))}`);
  if (v.agent !== undefined) lines.push(`- Agent: ${esc(String(v.agent))}`);
  if (v.note !== undefined) lines.push(`- Provenance note: ${esc(String(v.note))}`);
  return lines;
}

function conditionBlocks(c: Ctx, n: VNode): Block[] {
  const p = profileOf(c);
  const parts = partsOf(c, n.id);
  if (!parts.length) return [];
  const withTests = c.s.show.has('tests');
  const key = (x: VNode) => String(x.d.id || x.id.split('#').slice(1).join('#'));
  const status = (x: VNode) => (x.status ? statusLabelOf(p, x.status) : '');
  const tests = (x: VNode) => testsOf(c, x.id).map((t) => esc(t.title)).join('; ');
  const title: Block = { t: 'p', lines: [`**${esc(p.parts?.find((x) => x.kind === parts[0].kind)?.sectionTitle ?? partLabel(p))}**`] };
  if (c.s.conditions === 'table') {
    const headers = ['Id', esc(partLabel(p)), ...(p.status ? [esc(p.status.label)] : []), ...(withTests ? [esc(testsTitle(p))] : [])];
    const rows = parts.map((x) => [`${anchorTag(c, x.id)}${code(key(x))}`, esc(cut(x.statement || x.title, CELL_MAX)), ...(p.status ? [esc(status(x))] : []), ...(withTests ? [tests(x) || esc(noTests(p))] : [])]);
    return [title, { t: 'table', lines: tableLines(headers, rows) }];
  }
  const lines: string[] = [];
  for (const x of parts) {
    lines.push(`- ${anchorTag(c, x.id)}${code(key(x))}${status(x) ? ` (${esc(status(x))})` : ''}: ${esc(x.statement || x.title)}`);
    if (withTests) lines.push(`  - ${esc(testsTitle(p))}: ${tests(x) || esc(noTests(p))}`);
  }
  return [title, { t: 'ul', lines }];
}

function detailBlocks(c: Ctx, n: VNode, skipStatement = false): Block[] {
  const show = c.s.show;
  const blocks: Block[] = [];
  if (show.has('statement') && n.statement && !skipStatement) for (const text of paragraphs(n.statement)) blocks.push({ t: 'p', lines: [text] });
  const info = [
    ...(show.has('fields') ? fieldLines(c, n) : []),
    ...(show.has('links') ? linkLines(c, n) : []),
    ...(show.has('crosslinks') ? crossLines(c, n) : []),
    ...(show.has('provenance') ? provenanceLines(c, n) : []),
  ];
  const own = show.has('tests') ? testsOf(c, n.id) : [];
  if (own.length) info.push(`- ${esc(testsTitle(profileOf(c)))}: ${own.map((t) => esc(t.title)).join('; ')}`);
  if (info.length) blocks.push({ t: 'ul', lines: info });
  if (show.has('conditions')) blocks.push(...conditionBlocks(c, n));
  return blocks;
}

const headingMark = (c: Ctx, depth: number): string => '#'.repeat(Math.min(6, c.s.level + depth));

function heading(c: Ctx, n: VNode, depth: number): string {
  c.anchored.add(n.id);
  return `${headingMark(c, depth)} ${anchorTag(c, n.id)}${esc(n.title || n.id)}`;
}

function renderTree(c: Ctx, ids: string[]): string[] {
  const { index } = c.s.g;
  const chosen = new Set(ids);
  const kids = new Map<string, string[]>();
  const roots: string[] = [];
  for (const id of ids) {
    const parents = index.byId.get(id)!.parents.filter((x) => chosen.has(x) && x !== id);
    if (!parents.length) roots.push(id);
    else kids.set(parents[0], [...(kids.get(parents[0]) ?? []), id]);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string, depth: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    const n = index.byId.get(id)!;
    out.push([heading(c, n, depth), ...detailBlocks(c, n).flatMap((b) => ['', ...b.lines])].join('\n'));
    if (c.s.depth === undefined || depth < c.s.depth) for (const k of kids.get(id) ?? []) visit(k, depth + 1);
  };
  roots.forEach((r) => visit(r, 0));
  // A cycle has no root. Its nodes come last.
  if (c.s.depth === undefined) ids.forEach((id) => visit(id, 0));
  return out;
}

function renderList(c: Ctx, ids: string[]): string[] {
  const { index } = c.s.g;
  const lines: string[] = [];
  for (const id of ids) {
    const n = index.byId.get(id)!;
    c.anchored.add(id);
    const statement = c.s.show.has('statement') && n.statement ? `: ${paragraphs(n.statement).join(' ')}` : '';
    lines.push(`- ${anchorTag(c, id)}**${esc(n.title || id)}**${statement}`);
    // A title of a block is a bullet. The block below it sits 1 level deeper.
    let nest = '';
    for (const b of detailBlocks(c, n, true)) {
      if (b.t === 'table') lines.push('');
      if (b.t === 'p') nest = '  ';
      lines.push(...b.lines.map((l) => (b.t === 'p' ? `  - ${l}` : `  ${nest}${l}`)));
    }
  }
  return lines.length ? [lines.join('\n')] : [];
}

function columnTitle(p: Profile, name: string): string {
  const titles: Record<string, string> = { id: 'Id', title: 'Title', kind: 'Kind', lifecycle: 'Lifecycle', status: p.status?.label ?? 'Status', statement: 'Statement', delivery: 'Delivery', level: 'Level', parent: 'Parent' };
  return esc(titles[name] ?? fieldTitle(p, name));
}

function renderTable(c: Ctx, ids: string[]): string[] {
  const { index } = c.s.g;
  const p = index.profile;
  const columns = c.s.columns?.length ? c.s.columns : ['id', 'title', 'kind', 'lifecycle', 'status'];
  const rows = ids.map((id) => {
    const n = index.byId.get(id)!;
    c.anchored.add(id);
    return columns.map((col, i) => {
      let cell: string;
      if (col === 'id') cell = code(n.id);
      else if (col === 'title') cell = esc(cut(n.title || n.id, CELL_MAX));
      else if (col === 'kind') cell = esc(kindLabel(p, n.kind));
      else if (col === 'lifecycle') cell = esc(lifecycleLabel(p, n));
      else if (col === 'status') cell = esc(statusLabelOf(p, statusOf(index, id).value));
      else if (col === 'statement') cell = esc(cut(n.statement, CELL_MAX));
      else if (col === 'delivery') cell = esc(n.delivery);
      else if (col === 'level') cell = esc(n.level);
      else if (col === 'parent') cell = n.parents[0] ? nodeRef(c, c.s.g.id, n.parents[0]) : '';
      else {
        const v = getPath(n.d, col);
        cell = filled(v) ? esc(cut(valueLabel(p, col, v), CELL_MAX)) : '';
      }
      return (i === 0 ? anchorTag(c, id) : '') + cell;
    });
  });
  return rows.length ? [tableLines(columns.map((col) => columnTitle(p, col)), rows).join('\n')] : [];
}

function renderTrace(c: Ctx, ids: string[]): string[] {
  const { index } = c.s.g;
  const p = index.profile;
  const columns = c.s.columns?.length ? c.s.columns : ['requirement', 'condition', 'status', 'tests'];
  const titles: Record<string, string> = { requirement: ownerLabel(p), id: 'Id', condition: partLabel(p), key: `${partLabel(p)} id`, status: p.status?.label ?? 'Status', tests: testsTitle(p) };
  const rows: string[][] = [];
  for (const id of ids) {
    const n = index.byId.get(id)!;
    partsOf(c, id).forEach((part, row) => {
      if (row === 0) c.anchored.add(id);
      const key = String(part.d.id || part.id.split('#').slice(1).join('#'));
      const tests = testsOf(c, part.id).map((t) => esc(cut(t.title, CELL_MAX))).join('; ');
      rows.push(
        columns.map((col, i) => {
          let cell = '';
          if (col === 'requirement') cell = esc(cut(n.title || n.id, CELL_MAX));
          else if (col === 'id') cell = code(n.id);
          else if (col === 'condition') cell = `${code(key)} ${esc(cut(part.statement || part.title, TEXT_MAX))}`;
          else if (col === 'key') cell = code(key);
          else if (col === 'status') cell = esc(statusLabelOf(p, part.status));
          else if (col === 'tests') cell = tests || esc(noTests(p));
          return (i === 0 && row === 0 ? anchorTag(c, id) : '') + cell;
        }),
      );
    });
  }
  return rows.length ? [tableLines(columns.map((x) => esc(titles[x])), rows).join('\n')] : [];
}

function renderGlossary(c: Ctx, ids: string[]): string[] {
  const { index } = c.s.g;
  const p = index.profile;
  const out: string[] = [];
  if (c.s.vocabulary !== undefined) {
    const scheme = p.vocabularies![c.s.vocabulary];
    const concepts = c.s.sort === undefined ? sortConcepts(scheme.concepts) : [...scheme.concepts].sort((a, b) => compare(a.label.toLowerCase(), b.label.toLowerCase()));
    for (const concept of concepts) {
      const id = `${c.s.vocabulary}.${concept.code}`;
      c.anchored.add(id);
      const lines = [`${headingMark(c, 0)} ${anchorTag(c, id)}${esc(concept.label)}`];
      if (concept.definition) lines.push('', ...paragraphs(concept.definition));
      const facts = [`- Code: ${code(concept.code)}`];
      if (concept.altLabels?.length) facts.push(`- Also called: ${concept.altLabels.map(esc).join(', ')}`);
      if (concept.broader) facts.push(`- Broader: ${esc(conceptOf(scheme, concept.broader)?.label ?? concept.broader)}`);
      out.push([...lines, '', ...facts].join('\n'));
    }
    return out;
  }
  for (const id of ids) {
    const n = index.byId.get(id)!;
    if (!n.statement) continue;
    c.anchored.add(id);
    const synonyms = [...new Set((p.search?.synonymFields ?? []).flatMap((f) => (Array.isArray(n.d[f]) ? n.d[f] : [n.d[f]]).filter((x: unknown) => typeof x === 'string' && x !== '' && x !== n.title) as string[]))];
    const blocks: string[] = [];
    if (c.s.show.has('statement')) blocks.push(paragraphs(n.statement).join('\n\n'));
    if (synonyms.length) blocks.push(`Also called: ${synonyms.map(esc).join(', ')}`);
    for (const b of detailBlocks({ ...c, s: { ...c.s, show: new Set([...c.s.show].filter((x) => x !== 'statement')) } }, n)) blocks.push(b.lines.join('\n'));
    out.push([heading(c, n, 0), ...blocks.flatMap((b) => ['', b])].join('\n'));
  }
  return out;
}

function renderGaps(c: Ctx, ids: string[]): string[] {
  const { index } = c.s.g;
  const p = index.profile;
  const lists = gapLists(c.graphs, c.s.g, new Set(ids));
  const node = (id: string) => index.byId.get(id)!;
  const groups: [string, string[]][] = [];
  const add = (title: string, items: string[]) => items.length && groups.push([title, items]);
  const good = p.status?.values.find((v) => v.tone === 'good');
  add(
    good ? `${p.status!.label} is not ${good.label}` : 'Status',
    lists.status.map((x) => `- ${idRef(c, node(x.id))} (${esc(statusLabelOf(p, x.status))}): ${esc(cut(node(x.id).statement || x.title, TEXT_MAX))}`),
  );
  add(
    `Without ${(p.checks?.sectionTitle ?? 'checks').toLowerCase()}`,
    lists.uncheckedParts.map((x) => `- ${idRef(c, node(x.id))}: ${esc(cut(node(x.id).statement || x.title, TEXT_MAX))}`),
  );
  const unchecked = new Set(lists.uncheckedParts.map((x) => x.id));
  add(
    'Missing deliverables',
    lists.missingDeliverables.filter((d) => !(d.deliverable === 'checks' && unchecked.has(d.item))).map((d) => `- ${idRef(c, node(d.node))}: ${esc(d.message)}`),
  );
  add('Not placed in the hierarchy', lists.unplaced.map((x) => `- ${idRef(c, node(x.id))}: ${esc(x.title)}`));
  add('Without a source', lists.withoutSource.map((x) => `- ${idRef(c, node(x.id))}: ${esc(x.title)}`));
  add('Unresolved links', lists.unresolvedLinks.map((x) => `- ${idRef(c, node(x.from))}: ${esc(x.edge)} to ${code(x.to)}`));
  add('Broken cross links', lists.brokenCrossLinks.map((x) => `- ${idRef(c, node(x.from))}: ${esc(x.field)} to ${code(`${x.graph}:${x.to}`)}`));
  return groups.map(([title, items]) => `${headingMark(c, 0)} ${esc(title)}\n\n${items.join('\n')}`);
}

// The Markdown blocks of 1 section, and the ids that got an anchor.
function renderSection(graphs: GraphIndex[], s: Section, href: Ctx['href'], name: AnchorName = (_graph, id) => id): { body: string; anchored: Set<string> } {
  const c: Ctx = { graphs, s, href, name, anchored: new Set() };
  const ids = selectIds(s);
  const blocks =
    s.shape === 'tree' ? renderTree(c, ids) : s.shape === 'list' ? renderList(c, ids) : s.shape === 'table' ? renderTable(c, ids) : s.shape === 'traceability' ? renderTrace(c, ids) : s.shape === 'glossary' ? renderGlossary(c, ids) : renderGaps(c, ids);
  return { body: blocks.length ? blocks.join('\n\n') : s.empty, anchored: c.anchored };
}

// ---------- fill ----------

const HEADER = '<!-- generated by semspec; do not edit this section -->';
// A header that an older version wrote has the version after the name.
const OLD_HEADER = /<!-- generated by semspec [^\s;]+; do not edit this section -->/;

// The text between the markers: a header line, a blank line, the body. It starts and ends with a line break.
function regionOf(body: string, crlf: boolean): string {
  const text = `\n${HEADER}\n${body ? `\n${body}\n` : ''}`;
  return crlf ? text.replace(/\n/g, '\r\n') : text;
}

const keyOf = (graph: string, id: string): string => `${graph}\u0000${id}`;

// Fills the marked regions of the documents from the graphs. The author text stays as it is. A finding with the code
// `error` means that nothing was filled. The graphs are the graphs of the workspace, or 1 graph.
export function fillSpecs(graphs: GraphIndex[], documents: SpecDocument[], _options: SpecRunOptions = {}): SpecResult {
  const findings: SpecFinding[] = [];
  const nameOf = (d: SpecDocument) => d.name ?? d.path;
  const sections: Section[] = [];
  for (const doc of documents) {
    const parsed = parseSpecMarkers(doc.text);
    for (const pr of parsed.problems) findings.push({ code: 'error', file: nameOf(doc), line: pr.line, message: pr.message });
    for (const marker of parsed.markers) {
      const r = resolveSection(graphs, doc, marker);
      for (const message of r.problems) findings.push({ code: 'error', file: nameOf(doc), line: marker.line, section: markerText(marker), message });
      if (r.section) sections.push(r.section);
    }
  }
  const unchanged = () => ({ files: documents.map((d) => ({ path: d.path, name: nameOf(d), text: d.text, changed: false })), findings, sections: sections.length });
  if (findings.length) return unchanged();
  // Pass 1 finds the nodes that each document anchors. Pass 2 writes the links to them.
  const anchors = new Map<string, Set<string>>();
  for (const s of sections) {
    const set = anchors.get(s.doc.path) ?? new Set<string>();
    renderSection(graphs, s, () => undefined).anchored.forEach((id) => set.add(keyOf(s.g.id, id)));
    anchors.set(s.doc.path, set);
  }
  const graphsOfId = new Map<string, Set<string>>();
  for (const set of anchors.values()) {
    for (const key of set) {
      const [graph, id] = key.split('\u0000');
      graphsOfId.set(id, (graphsOfId.get(id) ?? new Set<string>()).add(graph));
    }
  }
  const name: AnchorName = (graph, id) => ((graphsOfId.get(id)?.size ?? 0) > 1 ? `${graph}--${id}` : id);
  const hrefFor = (from: string): Ctx['href'] => (graph, id) => {
    const key = keyOf(graph, id);
    if (anchors.get(from)?.has(key)) return `#${fragment(name(graph, id))}`;
    const other = documents.find((d) => d.path !== from && anchors.get(d.path)?.has(key));
    return other ? `${relativePath(from, other.path)}#${fragment(name(graph, id))}` : undefined;
  };
  const files: SpecResult['files'] = [];
  for (const doc of documents) {
    const crlf = doc.text.includes('\r\n');
    let text = '';
    let at = 0;
    for (const s of sections.filter((x) => x.doc === doc)) {
      const { marker } = s;
      const region = regionOf(renderSection(graphs, s, hrefFor(doc.path), name).body, crlf);
      const existing = doc.text.slice(marker.start, marker.end);
      // A header with a version, from an older run, counts as the same header.
      const same = existing === region || existing.replace(OLD_HEADER, HEADER) === region;
      text += doc.text.slice(at, marker.start) + (same ? existing : region);
      at = marker.end;
      if (!same) {
        findings.push({ code: 'stale', file: nameOf(doc), line: marker.line, section: markerText(marker), message: `The ${markerText(marker)} at line ${marker.line} differs from the graph. It is stale or an author changed it.` });
      }
    }
    text += doc.text.slice(at);
    files.push({ path: doc.path, name: nameOf(doc), text, changed: text !== doc.text });
  }
  return { files, findings, sections: sections.length };
}

// ---------- default documents ----------

export interface DefaultDocumentOptions {
  // The kinds of the root nodes. The default is `spec.roots` of the profile of each graph.
  roots?: string[];
  // The id of a graph that gets a glossary document.
  glossary?: string;
}

const INTRO = '_Write a short introduction here._';

// An option value of a marker. A value with a space or a quote is quoted with the quote that it does not hold.
function optionText(name: string, value: string): string {
  const bare = /^[^\s"']+$/.test(value) && !value.includes('-->');
  if (bare) return `${name}=${value}`;
  if (value.includes('-->') || (value.includes('"') && value.includes("'"))) throw new Error(`The value "${value}" of the option ${name} cannot be written in a marker.`);
  return value.includes('"') ? `${name}='${value}'` : `${name}="${value}"`;
}

// The file name part of an id. A character other than a letter, a digit, a dot, a hyphen or an underscore becomes ~ and its hex bytes.
function fileSafe(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/gu, (ch) => (/[!'()*]/.test(ch) ? `~${ch.charCodeAt(0).toString(16)}` : encodeURIComponent(ch).replace(/%/g, '~').toLowerCase()));
}

function marker(type: string, options: [string, string][]): string {
  return `<!-- semspec:${type}${options.map(([k, v]) => ` ${optionText(k, v)}`).join('')} -->\n<!-- semspec:end -->`;
}

// The templates of the default documents: 1 for each root node of the kinds, and 1 glossary document. A document is a
// template with a short introduction, a tree section and a traceability section. Its name is relative to the output folder.
export function defaultDocuments(graphs: GraphIndex[], options: DefaultDocumentOptions = {}): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  const taken = new Set<string>();
  const unique = (graph: string, base: string): string => {
    base = fileSafe(base);
    let name = `${base}.md`;
    if (taken.has(name.toLowerCase())) name = `${fileSafe(graph)}-${base}.md`;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${fileSafe(graph)}-${base}-${i}.md`;
    taken.add(name.toLowerCase());
    return name;
  };
  const only = graphs.length > 1;
  for (const g of graphs) {
    const roots = options.roots ?? g.index.profile.spec?.roots ?? [];
    for (const n of g.index.model.nodes.filter((x) => roots.includes(x.kind))) {
      const where: [string, string][] = only ? [['graph', g.id]] : [];
      const text = [
        `# ${esc(n.title || n.id)}`,
        INTRO,
        marker('section', [...where, ['shape', 'tree'], ['scope', n.id], ['self', 'no'], ['level', '2']]),
        '## Traceability',
        marker('section', [...where, ['shape', 'traceability'], ['scope', n.id]]),
      ].join('\n\n');
      out.push({ name: unique(g.id, n.id), text: `${text}\n` });
    }
  }
  if (options.glossary !== undefined) {
    const g = graphs.find((x) => x.id === options.glossary);
    if (!g) throw new Error(`Unknown graph "${options.glossary}". The graphs are: ${graphs.map((x) => x.id).join(', ')}.`);
    const text = [`# Glossary of ${esc(g.label || g.id)}`, INTRO, marker('section', [...(only ? ([['graph', g.id]] as [string, string][]) : []), ['shape', 'glossary'], ['level', '2']])].join('\n\n');
    out.push({ name: unique(g.id, only ? `glossary-${g.id}` : 'glossary'), text: `${text}\n` });
  }
  return out;
}
