// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// A card that links to a page. The link covers the whole card.
export function DocCard({ href, title, description, className }: { href: string; title: string; description?: string; className?: string }) {
  return (
    <Card size="sm" className={cn('relative h-full transition-colors hover:bg-muted/50', className)}>
      <CardHeader>
        <CardTitle>
          <a href={href} className="rounded-xl outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-3 focus-visible:after:ring-ring/50">
            {title}
          </a>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
    </Card>
  );
}
