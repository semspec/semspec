// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The coverage report: how many conditions (the nodes of the kinds in `profile.parts`) have each status value, have no status, or have no check.
// The selection uses the scope and the filters of the explorer. The report can group the counts, list conditions and act as a gate.
// The tool coverage and the command `semspec coverage` both call `coverage`, so they give the same answer.
import { DEFAULT_LIMIT, QueryError, cap, withTruncated, type GraphIndex, type Truncated } from './agent.js';
import { applyFilters, computeScope, fieldValues } from './explore.js';
import { kindOf } from './profile.js';
import { fieldLabel } from './vocabulary.js';
import type { Filters, Index, StatusTone, VNode } from './types.js';

export const TONES: StatusTone[] = ['good', 'warn', 'bad'];

// The words that name a condition with no status, and a condition with no check, in the `list` option.
export const NO_STATUS = 'no-status';
export const NO_CHECK = 'no-check';
// With derived evidence, the words that name a condition whose derived status differs from its authored status, and a stale condition.
export const DIFFER = 'differ';
export const STALE = 'stale';

// The status that the filters, the groups, the counts and the gate read. Without a choice, it is the status of the node:
// the derived status when the graph has derived evidence. A graph with no derived evidence has 1 status.
export const STATUS_SOURCES = ['authored', 'derived'] as const;
export type StatusSource = (typeof STATUS_SOURCES)[number];

export interface CoverageQuery {
  // The id of 1 graph. The default is every graph of the workspace.
  graph?: string;
  // The id of a node. The selection covers this node and its scope. It needs `graph` when the workspace has several graphs.
  scope?: string;
  // The filters of the explorer. The values of 1 filter are OR. The filters are AND.
  // A condition matches `kinds`, `deliveries` and `markers` when it, or a node above it, has one of the values.
  kinds?: string[];
  lifecycles?: string[];
  deliveries?: string[];
  statuses?: string[];
  markers?: string[];
  // The values of each field filter of the profile, by field.
  fields?: Record<string, string[]>;
  // A hierarchy kind or a field. The counts get 1 row for each node of the kind, or for each value of the field.
  group?: string;
  // Status values, NO_STATUS, NO_CHECK, DIFFER or STALE. The report lists the conditions that match one of them.
  list?: string[];
  // The status that the filters, the groups, the counts and the gate use. The default is the derived status when the graph has one.
  statusSource?: StatusSource;
  // The most conditions in the list. The default is DEFAULT_LIMIT.
  limit?: number;
  // Tones. The gate fails when the selection has a condition with a status of one of these tones.
  gate?: StatusTone[];
}

export interface CoverageCount {
  count: number;
  // The share of the conditions in the selection, or in the group, from 0 to 100 with 1 decimal.
  percent: number;
}

export interface CoverageStatusCount extends CoverageCount {
  value: string;
  label: string;
  tone: StatusTone;
}

export interface CoverageRow {
  conditions: number;
  statuses: CoverageStatusCount[];
  noStatus: CoverageCount;
  noCheck: CoverageCount;
}

export interface CoverageGroup extends CoverageRow {
  key: string;
  label: string;
  // The kind of a group node. A group of a field value has none.
  kind?: string;
}

export interface CoverageGraph extends CoverageRow {
  graph: string;
  label: string;
  groups?: CoverageGroup[];
}

export interface CoverageItem {
  graph: string;
  id: string;
  owner: { id: string; kind: string; title: string } | null;
  status: string | null;
  tone: StatusTone | null;
  // With derived evidence: the status of the graph file, the derived status, and the stale flag.
  authoredStatus?: string | null;
  derivedStatus?: string | null;
  stale?: boolean;
  text: string;
  checks: { id: string; type: string; title: string }[];
}

