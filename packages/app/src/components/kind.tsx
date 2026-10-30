// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Kind colour, kind badge, attribute chips and the node summary.
// The summary is 1 component. The card and the hover popover of a node both use it,
// so the 2 never drift apart.
import { cn } from '@/lib/utils';
import { Core, type Chip, type Kind, type NodeStatus, type StatusTone, type Summary } from '@/lib/core';

export const kindColor = (kind: Kind) => `var(--kind-${kind})`;

export function KindDot({ kind, className }: { kind: Kind; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: kindColor(kind) }} />;
}

export function KindBadge({ kind, className }: { kind: Kind; className?: string }) {
  return (
    <span
      className={cn('inline-flex h-5 items-center gap-1.5 rounded-md px-1.5 text-[11px] font-medium', className)}
      style={{ color: kindColor(kind), background: `color-mix(in oklab, ${kindColor(kind)} 14%, transparent)` }}
    >
      <KindDot kind={kind} />
      {Core.KIND_LABEL[kind]}
    </span>
  );
}

const TONE: Record<Chip['tone'], string> = {
  life: 'bg-secondary text-secondary-foreground',
  muted: 'bg-muted text-muted-foreground',
  count: 'border border-border text-muted-foreground',
  level: 'bg-secondary font-mono text-[10px] tracking-wide text-secondary-foreground',
  good: 'bg-good/10 text-good',
  warn: 'bg-warn/10 text-warn',
  plain: 'bg-secondary text-secondary-foreground',
};

export function ChipView({ chip }: { chip: Chip }) {
  return (
    <span className={cn('inline-flex h-5 items-center rounded-md px-1.5 text-[11px] leading-none whitespace-nowrap', TONE[chip.tone], chip.struck && 'line-through')}>
      {chip.text}
    </span>
  );
}

// A small round count of the neighbours that are not on the canvas.
export function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      title={`${count} neighbour${count === 1 ? '' : 's'} not on the canvas`}
      className={cn('inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] leading-none font-semibold text-background tabular-nums', className)}
    >
      {count}
    </span>
  );
}

// The summary of a node: kind, title, id and the attribute chips. It shows no long text.
// With a status, the border takes the colour of the status and a chip shows the share of good nodes.
export function NodeSummaryView({ summary, count, status, className }: { summary: Summary; count?: number; status?: NodeStatus; className?: string }) {
  return (
    <div
      className={cn('flex w-full flex-col overflow-hidden rounded-lg border bg-card text-card-foreground', summary.muted && 'opacity-60', className)}
      style={status ? { borderColor: toneColor(status.tone), borderWidth: 2 } : undefined}
    >
      <div
        className="flex h-6 items-center justify-between gap-2 px-2 text-[11px] font-semibold"
        style={{ color: kindColor(summary.kind), background: `color-mix(in oklab, ${kindColor(summary.kind)} 16%, var(--card))`, borderBottom: `2px solid ${kindColor(summary.kind)}` }}
      >
        <span className="uppercase tracking-wide">{Core.KIND_LABEL[summary.kind]}</span>
        {count !== undefined && <CountBadge count={count} />}
      </div>
      <div className="flex flex-col gap-1 px-2 py-1.5">
        <div className={cn('line-clamp-2 text-[13px] leading-snug font-medium', summary.muted && 'line-through')}>{summary.title}</div>
        {summary.sub && <div className="truncate text-[11px] text-muted-foreground">{summary.sub}</div>}
        <div className="truncate font-mono text-[10px] text-muted-foreground" title={summary.id}>
          {summary.id}
        </div>
        {(summary.chips.length > 0 || !!status?.total) && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {status && <StatusChip status={status} />}
            {summary.chips.map((c, i) => (
              <ChipView key={i} chip={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// The colour of a status tone. A node with no status is grey.
export const toneColor = (tone: StatusTone | null) =>
  tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--destructive)' : 'var(--muted-foreground)';

export function StatusDot({ tone, className }: { tone: StatusTone | null; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: toneColor(tone) }} />;
}

// The share of good nodes below a node, for example "12/30 pass". `short` leaves out the label.
export function statusShare(status: NodeStatus, short = false): string {
  const good = Core.profile.status!.values[0];
  const share = `${status.counts[good.value] ?? 0}/${status.total}`;
  return short ? share : `${share} ${good.label.toLowerCase()}`;
}

// The count of each status value, for example "12 pass · 8 partial · 10 fail".
export function StatusCounts({ status, className }: { status: NodeStatus; className?: string }) {
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-2 gap-y-0.5', className)}>
      {Core.profile.status!.values.map((x) => (
        <span key={x.value} className="inline-flex items-center gap-1 tabular-nums">
          <StatusDot tone={x.tone} />
          {status.counts[x.value] ?? 0} {x.label.toLowerCase()}
        </span>
      ))}
    </span>
  );
}

// A chip with the colour of the status and the share of good nodes.
export function StatusChip({ status, className }: { status: NodeStatus; className?: string }) {
  if (!status.total) return null;
  const color = toneColor(status.tone);
  return (
    <span
      className={cn('inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] leading-none whitespace-nowrap tabular-nums', className)}
      style={{ color, background: `color-mix(in oklab, ${color} 12%, transparent)` }}
    >
      <StatusDot tone={status.tone} />
      {statusShare(status)}
    </span>
  );
}
