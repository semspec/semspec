// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// DOM tests of the links in a tagged list of the details panel: the address of a line is an outside link,
// and a text that is the id of a node of the workspace is a link that selects the node.
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '@/lib/store';
import { fixtureModel, installStorage, pickInTree, renderWorkspace, wait } from './harness';

const OTHER = 'sg-stop-heater';
const SAME = 'story-pay-by-card';
const ENTRY = { std: { type: 'Entry', url: 'https://example.org/entry' } };

function workspace() {
  const a = fixtureModel('product', (profile, graph) => {
    profile.details.taggedLists = [{ title: 'Basis', field: 'basis', linkKey: 'url', labels: { 'specialises.std': 'Narrows STD', 'std.type': 'Kind', obligation: 'Obligation' } }];
    graph.nodes.find((n: any) => n.id === 'epic-checkout').basis = [
      { specialises: { std: { type: 'Device', url: 'https://example.org/x.yaml#L1' } } },
      { obligation: OTHER },
      { obligation: SAME },
      { obligation: 'no-such-node' },
      ENTRY,
    ];
  });
  const b = fixtureModel('safety');
  return { title: 'Tagged workspace', graphs: [{ id: 'product', label: 'Product', model: a }, { id: 'safety', label: 'Safety', model: b }] };
}

const panel = () => screen.getByTestId('details-panel');

beforeEach(() => installStorage());

describe('req-tagged-lists: link-key', () => {
  it('shows the line of an entry as an outside link and shows no line for the link key', async () => {
    renderWorkspace(workspace());
    await pickInTree('epic-checkout');
    const a = within(panel()).getByRole('link', { name: 'Kind: Entry' });
    expect(a.getAttribute('href')).toBe('https://example.org/entry');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(panel().textContent).not.toContain('std url');
  });
});

describe('req-tagged-lists: nested', () => {
  it('shows a nested tag as 1 outside link', async () => {
    renderWorkspace(workspace());
    await pickInTree('epic-checkout');
    const a = within(panel()).getByRole('link', { name: 'Narrows STD Device' });
    expect(a.getAttribute('href')).toBe('https://example.org/x.yaml#L1');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('req-tagged-lists: string-value', () => {
  it('shows the text as is when no node of the workspace has it as its id', async () => {
    renderWorkspace(workspace());
    await pickInTree('epic-checkout');
    expect(within(panel()).getByText('Obligation: no-such-node')).toBeTruthy();
  });

  it('shows the title of a node of another graph and jumps to the node', async () => {
    renderWorkspace(workspace());
    await pickInTree('epic-checkout');
    await userEvent.setup().click(within(panel()).getAllByTitle(OTHER)[0]);
    await wait(700);
    expect(useAppStore.getState().active).toBe('safety');
    expect(useAppStore.getState().graphs.safety.selected).toBe(OTHER);
  });

  it('selects a node of the same graph', async () => {
    renderWorkspace(workspace());
    await pickInTree('epic-checkout');
    await userEvent.setup().click(within(panel()).getAllByTitle(SAME)[0]);
    await wait(300);
    expect(useAppStore.getState().active).toBe('product');
    expect(useAppStore.getState().graphs.product.selected).toBe(SAME);
  });
});
