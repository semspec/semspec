// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The table of the nodes on the canvas: sort, filter by column, resize, page and export.
// It uses TanStack Table, the pattern of the shadcn Data Table.
import { useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnSizingState,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, ListFilter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { KindBadge, StatusDot, statusShare } from '@/components/kind';
import { Core, type FieldFilterSpec, type Filters, type VNode } from '@/lib/core';
import type { Viewer } from '@/lib/use-viewer';
import { cn } from '@/lib/utils';

const PAGE_SIZES = [25, 50, 100, 200];
// A step of the keyboard resize, in pixels.
const RESIZE_STEP = 16;

// Stops the text selection for the length of a drag. Safari needs the prefixed property.
// It restores the body styles when the pointer goes up, the touch ends or the window loses the pointer.
function lockSelection(touch: boolean) {
  const body = document.body;
  const saved = { userSelect: body.style.userSelect, webkit: body.style.getPropertyValue('-webkit-user-select'), cursor: body.style.cursor };
  window.getSelection()?.removeAllRanges();
  body.style.userSelect = 'none';
  body.style.setProperty('-webkit-user-select', 'none');
  body.style.cursor = 'col-resize';
  const events = touch ? ['touchend', 'touchcancel', 'blur'] : ['mouseup', 'blur'];
  const release = () => {
    body.style.userSelect = saved.userSelect;
    if (saved.webkit) body.style.setProperty('-webkit-user-select', saved.webkit);
    else body.style.removeProperty('-webkit-user-select');
    body.style.cursor = saved.cursor;
    for (const ev of events) window.removeEventListener(ev, release);
    document.removeEventListener('mouseleave', release);
  };
  for (const ev of events) window.addEventListener(ev, release);
  // A mouse that leaves the window may release its button outside, so the lock ends there too.
  if (!touch) document.addEventListener('mouseleave', release);
}
const MIN_SIZE = 64;

// The widths that the viewer saved for a graph. A width below the minimum or for an unknown column is dropped.
export function cleanWidths(raw: unknown, minOf: Record<string, number>): ColumnSizingState {
  const out: ColumnSizingState = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, w] of Object.entries(raw as Record<string, unknown>)) {
    if (id in minOf && typeof w === 'number' && Number.isFinite(w) && w >= minOf[id]) out[id] = w;
  }
  return out;
}

