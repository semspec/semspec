// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// What a reader does with a model: scope by a node, filter, walk by expansion, summarise, export.
import type { Chip, Filters, Groups, Index, NodeStatus, Summary, VEdge, VNode, Walk } from './types.js';
import { filterValues } from './tagged.js';
import { fieldLabel } from './vocabulary.js';
import { markerOf } from './provenance.js';
import { getPath, isMuted, kindLabel, kindOf, kindPlural, linkedKinds, treeKinds } from './profile.js';

// ---------- scope ----------

export interface ScopeSpec {
  id: string;
  maxDepth?: number | null;
  kinds?: string[];
}

// The scope of a node: the node and everything below it, plus the linked nodes that a node of
// the scope links to, plus the checks that the scope names. A linked node or a check scopes to
// its direct neighbours only.
export function computeScope(index: Index, spec: ScopeSpec): { ids: Set<string>; root: string | null } {
  const P = index.profile;
  const tree = treeKinds(P);
  const linked = linkedKinds(P);
  const root = index.byId.get(spec.id);
  if (!root) return { ids: new Set(), root: null };
  const maxDepth = spec.maxDepth ?? Infinity;
  const core = new Set<string>([root.id]);
  const inTree = tree.includes(root.kind);

  if (inTree) {
    let frontier = [root.id];
    for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const c of index.scopeChildren.get(id)!) {
          if (!core.has(c)) {
            core.add(c);
            next.push(c);
          }
        }
      }
      frontier = next;
    }
  } else {
    index.out.get(root.id)!.forEach((e) => core.add(e.t));
    index.inc.get(root.id)!.forEach((e) => core.add(e.s));
  }

  const all = new Set(core);
  const via = P.linkedScopeEdges ?? [];
  if (inTree) {
    for (const id of core) {
      for (const e of index.out.get(id)!) {
        const t = index.byId.get(e.t);
        if (!t) continue;
        if (linked.includes(t.kind) && via.includes(e.k)) all.add(t.id);
        if (e.k === P.checks!.edge) all.add(t.id);
      }
      for (const e of index.inc.get(id)!) {
        const s = index.byId.get(e.s);
        if (s && linked.includes(s.kind) && P.refs!.some((r) => r.field === e.k)) all.add(s.id);
      }
    }
  }

  if (spec.kinds?.length) {
    for (const id of Array.from(all)) if (id !== root.id && !spec.kinds.includes(index.byId.get(id)!.kind)) all.delete(id);
  }
  return { ids: all, root: root.id };
}

// The nodes of the group kind that a node belongs to. The profile names the group kind.
export function groupsOf(index: Index, id: string): Set<string> {
  const P = index.profile;
  const groupKind = P.facets?.groupKind;
  const cached = index.moduleCache.get(id);
  if (cached) return cached;
  const result = new Set<string>();
  index.moduleCache.set(id, result);
  const n = index.byId.get(id);
  if (!n || !groupKind) return result;
  if (n.kind === groupKind) result.add(id);
  n.up.forEach((p) => groupsOf(index, p).forEach((m) => result.add(m)));
  if ((P.parts ?? []).some((p) => p.kind === n.kind) && n.parents[0]) groupsOf(index, n.parents[0]).forEach((m) => result.add(m));
  if (linkedKinds(P).includes(n.kind) || n.kind === P.checks!.kind) {
    const tree = treeKinds(P);
    for (const e of [...index.out.get(id)!, ...index.inc.get(id)!]) {
      const other = e.s === id ? e.t : e.s;
      const o = index.byId.get(other);
      if (o && tree.includes(o.kind)) groupsOf(index, other).forEach((m) => result.add(m));
    }
  }
  return result;
}

// ---------- field filters ----------
// A field filter reads a list field or a text field of a node. A carrier kind is a kind with at
// least 1 node that has the field. A node of another kind takes the values of its relatives:
//   below a carrier: the nearest carriers above it, through the scope parents;
//   above carriers:  every carrier below it, through the scope children;
//   a linked node or a check: the relatives of its tree neighbours.
// A carrier also takes the values of the carriers below it, so a parent shows what its children have.

