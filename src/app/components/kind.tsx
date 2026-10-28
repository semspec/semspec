// SPDX-License-Identifier: Apache-2.0
// Kind colour, kind badge, attribute chips and the node summary.
// The summary is 1 component. The card and the hover popover of a node both use it,
// so the 2 never drift apart.
import { cn } from '@/lib/utils';
import { Core, type Chip, type Kind, type Summary } from '@/lib/core';

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
export function NodeSummaryView({ summary, count, className }: { summary: Summary; count?: number; className?: string }) {
  return (
    <div className={cn('flex w-full flex-col overflow-hidden rounded-lg border bg-card text-card-foreground', summary.muted && 'opacity-60', className)}>
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
        {summary.chips.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {summary.chips.map((c, i) => (
              <ChipView key={i} chip={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
