// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// DOM tests of the state of the views: the memory of a graph, the browser storage and the link in the hash.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Core } from '@/lib/core';
import { formatLink, parseLink } from '@/lib/link';
import { patchGraph, shortHash, storageKey, STORE_VERSION, useAppStore } from '@/lib/store';
import { blockStorage, installStorage, pickInTree, renderWorkspace, settle, storedKey, storedState, switchTo, twoGraphs, wait } from './harness';

let store: Map<string, string>;
beforeEach(() => {
  store = installStorage();
  // jsdom has no layout. The canvas is 800 px wide and 600 px high.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) }) as DOMRect);
});
afterEach(() => vi.restoreAllMocks());

const PRODUCT = 'Shop product';
const SAFETY = 'Heater safety case';
const chip = () => screen.queryByTestId('scope-chip')?.textContent ?? '';
const viewTab = (name: string) => screen.getByRole('tab', { name }).getAttribute('aria-selected');
const graphState = (id = 'product') => useAppStore.getState().graphs[id];
const transform = () => (document.querySelector('.react-flow__viewport') as HTMLElement | null)?.style.transform ?? '';

// Puts the product graph in a state with every listed value set.
async function shapeProduct() {
  await pickInTree('epic-checkout');
  await userEvent.setup().click(screen.getByRole('tab', { name: 'Cards' }));
  const model = twoGraphs().graphs[0].model;
  patchGraph('product', {
    depth: 2,
    filters: { ...graphState().filters, kinds: ['story'] },
    layoutChoice: 'force',
    walk: Core.walkStart(['epic-checkout', 'story-save-card']),
    dock: true,
    panel: 'expand',
    statusColour: true,
    selected: 'story-save-card',
  });
  return model;
}

