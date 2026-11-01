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
import { ChevronsRight, ChevronsLeft, EyeOff, LayoutGrid, Maximize2, Undo2, Waypoints, Network, Layers, Workflow, Orbit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CountBadge, KindDot, NodeSummaryView, StatusDot, kindColor, statusShare, toneColor } from '@/components/kind';
import { Core, type Kind, type NodeStatus, type Summary, type VEdge } from '@/lib/core';
import { SIZE, layered, placeNear, type Mode, type Pos } from '@/lib/layout';
import { LAYOUTS, boundsOf, facingSides, findContainers, forceLayout, grouped, moveWithMembers, rectsOf, type LayoutName } from '@/lib/layouts';
import type { Viewer } from '@/lib/use-viewer';
import { usePhone } from '@/lib/use-phone';
import { useTheme } from '@/lib/use-theme';
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

// Handles on all 4 sides. The layered layout uses the 2 handles without an id. The others pick a side.
const SIDES: [string, Position][] = [
  ['left', Position.Left],
  ['right', Position.Right],
  ['top', Position.Top],
  ['bottom', Position.Bottom],
];

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Left} className={hidden} isConnectable={false} />
      <Handle type="source" position={Position.Right} className={hidden} isConnectable={false} />
      {SIDES.map(([side, position]) => (
        <Handle key={`t-${side}`} id={`t-${side}`} type="target" position={position} className={hidden} isConnectable={false} />
      ))}
      {SIDES.map(([side, position]) => (
        <Handle key={`s-${side}`} id={`s-${side}`} type="source" position={position} className={hidden} isConnectable={false} />
      ))}
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
      <KindDot kind={summary.kind} className="size-2.5" neutral={!!status} />
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

// A container of the grouped layout: a title bar in the style of a pill, and a frame around the members.
function ContainerNode({ data }: NodeProps<Node<NodeData>>) {
  const { summary, badge, selected, dim, status } = data;
  const color = status ? toneColor(status.tone) : kindColor(summary.kind);
  return (
    <div
      className={cn('relative size-full rounded-xl border-2 border-dashed transition-opacity', selected && 'ring-2 ring-ring', dim && 'opacity-25', summary.muted && 'opacity-60')}
      style={{ borderColor: `color-mix(in oklab, ${color} 60%, var(--border))`, background: `color-mix(in oklab, ${color} 6%, transparent)` }}
    >
      <div className="flex h-8 items-center gap-2 px-3 text-[13px] font-medium">
        <KindDot kind={summary.kind} className="size-2.5" neutral={!!status} />
        <span className={cn('min-w-0 flex-1 truncate', summary.muted && 'line-through')}>{summary.title}</span>
        {!!status?.total && (
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
            <StatusDot tone={status.tone} />
            {statusShare(status, true)}
          </span>
        )}
      </div>
      <CountBadge count={badge} className="absolute -top-2 -right-1" />
      <Handles />
    </div>
  );
}

const NODE_TYPES = { pill: PillNode, card: CardNode, container: ContainerNode };

const LAYOUT_LABEL: Record<LayoutName, string> = { layered: 'Layered layout', grouped: 'Grouped layout', force: 'Force layout' };
const LAYOUT_ICON: Record<LayoutName, React.ReactNode> = { layered: <Workflow />, grouped: <Layers />, force: <Orbit /> };

// React Flow needs a container before its members.
function sortParentsFirst(ids: string[], parentOf: Map<string, string>): string[] {
  if (!parentOf.size) return ids;
  const depth = (id: string) => {
    let d = 0;
    for (let up = parentOf.get(id); up !== undefined; up = parentOf.get(up)) d++;
    return d;
  };
  return ids.map((id, i) => ({ id, i, d: depth(id) })).sort((a, b) => a.d - b.d || a.i - b.i).map((x) => x.id);
}

// A node that the canvas centers after a jump. The seq tells one jump from the next.
export interface CenterTarget {
  node: string;
  seq: number;
}

// The zoom that keeps the title of a node readable after a jump.
const JUMP_ZOOM = 1;