// The 2 statuses of the conditions in the graphs that have derived evidence. The percentages are of these conditions.
export interface CoverageEvidence {
  conditions: number;
  authored: { statuses: CoverageStatusCount[]; noStatus: CoverageCount };
  derived: { statuses: CoverageStatusCount[]; noStatus: CoverageCount };
  // The conditions where the derived status differs from the authored status.
  differ: CoverageCount;
  // The conditions with stale evidence. Their derived status is the not-run value.
  stale: CoverageCount;
}

export interface CoverageResult {
  scope: string | null;
  statusSource?: StatusSource;
  evidence?: CoverageEvidence;
  filters: Record<string, unknown>;
  group?: { name: string };
  total: CoverageRow;
  graphs: CoverageGraph[];
  list?: { statuses: string[]; limit: number; total: number; items: CoverageItem[] };
  gate?: { tones: StatusTone[]; pass: boolean; failing: CoverageItem[] };
  truncated?: Truncated;
}

// ---------- counts ----------

interface Tally {
  conditions: number;
  statuses: Map<string, { label: string; tone: StatusTone; count: number }>;
  noStatus: number;
  noCheck: number;
}

const emptyTally = (): Tally => ({ conditions: 0, statuses: new Map(), noStatus: 0, noCheck: 0 });

const percent = (count: number, total: number): number => (total ? Math.round((count / total) * 1000) / 10 : 0);

const statusFor = (index: Index, n: VNode, source?: StatusSource): string | undefined => {
  if (!index.model.derived) return n.status;
  return source === 'authored' ? n.authoredStatus : source === 'derived' ? n.derivedStatus : n.status;
};

const differs = (index: Index, n: VNode): boolean => !!index.model.derived && (n.authoredStatus ?? null) !== (n.derivedStatus ?? null);
const isStale = (index: Index, n: VNode): boolean => !!index.model.derived && n.d.verification?.stale === true;

const hasCheck = (index: Index, n: VNode): boolean => {
  const p = index.profile;
  // As the tool gaps: a profile with no declared check edge reports no part without a check.
  if (!p.checks || !p.edges[p.checks.edge]) return true;
  return (index.out.get(n.id) ?? []).some((e) => e.k === p.checks!.edge);
};

function tally(index: Index, conditions: VNode[], source?: StatusSource): Tally {
  const t = emptyTally();
  for (const v of index.profile.status?.values ?? []) t.statuses.set(v.value, { label: v.label, tone: v.tone, count: 0 });
  for (const n of conditions) {
    t.conditions++;
    const status = statusFor(index, n, source);
    if (status) t.statuses.get(status)!.count++;
    else t.noStatus++;
    if (!hasCheck(index, n)) t.noCheck++;
  }
  return t;
}

function rowOf(t: Tally): CoverageRow {
  return {
    conditions: t.conditions,
    statuses: [...t.statuses.entries()].map(([value, s]) => ({ value, label: s.label, tone: s.tone, count: s.count, percent: percent(s.count, t.conditions) })),
    noStatus: { count: t.noStatus, percent: percent(t.noStatus, t.conditions) },
    noCheck: { count: t.noCheck, percent: percent(t.noCheck, t.conditions) },
  };
}

// The sum of tallies. A status value that 2 graphs share counts once. The label and the tone come from the first graph.
function sum(tallies: Tally[]): Tally {
  const out = emptyTally();
  for (const t of tallies) {
    out.conditions += t.conditions;
    out.noStatus += t.noStatus;
    out.noCheck += t.noCheck;
    for (const [value, s] of t.statuses) {
      const have = out.statuses.get(value);
      if (have) have.count += s.count;
      else out.statuses.set(value, { ...s });
    }
  }
  return out;
}

// ---------- selection ----------

// The nodes above a node, through the scope parents.
function ancestorsOf(index: Index, id: string, memo: Map<string, Set<string>>): Set<string> {
  const known = memo.get(id);
  if (known) return known;
  const out = new Set<string>();
  memo.set(id, out);
  for (const p of index.byId.get(id)?.up ?? []) {
    out.add(p);
    ancestorsOf(index, p, memo).forEach((a) => out.add(a));
  }
  return out;
}

