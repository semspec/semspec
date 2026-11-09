// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The state store of the page. 1 store holds the active view and, for each view, what the reader did:
// scope, depth, walk, filters, selection, view, layout, canvas viewport, open tree groups, table column
// widths, the dock and the side panel.
//
// The store keeps the state in memory, so a switch of the view restores it. A small adapter writes the
// state of the workspace to the browser storage, so a reload restores it. The hash of the address
// links to a view, a scope and a node. A workspace with no views has 1 view for each graph, with the
// id of the graph, so the keys of the old state and the old links stay valid.
import { create } from 'zustand';
import { workspaceViews, type ViewFilters, type WorkspaceData } from '@semspec/core';
import { Core, setProfile, type Filters, type Index, type Model, type VEdge, type Walk } from './core';
import { LAYOUTS, type LayoutName } from './layouts';
import { formatLink, parseLink, type LinkValues } from './link';
import { defaultOpen, revealed } from './tree-open';

export type View = 'graph' | 'cards' | 'table';
export type Scope = { type: 'node'; id: string } | { type: 'all' } | null;
export type Panel = 'details' | 'expand';
export type CanvasMode = 'graph' | 'cards';
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}
export type Positions = Record<CanvasMode, { map: Map<string, { x: number; y: number }>; tick: number; key: string }>;

export const EMPTY_FILTERS: Filters = { q: '', kinds: [], lifecycles: [], deliveries: [], modules: [], statuses: [], markers: [], fields: {} };

// The version of the stored state. A state of another version is ignored.
export const STORE_VERSION = 1;
const HISTORY_LIMIT = 10;
const WRITE_DELAY = 200;
// The key of the table widths before the store held them. The store reads it once, then drops it.
const OLD_WIDTHS_PREFIX = 'semspec.table-widths.';

// What the reader did in 1 view.
export interface GraphState {
  scope: Scope;
  depth: number | null;
  filters: Filters;
  view: View;
  selected: string | null;
  // The selected edge. A node and an edge are never selected together.
  selectedEdge: VEdge | null;
  selectSeq: number;
  walk: Walk | null;
  walkRoot: string | null;
  history: (Walk | null)[];
  layoutTick: number;
  // The layout that the reader picked. null means the layout of the profile.
  layoutChoice: LayoutName | null;
  // The position and the zoom of the canvas, for each mode.
  viewport: Partial<Record<CanvasMode, Viewport>>;
  dock: boolean;
  statusColour: boolean;
  panel: Panel;
  open: Set<string>;
  // The widths of the table columns, by column id.
  widths: Record<string, number>;
}

export interface PageState {
  // The id of the active view.
  active: string;
  // A reset of the view adds 1, so the graph view mounts again.
  epoch: number;
  // The state of each view, by view id.
  graphs: Record<string, GraphState>;
}

export const useAppStore = create<PageState>(() => ({ active: '', epoch: 0, graphs: {} }));

// ---------- the workspace of the page ----------

interface Context {
  key: string;
  // The views by view id. Views that share a model share its index.
  graphs: Map<string, { model: Model; index: Index; graph: string; filters?: ViewFilters }>;
  first: string;
}
let ctx: Context | null = null;

// The canvas positions of each view. They live in memory only. A reload lays out again.
const positionStores = new Map<string, { current: Positions }>();
export function positionsOf(graph: string): { current: Positions } {
  let p = positionStores.get(graph);
  if (!p) {
    p = {
      current: {
        graph: { map: new Map(), tick: -1, key: '' },
        cards: { map: new Map(), tick: -1, key: '' },
      },
    };
    positionStores.set(graph, p);
  }
  return p;
}

export function freshGraph(model: Model, filters: Filters = EMPTY_FILTERS): GraphState {
  return {
    scope: null,
    depth: null,
    filters,
    view: 'graph',
    selected: null,
    selectedEdge: null,
    selectSeq: 0,
    walk: null,
    walkRoot: null,
    history: [],
    layoutTick: 0,
    layoutChoice: null,
    viewport: {},
    dock: false,
    statusColour: false,
    panel: 'details',
    open: defaultOpen(model),
    widths: {},
  };
}

// A short hash of a text, as 8 hex digits (FNV-1a).
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// The storage key of a workspace: its title and a hash of its graph ids.
export function storageKey(data: WorkspaceData): string {
  return `semspec:${data.title ?? ''}:${shortHash(data.graphs.map((g) => g.id).join('\n'))}`;
}

