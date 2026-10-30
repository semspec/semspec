// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import './index.css';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App, routeOf } from './app';

// The HTML of the body of a docs page. The bodies are not in the bundle. A prerendered page already
// holds the body in the DOM, so the browser reads it from there before React hydrates. The dev server
// renders on the client and takes the bodies from the virtual module. The build removes that branch.
async function bodyOf(path: string): Promise<string> {
  const route = routeOf(path);
  if (route.name !== 'doc') return '';
  const element = document.querySelector('[data-doc-body]');
  if (element) return element.innerHTML;
  if (import.meta.env.DEV) return ((await import('virtual:doc-bodies')).default as Record<string, string>)[route.id] ?? '';
  return '';
}

async function main() {
  const root = document.getElementById('root');
  if (!root) throw new Error('The page has no #root element');
  const tree = <App path={location.pathname} body={await bodyOf(location.pathname)} />;
  // A prerendered page has elements in #root, so React hydrates them. The placeholder comment of the
  // dev server is not an element, so the dev server renders on the client.
  if (root.firstElementChild) hydrateRoot(root, tree);
  else createRoot(root).render(tree);
}

void main();