interface Selection {
  source?: StatusSource;
  g: GraphIndex;
  conditions: VNode[];
  scopeIds: Set<string>;
  above: Map<string, Set<string>>;
}

const nonEmpty = (list: string[] | undefined): list is string[] => !!list?.length;

function select(g: GraphIndex, q: CoverageQuery): Selection {
  const { index } = g;
  const kinds = new Set((index.profile.parts ?? []).map((p) => p.kind));
  const scopeIds = q.scope === undefined ? new Set(index.model.nodes.map((n) => n.id)) : computeScope(index, { id: q.scope }).ids;
  // The status filter reads the chosen status of the condition, so it is not part of the filters of the explorer.
  const base: Filters = { q: '', kinds: [], lifecycles: q.lifecycles ?? [], deliveries: [], modules: [], statuses: [], markers: [], fields: q.fields };
  const passed = new Set(applyFilters(index, scopeIds, base));
  const above = new Map<string, Set<string>>();
  // A condition has no kind, delivery or marker filter value of its own, so it takes them from itself or from a node above it.
  // Each of these filters matches on its own, and it can match a different node above the condition. The filters are AND.
  const everyId = new Set(index.model.nodes.map((n) => n.id));
  const none: Filters = { q: '', kinds: [], lifecycles: [], deliveries: [], modules: [], statuses: [], markers: [] };
  const holders = [
    nonEmpty(q.kinds) ? { ...none, kinds: q.kinds } : undefined,
    nonEmpty(q.deliveries) ? { ...none, deliveries: q.deliveries } : undefined,
    nonEmpty(q.markers) ? { ...none, markers: q.markers } : undefined,
  ]
    .filter((f): f is Filters => !!f)
    .map((f) => new Set(applyFilters(index, everyId, f)));
  const conditions = index.model.nodes.filter((n) => {
    if (!kinds.has(n.kind) || !passed.has(n.id)) return false;
    if (nonEmpty(q.statuses) && !q.statuses.includes(statusFor(index, n, q.statusSource) ?? '')) return false;
    return holders.every((h) => h.has(n.id) || [...ancestorsOf(index, n.id, above)].some((a) => h.has(a)));
  });
  return { source: q.statusSource, g, conditions, scopeIds, above };
}

// ---------- groups ----------

type GroupKind = 'kind' | 'field';

function groupKindOf(index: Index, name: string): GroupKind | null {
  const k = kindOf(index.profile, name);
  if (k?.role === 'hierarchy') return 'kind';
  if (index.profile.fieldFilters?.some((f) => f.field === name) || index.model.nodes.some((n) => n.d[name] !== undefined)) return 'field';
  return null;
}

function groupsOf(s: Selection, name: string, by: GroupKind): CoverageGroup[] {
  const { index } = s.g;
  const members = new Map<string, { label: string; kind?: string; conditions: VNode[] }>();
  const add = (key: string, label: string, kind: string | undefined, n: VNode) => {
    const m = members.get(key) ?? { label, kind, conditions: [] };
    m.conditions.push(n);
    members.set(key, m);
  };
  const filterLabels = index.profile.fieldFilters?.find((f) => f.field === name)?.values;
  for (const n of s.conditions) {
    if (by === 'kind') {
      for (const a of [n.id, ...ancestorsOf(index, n.id, s.above)]) {
        const node = index.byId.get(a)!;
        // The scope limits the conditions, not the group nodes.
        if (node.kind === name) add(a, node.title, node.kind, n);
      }
    } else {
      for (const v of fieldValues(index, name, n.id)) add(v, v ? (filterLabels?.[v] ?? fieldLabel(index.profile, name, v)) : '(none)', undefined, n);
    }
  }
  const keys = [...members.keys()];
  if (by === 'kind') {
    const order = new Map(index.model.nodes.map((n, i) => [n.id, i]));
    keys.sort((a, b) => order.get(a)! - order.get(b)!);
  } else keys.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  return keys.map((key) => {
    const m = members.get(key)!;
    return { key, label: m.label, ...(m.kind ? { kind: m.kind } : {}), ...rowOf(tally(index, m.conditions, s.source)) };
  });
}