describe('req-state-memory: graph-state', () => {
  it('restores the scope, the walk, the filters, the selection, the view and the layout after a switch and a switch back', async () => {
    renderWorkspace();
    await shapeProduct();
    await settle();
    const before = graphState();
    await switchTo(SAFETY);
    expect(screen.getByTestId('welcome')).toBeTruthy();
    expect(graphState('safety').scope).toBeNull();
    await switchTo(PRODUCT);
    const after = graphState();
    expect(after.scope).toEqual({ type: 'node', id: 'epic-checkout' });
    expect(after.depth).toBe(2);
    expect(after.filters.kinds).toEqual(['story']);
    expect(after.walk && [...after.walk.shown]).toEqual([...before.walk!.shown]);
    expect(after.selected).toBe('story-save-card');
    expect(after.view).toBe('cards');
    expect(after.layoutChoice).toBe('force');
    expect(viewTab('Cards')).toBe('true');
    expect(screen.getByLabelText('Force layout').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('walk');
  });

  it('restores a walk from a node with its history, and after a reload', async () => {
    const r = renderWorkspace();
    await pickInTree('epic-checkout');
    const w1 = Core.walkStart(['epic-checkout']);
    const w2 = Core.walkStart(['epic-checkout', 'story-save-card']);
    patchGraph('product', { scope: null, walk: w2, walkRoot: 'epic-checkout', history: [null, w1] });
    await switchTo(SAFETY);
    await switchTo(PRODUCT);
    expect(chip()).toContain('Walk from');
    expect(graphState().history).toHaveLength(2);
    r.unmount();
    useAppStore.setState({ active: '', graphs: {} });
    renderWorkspace();
    expect(graphState().walkRoot).toBe('epic-checkout');
    expect([...graphState().walk!.shown].sort()).toEqual(['epic-checkout', 'story-save-card']);
    expect(graphState().history.map((w) => (w ? [...w.shown] : null))).toEqual([null, ['epic-checkout']]);
  });

  it('keeps the state of each graph apart', async () => {
    renderWorkspace();
    await pickInTree('epic-checkout');
    await switchTo(SAFETY);
    await pickInTree('g-safe-operation');
    expect(graphState('product').scope).toEqual({ type: 'node', id: 'epic-checkout' });
    expect(graphState('safety').scope).toEqual({ type: 'node', id: 'g-safe-operation' });
    await switchTo(PRODUCT);
    expect(chip()).toContain('Checkout');
  });
});

describe('req-state-memory: canvas-state', () => {
  it('saves the viewport of the canvas after the fit', async () => {
    renderWorkspace();
    await pickInTree('epic-checkout');
    await settle();
    const vp = graphState().viewport.graph;
    expect(vp).toBeDefined();
    expect(Number.isFinite(vp!.zoom)).toBe(true);
  });

  it('saves the viewport after the reader zooms the canvas, and restores it after a switch back', async () => {
    renderWorkspace();
    await pickInTree('epic-checkout');
    await settle();
    const fitted = graphState().viewport.graph!;
    const pane = document.querySelector('.react-flow__pane') as HTMLElement;
    fireEvent.wheel(pane, { deltaY: -100, ctrlKey: true, clientX: 200, clientY: 200 });
    // The zoom ends 150 ms after the last wheel event.
    await wait(400);
    const zoomed = graphState().viewport.graph!;
    expect(zoomed.zoom).toBeGreaterThan(fitted.zoom);
    expect(transform()).toContain(`scale(${zoomed.zoom})`);
    await switchTo(SAFETY);
    await switchTo(PRODUCT);
    await settle();
    expect(graphState().viewport.graph).toEqual(zoomed);
    expect(transform()).toBe(`translate(${zoomed.x}px,${zoomed.y}px) scale(${zoomed.zoom})`);
  });

  it('sets the stored viewport in place of the first fit after a switch back', async () => {
    renderWorkspace();
    await pickInTree('epic-checkout');
    await settle();
    patchGraph('product', { viewport: { graph: { x: 37, y: 53, zoom: 0.8 } } });
    await switchTo(SAFETY);
    await switchTo(PRODUCT);
    await settle();
    expect(graphState().viewport.graph).toEqual({ x: 37, y: 53, zoom: 0.8 });
    expect(transform()).toContain('translate(37px,53px) scale(0.8)');
  });

  it('keeps the viewport of each mode apart', async () => {
    renderWorkspace();
    await pickInTree('epic-checkout');
    await settle();
    patchGraph('product', { viewport: { graph: { x: 10, y: 20, zoom: 0.9 }, cards: { x: 30, y: 40, zoom: 0.5 } } });
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Cards' }));
    await settle();
    expect(transform()).toContain('translate(30px,40px) scale(0.5)');
  });

  it('drops the stored viewport on a new scope, so the canvas fits', async () => {
    renderWorkspace();
    await pickInTree('epic-checkout');
    await settle();
    patchGraph('product', { viewport: { graph: { x: 1, y: 2, zoom: 0.3 } } });
    await pickInTree('story-save-card');
    await settle();
    expect(graphState().viewport.graph).not.toEqual({ x: 1, y: 2, zoom: 0.3 });
  });
});

describe('req-state-memory: panel-state', () => {
  it('restores the open tree groups and the column widths of the table', async () => {
    renderWorkspace();
    await pickInTree('epic-checkout');
    patchGraph('product', (g) => ({ open: new Set([...g.open, 'g:custom']) }));
    const openBefore = new Set(graphState().open);
    expect(openBefore.has('g:custom')).toBe(true);
    patchGraph('product', { widths: { title: 400 } });
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Table' }));
    await switchTo(SAFETY);
    await switchTo(PRODUCT);
    expect(graphState().open).toEqual(openBefore);
    expect(document.querySelector('[data-testid="table-view"] col[data-col="title"]')).toHaveProperty('style.width', '400px');
    expect(document.querySelector(`[data-testid="tree-panel"] [data-node="epic-checkout"]`)).not.toBeNull();
  });
});

describe('req-state-storage: reload', () => {
  it('restores the active graph and the state of each graph after an unmount and a mount', async () => {
    const first = renderWorkspace();
    await shapeProduct();
    patchGraph('product', { viewport: { graph: { x: 5, y: 6, zoom: 0.7 } }, widths: { title: 380 } });
    await switchTo(SAFETY);
    await pickInTree('g-safe-operation');
    const open = [...graphState('safety').open].sort();
    first.unmount();
    // The store forgets its memory. Only the storage can bring the state back.
    useAppStore.setState({ active: '', graphs: {} });
    renderWorkspace();
    expect(useAppStore.getState().active).toBe('safety');
    expect(graphState('safety').scope).toEqual({ type: 'node', id: 'g-safe-operation' });
    expect(graphState().scope).toEqual({ type: 'node', id: 'epic-checkout' });
    expect(graphState().depth).toBe(2);
    expect(graphState().filters.kinds).toEqual(['story']);
    expect([...graphState().walk!.shown].sort()).toEqual(['epic-checkout', 'story-save-card']);
    expect(graphState().selected).toBe('story-save-card');
    expect(graphState().view).toBe('cards');
    expect(graphState().layoutChoice).toBe('force');
    expect(graphState().dock).toBe(true);
    expect(graphState().panel).toBe('expand');
    expect(graphState().statusColour).toBe(true);
    expect(graphState().viewport.graph).toEqual({ x: 5, y: 6, zoom: 0.7 });
    expect(graphState().widths).toEqual({ title: 380 });
    expect(Object.keys(graphState('safety').widths)).toEqual([]);
    expect([...graphState('safety').open].sort()).toEqual(open);
    await switchTo(PRODUCT);
    expect(screen.getByRole('status').textContent).toContain('walk');
    expect(viewTab('Cards')).toBe('true');
  });

  it('writes the state to the storage and reads the stored arrays back as sets and maps', async () => {
    const r = renderWorkspace();
    await shapeProduct();
    r.unmount();
    const g = storedState(store).graphs.product;
    expect(Array.isArray(g.open)).toBe(true);
    expect(Array.isArray(g.walk.shown)).toBe(true);
    expect(Array.isArray(g.walk.intro)).toBe(true);
  });

  it('writes the state to the storage after a short delay while the page stays open', async () => {
    renderWorkspace();
    await pickInTree('epic-checkout');
    await wait(300);
    expect(storedState(store).graphs.product.scope).toEqual({ type: 'node', id: 'epic-checkout' });
  });
});

describe('req-state-storage: key', () => {
  it('holds the workspace title and a hash of the graph ids', () => {
    const data = twoGraphs('Shop workspace');
    expect(storageKey(data)).toBe(`semspec:Shop workspace:${shortHash('product\nsafety')}`);
    expect(storageKey(twoGraphs('Other'))).not.toBe(storageKey(data));
    const reversed = { ...data, graphs: [...data.graphs].reverse().slice(0, 1) };
    expect(storageKey(reversed)).not.toBe(storageKey(data));
  });

  it('never shares a state between 2 workspaces', async () => {
    const first = renderWorkspace(twoGraphs('Workspace A'));
    await pickInTree('epic-checkout');
    first.unmount();
    expect(store.has(storageKey(twoGraphs('Workspace A')))).toBe(true);
    // A new page has no hash.
    window.history.replaceState(null, '', window.location.pathname);
    renderWorkspace(twoGraphs('Workspace B'));
    expect(graphState().scope).toBeNull();
    expect(screen.getByTestId('welcome')).toBeTruthy();
  });
});

describe('req-state-storage: stale', () => {
  it('drops the ids that the graph lacks and loads the rest', async () => {
    const key = storageKey(twoGraphs());
    store.set(
      key,
      JSON.stringify({
        version: STORE_VERSION,
        active: 'product',
        graphs: {
          product: {
            scope: { type: 'node', id: 'epic-checkout' },
            selected: 'gone-node',
            filters: { q: 'pay', kinds: ['story', 'ghost-kind'], fields: { priority: ['no-such-value'], 'ghost-field': ['x'] } },
            walk: { shown: ['epic-checkout', 'gone-node'], intro: [['epic-checkout', ['']], ['gone-node', ['epic-checkout']]] },
            walkRoot: 'gone-node',
            open: ['g:hier', 'epic-checkout', 'gone-node'],
            widths: { title: 400, id: 5 },
            view: 'cards',
          },
          'gone-graph': { scope: { type: 'node', id: 'x' } },
        },
      }),
    );
    renderWorkspace();
    const g = graphState();
    expect(g.scope).toEqual({ type: 'node', id: 'epic-checkout' });
    expect(g.selected).toBeNull();
    expect(g.filters.q).toBe('pay');
    expect(g.filters.kinds).toEqual(['story']);
    expect(g.filters.fields).toEqual({});
    expect([...g.walk!.shown]).toEqual(['epic-checkout']);
    expect([...g.walk!.intro.keys()]).toEqual(['epic-checkout']);
    expect(g.walkRoot).toBeNull();
    expect(g.open.has('g:hier')).toBe(true);
    expect(g.open.has('epic-checkout')).toBe(true);
    expect(g.open.has('gone-node')).toBe(false);
    expect(g.view).toBe('cards');
    expect(Object.keys(useAppStore.getState().graphs)).toEqual(['product', 'safety']);
    expect(viewTab('Cards')).toBe('true');
  });

  it('drops a column that the table lacks', async () => {
    store.set(storageKey(twoGraphs()), JSON.stringify({ version: STORE_VERSION, active: 'product', graphs: { product: { scope: { type: 'node', id: 'epic-checkout' }, view: 'table', widths: { title: 400, nothing: 300 } } } }));
    renderWorkspace();
    const col = (id: string) => document.querySelector(`[data-testid="table-view"] col[data-col="${id}"]`) as HTMLElement | null;
    expect(col('title')!.style.width).toBe('400px');
    expect(col('nothing')).toBeNull();
    fireEvent.keyDown(within(screen.getByTestId('table-view')).getByRole('separator', { name: 'Resize the Title column' }), { key: 'ArrowRight' });
    expect(graphState().widths).toEqual({ title: 416 });
  });

  it('drops a selected edge that the graph lacks and keeps the edge object of the model', () => {
    const data = twoGraphs();
    const model = data.graphs[0].model;
    const e = model.edges[0];
    store.set(storageKey(data), JSON.stringify({ version: STORE_VERSION, active: 'product', graphs: { product: { selectedEdge: { s: e.s, t: e.t, k: e.k } }, safety: { selectedEdge: { s: 'a', t: 'b', k: 'c' } } } }));
    renderWorkspace(data);
    expect(graphState().selectedEdge).toBe(model.edges.find((x) => x.s === e.s && x.t === e.t && x.k === e.k));
    expect(graphState().selectedEdge).not.toBeNull();
    expect(graphState('safety').selectedEdge).toBeNull();
  });
});

describe('req-state-storage: version', () => {
  it('ignores a state of another version and starts fresh', () => {
    store.set(storageKey(twoGraphs()), JSON.stringify({ version: STORE_VERSION + 1, active: 'safety', graphs: { product: { scope: { type: 'node', id: 'epic-checkout' } } } }));
    renderWorkspace();
    expect(useAppStore.getState().active).toBe('product');
    expect(graphState().scope).toBeNull();
    expect(screen.getByTestId('welcome')).toBeTruthy();
  });

  it('writes the version', async () => {
    const r = renderWorkspace();
    await pickInTree('epic-checkout');
    r.unmount();
    expect(storedState(store).version).toBe(STORE_VERSION);
  });

  it('starts fresh on a text that is not JSON', () => {
    store.set(storageKey(twoGraphs()), '{not json');
    renderWorkspace();
    expect(graphState().scope).toBeNull();
  });
});

describe('req-state-storage: blocked', () => {
  it('works and starts fresh when the storage throws on access', async () => {
    blockStorage();
    renderWorkspace();
    await pickInTree('epic-checkout');
    expect(chip()).toContain('Checkout');
    await switchTo(SAFETY);
    await switchTo(PRODUCT);
    // The memory of the page still restores the graph.
    expect(chip()).toContain('Checkout');
  });

  it('works when the storage throws on each read and write', async () => {
    const throwing = () => {
      throw new DOMException('The quota is exceeded.', 'QuotaExceededError');
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: throwing, setItem: throwing, removeItem: throwing, clear: throwing } });
    const r = renderWorkspace();
    await pickInTree('epic-checkout');
    expect(chip()).toContain('Checkout');
    expect(() => r.unmount()).not.toThrow();
  });
});

