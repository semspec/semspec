// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import type { CSSProperties } from 'react';
import roadmap from 'virtual:roadmap';
import { cn } from '@/lib/utils';

// A small dot in the colour of a kind. The colours come from the profile of the requirements.
export function KindDot({ kind, className }: { kind: string; className?: string }) {
  const color = roadmap.kinds[kind];
  const style = color ? ({ '--dot-light': color.light, '--dot-dark': color.dark } as CSSProperties) : undefined;
  return <span aria-hidden="true" style={style} className={cn('inline-block size-2.5 shrink-0 rounded-full bg-muted-foreground bg-(--dot-light) dark:bg-(--dot-dark)', className)} />;
}
