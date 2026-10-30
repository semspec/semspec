// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import docs from 'virtual:docs';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { TooltipProvider } from '@/components/ui/tooltip';
import { graphSlug, pageOf } from '@/lib/docs';
import { DocPageView } from '@/pages/doc-page';
import { DocsGraph } from '@/pages/docs-graph';
import { DocsIndexPage } from '@/pages/docs-index';
import { Home } from '@/pages/home';
import { Roadmap } from '@/pages/roadmap';

export type Route = { name: 'home' } | { name: 'roadmap' } | { name: 'docs' } | { name: 'docs-graph' } | { name: 'doc'; id: string };

// Returns the route of a URL path. A path that matches no route gives the home page.
// A docs path with an unknown page id gives the docs index.
export function routeOf(path: string): Route {
  const clean = path.replace(/\/index\.html$/, '/').replace(/([^/])$/, '$1/');
  if (clean === '/roadmap/') return { name: 'roadmap' };
  const match = /^\/docs\/(?:([^/]+)\/)?$/.exec(clean);
  if (!match) return { name: 'home' };
  const id = match[1];
  if (!id) return { name: 'docs' };
  if (id === graphSlug(docs)) return { name: 'docs-graph' };
  return pageOf(docs, id) ? { name: 'doc', id } : { name: 'docs' };
}

// The href of the nav link that marks the route as the current page.
function navHref(route: Route): string {
  if (route.name === 'roadmap') return '/roadmap/';
  if (route.name === 'home') return '/';
  return '/docs/';
}

// The whole site. The path picks the page. The server render and the browser use the same function.
// `body` is the HTML of the body of a docs page. The server gets it from the build. The browser takes it from the prerendered page.
export function App({ path, body = '' }: { path: string; body?: string }) {
  const route = routeOf(path);
  return (
    <TooltipProvider>
      <div className="flex min-h-svh flex-col">
        <a href="#main" className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-background focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:ring-3 focus-visible:ring-ring/50">
          Skip to the content
        </a>
        <SiteHeader route={navHref(route)} />
        <main id="main" className="flex-1">
          {route.name === 'roadmap' && <Roadmap />}
          {route.name === 'home' && <Home />}
          {route.name === 'docs' && <DocsIndexPage />}
          {route.name === 'docs-graph' && <DocsGraph />}
          {route.name === 'doc' && <DocPageView id={route.id} body={body} />}
        </main>
        <SiteFooter />
      </div>
    </TooltipProvider>
  );
}