// ---------- items ----------

function itemOf(g: GraphIndex, n: VNode, source?: StatusSource): CoverageItem {
  const { index } = g;
  const status = statusFor(index, n, source);
  const p = index.profile;
  const owner = n.parents[0] ? index.byId.get(n.parents[0]) : undefined;
  const checks = p.checks ? (index.out.get(n.id) ?? []).filter((e) => e.k === p.checks!.edge).flatMap((e) => index.byId.get(e.t) ?? []) : [];
  return {
    graph: g.id,
    id: n.id,
    owner: owner ? { id: owner.id, kind: owner.kind, title: owner.title } : null,
    status: status ?? null,
    tone: p.status?.values.find((v) => v.value === status)?.tone ?? null,
    ...(index.model.derived ? { authoredStatus: n.authoredStatus ?? null, derivedStatus: n.derivedStatus ?? null, stale: isStale(index, n) } : {}),
    text: n.statement,
    checks: checks.map((c) => ({ id: c.id, type: String(c.d[p.checks!.typeField] ?? ''), title: c.title })),
  };
}

// ---------- evidence ----------

// The counts of both statuses, in the graphs that have derived evidence. A graph with no derived evidence adds nothing.
function evidenceOfSelections(selections: Selection[]): { evidence?: CoverageEvidence } {
  const own = selections.filter((s) => s.g.index.model.derived);
  if (!own.length) return {};
  const authored = sum(own.map((s) => tally(s.g.index, s.conditions, 'authored')));
  const derived = sum(own.map((s) => tally(s.g.index, s.conditions, 'derived')));
  const total = authored.conditions;
  const count = (n: number): CoverageCount => ({ count: n, percent: percent(n, total) });
  const flat = own.flatMap((s) => s.conditions.map((n) => ({ index: s.g.index, n })));
  const rows = (t: Tally) => ({ statuses: rowOf(t).statuses, noStatus: count(t.noStatus) });
  return {
    evidence: {
      conditions: total,
      authored: rows(authored),
      derived: rows(derived),
      differ: count(flat.filter(({ index, n }) => differs(index, n)).length),
      stale: count(flat.filter(({ index, n }) => isStale(index, n)).length),
    },
  };
}

// ---------- the report ----------

