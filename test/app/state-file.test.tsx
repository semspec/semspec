// @vitest-environment jsdom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// DOM test of a page that opens from a file. The address is a file: URL. The test installs its
// storage first and then moves the page to a file: address, because jsdom refuses its own
// storage for a file: origin.
import { describe, expect, it } from 'vitest';
import { installStorage, pickInTree, renderWorkspace, storedState, twoGraphs } from './harness';
import { useAppStore } from '@/lib/store';

declare const jsdom: { reconfigure(options: { url: string }): void };

// Installs the test storage, then moves the page to the file: address.
function onFile(): Map<string, string> {
  const store = installStorage();
  jsdom.reconfigure({ url: 'file:///tmp/semspec/page.html' });
  return store;
}

describe('req-state-storage: file-page', () => {
  it('keeps the state of a page that opens from a file, in a browser that allows storage for files', async () => {
    const store = onFile();
    expect(window.location.protocol).toBe('file:');
    const first = renderWorkspace();
    await pickInTree('epic-checkout');
    first.unmount();
    expect(storedState(store).graphs.product.scope).toEqual({ type: 'node', id: 'epic-checkout' });
    useAppStore.setState({ active: '', graphs: {} });
    renderWorkspace();
    expect(useAppStore.getState().graphs.product.scope).toEqual({ type: 'node', id: 'epic-checkout' });
  });

  it('writes and reads the hash on a file: address', async () => {
    onFile();
    const first = renderWorkspace();
    await pickInTree('epic-checkout');
    expect(window.location.href).toBe('file:///tmp/semspec/page.html#graph=product&scope=epic-checkout&node=epic-checkout');
    first.unmount();
    window.location.hash = '#graph=safety&scope=g-safe-operation';
    renderWorkspace(twoGraphs());
    expect(useAppStore.getState().active).toBe('safety');
    expect(useAppStore.getState().graphs.safety.scope).toEqual({ type: 'node', id: 'g-safe-operation' });
  });
});
