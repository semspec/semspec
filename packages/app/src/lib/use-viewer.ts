// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The state of the viewer: scope, filters, view, selection and the walk on the canvas.
// The rules live in the core module. This hook only holds the state and calls them.
import { useCallback, useMemo, type SetStateAction } from 'react';
import { Core, type Model, type VEdge, type Walk } from './core';
import { EMPTY_FILTERS, patchGraph, positionsOf, useAppStore, type CanvasMode, type GraphState, type Panel, type Scope, type View, type Viewport } from './store';
import { revealed } from './tree-open';

export type { Panel, Scope, View };
export { EMPTY_FILTERS };

// 1 field of the state of the graph. The state lives in the store, so a switch of the graph keeps it.
function useField<K extends keyof GraphState>(graph: string, key: K) {
  const value = useAppStore((s) => s.graphs[graph][key]);
  const set = useCallback(
    (next: SetStateAction<GraphState[K]>) =>
      patchGraph(graph, (g) => ({ [key]: typeof next === 'function' ? (next as (prev: GraphState[K]) => GraphState[K])(g[key]) : next }) as Partial<GraphState>),
    [graph, key],
  );
  return [value, set] as const;
}

// The state of a viewer: scope, filters, view, selection and the walk on the canvas. The store holds
// it for each graph. The hook reads and writes through the store.
export function useViewer(model: Model, graph: string) {
  const index = useMemo(() => Core.buildIndex(model), [model]);
  const [scope] = useField(graph, 'scope');
  const [depth, setDepth] = useField(graph, 'depth');
  const [filters, setFilters] = useField(graph, 'filters');
  const [view, setView] = useField(graph, 'view');
  const [selected, setSelected] = useField(graph, 'selected');
  const [selectedEdge, setSelectedEdge] = useField(graph, 'selectedEdge');
  const [walk] = useField(graph, 'walk');
  const [walkRoot] = useField(graph, 'walkRoot');
  const [history] = useField(graph, 'history');
  const [layoutTick] = useField(graph, 'layoutTick');
  const [layoutChoice, setLayoutChoice] = useField(graph, 'layoutChoice');
  const [dock, setDock] = useField(graph, 'dock');
  // The canvas colours each node by its status. It is off by default.
  const [statusColour, setStatusColour] = useField(graph, 'statusColour');
  const [panel, setPanel] = useField(graph, 'panel');
  const [open] = useField(graph, 'open');
  const [widths, setWidths] = useField(graph, 'widths');
  const selectSeq = useAppStore((s) => s.graphs[graph].selectSeq);

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

  const select = useCallback(
    (id: string | null, opts?: { panel?: Panel }) => {
      patchGraph(graph, (g) => ({
        selected: id,
        selectedEdge: null,
        ...(id ? { open: revealed(index, g.open, id), selectSeq: g.selectSeq + 1, ...(opts?.panel ? { panel: opts.panel } : {}) } : {}),
      }));
    },
    [graph, index],
  );

  const selectEdge = useCallback(
    (edge: VEdge | null) => {
      patchGraph(graph, edge ? { selectedEdge: edge, selected: null, panel: 'details' } : { selectedEdge: null });
    },
    [graph],
  );

  // A new scope, a new walk and a new layout drop the stored viewport, so the canvas fits.
  const setScope = useCallback(
    (next: Scope) => {
      patchGraph(graph, (g) => ({ scope: next, walk: null, walkRoot: null, history: [], depth: null, viewport: {}, layoutTick: g.layoutTick + 1 }));
      if (next && next.type === 'node') select(next.id);
    },
    [graph, select],
  );

  const commit = useCallback(
    (next: Walk | null) => {
      patchGraph(graph, (g) => ({ history: [...g.history.slice(-49), walk], walk: next }));
    },
    [graph, walk],
  );

  const startFrom = useCallback(
    (id: string) => {
      patchGraph(graph, (g) => ({ scope: null, history: [], walk: Core.walkStart([id]), walkRoot: id, viewport: {}, layoutTick: g.layoutTick + 1 }));
      select(id);
    },
    [graph, select],
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
    [walk, canvasIds, commit, selected, setSelected],
  );

  const undo = useCallback(() => {
    patchGraph(graph, (g) => (g.history.length ? { walk: g.history[g.history.length - 1], history: g.history.slice(0, -1) } : {}));
  }, [graph]);

  const resetWalk = useCallback(() => {
    patchGraph(graph, (g) => ({ walk: null, walkRoot: null, history: [], viewport: {}, layoutTick: g.layoutTick + 1 }));
  }, [graph]);

  const relayout = useCallback(() => patchGraph(graph, (g) => ({ viewport: {}, layoutTick: g.layoutTick + 1 })), [graph]);
  const toggleOpen = useCallback(
    (key: string) => {
      patchGraph(graph, (g) => {
        const next = new Set(g.open);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return { open: next };
      });
    },
    [graph],
  );

  // The canvas positions of each mode. A switch between Graph and Cards keeps the walk and the
  // positions of each mode.
  const positions = positionsOf(graph);

  // The viewport of the canvas. It is not reactive, because a pan must not render the viewer.
  const viewportOf = useCallback((mode: CanvasMode) => useAppStore.getState().graphs[graph]?.viewport[mode], [graph]);
  const saveViewport = useCallback(
    (mode: CanvasMode, vp: Viewport) => patchGraph(graph, (g) => ({ viewport: { ...g.viewport, [mode]: vp } })),
    [graph],
  );

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
    graph,
    layoutChoice,
    setLayoutChoice,
    widths,
    setWidths,
    viewportOf,
    saveViewport,
  };
}

export type Viewer = ReturnType<typeof useViewer>;
