// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// DOM tests of the Graph view: the layout, the fit and the status colour. jsdom has no layout, so the tests fix the size of the canvas.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { flowNode, pickInTree, renderApp, settle } from './harness';

// The canvas is 800 px wide and 600 px high.
const VIEW = { width: 800, height: 600 };
const rectOf = () => ({ x: 0, y: 0, left: 0, top: 0, right: VIEW.width, bottom: VIEW.height, ...VIEW, toJSON: () => ({}) }) as DOMRect;

afterEach(() => vi.restoreAllMocks());

const translate = (el: HTMLElement) => {
  const m = el.style.transform.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/)!;
  return { x: Number(m[1]), y: Number(m[2]) };
};

// The layered layout: the profile of this test names no layout.
const layered = (profile: any) => {
  delete profile.layout;
};

describe('the layout of the Graph view', () => {
  it('puts the root of the scope left of the nodes below it', async () => {
    renderApp('product', { edit: layered });
    await pickInTree('epic-checkout');
    await settle();
    // A node that governs the root, as a decision does, may sit left of it. The nodes below it never do.
    const below = ['story-pay-by-card', 'story-save-card', 'story-pay-by-card-3ds', 'story-pay-by-card#declined', 'story-pay-by-card#charged'];
    const root = translate(flowNode('epic-checkout')).x;
    below.forEach((id) => expect(root, id).toBeLessThan(translate(flowNode(id)).x));
  });

  it('puts the root of the scope at the left edge when no node comes before it', async () => {
    renderApp('safety', { edit: layered });
    await pickInTree('g-safe-operation');
    await settle();
    const ids = [...document.querySelectorAll('.react-flow__node')].map((n) => n.getAttribute('data-id')!);
    expect(ids.length).toBeGreaterThan(3);
    const root = translate(flowNode('g-safe-operation')).x;
    ids.filter((id) => id !== 'g-safe-operation').forEach((id) => expect(root, id).toBeLessThan(translate(flowNode(id)).x));
  });

  it('fits the canvas to the layout', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(rectOf);
    renderApp('product', { edit: layered });
    await pickInTree('epic-checkout');
    await settle();
    await waitFor(() => expect(document.querySelector('.react-flow__viewport')!.getAttribute('style')).toMatch(/scale\(/));
    const [, vx, vy, zoom] = document.querySelector('.react-flow__viewport')!.getAttribute('style')!.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\) scale\(([\d.]+)\)/)!.map(Number);
    expect(zoom).toBeGreaterThan(0);
    expect(zoom).toBeLessThanOrEqual(1);
    // Each node starts inside the canvas, and the first node of the layout is on the screen.
    const xs = [...document.querySelectorAll('.react-flow__node')].map((n) => translate(n as HTMLElement));
    const left = Math.min(...xs.map((p) => p.x)) * zoom + vx;
    const top = Math.min(...xs.map((p) => p.y)) * zoom + vy;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThan(VIEW.width);
    expect(top).toBeLessThan(VIEW.height);
  });
});

describe('the status colour of the Graph view', () => {
  const border = (id: string) => (flowNode(id).firstElementChild as HTMLElement).style.borderColor;

  it('colours each node by its status tone when the toggle is on, and by its kind when it is off', async () => {
    renderApp('product');
    await pickInTree('epic-checkout');
    await settle();
    expect(border('story-pay-by-card#declined')).toContain('--kind-scenario');
    const toggle = screen.getByRole('button', { name: 'Colour the nodes by result' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await userEvent.setup().click(toggle);
    await settle();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    // The result of the scenario "declined" is pass, of "charged" is fail.
    expect(border('story-pay-by-card#declined')).toBe('var(--good)');
    expect(border('story-pay-by-card#charged')).toBe('var(--destructive)');
    expect(border('story-pay-by-card#declined')).not.toBe(border('story-pay-by-card#charged'));
    await userEvent.setup().click(toggle);
    await settle();
    expect(border('story-pay-by-card#declined')).toContain('--kind-scenario');
  });

  it('takes the tones of the profile of another fixture', async () => {
    renderApp('safety');
    await pickInTree('g-safe-operation');
    await settle();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Colour the nodes by assurance' }));
    await settle();
    const tones = [...document.querySelectorAll('.react-flow__node')].map((n) => (n.firstElementChild as HTMLElement).style.borderColor);
    expect(tones.every((t) => /^var\(--(good|warn|destructive|muted-foreground)\)$/.test(t))).toBe(true);
    expect(new Set(tones).size).toBeGreaterThan(1);
  });
});
