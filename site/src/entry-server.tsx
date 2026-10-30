// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import bodies from 'virtual:doc-bodies';
import docs from 'virtual:docs';
import { renderToString } from 'react-dom/server';
import { App, routeOf } from './app';
import { docsPaths, graphPath, pageOf } from './lib/docs';

// The text for the head of a docs page.
export interface Head {
  title: string;
  description: string;
}

const GRAPH_DESCRIPTION = 'The docs of Semspec as a graph, in the explorer, together with the requirements that they document.';
const INDEX_DESCRIPTION = 'The guides, concepts and references of Semspec.';

// Renders the page of a URL path to an HTML string. scripts/prerender.mjs calls it for each route.
export function render(path: string): string {
  const route = routeOf(path);
  return renderToString(<App path={path} body={route.name === 'doc' ? bodies[route.id] : ''} />);
}

// The URL paths of the docs routes.
export function docsRoutes(): string[] {
  return docsPaths(docs);
}

// The title and the description of a docs route. The home page and the roadmap keep the head of their own HTML file.
export function headOf(path: string): Head {
  const route = routeOf(path);
  if (route.name === 'doc') {
    const page = pageOf(docs, route.id)!;
    return { title: `${page.title} – Semspec docs`, description: page.description };
  }
  if (path === graphPath(docs)) return { title: 'Docs graph – Semspec docs', description: GRAPH_DESCRIPTION };
  return { title: 'Documentation – Semspec docs', description: INDEX_DESCRIPTION };
}
