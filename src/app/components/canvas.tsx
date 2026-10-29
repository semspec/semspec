// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The canvas of the Graph view and the Cards view. Both use React Flow and the same walk state.
// The Graph view draws small pill nodes with a hover summary. The Cards view draws cards.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { ChevronsRight, ChevronsLeft, EyeOff, LayoutGrid, Maximize2, Undo2, Waypoints, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CountBadge, KindDot, NodeSummaryView, StatusDot, kindColor, statusShare, toneColor } from '@/components/kind';
import { Core, type Kind, type NodeStatus, type Summary, type VEdge } from '@/lib/core';
import { SIZE, layered, placeNear, type Mode, type Pos } from '@/lib/layout';
import type { Viewer } from '@/lib/use-viewer';
import { cn } from '@/lib/utils';

const BIG = 300;
const SMALL_SCOPE_EDGES = 25;

interface NodeData extends Record<string, unknown> {
  kind: Kind;
  summary: Summary;
  badge: number;
  selected: boolean;
  dim: boolean;
  // Set when the canvas colours the nodes by status.
  status?: NodeStatus;
}

const hidden = 'size-1! min-h-0! min-w-0! border-0! bg-transparent!';

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Left} className={hidden} isConnectable={false} />
      <Handle type="source" position={Position.Right} className={hidden} isConnectable={false} />
    </>
  );
}

// A plain node of the Graph view. With a status, the border takes the colour of the status and
// the pill shows the share of good nodes.
function PillNode({ data }: NodeProps<Node<NodeData>>) {
  const { summary, badge, selected, dim, status } = data;
  return (
    <div
      className={cn(
        'relative flex h-8 w-[230px] items-center gap-2 rounded-full border bg-card px-3 text-[13px] shadow-xs transition-opacity',
        selected && 'ring-2 ring-ring',
        dim && 'opacity-25',
        summary.muted && 'opacity-60',
      )}
      style={status ? { borderColor: toneColor(status.tone), borderWidth: 2 } : { borderColor: `color-mix(in oklab, ${kindColor(summary.kind)} 55%, var(--border))` }}
    >
      <KindDot kind={summary.kind} className="size-2.5" />
      <span className={cn('min-w-0 flex-1 truncate', summary.muted && 'line-through')}>{summary.title}</span>
      {!!status?.total && (
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
          <StatusDot tone={status.tone} />
          {statusShare(status, true)}
        </span>
      )}
      <CountBadge count={badge} className="absolute -top-2 -right-1" />
      <Handles />
    </div>
  );
}

// A card of the Cards view. Far from the canvas it collapses to a dot with a short label.
function CardNode({ data }: NodeProps<Node<NodeData>>) {
  const { summary, badge, selected, dim, status } = data;
  const far = useStore((s) => s.transform[2] < 0.5);
  if (far) {
    return (
      <div className={cn('relative flex h-[120px] w-[232px] items-center gap-3 transition-opacity', dim && 'opacity-25')}>
        <span className="size-9 shrink-0 rounded-full" style={{ background: status ? toneColor(status.tone) : kindColor(summary.kind), outline: selected ? '3px solid var(--ring)' : undefined }} />
        <span className="truncate text-2xl font-medium">{summary.title.slice(0, 18)}</span>
        <CountBadge count={badge} className="absolute top-8 left-6 h-6 min-w-6 text-sm" />
        <Handles />
      </div>
    );
  }
  return (
    <div className={cn('relative w-[232px] rounded-lg transition-opacity', selected && 'ring-2 ring-ring', dim && 'opacity-25')}>
      <NodeSummaryView summary={summary} count={badge} status={status} />
      <Handles />
    </div>
  );
}

const NODE_TYPES = { pill: PillNode, card: CardNode };

