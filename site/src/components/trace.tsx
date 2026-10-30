// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { KindDot } from '@/components/kind-dot';
import { StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import type { TraceData, TraceNode } from '@/lib/trace';
import { cn } from '@/lib/utils';

// The id of the header line. The list takes its name from it.
const FILE_ID = 'trace-file';

// The chain of 1 requirement, from the product down to a test. It is static markup and shows only data of the graph.
// Each node is a box. A line with the label of the edge joins 2 boxes.
export function Trace({ trace, className }: { trace: TraceData; className?: string }) {
  return (
    <Card className={cn('gap-0 bg-background bg-linear-to-b from-muted/40 to-muted/40 py-0 shadow-xl shadow-foreground/5', className)}>
      <div className="border-b bg-muted/50 px-4 py-2">
        <span id={FILE_ID} className="block font-mono text-xs break-all text-muted-foreground">
          {trace.file}
        </span>
      </div>
      <ol role="list" aria-labelledby={FILE_ID} className="p-4">
        {trace.nodes.map((node) => (
          <TraceStep key={node.id} node={node} />
        ))}
      </ol>
    </Card>
  );
}

function TraceStep({ node }: { node: TraceNode }) {
  return (
    <li>
      {node.edge !== null && (
        // The line sits under the dot of the box above. The box has 1 px of border and 12 px of padding, and the dot is 10 px wide.
        <div className="flex h-6 items-center gap-3 pl-[18px]">
          <span aria-hidden="true" className="h-full w-px bg-muted-foreground/40" />
          <span className="font-mono text-xs text-muted-foreground">{node.edge}</span>
        </div>
      )}
      <div className="rounded-lg border bg-card px-3 py-2.5 text-card-foreground">
        <div className="flex items-center gap-2">
          <KindDot kind={node.kind} />
          <span className="text-xs text-muted-foreground">{node.kindLabel}</span>
          {node.status !== undefined && (
            <span className="ml-auto">
              <StatusBadge status={node.status} />
            </span>
          )}
        </div>
        <p className="mt-1 text-sm leading-snug font-medium">{node.title}</p>
        {node.file !== undefined && <p className="mt-1 font-mono text-[11px] leading-snug break-all text-muted-foreground">{node.file}</p>}
      </div>
    </li>
  );
}
