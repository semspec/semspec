// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// DOM tests of the tree, the Table and the details panel. Each test renders the app with a fixture.
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { flowEdge, flowNode, pickInTree, renderApp, settle } from './harness';

const tableHeads = () => within(screen.getByTestId('table-view')).getAllByRole('columnheader').map((h) => h.textContent);
const tableRows = () => within(within(screen.getByTestId('table-view')).getAllByRole('rowgroup')[1]).getAllByRole('row');

describe('the tree', () => {
  async function selectsAsScope(fixture: string, id: string, title: string) {
    renderApp(fixture);
    expect(screen.queryByTestId('scope-chip')).toBeNull();
    await pickInTree(id);
    const chip = screen.getByTestId('scope-chip');
    expect(chip.textContent).toContain('Scope');
    expect(chip.textContent).toContain(title);
    expect(document.querySelector(`[data-testid="tree-panel"] [data-node="${id}"]`)?.textContent).toContain(title);
  }

  it('selects a node of the product fixture as the scope', () => selectsAsScope('product', 'epic-checkout', 'Checkout'));

  it('selects a node of the safety fixture as the scope', () => selectsAsScope('safety', 'g-safe-operation', 'Safe operation'));

  it('removes the scope with the button of the chip', async () => {
    renderApp('product');
    await pickInTree('epic-checkout');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove the scope' }));
    expect(screen.queryByTestId('scope-chip')).toBeNull();
    expect(screen.getByTestId('welcome')).toBeTruthy();
  });
});

