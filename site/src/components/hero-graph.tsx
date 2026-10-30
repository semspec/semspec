// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import type { CSSProperties } from 'react';
import roadmap from 'virtual:roadmap';
import type { HeroGraphData } from '@/lib/hero-graph';
import { cn } from '@/lib/utils';

// A faint drawing of the requirements graph for the background of the hero. It is static markup with no text and no
// animation. It uses 1 path for the tree edges, 1 dashed path for the links and 1 group of dots for each kind.
// The dots take the colour of their kind from the profile, 1 value for each theme. The caller sets the size and the place.
export function HeroGraph({ graph, className }: { graph: HeroGraphData; className?: string }) {
  const at = new Map(graph.nodes.map((n) => [n.id, n]));
  const path = (linked: boolean) =>
    graph.edges
      .filter((e) => e.linked === linked)
      .flatMap((e) => {
        const a = at.get(e.from);
        const b = at.get(e.to);
        return a && b ? [`M${a.x} ${a.y}L${b.x} ${b.y}`] : [];
      })
      .join('');
  const kinds = [...new Set(graph.nodes.map((n) => n.kind))];

  return (
    <svg viewBox={`0 0 ${graph.size} ${graph.size}`} aria-hidden="true" focusable="false" className={cn('pointer-events-none', className)}>
      <g fill="none" className="stroke-foreground">
        <path d={path(false)} vectorEffect="non-scaling-stroke" className="opacity-15" />
        <path d={path(true)} vectorEffect="non-scaling-stroke" strokeDasharray="3 4" className="opacity-25" />
      </g>
      {kinds.map((kind) => {
        const color = roadmap.kinds[kind];
        const style = color ? ({ '--dot-light': color.light, '--dot-dark': color.dark } as CSSProperties) : undefined;
        return (
          <g key={kind} style={style} className={cn('opacity-45 dark:opacity-55', color ? 'fill-(--dot-light) dark:fill-(--dot-dark)' : 'fill-muted-foreground')}>
            {graph.nodes
              .filter((n) => n.kind === kind)
              .map((n) => (
                <circle key={n.id} cx={n.x} cy={n.y} r={n.r} />
              ))}
          </g>
        );
      })}
    </svg>
  );
}
