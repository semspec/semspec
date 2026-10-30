// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The filter bar: search with a result count, multi-select filters with counts, the depth,
// and the active filters as removable chips with "Clear all". Only 1 popover is open at a time.
import { useMemo, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { KindDot, StatusDot } from '@/components/kind';
import { Core, type Filters, type Kind, type StatusTone, type Vocabulary } from '@/lib/core';
import { EMPTY_FILTERS, type Viewer } from '@/lib/use-viewer';

// A built-in facet, or "field:" and the field of a field filter of the profile.
type FacetKey = 'kinds' | 'lifecycles' | 'deliveries' | 'modules' | 'statuses' | 'markers' | `field:${string}`;
interface Option {
  value: string;
  label: string;
  hint?: string;
  count: number;
  kind?: Kind;
  tone?: StatusTone | null;
  group?: string;
}

const fieldOf = (key: FacetKey) => (key.startsWith('field:') ? key.slice(6) : null);

// The selected values of a facet.
function selectedOf(filters: Filters, key: FacetKey): string[] {
  const field = fieldOf(key);
  return field ? filters.fields?.[field] ?? [] : filters[key as Exclude<FacetKey, `field:${string}`>] ?? [];
}

function withSelected(filters: Filters, key: FacetKey, list: string[]): Filters {
  const field = fieldOf(key);
  return field ? { ...filters, fields: { ...filters.fields, [field]: list } } : { ...filters, [key]: list };
}

// The options of a field with a vocabulary: the order and the labels of the vocabulary, and a group for each broader concept.
// `labels` and `groupOf` come from the field filter. They win over the vocabulary.
function codedList(scheme: Vocabulary, values: string[], counts: Map<string, number>, labels?: Record<string, string>, groupOf?: (val: string) => string | undefined): Option[] {
  return Core.codedOptions(scheme, values).map((o) => ({
    value: o.value,
    label: o.value === '' ? 'None' : labels?.[o.value] ?? o.label,
    hint: o.value !== '' && o.value !== o.label ? o.value : undefined,
    count: counts.get(o.value) ?? 0,
    group: groupOf ? groupOf(o.value) : o.group,
  }));
}

// Options in groups, in the order of their first option. An option with no group is in the group ''.
function grouped(list: Option[]): [string, Option[]][] {
  const out = new Map<string, Option[]>();
  list.forEach((o) => out.set(o.group ?? '', [...(out.get(o.group ?? '') ?? []), o]));
  return Array.from(out.entries());
}

const BASE_FACETS: { key: FacetKey; label: string }[] = [
  { key: 'kinds', label: 'Kind' },
  { key: 'lifecycles', label: 'Lifecycle' },
  { key: 'deliveries', label: 'Delivery' },
  { key: 'modules', label: 'Group' },
  { key: 'statuses', label: 'Status' },
  { key: 'markers', label: 'Provenance' },
];

export function FilterBar({ v }: { v: Viewer }) {
  const { index, filters } = v;
  // The group facet is named by the profile. A profile with no group kind has no group facet.
  const group = v.model.profile.facets;
  // The status facet is named by the profile too.
  const status = v.model.profile.status;
  // The marker facet exists when the profile names a marker.
  const provenance = v.model.profile.provenance;
  // The profile can add a filter for any list field or text field.
  const fieldFilters = v.model.profile.fieldFilters ?? [];
  const FACETS: { key: FacetKey; label: string }[] = [
    ...BASE_FACETS.filter((f) => (f.key !== 'modules' || group) && (f.key !== 'statuses' || status) && (f.key !== 'markers' || provenance?.marker)).map((f) =>
      f.key === 'modules' && group ? { ...f, label: group.groupLabel } : f.key === 'statuses' && status ? { ...f, label: status.label } : f.key === 'markers' ? { ...f, label: Core.provenanceLabel() } : f,
    ),
    ...fieldFilters.map((f) => ({ key: `field:${f.field}` as FacetKey, label: f.label })),
  ];
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
      const selected = selectedOf(filters, key);
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
      } else if (key === 'statuses') {
        // The values in the order of the profile, then the nodes with no status.
        list = [...status!.values.map((x) => ({ value: x.value, label: x.label, tone: x.tone })), { value: '', label: 'None', tone: null }]
          .filter((x) => values.has(x.value))
          .map((x) => ({ ...x, count: counts.get(x.value) ?? 0 }));
      } else if (key === 'markers' && Core.markerScheme()) {
        list = codedList(Core.markerScheme()!, Array.from(values), counts);
      } else if (key === 'lifecycles' && Core.schemeOf(v.model.profile.lifecycle.field)) {
        list = codedList(Core.schemeOf(v.model.profile.lifecycle.field)!.scheme, Array.from(values), counts);
      } else if (fieldOf(key)) {
        // The values in alphabetical order, in groups when the profile names a separator. "None" comes last.
        // A field with a vocabulary has the order and the groups of the vocabulary.
        const spec = fieldFilters.find((f) => f.field === fieldOf(key))!;
        const coded = Core.schemeOf(spec.field);
        const label = (val: string) => (val ? spec.values?.[val] ?? val : 'None');
        const groupOf = (val: string) => (spec.groupBy && val ? val.split(spec.groupBy)[0] : undefined);
        if (coded) list = codedList(coded.scheme, Array.from(values), counts, spec.values, spec.groupBy ? groupOf : undefined);
        else list = Array.from(values)
          .sort((a, b) => (!a ? 1 : !b ? -1 : (groupOf(a) ?? '').localeCompare(groupOf(b) ?? '') || label(a).localeCompare(label(b))))
          .map((val) => ({ value: val, label: label(val), hint: spec.values?.[val] ? val : undefined, count: counts.get(val) ?? 0, group: groupOf(val) }));
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
    const list = selectedOf(filters, key);
    v.setFilters(withSelected(filters, key, list.includes(value) ? list.filter((x) => x !== value) : [...list, value]));
  };

  const chips: { key: FacetKey | 'q'; value: string; label: string }[] = [];
  FACETS.forEach(({ key, label }) =>
    selectedOf(filters, key).forEach((val) => {
      const o = options[key].find((x) => x.value === val);
      chips.push({ key, value: val, label: `${label}: ${o?.label ?? val}` });
    }),
  );
  if (filters.q.trim()) chips.push({ key: 'q', value: filters.q, label: `Search: ${filters.q}` });
  const removeChip = (c: (typeof chips)[number]) =>
    c.key === 'q' ? v.setFilters({ ...filters, q: '' }) : v.setFilters(withSelected(filters, c.key, selectedOf(filters, c.key).filter((x) => x !== c.value)));

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
          const selected = selectedOf(filters, key);
          const n = selected.length;
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
                    {grouped(list).map(([g, opts]) => (
                      <CommandGroup key={g} heading={g || undefined}>
                        {opts.map((o) => (
                          <CommandItem key={o.value} value={`${o.label} ${o.hint ?? ''} ${o.value}`} onSelect={() => toggle(key, o.value)} className="gap-2 whitespace-nowrap data-[checked=true]:opacity-100">
                            <Checkbox checked={selected.includes(o.value)} tabIndex={-1} aria-hidden className="pointer-events-none" />
                            {o.kind && <KindDot kind={o.kind} />}
                            {o.tone !== undefined && <StatusDot tone={o.tone} />}
                            <span>{o.label}</span>
                            {o.hint && <span className="font-mono text-[10px] text-muted-foreground">{o.hint}</span>}
                            {/* The shortcut slot hides the check icon of CommandItem, so the count is the only right-aligned element. */}
                            <CommandShortcut className="min-w-8 pl-3 text-right tracking-normal tabular-nums">{o.count}</CommandShortcut>
                          </CommandItem>
                        ))}
                      </CommandGroup>
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
