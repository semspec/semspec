// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The state of the viewer: scope, filters, view, selection and the walk on the canvas.
// The rules live in the core module. This hook only holds the state and calls them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Core, type Filters, type Index, type Model, type VEdge, type VNode, type Walk } from './core';

export type View = 'graph' | 'cards' | 'table';
export type Scope = { type: 'node'; id: string } | { type: 'all' } | null;
export type Panel = 'details' | 'expand';

export const EMPTY_FILTERS: Filters = { q: '', kinds: [], lifecycles: [], deliveries: [], modules: [], statuses: [], fields: {} };

// The tree group that holds a node. A reveal opens it.
function groupOf(index: Index, id: string): string {
  let n = index.byId.get(id)!;
  const seen = new Set<string>();
  while (n.parents.length && !seen.has(n.id)) {
    seen.add(n.id);
    n = index.byId.get(n.parents[0])!;
  }
  if (Core.LINKED_KINDS.includes(n.kind)) return `g:${n.kind}`;
  if (!Core.kindSpec(n.kind)?.parents?.length) return 'g:hier';
  if (index.unplaced.has(n.id)) return `g:unplaced:${n.kind}`;
  return `g:un:${n.kind}`;
}

type Positions = Record<'graph' | 'cards', { map: Map<string, { x: number; y: number }>; tick: number; key: string }>;

// The state of a viewer. A workspace keeps it when the user leaves a graph, and gives it back
// when the user returns.
export interface ViewerState {
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
  dock: boolean;
  statusColour: boolean;
  panel: Panel;
  open: Set<string>;
  positions: Positions;
}