function Inner({ v, mode, center, onCentered }: { v: Viewer; mode: Mode; center?: CenterTarget | null; onCentered?: (seq: number) => void }) {
  const { index, canvasIds: ids, canvasEdges: edges, selected, walk } = v;
  const flow = useReactFlow();
  const { resolved: theme } = useTheme();
  const phone = usePhone();
  const [confirmed, setConfirmed] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const scopeKey = v.scope ? (v.scope.type === 'all' ? 'all' : v.scope.id) : `walk:${v.walkRoot}`;
  useEffect(() => setConfirmed(false), [scopeKey]);

  const store = v.positions.current[mode];
  const spec = Core.profile.layout;
  const groupEdge = spec?.groupEdge;
  const chosen = v.layoutChoice;
  const setChosen = v.setLayoutChoice;
  const wanted: LayoutName = chosen ?? spec?.default ?? 'layered';
  const layout: LayoutName = wanted === 'grouped' && !groupEdge ? 'layered' : wanted;
  const containers = useMemo(() => findContainers(ids, edges, layout === 'grouped' ? groupEdge : undefined), [ids, edges, layout, groupEdge]);

  const positions = useMemo(() => {
    const key = `${layout}::${ids.join('|')}`;
    const tickSame = store.tick === v.layoutTick;
    if (tickSame && store.key === key && store.map.size) return store.map;
    let next: Map<string, Pos>;
    if (tickSame && walk && store.map.size && store.key.startsWith(`${layout}::`)) {
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
    } else if (layout === 'grouped' && groupEdge) {
      next = grouped(ids, edges, mode, groupEdge, Core.DOWN_EDGES);
    } else if (layout === 'force') {
      next = forceLayout(ids, edges, mode);
    } else {
      next = layered(ids, edges, mode);
    }
    store.map = next;
    store.tick = v.layoutTick;
    store.key = key;
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, edges, mode, v.layoutTick, walk, layout, groupEdge]);

  // The rectangle of each node. A container takes the box around its members.
  const rects = useMemo(() => rectsOf(ids, containers.parentOf, positions, mode), [ids, containers, positions, mode]);

  // The neighbours of a selected node stand out and the rest dims. The scope node itself dims nothing.
  const isRoot = !!selected && ((v.scope?.type === 'node' && v.scope.id === selected) || v.walkRoot === selected);
  const neighbours = useMemo(
    () => (selected && !isRoot && v.canvasSet.has(selected) ? Core.neighbourIds(index, selected) : null),
    [index, selected, isRoot, v.canvasSet],
  );

  const derived = useMemo<Node<NodeData>[]>(
    () =>
      sortParentsFirst(ids, containers.parentOf).map((id) => {
        const n = index.byId.get(id)!;
        const parent = containers.parentOf.get(id);
        const rect = rects.get(id)!;
        const origin = parent ? rects.get(parent)! : { x: 0, y: 0 };
        const isBox = containers.children.has(id);
        return {
          id,
          type: isBox ? 'container' : mode === 'cards' ? 'card' : 'pill',
          position: { x: rect.x - origin.x, y: rect.y - origin.y },
          ...(isBox ? { width: rect.w, height: rect.h } : { width: SIZE[mode].w }),
          ...(parent ? { parentId: parent, extent: 'parent' as const } : {}),
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
    [ids, index, mode, rects, containers, selected, neighbours, v.canvasSet, v.statusColour, v.filters.fields],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>(derived);
  useEffect(() => setNodes(derived), [derived, setNodes]);

  const showAll = edges.length <= SMALL_SCOPE_EDGES;
  const rfEdges = useMemo<Edge[]>(
    () =>
      edges.flatMap((e: VEdge, i) => {
        // The nesting shows the edge to the container of a node.
        if (layout === 'grouped' && e.k === groupEdge && containers.parentOf.get(e.s) === e.t) return [];
        const chosen = e === v.selectedEdge;
        const touches = chosen || e.s === hovered || e.t === hovered || e.s === selected || e.t === selected;
        const dim = !!neighbours && !touches;
        // A `down` edge points from the specific node on the right to the general node on the left.
        // React Flow draws it from the general node, so the line leaves a right side and enters a left side.
        // The arrow stays at the general node.
        const down = Core.DOWN_EDGES.has(e.k);
        const from = down ? e.t : e.s;
        const to = down ? e.s : e.t;
        // The force layout and the edges between containers attach on the sides that face each other.
        const facing =
          (layout === 'force' ||
            (layout === 'grouped' &&
              (containers.parentOf.get(e.s) !== containers.parentOf.get(e.t) || containers.children.has(e.s) || containers.children.has(e.t)))) && rects.has(from) && rects.has(to)
            ? facingSides(rects.get(from)!, rects.get(to)!)
            : null;
        const marker = { type: MarkerType.ArrowClosed, width: 12, height: 12, color: 'var(--muted-foreground)' };
        return [{
          id: `e${i}`,
          data: { edge: e },
          source: from,
          target: to,
          ...(facing ? { sourceHandle: `s-${facing.source}`, targetHandle: `t-${facing.target}` } : {}),
          label: showAll || touches ? Core.EDGE_LABEL[e.k]?.[0] ?? e.k : undefined,
          labelStyle: { fontSize: 11, fill: 'var(--muted-foreground)' },
          labelBgStyle: { fill: 'var(--background)', fillOpacity: 0.85 },
          labelBgPadding: [4, 2],
          style: { stroke: 'var(--muted-foreground)', strokeOpacity: dim ? 0.12 : touches ? 0.9 : 0.45, strokeWidth: chosen ? 2.6 : touches ? 1.6 : 1.1 },
          ...(down ? { markerStart: marker } : { markerEnd: marker }),
        }];
      }),
    [edges, hovered, selected, v.selectedEdge, neighbours, showAll, layout, groupEdge, containers, rects],
  );

  // Fit keeps the text readable: the zoom never goes below 0.7 (0.2 on a phone). A canvas that is larger than the
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
      const all = ids.map((id) => rects.get(id)).filter((r) => !!r);
      if (!rect || !rect.width || !all.length) return;
      const { x: minX, y: minY, w: width, h: height } = boundsOf(all);
      const z = Math.min(1, Math.max(Math.min(layout === 'layered' ? 0.7 : layout === 'grouped' ? 0.15 : 0.4, phone ? 0.2 : 1), Math.min((rect.width - 48) / width, (rect.height - 110) / height)));
      const x = width * z + 48 <= rect.width ? (rect.width - width * z) / 2 - minX * z : 24 - minX * z;
      // A canvas taller than the view shows the root of the scope in the middle of the left edge. The
      // grouped layout starts at the top left corner.
      const rootPos = positions.get(v.scope?.type === 'node' ? v.scope.id : (v.walkRoot ?? ids[0]));
      const y =
        height * z + 110 <= rect.height
          ? (rect.height - height * z) / 2 - minY * z + 24
          : layout !== 'grouped' && rootPos
            ? rect.height / 2 - (rootPos.y + size.h / 2) * z + 24
            : 64 - minY * z;
      flow.setViewport({ x, y, zoom: z }, { duration: animate ? 250 : 0 });
      v.saveViewport(mode, { x, y, zoom: z });
    },
    [flow, domNode, ids, positions, rects, mode, layout, v.scope, v.walkRoot, phone],
  );
  // Fit on a new scope, a re-layout and a change of mode. A walk step keeps the view. A change of
  // the panel size fits again, until the reader moves or zooms the canvas.
  const moved = useRef(false);
  // A stored viewport comes back in place of the first fit, after the nodes render.
  const pendingViewport = useRef(v.viewportOf(mode));
  useEffect(() => {
    moved.current = false;
  }, [v.layoutTick, mode, scopeKey, confirmed, layout]);
  useEffect(() => {
    if (moved.current && !center) return;
    const t = setTimeout(() => {
      if (!moved.current) {
        const stored = pendingViewport.current;
        pendingViewport.current = undefined;
        if (stored) {
          flow.setViewport(stored, { duration: 0 });
          moved.current = true;
        } else fit(false);
      }
      // A jump centers its node after the stored viewport or the fit, so the node wins over both.
      const rect = domNode?.getBoundingClientRect();
      const box = center ? rects.get(center.node) : undefined;
      if (!center || !box || !rect || !rect.width) return;
      const zoom = Math.min(1.6, Math.max(JUMP_ZOOM, flow.getZoom()));
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      flow.setCenter(cx, cy, { zoom, duration: 250 });
      v.saveViewport(mode, { x: rect.width / 2 - cx * zoom, y: rect.height / 2 - cy * zoom, zoom });
      moved.current = true;
      onCentered?.(center.seq);
    }, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.layoutTick, mode, scopeKey, confirmed, layout, center?.seq, center ? v.canvasSet.has(center.node) : false, Math.round(vw / 40), Math.round(vh / 40)]);

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
      <TooltipTrigger render={<Button variant="outline" size="icon-sm" className="max-md:size-10" aria-label={label} disabled={disabled} onClick={onClick} />}>{icon}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  return (
    <ReactFlow
      colorMode={theme}
      nodes={nodes}
      edges={rfEdges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onNodeClick={(_, n) => v.select(n.id)}
      onEdgeClick={(_, e) => v.selectEdge((e.data as { edge: VEdge }).edge)}
      onNodeDoubleClick={(_, n) => v.expand(n.id)}
      onNodeDragStop={(_, n) => {
        // A member has a position inside its container. The store keeps absolute positions.
        const parent = containers.parentOf.get(n.id);
        const origin = parent ? rects.get(parent) : undefined;
        moveWithMembers(store.map, containers.parentOf, n.id, { x: n.position.x + (origin?.x ?? 0), y: n.position.y + (origin?.y ?? 0) });
      }}
      onNodeMouseEnter={(_, n) => setHovered(n.id)}
      onNodeMouseLeave={() => setHovered(null)}
      onPaneClick={() => v.select(null)}
      onMoveStart={(event) => {
        // An event means that the reader moved the canvas. A move by the code has none.
        if (event) moved.current = true;
      }}
      onMoveEnd={(event, vp) => {
        if (event) v.saveViewport(mode, { x: vp.x, y: vp.y, zoom: vp.zoom });
      }}
      zoomOnDoubleClick={false}
      nodesConnectable={false}
      minZoom={0.1}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      aria-label={mode === 'cards' ? 'Cards canvas' : 'Graph canvas'}
    >
      <Background gap={20} size={1} className="opacity-60" />
      <Controls showInteractive={false} position="bottom-left" className="mb-9" />
      {!phone && <MiniMap pannable zoomable position="bottom-right" nodeColor={(n) => {
          const d = n.data as NodeData;
          return d.status ? toneColor(d.status.tone) : kindColor(d.kind);
        }} nodeStrokeWidth={0} nodeBorderRadius={4} className="rounded-md! border! bg-card!" maskColor="color-mix(in oklab, var(--foreground) 8%, transparent)" />}
      <Panel position="top-left" className="flex items-center gap-1.5 rounded-lg border bg-card/95 p-1 shadow-xs max-md:max-w-[calc(100%-1.5rem)] max-md:flex-wrap">
        {tool('Re-layout the canvas', <LayoutGrid />, v.relayout)}
        {tool('Fit the canvas', <Maximize2 />, () => fit(true))}
        <span className="mx-0.5 h-4 w-px bg-border" />
        <ToggleGroup value={[layout]} onValueChange={(next) => next[0] && setChosen(next[0] as LayoutName)} variant="outline" size="sm" spacing={0} aria-label="Layout">
          {LAYOUTS.map((name) => (
            <Tooltip key={name}>
              <TooltipTrigger render={<ToggleGroupItem value={name} className="max-md:size-10" aria-label={LAYOUT_LABEL[name]} disabled={name === 'grouped' && !groupEdge} />}>
                {LAYOUT_ICON[name]}
              </TooltipTrigger>
              <TooltipContent>{name === 'grouped' && !groupEdge ? 'The profile has no group edge' : LAYOUT_LABEL[name]}</TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>
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
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 rounded-lg border bg-card/95 px-2.5 py-1 text-[11px] shadow-xs max-md:hidden">
          {v.statusColour && Core.profile.status
            ? Core.profile.status.values.map((x) => (
                <span key={x.value} className="inline-flex items-center gap-1.5">
                  <StatusDot tone={x.tone} />
                  {x.label}
                </span>
              ))
            : kinds.map((k) => (
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

export function Canvas({ v, mode, center, onCentered }: { v: Viewer; mode: Mode; center?: CenterTarget | null; onCentered?: (seq: number) => void }) {
  return (
    <ReactFlowProvider>
      <div className="h-full w-full" data-testid={`canvas-${mode}`}>
        <Inner v={v} mode={mode} center={center} onCentered={onCentered} />
      </div>
    </ReactFlowProvider>
  );
}