type Active = [string, string[]][];

function carrierKinds(index: Index, field: string): Set<string> {
  const cached = index.carrierCache.get(field);
  if (cached) return cached;
  const kinds = new Set<string>();
  index.model.nodes.forEach((n) => n.d[field] !== undefined && kinds.add(n.kind));
  index.carrierCache.set(field, kinds);
  return kinds;
}

// The values of a carrier. A carrier with no value has the value ''.
function ownValues(n: VNode, field: string, from?: 'keys'): string[] {
  const list = filterValues(n.d[field], from);
  return list.length ? list : [''];
}

const fromOf = (index: Index, field: string) => index.profile.fieldFilters?.find((f) => f.field === field)?.from;

function carriersAbove(index: Index, id: string, field: string, seen = new Set<string>()): string[] {
  const n = index.byId.get(id);
  if (!n || seen.has(id)) return [];
  seen.add(id);
  if (carrierKinds(index, field).has(n.kind)) return [id];
  return n.up.flatMap((p) => carriersAbove(index, p, field, seen));
}

function carriersBelow(index: Index, id: string, field: string, out = new Set<string>(), seen = new Set<string>()): Set<string> {
  const n = index.byId.get(id);
  if (!n || seen.has(id)) return out;
  seen.add(id);
  if (carrierKinds(index, field).has(n.kind)) out.add(id);
  (index.scopeChildren.get(id) ?? []).forEach((c) => carriersBelow(index, c, field, out, seen));
  return out;
}

function treeNeighbours(index: Index, id: string): string[] {
  const tree = treeKinds(index.profile);
  return Array.from(neighbourIds(index, id)).filter((o) => tree.includes(index.byId.get(o)!.kind));
}

// The values of a field for a node, taken from the node or from its relatives.
export function fieldValues(index: Index, field: string, id: string): Set<string> {
  const n = index.byId.get(id);
  const out = new Set<string>();
  if (!n) return out;
  const relatives = (x: string) => [...carriersAbove(index, x, field), ...carriersBelow(index, x, field)];
  let list = relatives(id);
  if (!list.length && !treeKinds(index.profile).includes(n.kind)) list = treeNeighbours(index, id).flatMap(relatives);
  list.forEach((c) => ownValues(index.byId.get(c)!, field, fromOf(index, field)).forEach((v) => out.add(v)));
  return out;
}

const activeOf = (fields: Filters['fields'], skip?: string): Active =>
  Object.entries(fields ?? {}).filter(([field, sel]) => sel.length && `field:${field}` !== skip);

// A node matches when the carriers above it match all filters together, or when a node below it
// matches. A linked node or a check matches when a tree neighbour matches.
function matchFields(index: Index, id: string, active: Active): boolean {
  if (!active.length) return true;
  const key = JSON.stringify(active);
  let memo = index.fieldCache.get(key);
  if (!memo) index.fieldCache.set(key, (memo = new Map()));
  const ok = (c: string, field: string, sel: string[]) => ownValues(index.byId.get(c)!, field, fromOf(index, field)).some((v) => sel.includes(v));
  const tree = treeKinds(index.profile);
  const visit = (x: string, seen: Set<string>): boolean => {
    if (memo!.has(x)) return memo!.get(x)!;
    const n = index.byId.get(x);
    if (!n || seen.has(x)) return false;
    seen.add(x);
    let decided = true;
    let result = true;
    for (const [field, sel] of active) {
      const above = carriersAbove(index, x, field);
      if (!above.length) decided = false;
      else if (!above.some((c) => ok(c, field, sel))) {
        result = false;
        break;
      }
    }
    result = decided && result;
    if (!result) {
      const next = tree.includes(n.kind) ? index.scopeChildren.get(x) ?? [] : decided ? [] : treeNeighbours(index, x);
      result = next.some((c) => visit(c, seen));
    }
    seen.delete(x);
    memo!.set(x, result);
    return result;
  };
  return visit(id, new Set());
}

