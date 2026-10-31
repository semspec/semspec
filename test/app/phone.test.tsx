// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// DOM tests of the phone layout. A mock of matchMedia sets the breakpoint. jsdom computes no CSS,
// so a test of a style reads the classes of the component.
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { flowNode, pickInTree, renderApp, settle } from './harness';

const treeSheet = () => screen.queryByTestId('tree-sheet');
const detailsSheet = () => screen.queryByTestId('details-sheet');

// Starts the app on a phone with a scope, so the canvas and the table have nodes.
async function phoneWithScope() {
  renderApp('product', { phone: true });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Open the tree' }));
  await pickInTree('epic-checkout');
  await waitFor(() => expect(treeSheet()).toBeNull());
  await settle();
  return user;
}

describe('the sheets on a phone', () => {
  it('opens the tree in a sheet with a toolbar button', async () => {
    renderApp('product', { phone: true });
    expect(screen.getByTestId('phone-header')).toBeTruthy();
    expect(screen.queryByTestId('tree-panel')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open the tree' }));
    const sheet = await screen.findByTestId('tree-sheet');
    expect(within(sheet).getByTestId('tree-panel')).toBeTruthy();
  });

  it('opens the details panel in a sheet with a toolbar button', async () => {
    renderApp('product', { phone: true });
    expect(detailsSheet()).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open the details' }));
    const sheet = await screen.findByTestId('details-sheet');
    expect(within(sheet).getByText('Nothing selected')).toBeTruthy();
  });

  it('opens the details sheet when a node is picked', async () => {
    await phoneWithScope();
    expect(detailsSheet()).toBeNull();
    fireEvent.click(flowNode('story-pay-by-card'));
    const sheet = await screen.findByTestId('details-sheet');
    expect(sheet.textContent).toContain('story-pay-by-card');
  });

  it('closes a sheet with its close button', async () => {
    renderApp('product', { phone: true });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open the tree' }));
    const sheet = await screen.findByTestId('tree-sheet');
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(treeSheet()).toBeNull());
  });

  it('closes a sheet with the Escape key', async () => {
    renderApp('product', { phone: true });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open the details' }));
    await screen.findByTestId('details-sheet');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(detailsSheet()).toBeNull());
  });

  it('closes a sheet with a tap outside it', async () => {
    renderApp('product', { phone: true });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open the tree' }));
    await screen.findByTestId('tree-sheet');
    const overlay = document.querySelector('[data-slot="sheet-overlay"]') as HTMLElement;
    expect(overlay).toBeTruthy();
    await user.click(overlay);
    await waitFor(() => expect(treeSheet()).toBeNull());
  });

  it('closes an open sheet when the viewport grows to the desktop layout', async () => {
    const { setPhone } = await import('./setup');
    renderApp('product', { phone: true });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open the tree' }));
    await screen.findByTestId('tree-sheet');
    const { act } = await import('@testing-library/react');
    act(() => setPhone(false));
    await waitFor(() => expect(treeSheet()).toBeNull());
    expect(screen.queryByTestId('phone-header')).toBeNull();
  });
});

describe('the layout from 768 px', () => {
  it('keeps the tree and the details panel in their side panels and shows no sheet button', async () => {
    renderApp('product', { phone: false });
    expect(screen.queryByTestId('phone-header')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open the tree' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open the details' })).toBeNull();
    expect(screen.getByTestId('tree-panel')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Side panels' })).toBeTruthy();
    expect(screen.getByText('Nothing selected')).toBeTruthy();
    expect(treeSheet()).toBeNull();
    expect(detailsSheet()).toBeNull();
  });
});

describe('the toolbar, the filters and the tabs on a phone', () => {
  it('keeps each control of the header reachable', async () => {
    renderApp('product', { phone: true });
    const header = screen.getByTestId('phone-header');
    ['Open the tree', 'Open the details', 'Menu'].forEach((name) => {
      const button = within(header).getByRole('button', { name });
      expect(button.className, name).toMatch(/\bsize-10\b/);
    });
    // The graph switch, the status colour and the theme are in the menu.
    await userEvent.setup().click(within(header).getByRole('button', { name: 'Menu' }));
    expect(await screen.findByText(/Colour by result/)).toBeTruthy();
    expect(screen.getByText('Theme')).toBeTruthy();
  });

  it('gives the view tabs a row of their own', async () => {
    renderApp('product', { phone: true });
    const tabs = within(screen.getByTestId('phone-header')).getByRole('tablist', { name: 'View' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Graph', 'Cards', 'Table']);
    expect(tabs.className).toMatch(/\bw-full\b/);
  });

  it('wraps the filters and scrolls the facets in a row of their own', async () => {
    renderApp('product', { phone: true });
    const bar = screen.getByTestId('filter-bar');
    expect(bar.firstElementChild!.className).toMatch(/\bflex-wrap\b/);
    const facets = screen.getByRole('button', { name: 'Filter by kind' }).parentElement!;
    expect(facets.className).toMatch(/max-md:overflow-x-auto/);
    expect(facets.className).toMatch(/max-md:w-full/);
  });

  it('wraps the tools of the canvas and hides the mini map and the legend', async () => {
    await phoneWithScope();
    expect(document.querySelector('.react-flow__minimap')).toBeNull();
    const tool = screen.getByRole('button', { name: 'Re-layout the canvas' });
    expect(tool.className).toMatch(/max-md:size-10/);
    expect(tool.closest('.react-flow__panel')!.className).toMatch(/max-md:flex-wrap/);
    expect(screen.getByText('Scenario', { selector: 'span' }).closest('div')!.className).toMatch(/max-md:hidden/);
  });

  it('shows the mini map on the desktop layout', async () => {
    renderApp('product', { phone: false });
    await pickInTree('epic-checkout');
    await settle();
    expect(document.querySelector('.react-flow__minimap')).toBeTruthy();
  });

  it('scrolls the Table in its own box and keeps the page from scrolling', async () => {
    const user = await phoneWithScope();
    await user.click(screen.getByRole('tab', { name: 'Table' }));
    const view = screen.getByTestId('table-view');
    const box = within(view).getByRole('table').parentElement!;
    expect(box.className).toMatch(/\boverflow-auto\b/);
    expect(box.className).toMatch(/\bmin-h-0\b/);
    // The table is wider than the box, and the root of the page clips what is left.
    expect(Number.parseInt(within(view).getByRole('table').style.minWidth)).toBeGreaterThan(375);
    expect(screen.getByTestId('phone-header').parentElement!.className).toMatch(/\boverflow-hidden\b/);
  });
});