describe('req-state-link: write', () => {
  it('writes the graph, the scope and the node into the hash with no new history entry', async () => {
    renderWorkspace();
    expect(window.location.hash).toBe('#graph=product');
    const length = window.history.length;
    await pickInTree('epic-checkout');
    expect(window.location.hash).toBe('#graph=product&scope=epic-checkout&node=epic-checkout');
    patchGraph('product', { selected: 'story-save-card' });
    expect(window.location.hash).toBe('#graph=product&scope=epic-checkout&node=story-save-card');
    await switchTo(SAFETY);
    expect(window.location.hash).toBe('#graph=safety');
    expect(window.history.length).toBe(length);
  });

  it('encodes the ids', () => {
    expect(formatLink({ graph: 'a b', scope: 'x&y', node: 'z=1#' })).toBe('#graph=a%20b&scope=x%26y&node=z%3D1%23');
    expect(parseLink('#graph=a%20b&scope=x%26y&node=z%3D1%23')).toEqual({ graph: 'a b', scope: 'x&y', node: 'z=1#' });
    expect(parseLink('#graph=%E0%A4%A&scope=s')).toEqual({ scope: 's' });
    expect(parseLink('')).toEqual({});
  });

  it('keeps the path and the query of the address', async () => {
    window.history.replaceState(null, '', '/page.html?x=1');
    renderWorkspace();
    await pickInTree('epic-checkout');
    expect(window.location.pathname + window.location.search).toBe('/page.html?x=1');
    window.history.replaceState(null, '', '/');
  });
});

