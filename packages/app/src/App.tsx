// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { useMemo, useRef, useState, useEffect } from 'react';
import { ArrowLeft, Info, Network, Palette, Table2, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Canvas } from '@/components/canvas';
import { DetailsPanel, ExpandPanel } from '@/components/details-panel';
import { FilterBar } from '@/components/filter-bar';
import { KindDot } from '@/components/kind';
import { TableView } from '@/components/table-view';
import { ThemeSwitch } from '@/components/theme-switch';
import { TreePanel } from '@/components/tree-panel';
import { incomingCrossLinks, kindColorCss, type WorkspaceData } from '@semspec/core';
import { Core, setProfile, type Model } from '@/lib/core';
import { useViewer, type View, type Viewer, type ViewerState } from '@/lib/use-viewer';
import { WorkspaceContext, type WorkspaceApi } from '@/lib/workspace';
import { cn } from '@/lib/utils';

function ScopeControl({ v }: { v: Viewer }) {
  if (v.scope?.type === 'node') {
    const n = v.index.byId.get(v.scope.id)!;
    return (
      <span className="inline-flex h-7 max-w-[28rem] items-center gap-1.5 rounded-md border bg-secondary pr-0.5 pl-2 text-[13px]" data-testid="scope-chip">
        <span className="shrink-0 text-muted-foreground">Scope</span>
        <KindDot kind={n.kind} />
        <span className="truncate font-medium" title={n.id}>{n.title}</span>
        <Button variant="ghost" size="icon-xs" aria-label="Remove the scope" onClick={() => v.setScope(null)}>
          <X />
        </Button>
      </span>
    );
  }
  if (v.walk && v.walkRoot) {
    const n = v.index.byId.get(v.walkRoot)!;
    return (
      <span className="inline-flex h-7 max-w-[28rem] items-center gap-1.5 rounded-md border bg-secondary pr-0.5 pl-2 text-[13px]" data-testid="scope-chip">
        <span className="shrink-0 text-muted-foreground">Walk from</span>
        <KindDot kind={n.kind} />
        <span className="truncate font-medium">{n.title}</span>
        <Button variant="ghost" size="icon-xs" aria-label="Clear the walk" onClick={v.resetWalk}>
          <X />
        </Button>
      </span>
    );
  }
  if (v.scope?.type === 'all') {
    return (
      <span className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-secondary pr-0.5 pl-2 text-[13px]">
        <span className="font-medium">Whole graph</span>
        <Button variant="ghost" size="icon-xs" aria-label="Remove the scope" onClick={() => v.setScope(null)}>
          <X />
        </Button>
      </span>
    );
  }
  return (
    <Button variant="outline" size="sm" onClick={() => v.setScope({ type: 'all' })}>
      Whole graph
    </Button>
  );
}

// The number of start nodes that the welcome page shows when the profile names no entry kind.
const FALLBACK_STARTS = 8;

// The start page. The profile names the kind to start from. Without it, the start page lists
// the nodes with the most children.

