// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import docs from 'virtual:docs';
import { DocCard } from '@/components/doc-card';
import { graphPath, groupPages, pagePath } from '@/lib/docs';

// The docs index: 1 group of cards for each kind, then the link to the docs graph.
export function DocsIndexPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-4xl font-semibold tracking-tighter sm:text-5xl">Documentation</h1>
      {groupPages(docs).map((group) => (
        <section key={group.kind.id} aria-labelledby={`group-${group.kind.id}`} className="mt-12">
          <h2 id={`group-${group.kind.id}`} className="text-2xl font-semibold tracking-tight">
            {group.kind.heading}
          </h2>
          <ul role="list" className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.pages.map((page) => (
              <li key={page.id}>
                <DocCard href={pagePath(page.id)} title={page.title} description={page.description} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section aria-labelledby="group-explore" className="mt-12">
        <h2 id="group-explore" className="text-2xl font-semibold tracking-tight">
          Explore
        </h2>
        <ul role="list" className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <li>
            <DocCard href={graphPath(docs)} title="Docs graph" description="Open the docs and the requirements that they document in the explorer." />
          </li>
        </ul>
      </section>
    </div>
  );
}