// ---------- the browser storage ----------

function storage(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  try {
    const text = storage()?.getItem(key);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

// ---------- the cleaning of a stored state ----------

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function walkOut(w: Walk | null) {
  return w ? { shown: [...w.shown], intro: [...w.intro].map(([k, v]) => [k, [...v]]) } : null;
}

// A walk without the nodes that the graph lacks. An empty walk is no walk.
function cleanWalk(raw: unknown, has: (id: string) => boolean): Walk | null {
  if (!isRecord(raw)) return null;
  const shown = new Set(strings(raw.shown).filter(has));
  if (!shown.size) return null;
  const intro = new Map<string, Set<string>>();
  if (Array.isArray(raw.intro)) {
    for (const entry of raw.intro) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !shown.has(entry[0])) continue;
      // The introducer '' marks a node that was on the canvas at the start.
      intro.set(entry[0], new Set(strings(entry[1]).filter((s) => s === '' || has(s))));
    }
  }
  return { shown, intro };
}

function cleanFilters(raw: unknown, index: Index): Filters {
  if (!isRecord(raw)) return EMPTY_FILTERS;
  const all = index.model.nodes.map((n) => n.id);
  const valid = (key: string) => new Set(Core.facetCounts(index, all, EMPTY_FILTERS, key).keys());
  const out: Filters = { ...EMPTY_FILTERS, q: typeof raw.q === 'string' ? raw.q : '', fields: {} };
  for (const key of ['kinds', 'lifecycles', 'deliveries', 'modules', 'statuses', 'markers'] as const) {
    // A facet that the profile does not define keeps no value.
    if ((key === 'deliveries' && !index.profile.fields.delivery) || (key === 'lifecycles' && !index.profile.lifecycle?.field)) continue;
    const ok = valid(key);
    out[key] = strings(raw[key]).filter((v) => ok.has(v));
  }
  if (isRecord(raw.fields)) {
    const known = new Set((index.profile.fieldFilters ?? []).map((f) => f.field));
    for (const [field, list] of Object.entries(raw.fields)) {
      if (!known.has(field)) continue;
      const ok = valid(`field:${field}`);
      const values = strings(list).filter((v) => ok.has(v));
      if (values.length) out.fields![field] = values;
    }
  }
  return out;
}

function cleanViewport(raw: unknown): Viewport | undefined {
  return isRecord(raw) && finite(raw.x) && finite(raw.y) && finite(raw.zoom) && raw.zoom > 0 ? { x: raw.x, y: raw.y, zoom: raw.zoom } : undefined;
}

// A stored state of 1 view, without what the graph no longer has. Without a stored state, the view
// starts with its default filters.
export function cleanGraph(raw: unknown, model: Model, index: Index, defaults?: ViewFilters): GraphState {
  const out = freshGraph(model, defaults ? cleanFilters(defaults, index) : EMPTY_FILTERS);
  if (!isRecord(raw)) return out;
  const has = (id: string) => index.byId.has(id);
  if (isRecord(raw.scope)) {
    if (raw.scope.type === 'all') out.scope = { type: 'all' };
    else if (raw.scope.type === 'node' && typeof raw.scope.id === 'string' && has(raw.scope.id)) out.scope = { type: 'node', id: raw.scope.id };
  }
  if (out.scope?.type === 'node' && finite(raw.depth) && raw.depth >= 0) out.depth = Math.floor(raw.depth);
  out.filters = cleanFilters(raw.filters, index);
  if (raw.view === 'graph' || raw.view === 'cards' || raw.view === 'table') out.view = raw.view;
  if (typeof raw.selected === 'string' && has(raw.selected)) out.selected = raw.selected;
  if (isRecord(raw.selectedEdge) && !out.selected) {
    const e = raw.selectedEdge;
    // The canvas compares edges by identity, so the state keeps the edge object of the model.
    out.selectedEdge = index.model.edges.find((x) => x.s === e.s && x.t === e.t && x.k === e.k) ?? null;
  }
  out.walk = cleanWalk(raw.walk, has);
  if (out.walk && typeof raw.walkRoot === 'string' && out.walk.shown.has(raw.walkRoot)) out.walkRoot = raw.walkRoot;
  if (out.walk && Array.isArray(raw.history)) out.history = raw.history.slice(-HISTORY_LIMIT).map((w) => cleanWalk(w, has));
  if (typeof raw.layoutChoice === 'string' && (LAYOUTS as string[]).includes(raw.layoutChoice)) out.layoutChoice = raw.layoutChoice as LayoutName;
  if (isRecord(raw.viewport)) {
    for (const mode of ['graph', 'cards'] as const) {
      const vp = cleanViewport(raw.viewport[mode]);
      if (vp) out.viewport[mode] = vp;
    }
  }
  if (typeof raw.dock === 'boolean') out.dock = raw.dock;
  if (typeof raw.statusColour === 'boolean') out.statusColour = raw.statusColour;
  if (raw.panel === 'details' || raw.panel === 'expand') out.panel = raw.panel;
  // A group key starts with "g:". Any other key is a node id.
  if (Array.isArray(raw.open)) out.open = new Set(strings(raw.open).filter((k) => k.startsWith('g:') || has(k)));
  if (isRecord(raw.widths)) {
    for (const [id, w] of Object.entries(raw.widths)) if (finite(w) && w > 0) out.widths[id] = w;
  }
  return out;
}

