// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// DOM tests of the live page (req-serve-live) and of the Source section (req-node-source).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { isLivePage, resetLiveError, startLive } from '@/lib/live';
import { setSourceHost } from '@/lib/source';
import { patchGraph, useAppStore } from '@/lib/store';
import { installStorage, pickInTree, renderWorkspace, settle, wait, workspaceOf } from './harness';

beforeEach(() => {
  installStorage();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) }) as DOMRect);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setSourceHost({ live: false });
  resetLiveError();
  document.head.querySelectorAll('meta[name="semspec-live"]').forEach((m) => m.remove());
  try {
    window.sessionStorage.clear();
  } catch {
    // No session storage in this runtime.
  }
});

// A stand-in for EventSource. `emit` sends an event to the listeners.
class FakeSource {
  listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  addEventListener(name: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  emit(name: string, data: unknown) {
    this.listeners.get(name)?.forEach((fn) => fn({ data: JSON.stringify(data) } as MessageEvent));
  }
}

const markLive = () => {
  const meta = document.createElement('meta');
  meta.name = 'semspec-live';
  meta.content = '1';
  document.head.append(meta);
};

const PRODUCT = 'product';
const graphState = () => useAppStore.getState().graphs[PRODUCT];

describe('req-serve-live: keep-state', () => {
  it('keeps the view, the scope, the selection, the layout and the filters after a reload with changed data', async () => {
    const first = renderWorkspace(workspaceOf(PRODUCT));
    await pickInTree('epic-checkout');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Cards' }));
    patchGraph(PRODUCT, { selected: 'story-save-card', layoutChoice: 'force', depth: 2, filters: { ...graphState().filters, kinds: ['story'] } });
    await settle();
    first.unmount();
    // A reload starts the page again: the memory is empty, the storage and the hash stay. The new data has another title for the scope.
    useAppStore.setState({ active: '', graphs: {} });
    renderWorkspace(
      workspaceOf(PRODUCT, (_p, g) => {
        g.nodes.find((n: { id: string }) => n.id === 'epic-checkout').name = 'Checkout, edited';
      }),
    );
    await settle();
    expect(graphState().scope).toEqual({ type: 'node', id: 'epic-checkout' });
    expect(graphState().selected).toBe('story-save-card');
    expect(graphState().view).toBe('cards');
    expect(graphState().layoutChoice).toBe('force');
    expect(graphState().depth).toBe(2);
    expect(graphState().filters.kinds).toEqual(['story']);
    expect(screen.getByRole('tab', { name: 'Cards' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('scope-chip').textContent).toContain('Checkout, edited');
  });

  it('drops a selected node that no longer exists after a reload', async () => {
    const first = renderWorkspace(workspaceOf(PRODUCT));
    await pickInTree('epic-checkout');
    patchGraph(PRODUCT, { selected: 'story-save-card' });
    await settle();
    first.unmount();
    useAppStore.setState({ active: '', graphs: {} });
    renderWorkspace(
      workspaceOf(PRODUCT, (_p, g) => {
        g.nodes = g.nodes.filter((n: { id: string }) => n.id !== 'story-save-card');
      }),
    );
    await settle();
    expect(graphState().selected).toBeNull();
    expect(graphState().scope).toEqual({ type: 'node', id: 'epic-checkout' });
  });
});

describe('req-serve-live: error', () => {
  it('shows the error with the file and removes it on the next reload event', async () => {
    markLive();
    const source = new FakeSource();
    const reload = vi.fn();
    renderWorkspace(workspaceOf(PRODUCT));
    startLive({ reload, open: () => source as unknown as EventSource });
    expect(screen.queryByTestId('live-error')).toBeNull();
    act(() => source.emit('invalid', { message: 'The graph file "/work/docs/node.yaml" must hold a mapping or a list of mappings.' }));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('/work/docs/node.yaml');
    expect(alert.textContent).toContain('last valid graph');
    // The page keeps working while it shows the error.
    expect(screen.getByTestId('welcome')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
    act(() => source.emit('reload', 1));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('req-serve-live: built-page', () => {
  it('opens no event channel and makes no network request when the page has no live marker', () => {
    const open = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('EventSource', open);
    expect(isLivePage()).toBe(false);
    expect(startLive({ open })).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('opens the event channel of serve when the page has the live marker', () => {
    markLive();
    const open = vi.fn(() => new FakeSource() as unknown as EventSource);
    startLive({ open });
    expect(open).toHaveBeenCalledWith('/events');
  });

  it('asks for no source text on a page that has no live marker and no embedded texts', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const data = workspaceOf(PRODUCT);
    data.graphs[0].model.files = { 'story-save-card': 'docs/save-card.yaml' };
    renderWorkspace(data);
    patchGraph(PRODUCT, { scope: { type: 'node', id: 'epic-checkout' }, selected: 'story-save-card' });
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// The product workspace with a file for 1 node.
function withFiles() {
  const data = workspaceOf(PRODUCT);
  data.graphs[0].model.files = { 'story-save-card': 'docs/save-card.yaml', 'epic-checkout': 'docs/save-card.yaml' };
  return data;
}

async function selectSaveCard() {
  await pickInTree('epic-checkout');
  act(() => patchGraph(PRODUCT, { selected: 'story-save-card' }));
  await settle();
}

describe('req-node-source: section', () => {
  it('shows the path of the file in the Source section of a node that comes from a file', async () => {
    renderWorkspace(withFiles());
    await selectSaveCard();
    const section = screen.getByTestId('source-section');
    expect(within(section).getByText('Source')).toBeTruthy();
    expect(within(section).getByTestId('source-path').textContent).toBe('docs/save-card.yaml');
  });

  it('has no Source section for a node with no file', async () => {
    renderWorkspace(withFiles());
    await pickInTree('epic-checkout');
    act(() => patchGraph(PRODUCT, { selected: 'story-pay-by-card' }));
    await settle();
    expect(screen.queryByTestId('source-section')).toBeNull();
  });

  it('asks serve for the whole text when the section opens, and keeps it open after a reload', async () => {
    setSourceHost({ live: true });
    const text = 'id: story-save-card\nstatement: A buyer saves a card.\n---\nid: other\n';
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, text: async () => text }));
    vi.stubGlobal('fetch', fetchSpy);
    const first = renderWorkspace(withFiles());
    await selectSaveCard();
    // The text is not loaded before the section opens.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('source-text')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show the text' }));
    await wait(10);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toBe('/source?graph=product&node=story-save-card');
    expect(screen.getByTestId('source-text').textContent).toBe(text);
    // A reload shows the section open again.
    first.unmount();
    useAppStore.setState({ active: '', graphs: {} });
    renderWorkspace(withFiles());
    await settle();
    await wait(10);
    expect(screen.getByTestId('source-text').textContent).toBe(text);
  });

  it('shows the error when serve gives no text', async () => {
    setSourceHost({ live: true });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, text: async () => 'Not found' })));
    renderWorkspace(withFiles());
    await selectSaveCard();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show the text' }));
    await wait(10);
    expect(screen.getByTestId('source-section').textContent).toContain('source root');
    expect(screen.queryByTestId('source-text')).toBeNull();
  });
});

describe('req-node-source: on-demand', () => {
  it('shows the embedded text of a built page and no button when the build had no texts', async () => {
    setSourceHost({ live: false, texts: { product: { 'docs/save-card.yaml': 'embedded text\n' } } });
    const first = renderWorkspace(withFiles());
    await selectSaveCard();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show the text' }));
    await wait(10);
    expect(screen.getByTestId('source-text').textContent).toBe('embedded text\n');
    first.unmount();
    setSourceHost({ live: false });
    window.sessionStorage.clear();
    useAppStore.setState({ active: '', graphs: {} });
    renderWorkspace(withFiles());
    await settle();
    expect(screen.getByTestId('source-path').textContent).toBe('docs/save-card.yaml');
    expect(screen.queryByRole('button', { name: 'Show the text' })).toBeNull();
    expect(screen.queryByTestId('source-text')).toBeNull();
  });

  it('shows the path only for a node whose text the page lacks, and not the text of the node before', async () => {
    setSourceHost({ live: false, texts: { product: { 'docs/save-card.yaml': 'embedded text\n' } } });
    const data = withFiles();
    data.graphs[0].model.files!['story-pay-by-card'] = 'docs/pay-by-card.yaml';
    renderWorkspace(data);
    await selectSaveCard();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show the text' }));
    await wait(10);
    expect(screen.getByTestId('source-text').textContent).toBe('embedded text\n');
    act(() => patchGraph(PRODUCT, { selected: 'story-pay-by-card' }));
    await settle();
    await wait(10);
    expect(screen.getByTestId('source-path').textContent).toBe('docs/pay-by-card.yaml');
    expect(screen.queryByTestId('source-text')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show the text' })).toBeNull();
  });
});
