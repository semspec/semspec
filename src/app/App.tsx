// SPDX-License-Identifier: Apache-2.0
import { Info, Network, Table2, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Canvas } from '@/components/canvas';
import { DetailsPanel, ExpandPanel } from '@/components/details-panel';
import { FilterBar } from '@/components/filter-bar';
import { KindDot } from '@/components/kind';
import { TableView } from '@/components/table-view';
import { TreePanel } from '@/components/tree-panel';
import { Core, type Model } from '@/lib/core';
import { useViewer, type View, type Viewer } from '@/lib/use-viewer';
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

// The start page. The profile names the kind to start from. Without it, the start page lists
// the nodes with the most children.
function Welcome({ v }: { v: Viewer }) {
  const entry = v.model.profile.entry;
  const kind = entry?.kind;
  const childKind = entry?.childKind;
  const starts = v.model.nodes
    .filter((n) => (kind ? n.kind === kind : Core.kindSpec(n.kind)?.role === 'hierarchy'))
    .map((n) => ({ n, count: (v.index.scopeChildren.get(n.id) ?? []).filter((c) => !childKind || v.index.byId.get(c)!.kind === childKind).length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  return (
    <div className="flex h-full items-center justify-center overflow-auto p-8" data-testid="welcome">
      <div className="flex w-full max-w-xl flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{entry?.title ?? 'Pick a node to see what it contains'}</h2>
          <p className="text-sm text-muted-foreground">Select a node in the tree, or start with one of the largest. The scope shows the node, everything below it, and the linked nodes that connect to it.</p>
        </div>
        <div className="grid gap-1.5">
          {starts.map(({ n, count }) => (
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

export function App({ model }: { model: Model }) {
  const v = useViewer(model);
  const active = v.scope || v.walk;
  const status = `${v.canvasIds.length} nodes · ${v.canvasEdges.length} edges${v.walk ? ' · walk' : ''}`;

  return (
    <TooltipProvider delay={300}>
      <div className="flex h-screen flex-col bg-background text-[13px] text-foreground">
        <header className="flex h-12 shrink-0 items-center gap-4 border-b bg-card px-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Network className="size-4" />
            </span>
            <div className="leading-tight">
              <div className="text-sm font-semibold">Requirement Explorer</div>
              <div className="text-[11px] text-muted-foreground tabular-nums">
                {model.profile.project} · {model.nodes.length} nodes · {model.edges.length} edges
              </div>
            </div>
          </div>
          <ScopeControl v={v} />
          <div className="ml-auto flex items-center gap-3">
            <Tabs value={v.view} onValueChange={(val) => v.setView(val as View)}>
              <TabsList aria-label="View">
                <TabsTrigger value="graph">Graph</TabsTrigger>
                <TabsTrigger value="cards">Cards</TabsTrigger>
                <TabsTrigger value="table">Table</TabsTrigger>
              </TabsList>
            </Tabs>
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
  );
}