function Coverage({ n }: { n: VNode }) {
  if (!n.cov || !n.cov.parts) return <span className="text-muted-foreground">–</span>;
  const pct = (n.cov.verified / n.cov.parts) * 100;
  const good = n.cov.verified === n.cov.parts;
  return (
    <span className="flex items-center gap-2" title={`${n.cov.verified} of ${n.cov.parts} parts have a check`}>
      <span className="tabular-nums">
        {n.cov.verified} of {n.cov.parts}
      </span>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <span className={cn('block h-full', good ? 'bg-good' : 'bg-warn')} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

// The status column sorts by the share of good nodes. A node with no status sorts last.
// With field filters, only the nodes that match count.
function statusColumn(index: Viewer['index'], fields: Filters['fields']): ColumnDef<VNode> {
  const good = index.profile.status!.values[0].value;
  return {
    id: 'status',
    header: index.profile.status!.label,
    size: 104,
    minSize: MIN_SIZE,
    accessorFn: (n) => {
      const st = Core.statusOf(index, n.id, fields);
      return st.total ? st.counts[good] / st.total : undefined;
    },
    cell: ({ row }) => {
      const st = Core.statusOf(index, row.original.id, fields);
      if (!st.total) return <span className="text-muted-foreground">–</span>;
      return (
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <StatusDot tone={st.tone} />
          {statusShare(st, true)}
        </span>
      );
    },
    // The filter reads the text "12/30".
    filterFn: (row, _id, value: string) => {
      const st = Core.statusOf(index, row.original.id, fields);
      return (st.total ? statusShare(st, true) : '').includes(value);
    },
  };
}

// The values of a field filter on the node itself, with their labels.
function fieldText(spec: FieldFilterSpec, n: VNode): string {
  return Core.filterValues(n.d[spec.field], spec.from).map((x) => spec.values?.[x] ?? Core.fieldLabel(spec.field, x)).join(', ');
}

// A column for a field filter of the profile. It shows the values of the node itself.
function fieldColumn(spec: FieldFilterSpec): ColumnDef<VNode> {
  const text = (n: VNode) => fieldText(spec, n);
  return {
    id: `field:${spec.field}`,
    header: spec.label,
    size: 140,
    minSize: MIN_SIZE,
    accessorFn: (n) => text(n) || undefined,
    cell: ({ row }) => {
      const t = text(row.original);
      return t ? (
        <span className="block truncate" title={t}>
          {t}
        </span>
      ) : (
        <span className="text-muted-foreground">–</span>
      );
    },
  };
}

export function TableView({ v, compact = false }: { v: Viewer; compact?: boolean }) {
  const { index } = v;
  const data = useMemo(() => v.tableIds.map((id) => index.byId.get(id)!), [v.tableIds, index]);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'title', desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: compact ? 25 : 50 });
  const { pageIndex, pageSize } = pagination;
  const setPageIndex = (f: number | ((p: number) => number)) =>
    setPagination((p) => ({ ...p, pageIndex: typeof f === 'function' ? f(p.pageIndex) : f }));
  const setPageSize = (s: number) => setPagination({ pageIndex: 0, pageSize: s });

  const parentTitle = (n: VNode) => (n.parents.length ? index.byId.get(n.parents[0])?.title ?? '' : '');
  const columns = useMemo<ColumnDef<VNode>[]>(
    () => [
      {
        id: 'title',
        header: 'Title',
        accessorFn: (n) => n.title,
        size: 320,
        minSize: 160,
        cell: ({ row }) => (
          <span className={cn('block truncate font-medium', (row.original.lifecycle === 'withdrawn' || row.original.lifecycle === 'superseded') && 'text-muted-foreground line-through')} title={row.original.title + (row.original.sub ? ` – ${row.original.sub}` : '')}>
            {row.original.title}
          </span>
        ),
      },
      {
        id: 'kind',
        header: 'Kind',
        size: 120,
        minSize: MIN_SIZE,
        accessorFn: (n) => Core.KIND_LABEL[n.kind],
        cell: ({ row }) => <KindBadge kind={row.original.kind} />,
      },
      {
        id: 'id',
        header: 'Id',
        size: 160,
        minSize: MIN_SIZE,
        accessorFn: (n) => n.id,
        cell: ({ getValue }) => (
          <span className="block truncate font-mono text-[11px] text-muted-foreground" title={String(getValue())}>
            {String(getValue())}
          </span>
        ),
      },
      { id: 'lifecycle', header: 'Lifecycle', size: 96, minSize: MIN_SIZE, accessorFn: (n) => (n.lifecycle ? Core.fieldLabel(index.profile.lifecycle.field, n.lifecycle) : ''), cell: ({ getValue }) => <span title={String(getValue())}>{String(getValue()) || '–'}</span> },
      { id: 'delivery', header: 'Delivery', size: 96, minSize: MIN_SIZE, accessorFn: (n) => n.delivery, cell: ({ getValue }) => <span>{String(getValue()) || '–'}</span> },
      { id: 'level', header: 'Level', size: 96, minSize: MIN_SIZE, accessorFn: (n) => (n.level ? Core.fieldLabel(index.profile.fields.level ?? '', n.level) : ''), cell: ({ getValue }) => <span className="font-mono text-[11px] uppercase">{String(getValue()) || '–'}</span> },
      { id: 'parent', header: 'Parent', size: 140, minSize: MIN_SIZE, accessorFn: parentTitle, cell: ({ getValue }) => <span className="block truncate" title={String(getValue())}>{String(getValue()) || '–'}</span> },
      {
        id: 'coverage',
        header: 'Coverage',
        size: 140,
        minSize: MIN_SIZE,
        accessorFn: (n) => (n.cov && n.cov.parts ? n.cov.verified / n.cov.parts : -1),
        cell: ({ row }) => <Coverage n={row.original} />,
        // The filter reads the text "2 of 3".
        filterFn: (row, _id, value: string) => {
          const c = row.original.cov;
          return (c ? `${c.verified} of ${c.parts}` : '').includes(value);
        },
      },
      ...(index.profile.fieldFilters ?? []).map(fieldColumn),
      ...(index.profile.status ? [statusColumn(index, v.filters.fields)] : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, v.filters.fields],
  );

  const minOf = useMemo(() => Object.fromEntries(columns.map((c) => [c.id!, c.minSize ?? MIN_SIZE])), [columns]);
  // The store keeps the widths. A width below the minimum or for an unknown column is dropped.
  const columnSizing = useMemo(() => cleanWidths(v.widths, minOf), [v.widths, minOf]);
  const setWidth = (id: string, width: number | null) =>
    v.setWidths((prev) => {
      const next = { ...cleanWidths(prev, minOf) };
      if (width === null) delete next[id];
      else next[id] = Math.max(minOf[id], Math.round(width));
      return next;
    });

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, pagination, columnSizing },
    onColumnSizingChange: (u) => v.setWidths((prev) => cleanWidths(typeof u === 'function' ? u(cleanWidths(prev, minOf)) : u, minOf)),
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    defaultColumn: { filterFn: 'includesString', sortUndefined: 'last' },
    autoResetPageIndex: true,
  });

  const rows = table.getRowModel().rows;
  const total = table.getFilteredRowModel().rows.length;
  const from = total ? pageIndex * pageSize + 1 : 0;
  const to = Math.min(total, (pageIndex + 1) * pageSize);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const activeFilters = columnFilters.length;

  const exportCsv = () => {
    const all = table.getSortedRowModel().rows.map((r) => r.original);
    const cols = [
      { label: 'Id', text: (n: VNode) => n.id },
      { label: 'Title', text: (n: VNode) => n.title },
      { label: 'Kind', text: (n: VNode) => Core.KIND_LABEL[n.kind] },
      { label: 'Lifecycle', text: (n: VNode) => (n.lifecycle ? Core.fieldLabel(index.profile.lifecycle.field, n.lifecycle) : '') },
      { label: 'Delivery', text: (n: VNode) => n.delivery },
      { label: 'Level', text: (n: VNode) => n.level },
      { label: 'Parent', text: parentTitle },
      { label: 'Parts', text: (n: VNode) => n.cov?.parts ?? '' },
      { label: 'Parts with a check', text: (n: VNode) => n.cov?.verified ?? '' },
      ...(index.profile.fieldFilters ?? []).map((spec) => ({ label: spec.label, text: (n: VNode) => fieldText(spec, n) })),
      ...(index.profile.status?.values ?? []).map((x) => ({
        label: `${index.profile.status!.label}: ${x.label}`,
        text: (n: VNode) => Core.statusOf(index, n.id, v.filters.fields).counts[x.value] ?? '',
      })),
    ];
    const blob = new Blob(['﻿' + Core.toCsv(cols, all)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'requirement-graph-scope.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="table-view">
      {/* The table container is the only scroll container, so the sticky header and the column filters stay at its top. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <Table containerClassName="min-h-0 flex-1 overflow-auto" className="table-fixed text-[13px]" style={{ width: table.getTotalSize(), minWidth: table.getTotalSize() }}>
          <colgroup>
            {table.getVisibleLeafColumns().map((c) => (
              <col key={c.id} data-col={c.id} style={{ width: c.getSize() }} />
            ))}
          </colgroup>
          <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  return (
                    <TableHead key={h.id} className="group/head relative h-8 px-2 select-none" aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}>
                      <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === 'asc' ? <ArrowUp className="size-3" /> : sorted === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                      </button>
                      {h.column.getCanResize() && (
                        <div
                          role="separator"
                          tabIndex={0}
                          aria-orientation="vertical"
                          aria-label={`Resize the ${String(h.column.columnDef.header)} column`}
                          aria-valuenow={h.column.getSize()}
                          aria-valuemin={minOf[h.column.id]}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            lockSelection(false);
                            h.getResizeHandler()(e);
                          }}
                          onTouchStart={(e) => {
                            // React registers touchstart as passive, so the touch path sets only the styles. touch-none stops the scroll.
                            lockSelection(true);
                            h.getResizeHandler()(e);
                          }}
                          onDoubleClick={() => setWidth(h.column.id, null)}
                          onKeyDown={(e) => {
                            const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                            if (!dir) return;
                            e.preventDefault();
                            setWidth(h.column.id, h.column.getSize() + dir * RESIZE_STEP);
                          }}
                          className={cn('absolute top-1 right-0 h-6 w-1.5 cursor-col-resize touch-none rounded bg-border opacity-0 select-none group-hover/head:opacity-100 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', h.column.getIsResizing() && 'bg-primary opacity-100')}
                        />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
            {showFilters && (
              <TableRow className="hover:bg-transparent">
                {table.getVisibleLeafColumns().map((c) => (
                  <TableHead key={c.id} className="h-9 px-1.5 py-1">
                    <Input
                      className="h-7 px-2 text-xs"
                      placeholder="Filter…"
                      aria-label={`Filter the ${String(c.columnDef.header)} column`}
                      value={(c.getFilterValue() as string) ?? ''}
                      onChange={(e) => {
                        setPageIndex(0);
                        c.setFilterValue(e.target.value || undefined);
                      }}
                    />
                  </TableHead>
                ))}
              </TableRow>
            )}
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.id}
                tabIndex={0}
                data-state={v.selected === r.original.id ? 'selected' : undefined}
                className="h-8 cursor-pointer"
                onClick={() => v.select(r.original.id)}
                onKeyDown={(e) => e.key === 'Enter' && v.select(r.original.id)}
              >
                {r.getVisibleCells().map((c) => (
                  <TableCell key={c.id} className="h-8 truncate px-2 py-0 align-middle">
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  No node matches the scope, the filters and the column filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-card px-3 py-1.5 text-xs">
        <Button variant={showFilters || activeFilters ? 'secondary' : 'ghost'} size="xs" className="max-md:h-10" onClick={() => setShowFilters((s) => !s)}>
          <ListFilter /> Column filters{activeFilters ? ` (${activeFilters})` : ''}
        </Button>
        <span className="text-muted-foreground">
          {from}–{to} of {total}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2 max-md:w-full">
          <span className="text-muted-foreground">Rows</span>
          <ToggleGroup
            value={[String(pageSize)]}
            onValueChange={(val: string[]) => {
              if (val[0]) {
                setPageSize(Number(val[0]));
              }
            }}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Rows per page"
          >
            {PAGE_SIZES.map((s) => (
              <ToggleGroupItem key={s} value={String(s)} className="h-6 px-2 text-xs max-md:h-10 max-md:min-w-10">
                {s}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button variant="outline" size="xs" className="max-md:h-10" disabled={pageIndex === 0} onClick={() => setPageIndex((p) => p - 1)}>
            Previous
          </Button>
          <span className="whitespace-nowrap tabular-nums">
            {pageIndex + 1} / {pages}
          </span>
          <Button variant="outline" size="xs" className="max-md:h-10" disabled={pageIndex >= pages - 1} onClick={() => setPageIndex((p) => p + 1)}>
            Next
          </Button>
          <Button variant="outline" size="xs" className="max-md:h-10" onClick={exportCsv}>
            <Download /> CSV
          </Button>
        </span>
      </div>
    </div>
  );
}
