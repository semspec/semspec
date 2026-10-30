// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import docs from 'virtual:docs';
import { ArrowLeft, ArrowRight, Pencil } from 'lucide-react';
import { DocCard } from '@/components/doc-card';
import { DocsShell } from '@/components/docs-shell';
import { KindDot } from '@/components/kind-dot';
import { LinkButton } from '@/components/link-button';
import { StatusBadge } from '@/components/status-badge';
import { Separator } from '@/components/ui/separator';
import { editUrl, neighbours, pageOf, pagePath, relatedPages } from '@/lib/docs';

const h2Class = 'text-xl font-semibold tracking-tight';

// One docs page. `body` is the HTML of the Markdown body. It never enters the client bundle.
export function DocPageView({ id, body }: { id: string; body: string }) {
  const page = pageOf(docs, id)!;
  const related = relatedPages(docs, id);
  const { prev, next } = neighbours(docs, id);
  return (
    <DocsShell path={pagePath(id)} headings={page.headings}>
      <article>
        <h1 className="text-4xl font-semibold tracking-tighter text-balance sm:text-5xl">{page.title}</h1>
        <p className="mt-4 text-lg text-pretty text-muted-foreground">{page.description}</p>
        <div className="doc mt-8" data-doc-body="" dangerouslySetInnerHTML={{ __html: body }} />
      </article>

      <Separator className="my-10" />

      <div className="space-y-10">
        {related.length > 0 && (
          <section aria-labelledby="related-title">
            <h2 id="related-title" className={h2Class}>
              Related
            </h2>
            <ul role="list" className="mt-4 grid gap-3 sm:grid-cols-2">
              {related.map((p) => (
                <li key={p.id}>
                  <DocCard href={pagePath(p.id)} title={p.title} description={p.description} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {page.documents.length > 0 && (
          <section aria-labelledby="documents-title">
            <h2 id="documents-title" className={h2Class}>
              Documents
            </h2>
            <ul role="list" className="mt-4 divide-y rounded-xl border">
              {page.documents.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                  <KindDot kind={d.kind} />
                  <span className="min-w-0 flex-1">{d.title}</span>
                  <StatusBadge status={d.status} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <div>
          <LinkButton href={editUrl(page)} variant="outline">
            <Pencil data-icon="inline-start" />
            Edit this page
          </LinkButton>
        </div>

        <nav aria-label="Previous and next page" className="grid gap-3 sm:grid-cols-2">
          {prev ? (
            <LinkButton href={pagePath(prev.id)} variant="outline" size="lg" className="h-auto justify-start py-2.5" rel="prev">
              <ArrowLeft data-icon="inline-start" />
              <span className="flex min-w-0 flex-col items-start">
                <span className="text-xs font-normal text-muted-foreground">Previous</span>
                <span className="truncate">{prev.title}</span>
              </span>
            </LinkButton>
          ) : (
            <span />
          )}
          {next && (
            <LinkButton href={pagePath(next.id)} variant="outline" size="lg" className="h-auto justify-end py-2.5 sm:col-start-2" rel="next">
              <span className="flex min-w-0 flex-col items-end">
                <span className="text-xs font-normal text-muted-foreground">Next</span>
                <span className="truncate">{next.title}</span>
              </span>
              <ArrowRight data-icon="inline-end" />
            </LinkButton>
          )}
        </nav>
      </div>
    </DocsShell>
  );
}