describe('the Table', () => {
  it('has a column for each field filter and pins its header', async () => {
    renderApp('product');
    await pickInTree('epic-checkout');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Table' }));
    const heads = tableHeads();
    expect(heads).toEqual(expect.arrayContaining(['Title', 'Kind', 'Id', 'Team', 'Priority', 'Basis']));
    // The header of the field filters comes from the profile, so the other profile has its own column.
    const thead = within(screen.getByTestId('table-view')).getAllByRole('rowgroup')[0];
    expect(thead.className).toMatch(/\bsticky\b/);
    expect(thead.className).toMatch(/\btop-0\b/);
  });

  it('takes the field filter columns of the profile', async () => {
    renderApp('safety');
    await pickInTree('g-safe-operation');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Table' }));
    expect(tableHeads()).toContain('Hardware part');
    expect(tableHeads()).not.toContain('Team');
  });

  it('filters the rows with a column filter', async () => {
    renderApp('product');
    await pickInTree('epic-checkout');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Table' }));
    const before = tableRows().length;
    await user.click(screen.getByRole('button', { name: /Column filters/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter the Title column' }), { target: { value: 'psp' } });
    await waitFor(() => expect(tableRows().length).toBeLessThan(before));
    expect(tableRows().map((r) => r.textContent).join(' ')).toContain('Use an external PSP');
    expect(tableRows().map((r) => r.textContent).join(' ')).not.toContain('Save card');
  });

  it('selects a node with a click on its row', async () => {
    renderApp('product');
    await pickInTree('epic-checkout');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Table' }));
    await user.click(within(screen.getByTestId('table-view')).getByText('Save card'));
    expect(screen.getByTestId('details-panel').textContent).toContain('story-save-card');
  });
});

describe('the details panel', () => {
  const edit = (_: unknown, graph: any) => {
    graph.nodes.find((n: any) => n.id === 'story-pay-by-card').rationale = 'Cards are the main way to pay.';
  };

  it('shows the properties, the text sections, the checks and the citations that the profile names', async () => {
    renderApp('product', { edit });
    await pickInTree('epic-checkout');
    await settle();
    fireEvent.click(flowNode('story-pay-by-card'));
    const story = screen.getByTestId('details-panel');
    // Properties of the profile, with a label.
    expect(story.textContent).toContain('Properties');
    expect(story.textContent).toContain('Release');
    expect(story.textContent).toContain('r1');
    // A text section of the profile.
    expect(story.textContent).toContain('Rationale');
    expect(story.textContent).toContain('Cards are the main way to pay.');
    // The statement under the title of its kind.
    expect(story.textContent).toContain('Summary');
    // The checks of a part.
    fireEvent.click(flowNode('story-pay-by-card#declined'));
    const part = screen.getByTestId('details-panel');
    expect(part.textContent).toContain('Tests');
    expect(part.textContent).toContain('showsDeclineMessage');
    fireEvent.click(flowNode('story-pay-by-card#charged'));
    expect(screen.getByTestId('details-panel').textContent).toContain('No test.');
    // The citation of a kind.
    fireEvent.click(flowNode('std-card-data'));
    const standard = screen.getByTestId('details-panel');
    expect(standard.textContent).toContain('Citation');
    expect(standard.textContent).toContain('https://example.org/standard');
  });

  it('shows no section that the node lacks', async () => {
    renderApp('product');
    await pickInTree('epic-checkout');
    await settle();
    fireEvent.click(flowNode('story-save-card'));
    expect(screen.getByTestId('details-panel').textContent).not.toContain('Rationale');
  });

  it('shows a coded field as its label, its code and its definition', async () => {
    renderApp('product');
    await pickInTree('epic-checkout');
    await settle();
    fireEvent.click(flowNode('story-pay-by-card'));
    const panel = screen.getByTestId('details-panel');
    expect(panel.textContent).toContain('High');
    const code = within(panel).getByText('high');
    expect(code.className).toMatch(/\bfont-mono\b/);
    expect(panel.textContent).toContain('The story blocks a release.');
  });

  it('shows the provenance of a node and a marker badge on an edge in a list', async () => {
    renderApp('product');
    await pickInTree('epic-checkout');
    await settle();
    fireEvent.click(flowNode('story-pay-by-card'));
    const prov = screen.getByTestId('provenance');
    expect(prov.textContent).toContain('Read in a source');
    expect(prov.textContent).toContain('Market study 2025');
    expect(prov.textContent).toContain('2026-02-10');
    expect(prov.textContent).toContain('Ana');
    expect(within(screen.getByTestId('details-panel')).getAllByTestId('edge-marker').length).toBeGreaterThan(0);
  });
});

describe('the edge panel', () => {
  it('shows the kind, the source, the target, the note and the properties of an edge that a click selects', async () => {
    renderApp('product');
    await pickInTree('epic-checkout');
    await settle();
    await waitFor(() => expect(flowEdge('dec-use-psp', 'epic-checkout')).toBeTruthy());
    fireEvent.click(flowEdge('dec-use-psp', 'epic-checkout'));
    const panel = screen.getByTestId('edge-details');
    expect(panel.textContent).toContain('Notes');
    expect(within(panel).getByText('Source').parentElement?.textContent).toContain('Use an external PSP');
    expect(within(panel).getByText('Target').parentElement?.textContent).toContain('Checkout');
    expect(panel.textContent).toContain('governs the epic');
    const props = within(panel).getByText('Properties').closest('section, div')!.parentElement!.textContent!;
    expect(props).toContain('since');
    expect(props).toContain('2024');
    expect(props).toContain('0.4');
    expect(props).toContain('Mandatory');
  });

  it('selects the source or the target with a button', async () => {
    renderApp('product');
    await pickInTree('epic-checkout');
    await settle();
    await waitFor(() => expect(flowEdge('dec-use-psp', 'epic-checkout')).toBeTruthy());
    const user = userEvent.setup();
    fireEvent.click(flowEdge('dec-use-psp', 'epic-checkout'));
    await user.click(screen.getByRole('button', { name: /Select the source/ }));
    expect(screen.queryByTestId('edge-details')).toBeNull();
    expect(screen.getByTestId('details-panel').textContent).toContain('dec-use-psp');
    await waitFor(() => expect(flowEdge('dec-use-psp', 'epic-checkout')).toBeTruthy());
    fireEvent.click(flowEdge('dec-use-psp', 'epic-checkout'));
    await user.click(screen.getByRole('button', { name: /Select the target/ }));
    expect(screen.getByTestId('details-panel').textContent).toContain('epic-checkout');
  });

  it('shows the properties after each edge in the list of a node', async () => {
    renderApp('product');
    await pickInTree('epic-checkout');
    await settle();
    fireEvent.click(flowNode('story-pay-by-card'));
    expect(screen.getByTestId('details-panel').textContent).toContain('since 2024-03 · audited true');
  });

  it('shows the provenance of an edge', async () => {
    renderApp('product');
    await pickInTree('epic-checkout');
    await settle();
    await waitFor(() => expect(flowEdge('story-pay-by-card', 'story-save-card')).toBeTruthy());
    fireEvent.click(flowEdge('story-pay-by-card', 'story-save-card'));
    const prov = within(screen.getByTestId('edge-details')).getByTestId('provenance');
    expect(prov.textContent).toContain('Inferred');
    expect(prov.textContent).toContain('Ben');
    expect(prov.textContent).toContain('2026-01');
  });
});

describe('the filters', () => {
  it('list the options of a coded field in the order of the vocabulary', async () => {
    renderApp('product');
    await pickInTree('epic-checkout');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Filter by priority' }));
    const options = await screen.findAllByRole('option');
    const labels = options.map((o) => o.textContent!);
    const at = (label: string) => labels.findIndex((l) => l.startsWith(label));
    // The vocabulary orders High, Medium, Low. The alphabet gives High, Low, Medium.
    expect(at('High')).toBeGreaterThanOrEqual(0);
    expect(at('High')).toBeLessThan(at('Medium'));
    expect(at('Medium')).toBeLessThan(at('Low'));
  });

  it('groups an option under the label of its broader concept', async () => {
    const edit = (profile: any, graph: any) => {
      profile.vocabularies.priority.concepts.push({ code: 'critical', label: 'Critical', definition: 'The story blocks every release.', broader: 'high', order: 4 });
      graph.nodes.find((n: any) => n.id === 'story-save-card').priority = 'critical';
    };
    renderApp('product', { edit });
    await pickInTree('epic-checkout');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Filter by priority' }));
    const options = await screen.findAllByRole('option');
    const critical = options.find((o) => o.textContent!.startsWith('Critical'))!;
    const group = critical.closest('[cmdk-group]')!;
    expect(group.querySelector('[cmdk-group-heading]')!.textContent).toBe('High');
    expect(options.find((o) => o.textContent!.startsWith('Medium'))!.closest('[cmdk-group]')).not.toBe(group);
  });
});

describe('the built-in facets', () => {
  const withoutDelivery = (profile: any) => {
    delete profile.fields.delivery;
    delete profile.fields.level;
  };
  // The titles stay literal, because the requirements link tests by their exact title.
  const hides = async (fixture: 'product' | 'safety', scope: string) => {
    renderApp(fixture, { edit: withoutDelivery });
    expect(screen.queryByRole('button', { name: 'Filter by delivery' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Filter by lifecycle' })).toBeTruthy();
    await pickInTree(scope);
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Table' }));
    expect(tableHeads()).not.toContain('Delivery');
    expect(tableHeads()).not.toContain('Level');
  };
  const shows = async (fixture: 'product' | 'safety', scope: string) => {
    renderApp(fixture);
    expect(screen.getByRole('button', { name: 'Filter by delivery' })).toBeTruthy();
    await pickInTree(scope);
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Table' }));
    expect(tableHeads()).toContain('Delivery');
  };
  it('hides the Delivery filter and column when the profile has no delivery field (product)', () => hides('product', 'epic-checkout'));
  it('hides the Delivery filter and column when the profile has no delivery field (safety)', () => hides('safety', 'g-safe-operation'));
  it('shows the Delivery filter and column when the profile has the field (product)', () => shows('product', 'epic-checkout'));
  it('shows the Delivery filter and column when the profile has the field (safety)', () => shows('safety', 'g-safe-operation'));
});
