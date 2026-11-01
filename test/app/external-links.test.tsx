// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// DOM tests of the links to outside tools: the Links section of the details panel, the check title as a link,
// the link buttons of a check with more than 1 link, and the CSV column. Each test renders a fixture profile.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { flowNode, pickInTree, renderApp, settle } from './harness';

const panel = () => screen.getByTestId('details-panel');
const checkNodeId = (title: string) => [...document.querySelectorAll('.react-flow__node')].map((n) => n.getAttribute('data-id')!).find((id) => id.startsWith(title))!;

function expectOutside(a: HTMLElement, href: string) {
  expect(a.getAttribute('href')).toBe(href);
  expect(a.getAttribute('target')).toBe('_blank');
  expect(a.getAttribute('rel')).toBe('noopener noreferrer');
}

describe('the links of the details panel', () => {
  // condition: details
  it('shows the Links section of a node with the label of the profile', async () => {
    renderApp('product');
    await pickInTree('epic-checkout');
    await settle();
    fireEvent.click(flowNode('story-pay-by-card'));
    const links = within(panel()).getByRole('heading', { name: /^Links/ }).closest('section')!;
    expectOutside(within(links).getByRole('link', { name: /Tracker/ }), 'https://tracker.example.org/items/story-pay-by-card');
  });

  it('shows no Links section for a node with no link', async () => {
    renderApp('product');
    await pickInTree('epic-checkout');
    await settle();
    fireEvent.click(flowNode('story-pay-by-card'));
    fireEvent.click(flowNode('std-card-data'));
    expect(within(panel()).queryByRole('heading', { name: /^Links/ })).toBeNull();
  });

  // condition: click-through
  it('makes the title of a check a link in the condition list and opens it in a new tab', async () => {
    renderApp('product');
    await pickInTree('epic-checkout');
    await settle();
    fireEvent.click(flowNode('story-pay-by-card'));
    const a = within(panel()).getByRole('link', { name: 'showsDeclineMessage' });
    expectOutside(a, 'https://ci.example.org/report?file=tests%2Fpay.test.ts&test=showsDeclineMessage');
    // The click is not cancelled, so the browser opens the address in a new tab.
    expect(fireEvent.click(a)).toBe(true);
    // The check has a missing field for the second link, so the title is the only link.
    expect(within(panel()).queryByRole('link', { name: 'Test run' })).toBeNull();
  });

  it('shows the links of a part with the check list of the part', async () => {
    renderApp('product');
    await pickInTree('epic-checkout');
    await settle();
    fireEvent.click(flowNode('story-pay-by-card#declined'));
    expectOutside(within(panel()).getByRole('link', { name: 'showsDeclineMessage' }), 'https://ci.example.org/report?file=tests%2Fpay.test.ts&test=showsDeclineMessage');
  });

  it('shows the links of a selected check node', async () => {
    renderApp('product');
    await pickInTree('epic-checkout');
    await settle();
    const id = checkNodeId('unit:');
    expect(id).toBeTruthy();
    fireEvent.click(flowNode(id));
    const links = within(panel()).getByRole('heading', { name: /^Links/ }).closest('section')!;
    expectOutside(within(links).getByRole('link', { name: /Test report/ }), 'https://ci.example.org/report?file=tests%2Fpay.test.ts&test=showsDeclineMessage');
    expect(within(panel()).getAllByRole('link', { name: 'showsDeclineMessage' }).length).toBeGreaterThan(0);
  });

  it('shows link buttons when a check has more than 1 link, on the safety profile', async () => {
    renderApp('safety');
    await pickInTree('g-safe-operation');
    await settle();
    fireEvent.click(flowNode('mit-thermal-fuse'));
    const buttons = within(panel()).getByTestId('outside-links');
    const links = within(buttons).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Document', 'Section']);
    expectOutside(links[0], 'https://docs.example.org/documents/FMEA-3');
    expectOutside(links[1], 'https://docs.example.org/documents/FMEA-3#section-4.2');
    // With more than 1 link the title is not a link.
    expect(within(panel()).queryByRole('link', { name: /Analysis/ })).toBeNull();
  });

  it('makes the title of a check a link on the safety profile', async () => {
    renderApp('safety');
    await pickInTree('g-safe-operation');
    await settle();
    fireEvent.click(flowNode('sg-detect-overheat#sensor-redundant'));
    const a = within(panel()).getByRole('link', { name: 'FTA-12' });
    expectOutside(a, 'https://docs.example.org/documents/FTA-12');
  });

  // condition: safe
  it('shows no link for a protocol other than http and https', async () => {
    renderApp('product', {
      edit: (profile, graph) => {
        profile.externalLinks.push({ label: 'Unsafe', template: '{unsafe}', kinds: ['story'] }, { label: 'Unsafe 2', template: 'https://x.example.org/{plan}', checkTypes: ['manual'] });
        graph.nodes.find((n: any) => n.id === 'story-pay-by-card').unsafe = 'javascript:alert(1)';
      },
    });
    await pickInTree('epic-checkout');
    await settle();
    fireEvent.click(flowNode('story-pay-by-card'));
    expect(within(panel()).queryByRole('link', { name: /Unsafe/ })).toBeNull();
    expect(panel().querySelector('a[href^="javascript"]')).toBeNull();
  });
});

describe('the CSV column', () => {
  it('has a Links column with the URLs separated by spaces', async () => {
    let blob: Blob | undefined;
    Object.assign(URL, { createObjectURL: (b: Blob) => ((blob = b), 'blob:test'), revokeObjectURL: () => {} });
    renderApp('product');
    await pickInTree('epic-checkout');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Table' }));
    await user.click(screen.getByRole('button', { name: /CSV/ }));
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(blob!);
      vi.advanceTimersByTime(10);
    });
    const [head, ...rows] = text.replace(/^﻿/, '').split('\r\n');
    expect(head.split(',')).toContain('"Links"');
    expect(rows.join('\n')).toContain('"https://tracker.example.org/items/story-pay-by-card"');
  });
});
