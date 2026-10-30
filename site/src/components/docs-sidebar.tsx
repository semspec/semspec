// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import docs from 'virtual:docs';
import { cn } from '@/lib/utils';
import { DOCS_ROOT, graphPath, groupPages, pagePath } from '@/lib/docs';

const linkClass = 'block rounded-md px-2.5 py-1.5 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-muted aria-[current=page]:font-medium aria-[current=page]:text-foreground';
const headingClass = 'px-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase';

// The list of all docs pages, grouped by kind, and the link to the docs graph. `path` is the URL path of the current page.
export function DocsSidebar({ path, className }: { path: string; className?: string }) {
  const current = (href: string) => (href === path ? ('page' as const) : undefined);
  return (
    <nav aria-label="Docs pages" className={cn('space-y-5', className)}>
      <a href={DOCS_ROOT} className={linkClass} aria-current={current(DOCS_ROOT)}>
        All docs
      </a>
      {groupPages(docs).map((group) => (
        <div key={group.kind.id} className="space-y-1">
          <p className={headingClass}>{group.kind.heading}</p>
          <ul role="list" className="space-y-0.5">
            {group.pages.map((page) => (
              <li key={page.id}>
                <a href={pagePath(page.id)} className={linkClass} aria-current={current(pagePath(page.id))}>
                  {page.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="space-y-1">
        <p className={headingClass}>Explore</p>
        <a href={graphPath(docs)} className={linkClass} aria-current={current(graphPath(docs))}>
          Docs graph
        </a>
      </div>
    </nav>
  );
}