// Builds the report. It throws a QueryError for an input that is not valid.
export function coverage(graphs: GraphIndex[], q: CoverageQuery = {}): CoverageResult {
  if (!graphs.length) throw new QueryError('The workspace has no graph.');
  const chosen = q.graph === undefined ? graphs : graphs.filter((g) => g.id === q.graph);
  if (!chosen.length) throw new QueryError(`Unknown graph "${q.graph}". The graphs are: ${graphs.map((g) => g.id).join(', ')}.`);
  if (q.scope !== undefined) {
    if (chosen.length > 1) throw new QueryError('The input "scope" needs "graph" when the workspace has several graphs.');
    if (!chosen[0].index.byId.has(q.scope)) throw new QueryError(`Unknown node id "${q.scope}" in the graph "${chosen[0].id}".`);
  }
  const limit = q.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) throw new QueryError('The input "limit" must be a whole number from 1.');
  for (const t of q.gate ?? []) if (!TONES.includes(t)) throw new QueryError(`Unknown tone "${t}". The tones are: ${TONES.join(', ')}.`);
  for (const field of Object.keys(q.fields ?? {})) {
    if (!chosen.some((g) => g.index.profile.fieldFilters?.some((f) => f.field === field))) {
      const known = [...new Set(chosen.flatMap((g) => g.index.profile.fieldFilters?.map((f) => f.field) ?? []))];
      throw new QueryError(`Unknown field filter "${field}". The field filters are: ${known.join(', ') || 'none'}.`);
    }
  }
  const known = new Set(chosen.flatMap((g) => g.index.profile.status?.values.map((v) => v.value) ?? []));
  for (const w of q.list ?? []) {
    if (w !== NO_STATUS && w !== NO_CHECK && w !== DIFFER && w !== STALE && !known.has(w)) throw new QueryError(`Unknown list value "${w}". The values are: ${[...known, NO_STATUS, NO_CHECK, DIFFER, STALE].join(', ')}.`);
  }
  if (q.statusSource !== undefined && !STATUS_SOURCES.includes(q.statusSource)) throw new QueryError(`Unknown status source "${q.statusSource}". The sources are: ${STATUS_SOURCES.join(', ')}.`);
  const by = new Map<string, GroupKind>();
  if (q.group !== undefined) {
    chosen.forEach((g) => {
      const kind = groupKindOf(g.index, q.group!);
      if (kind) by.set(g.id, kind);
    });
    if (!by.size) throw new QueryError(`Unknown group "${q.group}". A group is a hierarchy kind or a field.`);
  }

  const selections = chosen.map((g) => select(g, q));
  const tallies = selections.map((s) => tally(s.g.index, s.conditions, s.source));
  const perGraph: CoverageGraph[] = selections.map((s, i) => {
    const kind = by.get(s.g.id);
    return { graph: s.g.id, label: s.g.label, ...rowOf(tallies[i]), ...(q.group !== undefined ? { groups: kind ? groupsOf(s, q.group, kind) : [] } : {}) };
  });

  const filters: Record<string, unknown> = {};
  for (const key of ['kinds', 'lifecycles', 'deliveries', 'statuses', 'markers'] as const) if (nonEmpty(q[key])) filters[key] = q[key];
  const fields = Object.fromEntries(Object.entries(q.fields ?? {}).filter(([, v]) => v.length));
  if (Object.keys(fields).length) filters.fields = fields;

  const truncated: Truncated = {};
  const result: CoverageResult = {
    scope: q.scope ?? null,
    ...(q.statusSource !== undefined ? { statusSource: q.statusSource } : {}),
    ...evidenceOfSelections(selections),
    filters,
    ...(q.group !== undefined ? { group: { name: q.group } } : {}),
    total: rowOf(sum(tallies)),
    graphs: perGraph,
  };
  if (nonEmpty(q.list)) {
    const words = new Set(q.list);
    const matching = selections.flatMap((s) =>
      s.conditions
        .filter((n) => {
          const status = statusFor(s.g.index, n, s.source);
          return (status ? words.has(status) : words.has(NO_STATUS)) || (words.has(NO_CHECK) && !hasCheck(s.g.index, n)) || (words.has(DIFFER) && differs(s.g.index, n)) || (words.has(STALE) && isStale(s.g.index, n));
        })
        .map((n) => itemOf(s.g, n, s.source)),
    );
    result.list = { statuses: q.list, limit, total: matching.length, items: cap(matching, limit, 'list', truncated) };
  }
  if (nonEmpty(q.gate)) {
    const tones = new Set<string>(q.gate);
    const failing = selections.flatMap((s) => s.conditions.map((n) => itemOf(s.g, n, s.source)).filter((i) => i.tone && tones.has(i.tone)));
    result.gate = { tones: q.gate, pass: failing.length === 0, failing };
  }
  return withTruncated(result, truncated);
}

// ---------- Markdown ----------

const cell = (c: CoverageCount) => `${c.count} (${c.percent}%)`;
const escape = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ');

function table(first: string, rows: { name: string; row: CoverageRow }[], statuses: CoverageStatusCount[]): string[] {
  const head = [first, 'Conditions', ...statuses.map((s) => s.label), 'No status', 'No check'];
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  for (const { name, row } of rows) {
    const cells = statuses.map((s) => {
      const found = row.statuses.find((x) => x.value === s.value);
      return found ? cell(found) : '-';
    });
    lines.push(`| ${[escape(name), row.conditions, ...cells, cell(row.noStatus), cell(row.noCheck)].join(' | ')} |`);
  }
  return lines;
}