// ---------- status ----------

// The nodes with a status of their own at or below a node, through the scope parents. A node
// with a muted lifecycle and what is only below it do not count. A set counts a node under
// 2 parents once.
function statusLeaves(index: Index, id: string, seen: Set<string>): Set<string> {
  const cached = index.statusCache.get(id);
  if (cached) return cached;
  const result = new Set<string>();
  const n = index.byId.get(id);
  if (!n || seen.has(id) || isMuted(index.profile, n.lifecycle)) return result;
  seen.add(id);
  if (n.status) result.add(id);
  else for (const c of index.scopeChildren.get(id) ?? []) statusLeaves(index, c, seen).forEach((l) => result.add(l));
  seen.delete(id);
  index.statusCache.set(id, result);
  return result;
}

// The status of a node. All good is good, all bad is bad, and a mix is the warn value.
// A node with no status below it has no value. With field filters, only the nodes that match count.
export function statusOf(index: Index, id: string, fields?: Filters['fields']): NodeStatus {
  const spec = index.profile.status;
  const counts: Record<string, number> = {};
  if (!spec) return { value: null, tone: null, counts, total: 0 };
  spec.values.forEach((v) => (counts[v.value] = 0));
  const active = activeOf(fields);
  const leaves = new Set(Array.from(statusLeaves(index, id, new Set())).filter((l) => matchFields(index, l, active)));
  leaves.forEach((l) => counts[index.byId.get(l)!.status!]++);
  const total = leaves.size;
  const byTone = (tone: string) => spec.values.find((v) => v.tone === tone)?.value ?? null;
  if (!total) return { value: null, tone: null, counts, total };
  for (const tone of ['good', 'bad'] as const) {
    const value = byTone(tone);
    if (value && counts[value] === total) return { value, tone, counts, total };
  }
  return { value: byTone('warn'), tone: 'warn', counts, total };
}

// ---------- filters ----------

type FacetKey = 'kinds' | 'lifecycles' | 'deliveries' | 'modules' | 'statuses' | 'markers';
const NODE_FIELD = { kinds: 'kind', lifecycles: 'lifecycle', deliveries: 'delivery' } as const;
const FACET_KEYS: FacetKey[] = ['kinds', 'lifecycles', 'deliveries', 'modules', 'statuses', 'markers'];

function facetValues(index: Index, n: VNode, key: string, f: Filters, skip?: string): string[] {
  if (key.startsWith('field:')) return Array.from(fieldValues(index, key.slice(6), n.id));
  if (key === 'modules') return Array.from(groupsOf(index, n.id));
  if (key === 'markers') return [markerOf(index.profile.provenance, n.d)];
  if (key === 'statuses') return [statusOf(index, n.id, Object.fromEntries(activeOf(f.fields, skip))).value ?? ''];
  return [(n[NODE_FIELD[key as keyof typeof NODE_FIELD]] as string) || ''];
}

// Filters on top of a scope. Each facet is a list. An empty list allows everything.
// The values of 1 facet are OR. The facets are AND. `skip` names a facet to leave out.
// The key of a field filter is "field:" and the field.
export function applyFilters(index: Index, ids: Iterable<string>, f: Filters, skip?: string): string[] {
  const q = (f.q || '').trim().toLowerCase();
  const result: string[] = [];
  const active = activeOf(f.fields, skip);
  for (const id of ids) {
    const n = index.byId.get(id);
    if (!n) continue;
    let ok = true;
    for (const key of FACET_KEYS) {
      const list = f[key];
      if (key === skip || !list?.length) continue;
      if (!facetValues(index, n, key, f, skip).some((v) => list.includes(v))) {
        ok = false;
        break;
      }
    }
    if (!ok || !matchFields(index, id, active)) continue;
    if (q && `${n.id}\n${n.title}\n${n.sub}\n${n.statement}`.toLowerCase().indexOf(q) < 0) continue;
    result.push(id);
  }
  return result;
}

