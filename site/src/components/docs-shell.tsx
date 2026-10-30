// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { DocsSidebar } from '@/components/docs-sidebar';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import type { DocHeading } from '@/lib/docs';

// The frame of a docs page. On `lg` it has the sidebar at the left, the content in the middle and the
// list of headings at the right. Below `lg` the sidebar moves into a sheet and the list of headings is hidden.
export function DocsShell({ path, headings = [], children }: { path: string; headings?: DocHeading[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)_11rem] lg:gap-8 lg:py-12 xl:grid-cols-[15rem_minmax(0,1fr)_14rem] xl:gap-12">
      <aside className="hidden lg:block">
        <div className="sticky top-20 max-h-[calc(100svh-6rem)] overflow-y-auto pb-6 [scrollbar-width:thin]">
          <DocsSidebar path={path} />
        </div>
      </aside>

      <div className="min-w-0">
        <div className="mb-6 lg:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger render={<Button variant="outline" />}>
              <Menu data-icon="inline-start" />
              All docs pages
            </SheetTrigger>
            <SheetContent side="left">
              <SheetHeader>
                <SheetTitle>Docs pages</SheetTitle>
                <SheetDescription className="sr-only">Links to all pages of the docs</SheetDescription>
              </SheetHeader>
              <div className="overflow-y-auto px-4 pb-6">
                <DocsSidebar path={path} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
        {children}
      </div>

      <aside className="hidden lg:block">
        {headings.length > 0 && (
          <nav aria-label="On this page" className="sticky top-20 max-h-[calc(100svh-6rem)] overflow-y-auto pb-6 text-sm [scrollbar-width:thin]">
            <p className="px-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">On this page</p>
            <ul role="list" className="mt-2 space-y-0.5">
              {headings.map((h) => (
                <li key={h.id}>
                  <a
                    href={`#${h.id}`}
                    className={`block rounded-md py-1 pr-2 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 ${h.depth === 3 ? 'pl-5' : 'pl-2.5'}`}
                  >
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </aside>
    </div>
  );
}
