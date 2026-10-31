// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// DOM tests that a selection, a scope or a graph that the reader sets stays set. A page that writes the hash
// with location.replace gets a hashchange event for each write. The event can arrive about 1 second late.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { patchGraph, useAppStore } from '@/lib/store';
import { fixtureModel, flowNode, installStorage, pickInTree, renderWorkspace, settle } from './harness';

// The product graph points at a node of the safety graph.
function crossWorkspace() {
  const a = fixtureModel('product', (profile, graph) => {
    profile.crossLinks = [{ field: 'ref', graph: 'safety', label: 'Safety' }];
    graph.nodes.find((n: any) => n.id === 'epic-checkout').ref = ['sg-stop-heater'];
  });
  const b = fixtureModel('safety');
  return { title: 'Cross workspace', graphs: [{ id: 'product', label: 'Product', model: a }, { id: 'safety', label: 'Safety', model: b }] };
}

const state = () => useAppStore.getState();
const selectedIn = (graph: string) => state().graphs[graph].selected;
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

let realReplace: History['replaceState'];

// Delivers a hashchange event that carries an older hash, as a slow browser does. The address shows the
// older hash while the event runs, then it shows the current hash again.
function lateEvent(older: string) {
  const current = window.location.hash;
  realReplace.call(window.history, null, '', window.location.pathname + older);
  act(() => void window.dispatchEvent(new HashChangeEvent('hashchange')));
  realReplace.call(window.history, null, '', window.location.pathname + current);
}

beforeEach(() => {
  installStorage();
  realReplace = window.history.replaceState;
  // The browser refuses replaceState. The page writes the hash with location.replace.
  vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
    throw new Error('refused');
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) }) as DOMRect);
});
afterEach(() => vi.restoreAllMocks());

describe('req-state-link: no-revert', () => {
  it('keeps the node of a cross link when an older hash event arrives later', async () => {
    renderWorkspace(crossWorkspace());
    // The safety graph holds an earlier selection. The first hash write of the jump names it.
    patchGraph('safety', { scope: { type: 'node', id: 'g-safe-operation' }, selected: 'g-safe-operation' });
    await pickInTree('epic-checkout');
    await userEvent.setup().click(screen.getAllByTitle('sg-stop-heater')[0]);
    await settle();
    expect(state().active).toBe('safety');
    expect(selectedIn('safety')).toBe('sg-stop-heater');
    await wait(1000);
    lateEvent('#graph=safety&scope=g-safe-operation&node=g-safe-operation');
    await wait(1000);
    expect(state().active).toBe('safety');
    expect(selectedIn('safety')).toBe('sg-stop-heater');
    expect(window.location.hash).toBe('#graph=safety&scope=g-safe-operation&node=sg-stop-heater');
  });

  it('keeps the last of several selections when older hash events arrive later', async () => {
    renderWorkspace(crossWorkspace());
    await pickInTree('epic-checkout');
    const user = userEvent.setup();
    const hashes: string[] = [];
    for (const id of ['story-pay-by-card', 'story-save-card', 'epic-checkout', 'story-pay-by-card']) {
      await user.click(flowNode(id));
      hashes.push(window.location.hash);
    }
    expect(selectedIn('product')).toBe('story-pay-by-card');
    await wait(1000);
    for (const older of hashes.slice(0, -1)) lateEvent(older);
    await wait(1000);
    expect(selectedIn('product')).toBe('story-pay-by-card');
    expect(window.location.hash).toBe(hashes[3]);
  });

  it('still follows a hash that the page did not write', async () => {
    renderWorkspace(crossWorkspace());
    await pickInTree('epic-checkout');
    await wait(1000);
    realReplace.call(window.history, null, '', window.location.pathname + '#graph=safety&scope=g-safe-operation');
    act(() => void window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect(state().active).toBe('safety');
    expect(selectedIn('safety')).toBe('g-safe-operation');
  });
});