// The number of nodes for each value of 1 facet, with every other filter applied.
export function facetCounts(index: Index, ids: Iterable<string>, f: Filters, key: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of applyFilters(index, ids, f, key)) {
    for (const v of facetValues(index, index.byId.get(id)!, key, f, key)) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts;
}

export const scopedEdges = (index: Index, idSet: Set<string>): VEdge[] => index.model.edges.filter((e) => idSet.has(e.s) && idSet.has(e.t));

// ---------- walk ----------
// A walk is the set of nodes on the canvas. `intro` records who introduced each node, so a
// collapse removes exactly what an expand added. A node on the canvas at the start has the
// introducer "" and stays until it is hidden.

export function neighbourIds(index: Index, id: string): Set<string> {
  const set = new Set<string>();
  index.out.get(id)!.forEach((e) => set.add(e.t));
  index.inc.get(id)!.forEach((e) => set.add(e.s));
  set.delete(id);
  return set;
}

// The number of neighbours of a node that are not on the canvas.
export function badgeCount(index: Index, shown: Set<string>, id: string): number {
  let n = 0;
  neighbourIds(index, id).forEach((o) => !shown.has(o) && n++);
  return n;
}

// The hidden neighbours of a node, by edge kind and by node kind.
export function neighbourGroups(index: Index, shown: Set<string>, id: string): Groups {
  const byEdge = new Map<string, { k: string; dir: 'in' | 'out'; ids: Set<string> }>();
  const byKind = new Map<string, number>();
  const seen = new Set<string>();
  const add = (e: VEdge, other: string, dir: 'in' | 'out') => {
    if (shown.has(other) || other === id) return;
    const key = `${e.k}|${dir}`;
    if (!byEdge.has(key)) byEdge.set(key, { k: e.k, dir, ids: new Set() });
    byEdge.get(key)!.ids.add(other);
    if (!seen.has(other)) {
      seen.add(other);
      const kind = index.byId.get(other)!.kind;
      byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    }
  };
  index.out.get(id)!.forEach((e) => add(e, e.t, 'out'));
  index.inc.get(id)!.forEach((e) => add(e, e.s, 'in'));
  return {
    edge: Array.from(byEdge.values()).map((g) => ({ k: g.k, dir: g.dir, count: g.ids.size })),
    kind: Array.from(byKind.entries()).map(([kind, count]) => ({ kind, count })),
    total: seen.size,
  };
}

export function walkStart(ids: Iterable<string>): Walk {
  const shown = new Set(ids);
  const intro = new Map<string, Set<string>>();
  shown.forEach((id) => intro.set(id, new Set([''])));
  return { shown, intro };
}

function cloneWalk(w: Walk): Walk {
  const intro = new Map<string, Set<string>>();
  w.intro.forEach((s, k) => intro.set(k, new Set(s)));
  return { shown: new Set(w.shown), intro };
}

export interface ExpandFilter {
  k?: string;
  dir?: string;
  kind?: string;
}

// Adds the hidden neighbours of a node. A filter limits the expand to 1 edge kind or 1 node kind.
export function walkExpand(index: Index, walk: Walk, id: string, filter?: ExpandFilter): { walk: Walk; added: string[] } {
  const next = cloneWalk(walk);
  const added: string[] = [];
  const take = (other: string) => {
    if (next.shown.has(other) || other === id) return;
    next.shown.add(other);
    next.intro.set(other, new Set([id]));
    added.push(other);
  };
  const wanted = (e: VEdge, other: string, dir: string) => {
    if (!filter) return true;
    if (filter.k) return e.k === filter.k && (!filter.dir || filter.dir === dir);
    if (filter.kind) return index.byId.get(other)!.kind === filter.kind;
    return true;
  };
  index.out.get(id)!.forEach((e) => wanted(e, e.t, 'out') && take(e.t));
  index.inc.get(id)!.forEach((e) => wanted(e, e.s, 'in') && take(e.s));
  return { walk: next, added };
}