function serialize(state: PageState) {
  const graphs: Record<string, unknown> = {};
  for (const [id, g] of Object.entries(state.graphs)) {
    graphs[id] = {
      scope: g.scope,
      depth: g.depth,
      filters: g.filters,
      view: g.view,
      selected: g.selected,
      selectedEdge: g.selectedEdge ? { s: g.selectedEdge.s, t: g.selectedEdge.t, k: g.selectedEdge.k } : null,
      walk: walkOut(g.walk),
      walkRoot: g.walkRoot,
      history: g.history.slice(-HISTORY_LIMIT).map(walkOut),
      layoutChoice: g.layoutChoice,
      viewport: g.viewport,
      dock: g.dock,
      statusColour: g.statusColour,
      panel: g.panel,
      open: [...g.open],
      widths: g.widths,
    };
  }
  return { version: STORE_VERSION, active: state.active, graphs };
}

// ---------- the load ----------

// Loads the state of a workspace: the stored state, cleaned, then the link of the address.
// Every view of the workspace gets a state.
export function hydrate(data: WorkspaceData, hash = currentHash()): void {
  const key = storageKey(data);
  const indexes = new Map<Model, Index>();
  const indexOf = (m: Model) => indexes.get(m) ?? indexes.set(m, Core.buildIndex(m)).get(m)!;
  const views = workspaceViews(data);
  const graphs = new Map(views.map((v) => [v.id, { model: v.model, index: indexOf(v.model), graph: v.graph, filters: v.filters }]));
  ctx = { key, graphs, first: views[0].id };
  positionStores.clear();
  const raw = readJson(key);
  const stored = isRecord(raw) && raw.version === STORE_VERSION && isRecord(raw.graphs) ? raw : null;
  const state: Record<string, GraphState> = {};
  let migrated = false;
  const oldKeys = new Set<string>();
  for (const [id, { model, index, filters }] of graphs) {
    state[id] = cleanGraph(stored?.graphs && (stored.graphs as Record<string, unknown>)[id], model, index, filters);
    // The widths of the old key move into the store once.
    const oldKey = OLD_WIDTHS_PREFIX + model.profile.project;
    const old = readJson(oldKey);
    if (isRecord(old)) {
      if (!Object.keys(state[id].widths).length) {
        for (const [col, w] of Object.entries(old)) if (finite(w) && w > 0) state[id].widths[col] = w;
      }
      migrated = true;
    }
    if (old !== null) oldKeys.add(oldKey);
  }
  for (const oldKey of oldKeys) {
    try {
      storage()?.removeItem(oldKey);
    } catch {
      // Blocked storage. Nothing to remove.
    }
  }
  const active = typeof stored?.active === 'string' && graphs.has(stored.active) ? stored.active : ctx.first;
  const epoch = useAppStore.getState().epoch;
  useAppStore.setState({ active, epoch, graphs: state });
  applyLink(parseLink(hash));
  if (migrated) writeNow();
}

function currentHash(): string {
  try {
    return window.location.hash;
  } catch {
    return '';
  }
}

// ---------- the link ----------

