// SPDX-License-Identifier: Apache-2.0
// The state of the viewer: scope, filters, view, selection and the walk on the canvas.
// The rules live in the core module. This hook only holds the state and calls them.
import { useCallback, useMemo, useRef, useState } from 'react';
import { Core, type Filters, type Index, type Model, type VEdge, type VNode, type Walk } from './core';

export type View = 'graph' | 'cards' | 'table';
export type Scope = { type: 'node'; id: string } | { type: 'all' } | null;
export type Panel = 'details' | 'expand';

export const EMPTY_FILTERS: Filters = { q: '', kinds: [], lifecycles: [], deliveries: [], modules: [] };

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

export function useViewer(model: Model) {
  const index = useMemo(() => Core.buildIndex(model), [model]);
  const [scope, setScopeState] = useState<Scope>(null);
  const [depth, setDepth] = useState<number | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [view, setView] = useState<View>('graph');
  const [selected, setSelected] = useState<string | null>(null);
  const [selectSeq, setSelectSeq] = useState(0);
  const [walk, setWalk] = useState<Walk | null>(null);
  const [walkRoot, setWalkRoot] = useState<string | null>(null);
  const [history, setHistory] = useState<(Walk | null)[]>([]);
  const [layoutTick, setLayoutTick] = useState(0);
  const [dock, setDock] = useState(false);
  const [panel, setPanel] = useState<Panel>('details');
  const [open, setOpen] = useState<Set<string>>(() => new Set(['g:hier']));

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
      if (id) {
        reveal(id);
        setSelectSeq((s) => s + 1);
        if (opts?.panel) setPanel(opts.panel);
      }
    },
    [reveal],
  );

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
  const positions = useRef<Record<'graph' | 'cards', { map: Map<string, { x: number; y: number }>; tick: number; key: string }>>({
    graph: { map: new Map(), tick: -1, key: '' },
    cards: { map: new Map(), tick: -1, key: '' },
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
