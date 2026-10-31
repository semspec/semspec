// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// DOM tests of the indent of the tree under a sub-heading.
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness';

const tree = () => within(screen.getByTestId('tree-panel'));
const row = (id: string) => document.querySelector(`[data-testid="tree-panel"] [data-node="${id}"]`) as HTMLElement;
const depth = (id: string) => Number(row(id).dataset.depth);
const guides = (id: string) => row(id).querySelectorAll('span.border-l').length;

// The epic becomes a second root kind, so the tree shows a sub-heading per root kind.
const twoRoots = (profile: any) => {
  delete profile.kinds.find((k: any) => k.id === 'epic').parents;
};

describe('the indent of the tree', () => {
  it('puts a root under a sub-heading 1 level below it, and its child 1 level further', async () => {
    renderApp('product', { edit: twoRoots });
    const user = userEvent.setup();
    const headings = tree().getAllByRole('button', { expanded: true }).map((b) => b.textContent);
    expect(headings.some((t) => t?.startsWith('Epics'))).toBe(true);
    expect(headings.some((t) => t?.startsWith('Products'))).toBe(true);
    expect(depth('prd-shop')).toBe(2);
    expect(depth('epic-checkout')).toBe(2);
    expect(guides('epic-checkout')).toBe(2);
    await user.click(within(row('epic-checkout')).getByRole('button', { name: 'Expand Checkout' }));
    const child = document.querySelector('[data-testid="tree-panel"] [data-node][data-depth="3"]') as HTMLElement;
    expect(child).toBeTruthy();
    expect(child.querySelectorAll('span.border-l').length).toBe(3);
  });

  it('keeps the depth of the roots and the lines after a search filter', async () => {
    renderApp('product', { edit: twoRoots });
    await userEvent.setup().type(screen.getByLabelText('Find in the tree'), 'checkout');
    expect(depth('epic-checkout')).toBe(2);
  });

  it('keeps depth 0 for the roots of a tree with 1 root kind', () => {
    renderApp('product');
    expect(depth('prd-shop')).toBe(0);
    expect(guides('prd-shop')).toBe(0);
  });
});