function Inner({ v, mode }: { v: Viewer; mode: Mode }) {
  const { index, canvasIds: ids, canvasEdges: edges, selected, walk } = v;
  const flow = useReactFlow();
  const [confirmed, setConfirmed] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const scopeKey = v.scope ? (v.scope.type === 'all' ? 'all' : v.scope.id) : `walk:${v.walkRoot}`;
  useEffect(() => setConfirmed(false), [scopeKey]);

  const store = v.positions.current[mode];

  const positions = useMemo(() => {
    const key = ids.join('|');
    const tickSame = store.tick === v.layoutTick;
    if (tickSame && store.key === key && store.map.size) return store.map;
    let next: Map<string, Pos>;
    if (tickSame && walk && store.map.size) {
      // A walk keeps the nodes where they are. New nodes go next to their source.
      next = new Map(store.map);
      const DOWNWARD = Core.DOWN_EDGES;
      const added = ids.filter((id) => !next.has(id));
      const bySource = new Map<string, { id: string; left: boolean }[]>();
      added.forEach((id) => {
        const from = Array.from(walk.intro.get(id) ?? []).find((s) => s && next.has(s)) ?? Array.from(next.keys())[0];
        // A general node sits left of the node it comes from. A specific node sits right.
        const left =
          index.out.get(from)!.some((e) => e.t === id && DOWNWARD.has(e.k)) || index.inc.get(from)!.some((e) => e.s === id && !DOWNWARD.has(e.k));
        if (!bySource.has(from)) bySource.set(from, []);
        bySource.get(from)!.push({ id, left });
      });
      bySource.forEach((list, from) => {
        next = placeNear(next, from, list, mode);
      });
    } else {
      next = layered(ids, edges, mode);
    }
    store.map = next;
    store.tick = v.layoutTick;
    store.key = key;
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, edges, mode, v.layoutTick, walk]);

  // The neighbours of a selected node stand out and the rest dims. The scope node itself dims nothing.
  const isRoot = !!selected && ((v.scope?.type === 'node' && v.scope.id === selected) || v.walkRoot === selected);
  const neighbours = useMemo(
    () => (selected && !isRoot && v.canvasSet.has(selected) ? Core.neighbourIds(index, selected) : null),
    [index, selected, isRoot, v.canvasSet],
  );

  const derived = useMemo<Node<NodeData>[]>(
    () =>
      ids.map((id) => {
        const n = index.byId.get(id)!;
        return {
          id,
          type: mode === 'cards' ? 'card' : 'pill',
          position: positions.get(id) ?? { x: 0, y: 0 },
          width: SIZE[mode].w,
          data: {
            kind: n.kind,
            summary: Core.summaryOf(index, n),
            badge: Core.badgeCount(index, v.canvasSet, id),
            selected: id === selected,
            dim: !!neighbours && id !== selected && !neighbours.has(id),
            status: v.statusColour ? Core.statusOf(index, id, v.filters.fields) : undefined,
          },
        };
      }),
    [ids, index, mode, positions, selected, neighbours, v.canvasSet, v.statusColour, v.filters.fields],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>(derived);
  useEffect(() => setNodes(derived), [derived, setNodes]);

  const showAll = edges.length <= SMALL_SCOPE_EDGES;
  const rfEdges = useMemo<Edge[]>(
    () =>
      edges.map((e: VEdge, i) => {
        const touches = e.s === hovered || e.t === hovered || e.s === selected || e.t === selected;
        const dim = !!neighbours && !touches;
        // A `down` edge points from the specific node on the right to the general node on the left.
        // React Flow draws it from the general node, so the line leaves a right side and enters a left side.
        // The arrow stays at the general node.
        const down = Core.DOWN_EDGES.has(e.k);
        const marker = { type: MarkerType.ArrowClosed, width: 12, height: 12, color: 'var(--muted-foreground)' };
        return {
          id: `e${i}`,
          source: down ? e.t : e.s,
          target: down ? e.s : e.t,
          label: showAll || touches ? Core.EDGE_LABEL[e.k]?.[0] ?? e.k : undefined,
          labelStyle: { fontSize: 11, fill: 'var(--muted-foreground)' },
          labelBgStyle: { fill: 'var(--background)', fillOpacity: 0.85 },
          labelBgPadding: [4, 2],
          style: { stroke: 'var(--muted-foreground)', strokeOpacity: dim ? 0.12 : touches ? 0.9 : 0.45, strokeWidth: touches ? 1.6 : 1.1 },
          ...(down ? { markerStart: marker } : { markerEnd: marker }),
        };
      }),
    [edges, hovered, selected, neighbours, showAll],
  );

  // Fit keeps the text readable: the zoom never goes below 0.7. A canvas that is larger than the
  // view starts at its top left corner, so the root of the scope is on the screen.
  const vw = useStore((s) => s.width);
  const vh = useStore((s) => s.height);
  const domNode = useStore((s) => s.domNode);
  const fit = useCallback(
    (animate = true) => {
      // The bounds come from the positions of the layout, and the size from the element, so the fit
      // does not depend on what React Flow has measured yet.
      const rect = domNode?.getBoundingClientRect();
      const size = SIZE[mode];
      const pts = ids.map((id) => positions.get(id)).filter((p): p is Pos => !!p);
      if (!rect || !rect.width || !pts.length) return;
      const minX = Math.min(...pts.map((p) => p.x));
      const minY = Math.min(...pts.map((p) => p.y));
      const width = Math.max(...pts.map((p) => p.x)) + size.w - minX;
      const height = Math.max(...pts.map((p) => p.y)) + size.h - minY;
      const z = Math.min(1, Math.max(0.7, Math.min((rect.width - 48) / width, (rect.height - 110) / height)));
      const x = width * z + 48 <= rect.width ? (rect.width - width * z) / 2 - minX * z : 24 - minX * z;
      // A canvas taller than the view shows the root of the scope in the middle of the left edge.
      const rootPos = positions.get(v.scope?.type === 'node' ? v.scope.id : (v.walkRoot ?? ids[0]));
      const y =
        height * z + 110 <= rect.height
          ? (rect.height - height * z) / 2 - minY * z + 24
          : rootPos
            ? rect.height / 2 - (rootPos.y + size.h / 2) * z + 24
            : 64 - minY * z;
      flow.setViewport({ x, y, zoom: z }, { duration: animate ? 250 : 0 });
    },
    [flow, domNode, ids, positions, mode, v.scope, v.walkRoot],
  );
  // Fit on a new scope, a re-layout and a change of mode. A walk step keeps the view. A change of
  // the panel size fits again, until the reader moves or zooms the canvas.
  const moved = useRef(false);
  useEffect(() => {
    moved.current = false;
  }, [v.layoutTick, mode, scopeKey, confirmed]);
  useEffect(() => {
    if (moved.current) return;
    const t = setTimeout(() => fit(false), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.layoutTick, mode, scopeKey, confirmed, Math.round(vw / 40), Math.round(vh / 40)]);

  if (ids.length > BIG && !confirmed) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center gap-3 rounded-xl border bg-card p-6 text-center">
          <Waypoints className="size-8 text-warn" />
          <div className="text-base font-semibold">{ids.length} nodes are too many for a canvas</div>
          <p className="text-sm text-muted-foreground">
            A graph above {BIG} nodes is slow and hard to read. Narrow the scope with the depth or the filters, start a walk from one node, or use the table.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => v.setView('table')}>
              Open the table
            </Button>
            <Button variant="secondary" onClick={() => setConfirmed(true)}>
              Draw {ids.length} nodes anyway
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (!ids.length) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">No node matches the scope and the filters.</div>
    );
  }

  const sel = selected && v.canvasSet.has(selected) ? selected : null;
  const kinds = Array.from(new Set(ids.map((id) => index.byId.get(id)!.kind)));
  const tool = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick} />}>{icon}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={rfEdges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onNodeClick={(_, n) => v.select(n.id)}
      onNodeDoubleClick={(_, n) => v.expand(n.id)}
      onNodeDragStop={(_, n) => store.map.set(n.id, n.position)}
      onNodeMouseEnter={(_, n) => setHovered(n.id)}
      onNodeMouseLeave={() => setHovered(null)}
      onPaneClick={() => v.select(null)}
      onMoveStart={(event) => {
        // An event means that the reader moved the canvas. A move by the code has none.
        if (event) moved.current = true;
      }}
      zoomOnDoubleClick={false}
      nodesConnectable={false}
      minZoom={0.1}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      colorMode="system"
      aria-label={mode === 'cards' ? 'Cards canvas' : 'Graph canvas'}
    >
      <Background gap={20} size={1} className="opacity-60" />
      <Controls showInteractive={false} position="bottom-left" className="mb-9" />
      <MiniMap pannable zoomable position="bottom-right" nodeColor={(n) => kindColor((n.data as NodeData).kind)} nodeStrokeWidth={0} nodeBorderRadius={4} className="rounded-md! border! bg-card!" maskColor="color-mix(in oklab, var(--foreground) 8%, transparent)" />
      <Panel position="top-left" className="flex items-center gap-1.5 rounded-lg border bg-card/95 p-1 shadow-xs">
        {tool('Re-layout the canvas', <LayoutGrid />, v.relayout)}
        {tool('Fit the canvas', <Maximize2 />, () => fit(true))}
        <span className="mx-0.5 h-4 w-px bg-border" />
        {tool('Expand the selected node', <ChevronsRight />, () => sel && v.expand(sel), !sel)}
        {tool('Collapse what the selected node added', <ChevronsLeft />, () => sel && v.collapse(sel), !sel || !walk)}
        {tool('Hide the selected node', <EyeOff />, () => sel && v.hide(sel), !sel)}
        {tool('Start a walk from the selected node', <Network />, () => sel && v.startFrom(sel), !sel)}
        <span className="mx-0.5 h-4 w-px bg-border" />
        {tool('Undo the last expand or collapse', <Undo2 />, v.undo, !v.canUndo)}
      </Panel>
      <Panel position="top-right" className="flex max-w-[55%] flex-col items-end gap-1.5">
        {v.walk && (
          <div className="flex items-center gap-2 rounded-lg border bg-card/95 px-2.5 py-1 text-xs shadow-xs">
            <span className="font-medium">Walk</span>
            <span className="text-muted-foreground tabular-nums">{ids.length} nodes</span>
            <Button variant="ghost" size="xs" onClick={v.resetWalk}>
              {v.walkRoot ? 'Clear' : 'Back to the scope'}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 rounded-lg border bg-card/95 px-2.5 py-1 text-[11px] shadow-xs">
          {kinds.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <KindDot kind={k} />
              {Core.KIND_LABEL[k]}
            </span>
          ))}
        </div>
      </Panel>
    </ReactFlow>
  );
}

export function Canvas({ v, mode }: { v: Viewer; mode: Mode }) {
  return (
    <ReactFlowProvider>
      <div className="h-full w-full" data-testid={`canvas-${mode}`}>
        <Inner v={v} mode={mode} />
      </div>
    </ReactFlowProvider>
  );
}
