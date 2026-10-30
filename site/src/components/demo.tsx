// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { LinkButton } from '@/components/link-button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMediaQuery } from '@/lib/use-media-query';

const DEMOS = [
  { id: 'requirements', label: 'Semspec requirements', href: '/demo/requirements.html', caption: 'The requirements of Semspec, from the requirements folder of this repository.' },
  { id: 'shop', label: 'Shop workspace', href: '/demo/shop.html', caption: 'A requirements graph and a domain model of an invented retail market, with links between them.' },
];

// The live demo: a framed window with 2 tabs, each with a page that `semspec build` wrote.
// A phone gets a card with links, and the page loads no iframe there.
export function Demo() {
  const [tab, setTab] = useState(DEMOS[0].id);
  // The iframe mounts only after the client knows that the screen is wide. The server render has none.
  const wide = useMediaQuery('(min-width: 48rem)');
  const active = DEMOS.find((d) => d.id === tab) ?? DEMOS[0];

  return (
    <>
      <Card className="md:hidden">
        <CardContent className="space-y-4">
          <p>The explorer needs a wider screen. Open it full page to use it on this device.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {DEMOS.map((d, i) => (
              <LinkButton key={d.id} href={d.href} variant={i === 0 ? 'default' : 'outline'} size="lg">
                Open {d.label}
                <ExternalLink data-icon="inline-end" />
              </LinkButton>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="hidden overflow-hidden rounded-2xl border bg-card shadow-xl shadow-foreground/5 md:block">
        <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="gap-0">
          <div className="flex items-center justify-between gap-3 border-b bg-muted/50 px-3 py-2">
            <TabsList>
              {DEMOS.map((d) => (
                <TabsTrigger key={d.id} value={d.id} className="px-3">
                  {d.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <LinkButton href={active.href} variant="outline" size="sm">
              Open full page
              <ExternalLink data-icon="inline-end" />
            </LinkButton>
          </div>
          {DEMOS.map((d) => (
            <TabsContent key={d.id} value={d.id}>
              <p className="border-b px-4 py-2 text-sm text-muted-foreground">{d.caption}</p>
              {wide ? (
                <iframe title={`Semspec explorer: ${d.label}`} src={d.href} loading="lazy" className="block h-[75vh] min-h-[560px] w-full border-0 bg-background" />
              ) : (
                <div className="h-[75vh] min-h-[560px]" />
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </>
  );
}
