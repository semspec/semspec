// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import type { ComponentProps } from 'react';
import type { VariantProps } from 'class-variance-authority';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// A link that looks like a button. It stays an anchor, so the browser and the screen reader treat it as a link.
export function LinkButton({ variant, size, className, ...props }: ComponentProps<'a'> & VariantProps<typeof buttonVariants>) {
  return <a className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
