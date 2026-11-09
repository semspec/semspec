// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// DOM tests of the views of a workspace: the menu, the default views, the filters, the state of each view,
// the link in the hash and the jump along a cross link.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkspaceData } from '@semspec/core';
import { useAppStore } from '@/lib/store';
import { fixtureModel, installStorage, pickInTree, renderApp, renderWorkspace, settle, switchTo, twoGraphs, wait } from './harness';

beforeEach(() => {
  installStorage();
  window.history.replaceState(null, '', window.location.pathname);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) }) as DOMRect);
});
afterEach(() => vi.restoreAllMocks());

const graphState = (id: string) => useAppStore.getState().graphs[id];

// 2 views of the product graph, with a profile that nests by the parents rule in the second, and the safety graph.
function viewsData(): WorkspaceData {
  const product = fixtureModel('product');
  const safety = fixtureModel('safety');
  const nested = fixtureModel('product', (profile) => {
    profile.layout = { default: 'grouped', groupBy: 'parents' };
  });
  return {
    title: 'Views workspace',
    graphs: [
      { id: 'req', label: 'Product', model: product },
      { id: 'safe', label: 'Safety', model: safety },
    ],
    views: [
      { id: 'req', label: 'Product', graph: 'req' },
      { id: 'epics', label: 'Epic groups', graph: 'req', model: nested, filters: { kinds: ['epic'] } },
      { id: 'safe', label: 'Safety', graph: 'safe' },
    ],
  };
}

// Opens the menu of the views with the keyboard and returns the names of its items.
async function menuItems(): Promise<string[]> {
  const user = userEvent.setup();
  screen.getByRole('button', { name: 'Views' }).focus();
  await user.keyboard('{Enter}');
  return (await screen.findAllByRole('menuitemradio')).map((i) => i.textContent ?? '');
}

describe('req-workspace-views: list', () => {
  it('shows a menu of the views in the order of the list', async () => {
    renderWorkspace(viewsData());
    expect(await menuItems()).toEqual(['Product', 'Epic groups', 'Safety']);
  });

  it('switches the view with the menu and shows its label in the header', async () => {
    renderWorkspace(viewsData());
    await switchTo('Epic groups');
    expect(useAppStore.getState().active).toBe('epics');
    expect(screen.getByRole('button', { name: 'Views' }).textContent).toContain('Epic groups');
  });
});

describe('req-workspace-views: default-views', () => {
  it('shows the menu of a workspace with no views with 1 item for each graph', async () => {
    const data = twoGraphs();
    renderWorkspace(data);
    expect(await menuItems()).toEqual(data.graphs.map((g) => g.label));
  });

  it('shows no menu when the workspace has 1 view', () => {
    renderApp('product');
    expect(screen.queryByRole('button', { name: 'Views' })).toBeNull();
  });
});

describe('req-workspace-views: layout', () => {
  it('enables the grouped layout and nests by the parents rule when the profile has groupBy and no groupEdge', async () => {
    const data = viewsData();
    // The default filters of the view would hide the stories.
    data.views![1] = { ...data.views![1], filters: undefined };
    renderWorkspace(data);
    await switchTo('Epic groups');
    await pickInTree('epic-checkout');
    await settle();
    expect(screen.getByLabelText('Grouped layout').hasAttribute('disabled')).toBe(false);
    expect(document.querySelector('.react-flow__node-container[data-id="epic-checkout"]')).not.toBeNull();
    expect(document.querySelector('.react-flow__node[data-id="story-pay-by-card"]')).not.toBeNull();
  });
});

describe('req-workspace-views: filters', () => {
  it('applies the default filters of a view when a person opens it first, and keeps a change', async () => {
    renderWorkspace(viewsData());
    expect(graphState('epics').filters.kinds).toEqual(['epic']);
    expect(graphState('req').filters.kinds).toEqual([]);
    await switchTo('Epic groups');
    useAppStore.setState((s) => ({ graphs: { ...s.graphs, epics: { ...s.graphs.epics, filters: { ...s.graphs.epics.filters, kinds: [] } } } }));
    await switchTo('Product');
    await switchTo('Epic groups');
    expect(graphState('epics').filters.kinds).toEqual([]);
  });
});

describe('req-workspace-views: identity', () => {
  it('keeps the state of each view of 1 graph', async () => {
    renderWorkspace(viewsData());
    await pickInTree('epic-checkout');
    expect(graphState('req').scope).toEqual({ type: 'node', id: 'epic-checkout' });
    await switchTo('Epic groups');
    expect(graphState('epics').scope).toBeNull();
    await switchTo('Product');
    expect(graphState('req').scope).toEqual({ type: 'node', id: 'epic-checkout' });
  });

  it('writes the id of the view into the hash and keeps the hash of a view with the id of its graph', async () => {
    renderWorkspace(viewsData());
    expect(window.location.hash).toBe('#graph=req');
    await switchTo('Epic groups');
    expect(window.location.hash).toBe('#graph=epics');
  });

  it('opens a hash that names a graph in the first view of the graph', () => {
    window.history.replaceState(null, '', '#graph=req&scope=epic-checkout');
    const data = viewsData();
    // No view has the id of the graph. The first view of the graph opens.
    data.views = [data.views![1], { ...data.views![0], id: 'req-main' }, data.views![2]];
    renderWorkspace(data);
    expect(useAppStore.getState().active).toBe('epics');
    expect(graphState('epics').scope).toEqual({ type: 'node', id: 'epic-checkout' });
  });

  it('opens a cross link in the first view of the target graph', async () => {
    const product = fixtureModel('product', (profile, graph) => {
      profile.crossLinks = [{ field: 'ref', graph: 'safe', label: 'Safety' }];
      graph.nodes.find((n: any) => n.id === 'epic-checkout').ref = ['sg-stop-heater'];
    });
    const data = viewsData();
    data.graphs[0] = { ...data.graphs[0], model: product };
    data.views = [
      { id: 'req', label: 'Product', graph: 'req' },
      { id: 'safe-first', label: 'Safety first', graph: 'safe' },
      { id: 'safe', label: 'Safety', graph: 'safe' },
    ];
    renderWorkspace(data);
    await pickInTree('epic-checkout');
    await userEvent.setup().click(screen.getAllByTitle('sg-stop-heater')[0]);
    await wait(700);
    expect(useAppStore.getState().active).toBe('safe-first');
    expect(graphState('safe-first').selected).toBe('sg-stop-heater');
  });
});
