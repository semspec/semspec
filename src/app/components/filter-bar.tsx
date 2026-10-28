// SPDX-License-Identifier: Apache-2.0
// The filter bar: search with a result count, 4 multi-select filters with counts, the depth,
// and the active filters as removable chips with "Clear all". Only 1 popover is open at a time.
import { useMemo, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { KindDot } from '@/components/kind';
import { Core, type Filters, type Kind } from '@/lib/core';
import { EMPTY_FILTERS, type Viewer } from '@/lib/use-viewer';

type FacetKey = 'kinds' | 'lifecycles' | 'deliveries' | 'modules';
interface Option {
  value: string;
  label: string;
  hint?: string;
  count: number;
  kind?: Kind;
}

const BASE_FACETS: { key: FacetKey; label: string }[] = [
  { key: 'kinds', label: 'Kind' },
  { key: 'lifecycles', label: 'Lifecycle' },
  { key: 'deliveries', label: 'Delivery' },
  { key: 'modules', label: 'Group' },
];

export function FilterBar({ v }: { v: Viewer }) {
  const { index, filters } = v;
  // The group facet is named by the profile. A profile with no group kind has no group facet.
  const group = v.model.profile.facets;
  const FACETS = BASE_FACETS.filter((f) => f.key !== 'modules' || group).map((f) => (f.key === 'modules' && group ? { ...f, label: group.groupLabel } : f));
  const [openFacet, setOpenFacet] = useState<FacetKey | null>(null);
  const enabled = v.baseIds.length > 0;

  // The options of each facet, with the count of nodes that each value would give.
  const options = useMemo(() => {
    const result = {} as Record<FacetKey, Option[]>;
    const groupKind = v.model.profile.facets?.groupKind;
    const modules = v.model.nodes.filter((n) => n.kind === groupKind);
    const titleCount = new Map<string, number>();
    modules.forEach((m) => titleCount.set(m.title, (titleCount.get(m.title) ?? 0) + 1));
    FACETS.forEach(({ key }) => {
      const counts = Core.facetCounts(index, v.baseIds, filters, key);
      const selected = filters[key];
      const values = new Set<string>([...counts.keys(), ...selected]);
      let list: Option[];
      if (key === 'kinds') {
        list = Core.ALL_KINDS.filter((k) => values.has(k)).map((k) => ({ value: k, label: Core.KIND_LABEL[k], count: counts.get(k) ?? 0, kind: k }));
      } else if (key === 'modules') {
        list = Array.from(values)
          .filter((id) => index.byId.has(id))
          .map((id) => {
            const m = index.byId.get(id)!;
            return { value: id, label: m.title, hint: (titleCount.get(m.title) ?? 0) > 1 ? id : undefined, count: counts.get(id) ?? 0 };
          })
          .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
      } else {
        list = Array.from(values)
          .sort()
          .map((val) => ({ value: val, label: val ? val.charAt(0).toUpperCase() + val.slice(1) : 'None', count: counts.get(val) ?? 0 }));
      }
      result[key] = list;
    });
    return result;
  }, [index, v.baseIds, v.model, filters]);

  const toggle = (key: FacetKey, value: string) => {
    const list = filters[key];
    v.setFilters({ ...filters, [key]: list.includes(value) ? list.filter((x) => x !== value) : [...list, value] });
  };

  const chips: { key: FacetKey | 'q'; value: string; label: string }[] = [];
  FACETS.forEach(({ key, label }) =>
    filters[key].forEach((val) => {
      const o = options[key].find((x) => x.value === val);
      chips.push({ key, value: val, label: `${label}: ${o?.label ?? val}` });
    }),
  );
  if (filters.q.trim()) chips.push({ key: 'q', value: filters.q, label: `Search: ${filters.q}` });
  const removeChip = (c: (typeof chips)[number]) =>
    c.key === 'q' ? v.setFilters({ ...filters, q: '' }) : v.setFilters({ ...filters, [c.key]: filters[c.key].filter((x) => x !== c.value) });

  const searching = filters.q.trim().length > 0;
  const rootScope = v.scope && v.scope.type === 'node' && Core.HIERARCHY_KINDS.includes(index.byId.get(v.scope.id)!.kind);

  return (
    <div className="flex flex-col gap-2 border-b bg-card px-3 py-2" data-testid="filter-bar">
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="h-8 w-64 max-w-full">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search id, title, statement"
            aria-label="Search id, title and statement"
            disabled={!enabled}
            value={filters.q}
            onChange={(e) => v.setFilters({ ...filters, q: e.target.value })}
          />
          {searching && (
            <InputGroupAddon align="inline-end" className="text-xs tabular-nums">
              {v.filteredCount} of {v.baseIds.length}
            </InputGroupAddon>
          )}
        </InputGroup>
        {FACETS.map(({ key, label }) => {
          const list = options[key];
          const n = filters[key].length;
          return (
            <Popover key={key} open={openFacet === key} onOpenChange={(o) => setOpenFacet(o ? key : null)}>
              <PopoverTrigger render={<Button variant="outline" size="default" disabled={!enabled} aria-label={`Filter by ${label.toLowerCase()}`} />}>
                {label}
                {n > 0 && <Badge variant="secondary" className="h-4 px-1.5">{n}</Badge>}
                <ChevronDown className="opacity-60" />
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto max-w-[28rem] min-w-60 gap-0 p-0">
                <Command>
                  {list.length > 8 && <CommandInput placeholder={`Find a ${label.toLowerCase()}`} />}
                  <CommandList>
                    <CommandEmpty>Nothing found.</CommandEmpty>
                    {list.map((o) => (
                      <CommandItem key={o.value} value={`${o.label} ${o.hint ?? ''} ${o.value}`} onSelect={() => toggle(key, o.value)} className="gap-2 whitespace-nowrap data-[checked=true]:opacity-100">
                        <Checkbox checked={filters[key].includes(o.value)} tabIndex={-1} aria-hidden className="pointer-events-none" />
                        {o.kind && <KindDot kind={o.kind} />}
                        <span>{o.label}</span>
                        {o.hint && <span className="font-mono text-[10px] text-muted-foreground">{o.hint}</span>}
                        <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">{o.count}</span>
                      </CommandItem>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          );
        })}
        {rootScope && !v.walk && (
          <div className="ml-1 flex items-center gap-2 text-xs text-muted-foreground">
            Depth
            <ToggleGroup
              value={[v.depth === null ? 'all' : String(v.depth)]}
              onValueChange={(val: string[]) => val[0] && v.setDepth(val[0] === 'all' ? null : Number(val[0]))}
              variant="outline"
              size="sm"
              spacing={0}
              aria-label="Depth below the scope node"
            >
              {['all', '1', '2', '3', '4'].map((d) => (
                <ToggleGroupItem key={d} value={d} className="h-7 min-w-7 px-2 text-xs">
                  {d === 'all' ? 'All' : d}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <span key={`${c.key}:${c.value}`} className="inline-flex h-6 items-center gap-1 rounded-md border bg-secondary pr-0.5 pl-2 text-xs">
              {c.label}
              <Button variant="ghost" size="icon-xs" aria-label={`Remove the filter ${c.label}`} onClick={() => removeChip(c)}>
                <X />
              </Button>
            </span>
          ))}
          <Button variant="ghost" size="xs" onClick={() => v.setFilters(EMPTY_FILTERS as Filters)}>
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}