describe('req-state-link: read', () => {
  it('shows the graph, the scope and the node of the hash, and the hash wins over the stored state', async () => {
    store.set(storageKey(twoGraphs()), JSON.stringify({ version: STORE_VERSION, active: 'product', graphs: { product: { scope: { type: 'node', id: 'epic-checkout' }, selected: 'epic-checkout', view: 'cards' }, safety: { scope: { type: 'node', id: 'g-safe-operation' } } } }));
    window.history.replaceState(null, '', '#graph=safety&scope=g-safe-operation&node=g-safe-operation');
    renderWorkspace();
    expect(useAppStore.getState().active).toBe('safety');
    expect(chip()).toContain('Safe operation');
    expect(graphState('safety').selected).toBe('g-safe-operation');
    await switchTo(PRODUCT);
    // The state of the other graph stays as it was stored.
    expect(graphState().view).toBe('cards');
  });

  it('wins over a stored scope and selection of the same graph', async () => {
    store.set(storageKey(twoGraphs()), JSON.stringify({ version: STORE_VERSION, active: 'product', graphs: { product: { scope: { type: 'node', id: 'epic-checkout' }, selected: 'epic-checkout', view: 'table' } } }));
    window.history.replaceState(null, '', '#graph=product&scope=story-save-card&node=story-save-card');
    renderWorkspace();
    expect(graphState().scope).toEqual({ type: 'node', id: 'story-save-card' });
    expect(graphState().selected).toBe('story-save-card');
    expect(graphState().view).toBe('table');
    expect(window.location.hash).toBe('#graph=product&scope=story-save-card&node=story-save-card');
  });

  it('shows a node as the scope when the hash names a node only', () => {
    window.history.replaceState(null, '', '#node=story-save-card');
    renderWorkspace();
    expect(graphState().scope).toEqual({ type: 'node', id: 'story-save-card' });
    expect(graphState().selected).toBe('story-save-card');
  });

  it('follows a change of the hash on the open page', async () => {
    renderWorkspace();
    window.history.replaceState(null, '', '#graph=safety&scope=g-safe-operation');
    act(() => void window.dispatchEvent(new HashChangeEvent('hashchange')));
    await waitFor(() => expect(useAppStore.getState().active).toBe('safety'));
    expect(graphState('safety').scope).toEqual({ type: 'node', id: 'g-safe-operation' });
  });

  it('opens the tree to the node of the hash', () => {
    window.history.replaceState(null, '', '#node=story-pay-by-card-3ds');
    renderWorkspace();
    expect(document.querySelector('[data-testid="tree-panel"] [data-node="story-pay-by-card-3ds"]')).not.toBeNull();
  });
});

