// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the slice: the sections, the cross links, the coded values, the budget and the command `semspec slice`.
// The fixtures are the 2 profiles of the workspace fixture and the requirements of this repository.
import { describe, expect, it, vi } from 'vitest';
import { QueryError, indexGraphs, slice, sliceMarkdown } from '@semspec/core';
import { run } from '../packages/cli/src/index';
import { loadWorkspace } from '../packages/cli/src/workspace';

const workspacePath = new URL('../fixtures/workspace/workspace.json', import.meta.url).pathname;
const graphs = indexGraphs(loadWorkspace(workspacePath).data.graphs);
const ids = (list: { id: string }[]) => list.map((x) => x.id);

describe('slice of the product graph', () => {
  const s = slice(graphs, { graph: 'req', id: 'story-pay-by-card' });
  it('holds the node with its lifecycle, status and fields', () => {
    expect(s).toMatchObject({ graph: 'req', kind: 'story', kindLabel: 'Story', title: 'Pay by card', lifecycle: 'planned', status: { value: 'partial', label: 'Partial', own: false } });
    expect(s.statement).toContain('3DS');
    expect(s.fields).toEqual({ priority: 'high', release: 'r1', teams: ['payments', 'web'] });
  });
  it('holds the path to the root as ids and titles, root first', () => {
    expect(s.path).toEqual([
      { id: 'prd-shop', kind: 'product', title: 'Shop' },
      { id: 'epic-checkout', kind: 'epic', title: 'Checkout' },
    ]);
  });
  it('holds the parts with their status and checks, and the part with no check', () => {
    expect(ids(s.parts)).toEqual(['story-pay-by-card#declined', 'story-pay-by-card#charged']);
    expect(s.parts[0]).toMatchObject({ status: { value: 'pass' }, text: 'A declined card shows a message.' });
    expect(s.parts[0].checks.map((c) => c.type)).toEqual(['unit']);
    expect(s.parts[1].checks).toEqual([]);
  });
  it('holds the linked nodes with the edge notes', () => {
    expect(s.linked.map((l) => `${l.direction}:${l.edge}:${l.id}`)).toEqual(['out:complies:std-card-data', 'in:notes:dec-use-two-psp']);
    expect(s.linked[0]).toMatchObject({ kind: 'standard', label: 'Complies with', statement: 'A merchant shall not store card data.' });
    const epic = slice(graphs, { graph: 'req', id: 'epic-checkout' });
    expect(epic.linked.find((l) => l.id === 'dec-use-psp')).toMatchObject({ direction: 'in', edge: 'notes', note: 'governs the epic', kind: 'decision' });
  });
  it('holds the cross links with the definition of each target', () => {
    expect(s.crossLinks.map((c) => `${c.graph}:${c.id}`)).toEqual(['domain:pay-card', 'domain:prov-payvale', 'domain:prov-tillpay', 'domain:prov-quillpay']);
    expect(s.crossLinks[0]).toMatchObject({ field: 'concerns', label: 'Concerns', kind: 'method', title: 'Card payment', statement: 'The buyer pays with a card at once.' });
  });
  it('holds the gaps of the node and its parts', () => {
    expect(s.gaps.status).toEqual([{ id: 'story-pay-by-card#charged', title: 'Charged', status: 'fail', label: 'Fail' }]);
    expect(ids(s.gaps.missingChecks)).toEqual(['story-pay-by-card#charged']);
    expect(s.gaps.missingSources).toEqual([]);
  });
  it('lists the nodes below to the depth, and not the parts', () => {
    expect(ids(s.below.nodes)).toEqual(['story-pay-by-card-3ds', 'story-save-card']);
    const epic = slice(graphs, { graph: 'req', id: 'epic-checkout', depth: 1 });
    expect(epic.below.nodes.every((n) => !n.id.includes('#'))).toBe(true);
    const product1 = slice(graphs, { graph: 'req', id: 'prd-shop', depth: 1 });
    const product2 = slice(graphs, { graph: 'req', id: 'prd-shop', depth: 2 });
    expect(product1.below.nodes.every((n) => !n.children)).toBe(true);
    expect(product1.below.nodes.find((n) => n.id === 'epic-checkout')?.more).toBeGreaterThan(0);
    expect(product2.below.nodes.find((n) => n.id === 'epic-checkout')?.children?.length).toBeGreaterThan(0);
    expect(product2.below.total).toBeGreaterThan(product1.below.total);
  });
  it('writes Markdown with a heading for each section and ids in backticks', () => {
    const md = sliceMarkdown(s);
    expect(md.startsWith('# `story-pay-by-card` Pay by card\n')).toBe(true);
    for (const h of ['## Fields', '## Path to the root', '## Parts', '## Linked nodes', '## Cross links', '## Gaps', '## Below the node']) expect(md).toContain(`\n${h}`);
    expect(md).toContain('`std-card-data`');
    expect(md).toContain('- `story-pay-by-card#charged` [Fail] A valid card is charged once.\n  - No check.');
    expect(md).toContain('`domain:pay-card` Card payment [method]');
    expect(md).not.toContain('Cut to fit');
  });
  it('is plain data that survives JSON', () => {
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('slice of the domain graph', () => {
  const s = slice(graphs, { graph: 'domain', id: 'shop-brightcart' });
  it('holds the definitions of the coded values of the fields, the marker and the edge properties', () => {
    const byAt = (at: string) => s.codes.find((c) => c.at === at);
    expect(byAt('segment')).toMatchObject({ vocabulary: 'segment', code: 'retail', label: 'Retail', definition: 'The organisation sells goods to buyers.' });
    expect(byAt('how')).toMatchObject({ code: 'verified', definition: expect.any(String) });
    expect(byAt('offers.status')).toMatchObject({ code: 'active', definition: expect.any(String) });
    expect(new Set(s.codes.map((c) => `${c.vocabulary}:${c.code}`)).size).toBe(s.codes.length);
    expect(sliceMarkdown(s)).toContain('## Coded values');
  });
  it('holds the provenance and keeps the source of an edge out of the edge properties', () => {
    expect(s.provenance).toMatchObject({ marker: 'verified', source: 'src-veldt-report', sourceTitle: expect.any(String) });
    const uses = s.linked.find((l) => l.edge === 'usesProvider')!;
    expect(uses.props).toMatchObject({ since: expect.any(String), share: expect.any(Number) });
    expect(Object.keys(uses.props!)).not.toContain('source');
  });
  it('refuses an unknown id, graph and option', () => {
    expect(() => slice(graphs, { graph: 'domain', id: 'nope' })).toThrow(QueryError);
    expect(() => slice(graphs, { graph: 'zzz', id: 'x' })).toThrow(/Unknown graph "zzz"/);
    expect(() => slice(graphs, { graph: 'req', id: 'prd-shop', depth: 0 })).toThrow(/"depth"/);
    expect(() => slice(graphs, { graph: 'req', id: 'prd-shop', budget: 0 })).toThrow(/"budget"/);
  });
});

describe('slice budget', () => {
  const full = slice(graphs, { graph: 'req', id: 'prd-shop', depth: 2, budget: 1_000_000 });
  it('cuts nothing when the text fits', () => {
    expect(full.cut).toBeUndefined();
    expect(sliceMarkdown(full).length).toBeLessThan(6000);
  });
  it('cuts the deep children first and says so', () => {
    const size = sliceMarkdown(full).length;
    const cut = slice(graphs, { graph: 'req', id: 'prd-shop', depth: 2, budget: size - 1 });
    expect(cut.below.depth).toBe(1);
    expect(cut.below.nodes.every((n) => !n.children)).toBe(true);
    expect(cut.cut?.[0]).toMatch(/node\(s\) below the node are not listed/);
    expect(sliceMarkdown(cut)).toContain('## Cut to fit the budget');
  });
  it('cuts the long statements of linked nodes and cross links before the parts', () => {
    const s = slice(graphs, { graph: 'req', id: 'story-pay-by-card', budget: 1 });
    expect(s.linked.every((l) => !l.statement)).toBe(true);
    expect(s.crossLinks.every((c) => !c.statement)).toBe(true);
    expect(s.cut?.join(' ')).toMatch(/statements of \d+ linked node/);
    expect(s.parts.length).toBe(2);
    expect(s.gaps.status.length).toBe(1);
    expect(s.crossLinks.length).toBe(4);
  });
  it('cuts a statement to a short text first', () => {
    const long = 'word '.repeat(80).trim();
    const withLong = indexGraphs(loadWorkspace(workspacePath).data.graphs);
    withLong[0].index.byId.get('std-card-data')!.statement = long;
    const uncut = slice(withLong, { graph: 'req', id: 'story-pay-by-card', budget: 1_000_000 });
    const budget = sliceMarkdown(uncut).length - 1;
    const cut = slice(withLong, { graph: 'req', id: 'story-pay-by-card', budget });
    const std = cut.linked.find((l) => l.id === 'std-card-data')!;
    expect(std.statement!.length).toBeLessThan(long.length);
    expect(std.statement!.endsWith('…')).toBe(true);
    expect(cut.cut?.join(' ')).toMatch(/cut to 160 characters/);
  });
  it('keeps the same slice in JSON and in Markdown', () => {
    const s = slice(graphs, { graph: 'req', id: 'prd-shop', depth: 2, budget: 300 });
    expect(s.cut?.length).toBeGreaterThan(0);
    for (const note of s.cut!) expect(sliceMarkdown(s)).toContain(note);
  });
});

describe('slice of the requirements of this repository', () => {
  const root = new URL('..', import.meta.url).pathname;
  it('shows the parts, the checks and the path of a requirement', async () => {
    const out: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((m) => void out.push(String(m)));
    try {
      const code = await run(['slice', '--graph', `${root}requirements/graph`, '--profile', `${root}requirements/profile.yaml`, 'req-mcp-check-tools']);
      expect(code).toBe(0);
    } finally {
      log.mockRestore();
    }
    const text = out.join('\n');
    expect(text).toContain('# `req-mcp-check-tools` Check the graph with MCP tools');
    expect(text).toContain('`prd-semspec` Semspec > `feat-harness` Harness > `cap-mcp` MCP server');
    expect(text).toContain('`req-mcp-check-tools#validate` [Verified]');
  });
});

describe('semspec slice', () => {
  async function sliceCommand(args: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((m) => void out.push(String(m)));
    const error = vi.spyOn(console, 'error').mockImplementation((m) => void err.push(String(m)));
    try {
      const code = await run(['slice', ...args]);
      return { code, out: out.join('\n'), err: err.join('\n') };
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  }
  it('prints Markdown for a node of a workspace', async () => {
    const r = await sliceCommand(['--workspace', workspacePath, '--in', 'req', 'story-pay-by-card']);
    expect(r.code).toBe(0);
    expect(r.out.startsWith('# `story-pay-by-card` Pay by card')).toBe(true);
    expect(r.out).toContain('## Cross links');
  });
  it('prints the JSON slice with --json and applies --depth and --budget', async () => {
    const r = await sliceCommand(['--workspace', workspacePath, '--in', 'req', 'prd-shop', '--depth', '2', '--json']);
    expect(r.code).toBe(0);
    const json = JSON.parse(r.out);
    expect(json).toMatchObject({ graph: 'req', id: 'prd-shop' });
    expect(json.below.depth).toBe(2);
    const small = JSON.parse((await sliceCommand(['--workspace', workspacePath, '--in', 'req', 'prd-shop', '--depth', '2', '--budget', '300', '--json'])).out);
    expect(small.cut.length).toBeGreaterThan(0);
  });
  it('fails with a message for a missing id, a mix of options, a wrong number and an unknown node', async () => {
    expect((await sliceCommand(['--workspace', workspacePath])).err).toContain('Give the id');
    expect((await sliceCommand(['--workspace', workspacePath, '--graph', 'x', 'a'])).err).toContain('Use --workspace alone');
    expect((await sliceCommand(['--workspace', workspacePath, 'a', '--depth', '0'])).err).toContain('--depth');
    const unknown = await sliceCommand(['--workspace', workspacePath, 'nope']);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain('"nope"');
  });
});