function Welcome({ v }: { v: Viewer }) {
  const entry = v.model.profile.entry;
  const kind = entry?.kind;
  const childKind = entry?.childKind;
  const starts = v.model.nodes
    .filter((n) => (kind ? n.kind === kind : Core.kindSpec(n.kind)?.role === 'hierarchy'))
    .map((n) => ({ n, count: (v.index.scopeChildren.get(n.id) ?? []).filter((c) => !childKind || v.index.byId.get(c)!.kind === childKind).length }))
    .sort((a, b) => b.count - a.count);
  // A profile with an entry kind lists every node of that kind. The fallback lists the largest hierarchy nodes only.
  const shown = kind ? starts : starts.slice(0, FALLBACK_STARTS);
  const left = starts.length - shown.length;
  return (
    <div className="flex h-full overflow-auto p-8" data-testid="welcome">
      <div className="m-auto flex w-full max-w-xl flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{entry?.title ?? 'Pick a node to see what it contains'}</h2>
          <p className="text-sm text-muted-foreground">{kind ? 'Select a node in the tree, or start with one below.' : 'Select a node in the tree, or start with one of the largest.'} The scope shows the node, everything below it, and the linked nodes that connect to it.</p>
        </div>
        <div className="grid gap-1.5">
          {shown.map(({ n, count }) => (
            <button
              key={n.id}
              type="button"
              onClick={() => v.setScope({ type: 'node', id: n.id })}
              className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left text-[13px] transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <KindDot kind={n.kind} className="size-2.5" />
              <span className="flex-1 font-medium">{n.title}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {count} {entry?.countLabel ?? 'children'}
              </span>
            </button>
          ))}
        </div>
        {left > 0 && <p className="text-xs text-muted-foreground">{left} more in the tree.</p>}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {v.model.stats.unplacedLive > 0 && (
            <span className="inline-flex items-center gap-1.5 text-warn">
              <TriangleAlert className="size-3.5" />
              {v.model.stats.unplacedLive} live nodes are not placed under their parent kind. See the warning groups in the tree.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function CenterView({ v }: { v: Viewer }) {
  if (!v.scope && !v.walk) return <Welcome v={v} />;
  if (v.view === 'table') return <TableView v={v} />;
  const mode = v.view === 'cards' ? 'cards' : 'graph';
  if (!v.dock) return <Canvas key={mode} v={v} mode={mode} />;
  return (
    <ResizablePanelGroup orientation="vertical">
      <ResizablePanel defaultSize="62%" minSize="25%">
        <Canvas key={mode} v={v} mode={mode} />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="38%" minSize="15%">
        <TableView v={v} compact />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

interface Focus {
  node: string;
  seq: number;
}

// The workspace state: the active graph, the trail of jumps and the saved state of each graph.
export function App({ data }: { data: WorkspaceData }) {
  const [activeId, setActiveId] = useState(data.graphs[0].id);
  const [trail, setTrail] = useState<{ graph: string; node: string | null }[]>([]);
  const [focus, setFocus] = useState<Focus | null>(null);
  const saved = useRef(new Map<string, ViewerState>());
  const seq = useRef(0);
  const incoming = useMemo(() => incomingCrossLinks(data.graphs), [data]);
  const nodes = useMemo(() => new Map(data.graphs.map((g) => [g.id, new Map(g.model.nodes.map((n) => [n.id, n]))])), [data]);
  const graph = data.graphs.find((g) => g.id === activeId)!;
  // The profile is global for the app. The graph that shows is the only one that reads it.
  setProfile(graph.model.profile);

  const jumpFrom = (target: string, node: string, from: string | null) => {
    setTrail((t) => [...t, { graph: activeId, node: from }]);
    setActiveId(target);
    setFocus({ node, seq: ++seq.current });
  };
  const last = trail[trail.length - 1];
  const root: Omit<WorkspaceApi, 'jump'> & { jumpFrom: typeof jumpFrom } = {
    graphs: data.graphs,
    activeId,
    setActive: (id) => {
      setTrail([]);
      setFocus(null);
      setActiveId(id);
    },
    jumpFrom,
    back: () => {
      if (!last) return;
      setTrail((t) => t.slice(0, -1));
      setActiveId(last.graph);
      setFocus(last.node ? { node: last.node, seq: ++seq.current } : null);
    },
    canBack: trail.length > 0,
    backLabel: last ? data.graphs.find((g) => g.id === last.graph)?.label : undefined,
    incoming: (node) => incoming.get(activeId)?.get(node) ?? [],
    nodeOf: (g, node) => nodes.get(g)?.get(node),
  };
  return (
    <GraphApp
      key={activeId}
      label={graph.label}
      model={graph.model}
      root={root}
      focus={focus}
      session={{ initial: saved.current.get(activeId), save: (s) => saved.current.set(activeId, s) }}
    />
  );
}

function GraphApp({
  label,
  model,
  root,
  focus,
  session,
}: {
  label: string;
  model: Model;
  root: Omit<WorkspaceApi, 'jump'> & { jumpFrom: (graph: string, node: string, from: string | null) => void };
  focus: Focus | null;
  session: { initial?: ViewerState; save: (state: ViewerState) => void };
}) {
  const v = useViewer(model, session);
  const ws: WorkspaceApi = { ...root, jump: (graph, node) => root.jumpFrom(graph, node, v.selected) };
  // A jump or a Back selects the node. The scope shows the node when the canvas does not.
  useEffect(() => {
    if (!focus || !v.index.byId.has(focus.node)) return;
    if (v.canvasSet.has(focus.node)) v.select(focus.node, { panel: 'details' });
    else v.setScope({ type: 'node', id: focus.node });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);
  const active = v.scope || v.walk;
  // The nodes of the scope that have no source, when the profile has a source field.
  const noSource = active ? Core.missingSource(v.index, v.baseIds) : null;
  const status = `${v.canvasIds.length} nodes · ${v.canvasEdges.length} edges${v.walk ? ' · walk' : ''}${noSource ? ` · ${noSource.missing} of ${noSource.total} without a source` : ''}`;

  return (
    <WorkspaceContext.Provider value={ws}>
      {/* The kinds of each graph have their own colours. These variables replace those of the page. */}
      <style>{kindColorCss(model.profile)}</style>
    <TooltipProvider delay={300}>
      <div className="flex h-screen flex-col bg-background text-[13px] text-foreground">
        <header className="flex h-12 shrink-0 items-center gap-4 border-b bg-card px-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Network className="size-4" />
            </span>
            <div className="leading-tight">
              <div className="text-sm font-semibold">Semspec</div>
              <div className="text-[11px] text-muted-foreground tabular-nums">
                {label} · {model.nodes.length} nodes · {model.edges.length} edges
              </div>
            </div>
          </div>
          {ws.graphs.length > 1 && (
            <Tabs value={ws.activeId} onValueChange={ws.setActive}>
              <TabsList aria-label="Graph">
                {ws.graphs.map((g) => (
                  <TabsTrigger key={g.id} value={g.id}>
                    {g.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          {ws.canBack && (
            <Button variant="outline" size="sm" onClick={ws.back}>
              <ArrowLeft /> Back{ws.backLabel ? ` to ${ws.backLabel}` : ''}
            </Button>
          )}
          <ScopeControl v={v} />
          <div className="ml-auto flex items-center gap-3">
            {model.profile.status && (
              <Toggle variant="outline" size="sm" pressed={v.statusColour} onPressedChange={v.setStatusColour} aria-label={`Colour the nodes by ${model.profile.status.label.toLowerCase()}`}>
                <Palette /> {model.profile.status.label}
              </Toggle>
            )}
            <Tabs value={v.view} onValueChange={(val) => v.setView(val as View)}>
              <TabsList aria-label="View">
                <TabsTrigger value="graph">Graph</TabsTrigger>
                <TabsTrigger value="cards">Cards</TabsTrigger>
                <TabsTrigger value="table">Table</TabsTrigger>
              </TabsList>
            </Tabs>
            <ThemeSwitch />
          </div>
        </header>
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize="21%" minSize="14%" maxSize="40%" className="bg-sidebar">
            <TreePanel v={v} />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="51%" minSize="30%">
            <main className="flex h-full min-h-0 flex-col">
              <FilterBar v={v} />
              <div className="min-h-0 flex-1">
                <CenterView v={v} />
              </div>
              <div className="flex h-8 shrink-0 items-center gap-3 border-t bg-card px-3 text-xs text-muted-foreground" role="status" aria-live="polite">
                <span className="tabular-nums">{active ? status : 'No scope'}</span>
                {active && v.view !== 'table' && (
                  <Button variant={v.dock ? 'secondary' : 'ghost'} size="xs" className="ml-auto" onClick={() => v.setDock(!v.dock)}>
                    <Table2 /> {v.dock ? 'Hide the table' : 'Show the table under the canvas'}
                  </Button>
                )}
              </div>
            </main>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="28%" minSize="20%" maxSize="45%">
            <aside className="flex h-full min-h-0">
              <div className="flex min-w-0 flex-1 flex-col bg-card">
                <div className="flex h-9 shrink-0 items-center border-b px-4 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {v.panel === 'details' ? 'Details' : 'Neighbours'}
                </div>
                <ScrollArea className="min-h-0 flex-1">{v.panel === 'details' ? <DetailsPanel v={v} /> : <ExpandPanel v={v} />}</ScrollArea>
              </div>
              <nav aria-label="Side panels" className="flex w-10 shrink-0 flex-col items-center gap-1 border-l bg-sidebar py-2">
                {(
                  [
                    ['details', 'Details', <Info key="i" />],
                    ['expand', 'Neighbours and expand', <Network key="n" />],
                  ] as const
                ).map(([key, label, icon]) => (
                  <Tooltip key={key}>
                    <TooltipTrigger
                      render={<Button variant={v.panel === key ? 'secondary' : 'ghost'} size="icon-sm" aria-label={label} aria-pressed={v.panel === key} onClick={() => v.setPanel(key)} className={cn(v.panel === key && 'text-primary')} />}
                    >
                      {icon}
                    </TooltipTrigger>
                    <TooltipContent side="left">{label}</TooltipContent>
                  </Tooltip>
                ))}
              </nav>
            </aside>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </TooltipProvider>
    </WorkspaceContext.Provider>
  );
}