function itemLines(i: CoverageItem, withGraph: boolean): string[] {
  const where = `${withGraph ? `${i.graph}:` : ''}${i.id}`;
  const both = i.derivedStatus !== undefined && (i.authoredStatus ?? null) !== (i.derivedStatus ?? null) ? ` (authored ${i.authoredStatus ?? 'none'}, derived ${i.derivedStatus ?? 'none'})` : '';
  const head = `- \`${where}\`${i.status ? ` [${i.status}]` : ' [no status]'}${both}${i.stale ? ' (stale)' : ''}${i.owner ? ` of \`${i.owner.id}\`` : ''}: ${escape(i.text)}`;
  const checks = i.checks.length ? [`  Checks: ${i.checks.map((c) => `${c.type ? `${c.type} ` : ''}${escape(c.title)}`).join('; ')}`] : ['  Checks: none'];
  return [head, ...checks];
}

// The report as Markdown.
export function coverageMarkdown(r: CoverageResult): string {
  const lines: string[] = ['# Coverage', ''];
  const parts = Object.entries(r.filters).map(([k, v]) => `${k}: ${k === 'fields' ? Object.entries(v as Record<string, string[]>).map(([f, vs]) => `${f}=${vs.join('|')}`).join(', ') : (v as string[]).join(', ')}`);
  lines.push(`Scope: ${r.scope ? `\`${r.scope}\`` : 'all nodes'}. Filters: ${parts.length ? parts.join('; ') : 'none'}.`, '');
  const withGraph = r.graphs.length > 1;
  const statuses = r.total.statuses;
  lines.push('## Total', '');
  lines.push(...table('', [{ name: 'Total', row: r.total }, ...(withGraph ? r.graphs.map((g) => ({ name: g.graph, row: g as CoverageRow })) : [])], statuses));
  if (r.evidence) {
    const e = r.evidence;
    lines.push('', '## Authored and derived status', '');
    lines.push(`Status source: ${r.statusSource ?? 'derived'}. The counts below cover ${e.conditions} condition(s) with derived evidence.`, '');
    const head = ['Source', 'Conditions', ...r.total.statuses.map((x) => x.label), 'No status'];
    lines.push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`);
    for (const [name, side] of [['Authored', e.authored], ['Derived', e.derived]] as const) {
      lines.push(`| ${[name, e.conditions, ...r.total.statuses.map((x) => { const f = side.statuses.find((y) => y.value === x.value); return f ? cell(f) : '-'; }), cell(side.noStatus)].join(' | ')} |`);
    }
    lines.push('', `Derived status differs from authored status: ${cell(e.differ)}. Stale: ${cell(e.stale)}.`);
  }
  for (const g of r.graphs) {
    if (!g.groups) continue;
    lines.push('', `## Groups by ${r.group!.name}${withGraph ? ` in ${g.graph}` : ''}`, '');
    if (!g.groups.length) lines.push('No group.');
    else lines.push(...table('Group', g.groups.map((x) => ({ name: x.key && x.key !== x.label ? `${x.label} (${x.key})` : x.label, row: x })), g.statuses));
  }
  if (r.list) {
    lines.push('', `## Conditions: ${r.list.statuses.join(', ')}`, '');
    if (!r.list.items.length) lines.push('No condition.');
    for (const i of r.list.items) lines.push(...itemLines(i, withGraph));
    if (r.truncated?.list) lines.push('', `The list shows ${r.list.items.length} of ${r.list.total} conditions. The limit is ${r.list.limit}.`);
  }
  if (r.gate) {
    lines.push('', '## Gate', '');
    if (r.gate.pass) lines.push(`The gate passes. No condition has a status with the tone ${r.gate.tones.join(' or ')}.`);
    else {
      lines.push(`The gate fails. ${r.gate.failing.length} condition(s) have a status with the tone ${r.gate.tones.join(' or ')}.`, '');
      for (const i of r.gate.failing) lines.push(...itemLines(i, withGraph));
    }
  }
  return `${lines.join('\n')}\n`;
}