// `session` restores a saved state at the start. The hook saves the state after each render.
export function useViewer(model: Model, session?: { initial?: ViewerState; save: (state: ViewerState) => void }) {
  const index = useMemo(() => Core.buildIndex(model), [model]);
  const init = session?.initial;
  const [scope, setScopeState] = useState<Scope>(init?.scope ?? null);
  const [depth, setDepth] = useState<number | null>(init?.depth ?? null);
  const [filters, setFilters] = useState<Filters>(init?.filters ?? EMPTY_FILTERS);
  const [view, setView] = useState<View>(init?.view ?? 'graph');
  const [selected, setSelected] = useState<string | null>(init?.selected ?? null);
  const [selectedEdge, setSelectedEdge] = useState<VEdge | null>(init?.selectedEdge ?? null);
  const [selectSeq, setSelectSeq] = useState(init?.selectSeq ?? 0);
  const [walk, setWalk] = useState<Walk | null>(init?.walk ?? null);
  const [walkRoot, setWalkRoot] = useState<string | null>(init?.walkRoot ?? null);
  const [history, setHistory] = useState<(Walk | null)[]>(init?.history ?? []);
  const [layoutTick, setLayoutTick] = useState(init?.layoutTick ?? 0);
  const [dock, setDock] = useState(init?.dock ?? false);
  // The canvas colours each node by its status. It is off by default.
  const [statusColour, setStatusColour] = useState(init?.statusColour ?? false);
  const [panel, setPanel] = useState<Panel>(init?.panel ?? 'details');
  const [open, setOpen] = useState<Set<string>>(() => init?.open ?? new Set(['g:hier']));

  // The nodes of the scope, before the filters.
  const scopeIds = useMemo<string[]>(() => {
    if (!scope) return [];
    if (scope.type === 'all') return model.nodes.map((n) => n.id);
    return Array.from(Core.computeScope(index, { id: scope.id, maxDepth: depth }).ids);
  }, [scope, depth, index, model]);

  // The nodes that the facets count: the walk when one is on the canvas, else the scope.
  const baseIds = useMemo<string[]>(() => (walk ? Array.from(walk.shown) : scopeIds), [walk, scopeIds]);
  const filteredIds = useMemo(() => Core.applyFilters(index, baseIds, filters), [index, baseIds, filters]);
  // The canvas shows the whole walk, or the filtered scope. The table follows the canvas.
  const canvasIds = useMemo(() => (walk ? baseIds : filteredIds), [walk, baseIds, filteredIds]);
  const canvasSet = useMemo(() => new Set(canvasIds), [canvasIds]);
  const canvasEdges = useMemo<VEdge[]>(() => Core.scopedEdges(index, canvasSet), [index, canvasSet]);
  const tableIds = filteredIds;

  const reveal = useCallback(
    (id: string) => {
      setOpen((prev) => {
        const next = new Set(prev);
        next.add(groupOf(index, id));
        let n: VNode | undefined = index.byId.get(id);
        const seen = new Set<string>();
        while (n && n.parents.length && !seen.has(n.id)) {
          seen.add(n.id);
          n = index.byId.get(n.parents[0]);
          if (n) next.add(n.id);
        }
        return next;
      });
    },
    [index],
  );

  const select = useCallback(
    (id: string | null, opts?: { panel?: Panel }) => {
      setSelected(id);
      setSelectedEdge(null);
      if (id) {
        reveal(id);
        setSelectSeq((s) => s + 1);
        if (opts?.panel) setPanel(opts.panel);
      }
    },
    [reveal],
  );

  const selectEdge = useCallback((edge: VEdge | null) => {
    setSelectedEdge(edge);
    if (edge) {
      setSelected(null);
      setPanel('details');
    }
  }, []);

  const setScope = useCallback(
    (next: Scope) => {
      setScopeState(next);
      setWalk(null);
      setWalkRoot(null);
      setHistory([]);
      setDepth(null);
      setLayoutTick((t) => t + 1);
      if (next && next.type === 'node') select(next.id);
    },
    [select],
  );

  const commit = useCallback(
    (next: Walk | null) => {
      setHistory((h) => [...h.slice(-49), walk]);
      setWalk(next);
    },
    [walk],
  );

  const startFrom = useCallback(
    (id: string) => {
      setScopeState(null);
      setHistory([]);
      setWalk(Core.walkStart([id]));
      setWalkRoot(id);
      setLayoutTick((t) => t + 1);
      select(id);
    },
    [select],
  );

  const expand = useCallback(
    (id: string, filter?: { k?: string; dir?: string; kind?: string }) => {
      const base = walk ?? Core.walkStart(canvasIds);
      const { walk: next, added } = Core.walkExpand(index, base, id, filter);
      if (!added.length) return [] as string[];
      commit(next);
      return added;
    },
    [walk, canvasIds, index, commit],
  );

  const collapse = useCallback(
    (id: string) => {
      if (!walk) return;
      commit(Core.walkCollapse(walk, id));
    },
    [walk, commit],
  );

  const hide = useCallback(
    (id: string) => {
      const base = walk ?? Core.walkStart(canvasIds);
      commit(Core.walkHide(base, id));
      if (selected === id) setSelected(null);
    },
    [walk, canvasIds, commit, selected],
  );

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      setWalk(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, []);

  const resetWalk = useCallback(() => {
    setWalk(null);
    setWalkRoot(null);
    setHistory([]);
    setLayoutTick((t) => t + 1);
  }, []);

  const relayout = useCallback(() => setLayoutTick((t) => t + 1), []);
  const toggleOpen = useCallback((key: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // The canvas positions of each mode. A switch between Graph and Cards keeps the walk and the
  // positions of each mode.
  const positions = useRef<Positions>(
    init?.positions ?? {
      graph: { map: new Map(), tick: -1, key: '' },
      cards: { map: new Map(), tick: -1, key: '' },
    },
  );

  const latest: ViewerState = { scope, depth, filters, view, selected, selectedEdge, selectSeq, walk, walkRoot, history, layoutTick, dock, statusColour, panel, open, positions: positions.current };
  const current = useRef(latest);
  current.current = latest;
  const saver = useRef(session?.save);
  saver.current = session?.save;
  // The state is saved after each render, so the next viewer of this graph reads the last state.
  useEffect(() => {
    saver.current?.(current.current);
  });

  return {
    model,
    index,
    scope,
    setScope,
    depth,
    setDepth,
    filters,
    setFilters,
    view,
    setView,
    selected,
    select,
    selectedEdge,
    selectEdge,
    selectSeq,
    walk,
    walkRoot,
    canUndo: history.length > 0,
    undo,
    expand,
    collapse,
    hide,
    startFrom,
    resetWalk,
    layoutTick,
    relayout,
    dock,
    setDock,
    statusColour: statusColour && !!model.profile.status,
    setStatusColour,
    panel,
    setPanel,
    open,
    toggleOpen,
    scopeIds,
    baseIds,
    canvasIds,
    canvasSet,
    canvasEdges,
    tableIds,
    filteredCount: filteredIds.length,
    positions,
  };
}

export type Viewer = ReturnType<typeof useViewer>;