describe('req-state-link: unknown', () => {
  it('ignores an unknown graph, scope and node and loads the rest of the state', async () => {
    store.set(storageKey(twoGraphs()), JSON.stringify({ version: STORE_VERSION, active: 'product', graphs: { product: { scope: { type: 'node', id: 'epic-checkout' }, view: 'cards' } } }));
    window.history.replaceState(null, '', '#graph=nope&scope=nope&node=nope');
    renderWorkspace();
    expect(useAppStore.getState().active).toBe('product');
    expect(graphState().scope).toEqual({ type: 'node', id: 'epic-checkout' });
    expect(graphState().selected).toBeNull();
    expect(graphState().view).toBe('cards');
    expect(window.location.hash).toBe('#graph=product&scope=epic-checkout');
  });

  it('ignores a node of another graph', () => {
    window.history.replaceState(null, '', '#graph=product&node=g-safe-operation');
    renderWorkspace();
    expect(graphState().selected).toBeNull();
    expect(graphState().scope).toBeNull();
  });

  it('ignores a broken hash', () => {
    window.history.replaceState(null, '', '#%E0%A4%A&&=&graph');
    renderWorkspace();
    expect(useAppStore.getState().active).toBe('product');
  });
});

describe('the Reset the view item', () => {
  it('clears the stored state of the workspace and starts fresh, and keeps the theme', async () => {
    store.set('semspec-theme', 'dark');
    renderWorkspace();
    await pickInTree('epic-checkout');
    patchGraph('product', { widths: { title: 400 } });
    await switchTo(SAFETY);
    const user = userEvent.setup();
    screen.getByRole('button', { name: 'Menu' }).focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('menuitem', { name: /Reset the view/ }));
    await settle();
    expect(useAppStore.getState().active).toBe('product');
    expect(graphState().scope).toBeNull();
    expect(graphState().widths).toEqual({});
    expect(graphState('safety').scope).toBeNull();
    expect(screen.getByTestId('welcome')).toBeTruthy();
    expect(storedKey(store)).toBeUndefined();
    expect(store.get('semspec-theme')).toBe('dark');
    expect(window.location.hash).toBe('#graph=product');
    // A later change is stored again.
    await pickInTree('epic-checkout');
    await wait(300);
    expect(storedState(store).graphs.product.scope).toEqual({ type: 'node', id: 'epic-checkout' });
  });

  it('is in the menu of the phone header', async () => {
    renderWorkspace(twoGraphs(), true);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(await screen.findByRole('menuitem', { name: /Reset the view/ })).toBeTruthy();
  });
});
