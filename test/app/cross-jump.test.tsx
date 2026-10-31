// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// DOM tests of the jump along a cross link: the target opens, shows on the canvas and sits in the middle
// of the view. Back returns to the source node and the source viewport.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SIZE } from '@/lib/layout';
import { patchGraph, positionsOf, useAppStore } from '@/lib/store';
import { fixtureModel, installStorage, pickInTree, renderWorkspace, settle, switchTo } from './harness';

const TARGET = 'sg-stop-heater';

function crossWorkspace() {
  const a = fixtureModel('product', (profile, graph) => {
    profile.crossLinks = [{ field: 'ref', graph: 'safety', label: 'Safety' }];
    graph.nodes.find((n: any) => n.id === 'epic-checkout').ref = [TARGET];
  });
  const b = fixtureModel('safety');
  return { title: 'Cross workspace', graphs: [{ id: 'product', label: 'Product', model: a }, { id: 'safety', label: 'Safety', model: b }] };
}

const graphState = (id: string) => useAppStore.getState().graphs[id];
const transform = () => (document.querySelector('.react-flow__viewport') as HTMLElement | null)?.style.transform ?? '';
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

// Follows the cross link of epic-checkout in the details panel.
async function jump() {
  await pickInTree('epic-checkout');
  await userEvent.setup().click(screen.getAllByTitle(TARGET)[0]);
  await wait(700);
}

// The translate and the zoom that put the centre of a node in the middle of the 800 x 600 view.
function centred(graph: string, id: string) {
  const pos = positionsOf(graph).current.graph.map.get(id)!;
  const m = /translate\((-?[\d.e-]+)px,\s*(-?[\d.e-]+)px\) scale\(([\d.e-]+)\)/.exec(transform())!;
  const [x, y, zoom] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return { zoom, dx: x + (pos.x + SIZE.graph.w / 2) * zoom - 400, dy: y + (pos.y + SIZE.graph.h / 2) * zoom - 300 };
}

beforeEach(() => {
  installStorage();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) }) as DOMRect);
});
afterEach(() => vi.restoreAllMocks());

describe('req-cross-link-jump: open', () => {
  it('switches to the target graph, selects the node and opens the tree to it', async () => {
    renderWorkspace(crossWorkspace());
    await jump();
    expect(useAppStore.getState().active).toBe('safety');
    expect(graphState('safety').selected).toBe(TARGET);
    expect(document.querySelector(`[data-testid="tree-panel"] [data-node="${TARGET}"]`)).not.toBeNull();
  });
});

describe('req-cross-link-jump: visible', () => {
  it('sets the node as the scope when the canvas does not hold it', async () => {
    renderWorkspace(crossWorkspace());
    patchGraph('safety', { scope: { type: 'node', id: 'mit-watchdog' }, depth: 0 });
    await jump();
    expect(graphState('safety').scope).toEqual({ type: 'node', id: TARGET });
    expect(document.querySelector(`.react-flow__node[data-id="${TARGET}"]`)).not.toBeNull();
  });

  it('keeps the scope when the canvas holds the node', async () => {
    renderWorkspace(crossWorkspace());
    patchGraph('safety', { scope: { type: 'node', id: 'g-safe-operation' } });
    await jump();
    expect(graphState('safety').scope).toEqual({ type: 'node', id: 'g-safe-operation' });
    expect(document.querySelector(`.react-flow__node[data-id="${TARGET}"]`)).not.toBeNull();
  });
});

describe('req-cross-link-jump: center', () => {
  it('centers the node at a zoom of at least 1 when the graph has no stored viewport', async () => {
    renderWorkspace(crossWorkspace());
    await jump();
    const c = centred('safety', TARGET);
    expect(c.zoom).toBeGreaterThanOrEqual(1);
    expect(Math.abs(c.dx)).toBeLessThan(1);
    expect(Math.abs(c.dy)).toBeLessThan(1);
    expect(graphState('safety').viewport.graph!.zoom).toBe(c.zoom);
  });

  it('centers the node in place of the stored viewport of a node on the canvas', async () => {
    renderWorkspace(crossWorkspace());
    patchGraph('safety', { scope: { type: 'node', id: 'g-safe-operation' }, viewport: { graph: { x: 37, y: 53, zoom: 0.8 } } });
    await jump();
    expect(transform()).not.toContain('translate(37px,53px)');
    const c = centred('safety', TARGET);
    expect(c.zoom).toBeGreaterThanOrEqual(1);
    expect(Math.abs(c.dx)).toBeLessThan(1);
    expect(Math.abs(c.dy)).toBeLessThan(1);
  });

  it('keeps a zoom above 1', async () => {
    renderWorkspace(crossWorkspace());
    patchGraph('safety', { scope: { type: 'node', id: 'g-safe-operation' }, viewport: { graph: { x: 37, y: 53, zoom: 1.4 } } });
    await jump();
    expect(centred('safety', TARGET).zoom).toBeCloseTo(1.4, 5);
  });

  it('still restores the stored viewport after a switch with a tab', async () => {
    renderWorkspace(crossWorkspace());
    await jump();
    patchGraph('product', { viewport: { graph: { x: 37, y: 53, zoom: 0.8 } } });
    await switchTo('Product');
    await switchTo('Safety');
    await settle();
    const stored = graphState('safety').viewport.graph!;
    expect(transform()).toBe(`translate(${stored.x}px,${stored.y}px) scale(${stored.zoom})`);
    await switchTo('Product');
    await settle();
    expect(transform()).toContain('translate(37px,53px) scale(0.8)');
  });
});

describe('req-cross-link-jump: back', () => {
  it('returns to the source graph with the source node selected and the source viewport', async () => {
    renderWorkspace(crossWorkspace());
    await pickInTree('epic-checkout');
    await wait(300);
    patchGraph('product', { viewport: { graph: { x: 37, y: 53, zoom: 0.8 } } });
    await userEvent.setup().click(screen.getAllByTitle(TARGET)[0]);
    await wait(700);
    expect(useAppStore.getState().active).toBe('safety');
    await userEvent.setup().click(screen.getByRole('button', { name: /Back/ }));
    await wait(700);
    expect(useAppStore.getState().active).toBe('product');
    expect(graphState('product').selected).toBe('epic-checkout');
    expect(graphState('product').viewport.graph).toEqual({ x: 37, y: 53, zoom: 0.8 });
    expect(transform()).toContain('translate(37px,53px) scale(0.8)');
  });
});
