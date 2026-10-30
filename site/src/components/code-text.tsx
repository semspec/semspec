// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// Inline code in a sentence.
export function CodeText({ className, ...props }: ComponentProps<'code'>) {
  return <code className={cn('rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground', className)} {...props} />;
}
