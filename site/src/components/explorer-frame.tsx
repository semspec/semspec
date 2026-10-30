// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { ExternalLink } from 'lucide-react';
import { LinkButton } from '@/components/link-button';
import { Card, CardContent } from '@/components/ui/card';
import { useMediaQuery } from '@/lib/use-media-query';

// A framed explorer page like the demo of the home page. A phone gets a card with a link, and the page loads no iframe there.
export function ExplorerFrame({ title, href }: { title: string; href: string }) {
  // The iframe mounts only after the client knows that the screen is wide. The server render has none.
  const wide = useMediaQuery('(min-width: 48rem)');
  return (
    <>
      <Card className="md:hidden">
        <CardContent className="space-y-4">
          <p>The explorer needs a wider screen. Open it full page to use it on this device.</p>
          <LinkButton href={href} size="lg">
            Open full page
            <ExternalLink data-icon="inline-end" />
          </LinkButton>
        </CardContent>
      </Card>

      <div className="hidden overflow-hidden rounded-2xl border bg-card shadow-xl shadow-foreground/5 md:block">
        <div className="flex items-center justify-end gap-3 border-b bg-muted/50 px-3 py-2">
          <LinkButton href={href} variant="outline" size="sm">
            Open full page
            <ExternalLink data-icon="inline-end" />
          </LinkButton>
        </div>
        {wide ? <iframe title={title} src={href} loading="lazy" className="block h-[75vh] min-h-[560px] w-full border-0 bg-background" /> : <div className="h-[75vh] min-h-[560px]" />}
      </div>
    </>
  );
}
