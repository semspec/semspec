// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The hierarchy tree. Each linked kind has its own group. A node with no place has its group too.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Search, TriangleAlert } from 'lucide-react';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { KindDot } from '@/components/kind';
import { Core, type Index, type VNode } from '@/lib/core';
import type { Viewer } from '@/lib/use-viewer';
import { cn } from '@/lib/utils';

interface Group {
  key: string;
  label: string;
  ids: string[];
  count: number;
  warn?: boolean;
  hint?: string;
  // Sub-headings, one per root kind, when the roots have more than 1 kind.
  sections?: { key: string; kind: string; ids: string[] }[];
}

function sortIds(index: Index, ids: string[]) {
  return ids.slice().sort((a, b) => index.byId.get(a)!.title.localeCompare(index.byId.get(b)!.title));
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The groups come from the profile. A kind with no parent groups is a root of the hierarchy.
// A linked kind has its own group. A node that the profile expects under a parent, and that has
// none, goes to a group with a warning.
function buildGroups(v: Viewer): Group[] {
  const { index, model } = v;
  const P = model.profile;
  const ofKind = (k: string) => model.nodes.filter((n) => n.kind === k).map((n) => n.id);
  const groups: Group[] = [];
  const treeKinds = Core.HIERARCHY_KINDS.filter((k) => Core.kindSpec(k)?.role === 'hierarchy');
  const roots = treeKinds.filter((k) => !Core.kindSpec(k)?.parents?.length).flatMap(ofKind);
  const sections = Core.hierarchySections(P, model.nodes.filter((n) => roots.includes(n.id))).map((s) => ({ ...s, ids: sortIds(index, s.ids) }));
  groups.push({ key: 'g:hier', label: P.groups?.hierarchy ?? 'Tree', ids: sortIds(index, roots), count: roots.length, sections: sections.length ? sections : undefined });
  Core.LINKED_KINDS.forEach((k) => {
    // A linked node with a parent shows below its parent, so the group lists the roots only.
    const ids = ofKind(k).filter((id) => !index.byId.get(id)!.parents.length);
    if (!ids.length) return;
    groups.push({ key: `g:${k}`, label: capitalise(Core.KIND_PLURAL[k]), ids: sortIds(index, ids), count: ids.length });
  });
  treeKinds.forEach((k) => {
    const spec = Core.kindSpec(k)!;
    if (!spec.parents?.length) return;
    const ids = model.nodes.filter((n) => n.kind === k && !n.parents.length).map((n) => n.id);
    if (!ids.length) return;
    if (spec.placedUnder) {
      const total = model.unplaced.filter((id) => index.byId.get(id)!.kind === k);
      const liveCount = total.filter((id) => Core.profile.lifecycle.states?.[index.byId.get(id)!.lifecycle]?.muted !== true).length;
      groups.push({
        key: `g:unplaced:${k}`,
        label: spec.unplacedLabel ?? `Not placed: ${spec.plural}`,
        ids: sortIds(index, ids),
        count: total.length,
        warn: true,
        hint: `${total.length} ${spec.plural} are not placed, ${liveCount} of them live (not muted by their lifecycle).`,
      });
    } else {
      groups.push({ key: `g:un:${k}`, label: `Not placed: ${spec.plural}`, ids: sortIds(index, ids), count: ids.length, warn: true });
    }
  });
  return groups;
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-warn/25 text-inherit">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

const Row = memo(function Row(props: {
  n: VNode;
  depth: number;
  open: boolean;
  hasKids: boolean;
  kidCount: number;
  isScope: boolean;
  isSelected: boolean;
  q: string;
  onToggle: () => void;
  onPick: () => void;
}) {
  const { n, depth, open, hasKids, kidCount, isScope, isSelected, q } = props;
  const muted = n.lifecycle === 'withdrawn' || n.lifecycle === 'superseded';
  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={hasKids ? open : undefined}
      data-node={n.id}
      title={`${Core.KIND_LABEL[n.kind]} · ${n.id}`}
      className={cn('group/row relative flex h-[26px] items-center pr-2 text-[13px] hover:bg-muted', isSelected && 'bg-accent', isScope && 'font-semibold')}
    >
      {isScope && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
      {Array.from({ length: depth }).map((_, i) => (
        <span key={i} aria-hidden className={cn('h-full w-4 shrink-0 border-l border-border/70', i === 0 && 'ml-2')} />
      ))}
      <button type="button" aria-label={open ? `Collapse ${n.title}` : `Expand ${n.title}`} tabIndex={-1} onClick={props.onToggle} className={cn('flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent', !hasKids && 'invisible')}>
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
      </button>
      <button type="button" onClick={props.onPick} className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <KindDot kind={n.kind} />
        <span className={cn('truncate', muted && 'text-muted-foreground line-through')}>
          <Highlight text={n.title} q={q} />
        </span>
      </button>
      {kidCount > 0 && <span className="ml-1 shrink-0 rounded-full bg-muted px-1.5 text-[10px] leading-4 text-muted-foreground tabular-nums">{kidCount}</span>}
    </div>
  );
});

export function TreePanel({ v }: { v: Viewer }) {
  const { index } = v;
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => buildGroups(v), [v.model, v.index]);
  const host = useRef<HTMLDivElement>(null);

  // A node matches, or has a descendant that matches. The ancestors of a hit stay visible.
  const matches = useMemo(() => {
    if (!q) return null;
    const memo = new Map<string, boolean>();
    const visit = (id: string, seen: Set<string>): boolean => {
      if (memo.has(id)) return memo.get(id)!;
      if (seen.has(id)) return false;
      seen.add(id);
      const n = index.byId.get(id)!;
      let hit = `${n.id} ${n.title}`.toLowerCase().includes(q);
      if (!hit) hit = index.children.get(id)!.some((c) => visit(c, seen));
      memo.set(id, hit);
      return hit;
    };
    return (id: string) => visit(id, new Set());
  }, [q, index]);

  // Scroll to the selected node when the selection changes, and only then.
  useEffect(() => {
    if (!v.selected) return;
    const el = host.current?.querySelector(`[data-node="${CSS.escape(v.selected)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.selectSeq]);

  const renderList = (ids: string[], depth: number, trail: Set<string>): React.ReactNode =>
    ids.map((id) => {
      if (matches && !matches(id)) return null;
      const n = index.byId.get(id)!;
      const kids = index.children.get(id)!.filter((c) => !trail.has(c));
      const shown = matches ? kids.filter((c) => matches(c)) : kids;
      const open = matches ? shown.length > 0 : v.open.has(id);
      const nextTrail = new Set(trail).add(id);
      return (
        <div key={`${id}@${depth}`}>
          <Row
            n={n}
            depth={depth}
            open={open}
            hasKids={kids.length > 0}
            kidCount={kids.length}
            isScope={v.scope?.type === 'node' && v.scope.id === id}
            isSelected={v.selected === id}
            q={q}
            onToggle={() => v.toggleOpen(id)}
            onPick={() => v.setScope({ type: 'node', id })}
          />
          {open && renderList(sortIds(index, shown), depth + 1, nextTrail)}
        </div>
      );
    });

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="tree-panel">
      <div className="p-2">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput placeholder="Find in the tree" aria-label="Find in the tree" value={query} onChange={(e) => setQuery(e.target.value)} />
        </InputGroup>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div ref={host} role="tree" aria-label="Hierarchy" className="pb-4">
          {groups.map((g) => {
            const items = matches ? g.ids.filter((id) => matches(id)) : g.ids;
            if (matches && !items.length) return null;
            const open = matches ? true : v.open.has(g.key);
            return (
              <div key={g.key} role="group" className="mb-0.5">
                <button
                  type="button"
                  aria-expanded={open}
                  title={g.hint}
                  onClick={() => v.toggleOpen(g.key)}
                  className={cn('flex h-7 w-full items-center gap-1 px-2 text-left text-[11px] font-semibold tracking-wide uppercase outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring', g.warn ? 'text-warn' : 'text-muted-foreground')}
                >
                  <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
                  {g.warn && <TriangleAlert className="size-3.5" />}
                  <span className="truncate">{g.label}</span>
                  <span className={cn('ml-auto rounded-full px-1.5 text-[10px] leading-4 tabular-nums', g.warn ? 'bg-warn/15' : 'bg-muted')}>{matches ? items.length : g.count}</span>
                </button>
                {open && !g.sections && renderList(items, 0, new Set())}
                {open &&
                  g.sections?.map((sec) => {
                    const secItems = matches ? sec.ids.filter((id) => matches(id)) : sec.ids;
                    if (matches && !secItems.length) return null;
                    const secOpen = matches ? true : v.open.has(sec.key);
                    return (
                      <div key={sec.key} role="group">
                        <button
                          type="button"
                          aria-expanded={secOpen}
                          onClick={() => v.toggleOpen(sec.key)}
                          className="flex h-7 w-full items-center gap-1 pr-2 pl-5 text-left text-[11px] font-medium tracking-wide text-muted-foreground uppercase outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ChevronRight className={cn('size-3.5 transition-transform', secOpen && 'rotate-90')} />
                          <KindDot kind={sec.kind} />
                          <span className="truncate">{capitalise(Core.KIND_PLURAL[sec.kind])}</span>
                          <span className="ml-auto rounded-full bg-muted px-1.5 text-[10px] leading-4 tabular-nums">{matches ? secItems.length : sec.ids.length}</span>
                        </button>
                        {secOpen && renderList(secItems, 0, new Set())}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