// The link values of the active view. The key `graph` holds the id of the view.
export function linkOf(state: PageState = useAppStore.getState()): LinkValues {
  const g = state.graphs[state.active];
  if (!g) return {};
  return { graph: state.active, scope: g.scope?.type === 'node' ? g.scope.id : undefined, node: g.selected ?? undefined };
}

// The id of the view that a link names. A link can name a view, or a graph, which opens in the first
// view of the graph. An unknown name gives nothing.
export function viewOfLink(name: string | undefined): string | undefined {
  if (!ctx || !name) return undefined;
  if (ctx.graphs.has(name)) return name;
  for (const [id, v] of ctx.graphs) if (v.graph === name) return id;
  return undefined;
}

// Applies a link. It wins over the stored state. An unknown view, scope or node is ignored.
export function applyLink(link: LinkValues): void {
  if (!ctx) return;
  const state = useAppStore.getState();
  const id = viewOfLink(link.graph) ?? state.active;
  const { model, index } = ctx.graphs.get(id)!;
  let g = state.graphs[id];
  setProfile(model.profile);
  if (link.scope && index.byId.has(link.scope)) {
    const same = g.scope?.type === 'node' && g.scope.id === link.scope;
    if (!same) {
      g = { ...g, scope: { type: 'node', id: link.scope }, depth: null, walk: null, walkRoot: null, history: [], viewport: {}, layoutTick: g.layoutTick + 1 };
      g = { ...g, selected: link.scope, selectedEdge: null, selectSeq: g.selectSeq + 1, open: revealed(index, g.open, link.scope) };
    }
  }
  if (link.node && index.byId.has(link.node)) {
    g = { ...g, selected: link.node, selectedEdge: null, selectSeq: g.selectSeq + 1, open: revealed(index, g.open, link.node) };
    // A link to a node alone shows the node as the scope.
    if (!g.scope && !g.walk) g = { ...g, scope: { type: 'node', id: link.node }, viewport: {}, layoutTick: g.layoutTick + 1 };
  }
  if (id === state.active && g === state.graphs[id]) return;
  useAppStore.setState({ active: id, graphs: { ...state.graphs, [id]: g } });
}

// ---------- the update of a graph ----------

export function setActive(id: string): void {
  if (useAppStore.getState().graphs[id]) useAppStore.setState({ active: id });
}

export function patchGraph(id: string, patch: Partial<GraphState> | ((g: GraphState) => Partial<GraphState>)): void {
  useAppStore.setState((s) => {
    const g = s.graphs[id];
    if (!g) return s;
    const p = typeof patch === 'function' ? patch(g) : patch;
    if (Object.entries(p).every(([k, v]) => g[k as keyof GraphState] === v)) return s;
    return { graphs: { ...s.graphs, [id]: { ...g, ...p } } };
  });
}

// ---------- the write ----------

let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

function writeNow(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  dirty = false;
  if (!ctx) return;
  try {
    storage()?.setItem(ctx.key, JSON.stringify(serialize(useAppStore.getState())));
  } catch {
    // The storage is blocked or full. The page works and keeps the state in memory.
  }
}

function schedule(): void {
  dirty = true;
  if (!timer) timer = setTimeout(writeNow, WRITE_DELAY);
}

// Writes each change to the storage, after a short delay. The returned function writes at once and stops.
export function attachPersistence(): () => void {
  const unsubscribe = useAppStore.subscribe((s, prev) => {
    if (s.graphs !== prev.graphs || s.active !== prev.active) schedule();
  });
  const flush = () => {
    if (dirty) writeNow();
  };
  window.addEventListener('pagehide', flush);
  return () => {
    unsubscribe();
    window.removeEventListener('pagehide', flush);
    flush();
  };
}

// Forgets the stored state of the workspace and starts fresh in every view.
export function resetStored(): void {
  if (!ctx) return;
  const graphs: Record<string, GraphState> = {};
  for (const [id, { model, index, filters }] of ctx.graphs) graphs[id] = freshGraph(model, filters ? cleanFilters(filters, index) : EMPTY_FILTERS);
  positionStores.clear();
  useAppStore.setState((s) => ({ active: ctx!.first, epoch: s.epoch + 1, graphs }));
  if (timer) clearTimeout(timer);
  timer = null;
  dirty = false;
  try {
    storage()?.removeItem(ctx.key);
  } catch {
    // Blocked storage. Nothing to remove.
  }
}