// Removes the neighbours that a node introduced, when nothing else introduced them.
export function walkCollapse(walk: Walk, id: string): Walk {
  const next = cloneWalk(walk);
  const drop = (src: string) => {
    for (const n of Array.from(next.intro.keys())) {
      const set = next.intro.get(n);
      if (set?.has(src)) {
        set.delete(src);
        if (!set.size) {
          next.intro.delete(n);
          next.shown.delete(n);
          drop(n);
        }
      }
    }
  };
  drop(id);
  return next;
}

// Removes 1 node, and what only it introduced.
export function walkHide(walk: Walk, id: string): Walk {
  const next = walkCollapse(walk, id);
  next.shown.delete(id);
  next.intro.delete(id);
  next.intro.forEach((set) => set.delete(id));
  return next;
}

// ---------- summary ----------
// One summary of a node. The card and the hover popover both use it.

const plural = (index: Index, n: number, kind: string) => `${n} ${n === 1 ? kindLabel(index.profile, kind).toLowerCase() : kindPlural(index.profile, kind)}`;

export function summaryOf(index: Index, n: VNode): Summary {
  const P = index.profile;
  const k = kindOf(P, n.kind);
  const chips: Chip[] = [];
  const muted = isMuted(P, n.lifecycle);
  for (const spec of k?.chips ?? []) {
    if (spec === 'lifecycle') {
      if (n.lifecycle) chips.push({ text: fieldLabel(P, P.lifecycle.field, n.lifecycle), tone: muted ? 'muted' : 'life', struck: muted });
    } else if (spec === 'members') {
      const counts = new Map<string, number>();
      (index.children.get(n.id) ?? []).forEach((c) => counts.set(index.byId.get(c)!.kind, (counts.get(index.byId.get(c)!.kind) ?? 0) + 1));
      const first = Array.from(counts.entries())[0];
      if (first) chips.push({ text: plural(index, first[1], first[0]), tone: 'count' });
    } else if (spec === 'coverage') {
      if (n.cov?.parts) chips.push({ text: `${n.cov.verified} of ${n.cov.parts} verified`, tone: n.cov.verified === n.cov.parts ? 'good' : 'warn' });
    } else if (spec === 'verified') {
      const v = (n.d.checks as unknown[]) ?? [];
      chips.push({ text: v.length ? 'verified' : 'not verified', tone: v.length ? 'good' : 'warn' });
    } else if (spec === 'verifyTypes') {
      const types: string[] = [];
      ((n.d.checks as Record<string, string>[]) ?? []).forEach((x) => {
        const t = x[P.checks!.typeField];
        if (!types.includes(t)) types.push(t);
      });
      types.forEach((t) => chips.push({ text: t, tone: 'plain' }));
    } else if (spec === 'checkType') {
      chips.push({ text: String(n.d[P.checks!.typeField] ?? 'check'), tone: 'plain' });
    } else if (typeof spec === 'object') {
      let value = getPath(n.d, spec.field);
      if (value === undefined || value === null || value === '') continue;
      let text = fieldLabel(P, spec.field, String(value));
      if (spec.slice) text = text.slice(0, spec.slice);
      if (spec.format === 'upper') text = text.toUpperCase();
      chips.push({ text: spec.template ? spec.template.replace('{value}', text) : text, tone: spec.tone ?? 'plain' });
    }
  }
  return { kind: n.kind, title: n.title, sub: n.sub, id: n.id, muted, chips };
}

// ---------- export ----------

function csvCell(value: unknown): string {
  let s = value === undefined || value === null ? '' : String(value);
  // A cell that starts with a formula character gets a quote, so a spreadsheet does not run it.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export function toCsv<T>(columns: { label: string; text: (row: T) => unknown }[], rows: T[]): string {
  const lines = [columns.map((c) => csvCell(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(c.text(r))).join(','));
  return lines.join('\r\n') + '\r\n';
}
