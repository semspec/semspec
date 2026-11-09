// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the coverage report: the counts, the filters, the groups, the list, the workspace, the gate and the command `semspec coverage`.
// The fixtures are the product profile of the workspace fixture and the profile of this repository, with small graphs written in the tests.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { QueryError, buildModel, coverage, coverageMarkdown, indexGraphs, type CoverageResult, type Graph } from '@semspec/core';
import { callTool } from '@semspec/mcp';
import { run } from '../packages/cli/src/index';
import { loadProfile } from '../packages/cli/src/inputs';
import { mcpLoader } from '../packages/cli/src/mcp';
import { loadWorkspace } from '../packages/cli/src/workspace';

const root = new URL('../', import.meta.url).pathname;
const productProfilePath = `${root}fixtures/product/profile.json`;
const productProfile = loadProfile(productProfilePath);
const workspacePath = `${root}fixtures/workspace/workspace.json`;

const test = (name: string, text: string, result?: string, tests: unknown[] = []) => ({ key: name, text, ...(result ? { result } : {}), tests });
const unit = (name: string) => ({ type: 'unit', file: 'tests/a.test.ts', name });

// 3 stories with 5 scenarios. story-2 is in 2 epics.
//   s1 pass with a test, s2 fail, s3 no result with a test, s4 partial, s5 pass with a test.
const graph: Graph = {
  nodes: [
    { id: 'prd-a', kind: 'product', name: 'Product A' },
    { id: 'epic-1', kind: 'epic', name: 'Epic 1', products: ['prd-a'] },
    { id: 'epic-2', kind: 'epic', name: 'Epic 2', products: ['prd-a'] },
    { id: 'story-1', kind: 'story', summary: 'Story 1.', epics: ['epic-1'], teams: ['web'], release: 'r1', how: 'verified', source: 'src-a', scenarios: [test('s1', 'S1 text.', 'pass', [unit('t1')]), test('s2', 'S2 text.', 'fail'), test('s3', 'S3 text.', undefined, [unit('t3')])] },
    { id: 'story-2', kind: 'story', summary: 'Story 2.', epics: ['epic-1', 'epic-2'], teams: ['web', 'api'], release: 'r2', how: 'inferred', scenarios: [test('s4', 'S4 text.', 'partial')] },
    { id: 'story-3', kind: 'story', summary: 'Story 3.', epics: ['epic-2'], teams: ['api'], status: 'active', scenarios: [test('s5', 'S5 text.', 'pass', [unit('t5')])] },
    { id: 'src-a', kind: 'source', title: 'Source A' },
  ],
};
const graphs = indexGraphs([{ id: 'shop', label: 'Shop', model: buildModel(graph, productProfile) }]);
const ids = (r: CoverageResult) => (r.list?.items ?? []).map((i) => i.id);
const counts = (row: { statuses: { value: string; count: number }[] }) => Object.fromEntries(row.statuses.map((s) => [s.value, s.count]));

const dir = mkdtempSync(join(tmpdir(), 'semspec-coverage-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const graphPath = join(dir, 'graph.json');
writeFileSync(graphPath, JSON.stringify(graph));

async function cli(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((m) => void out.push(String(m)));
  const error = vi.spyOn(console, 'error').mockImplementation((m) => void err.push(String(m)));
  try {
    const code = await run(['coverage', ...args]);
    return { code, out: out.join('\n'), err: err.join('\n') };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}
const own = ['--graph', graphPath, '--profile', productProfilePath];

describe('coverage counts', () => {
  it('counts the conditions for each status value, with no status and with no check, and gives percentages', () => {
    const r = coverage(graphs);
    expect(r.total.conditions).toBe(5);
    expect(r.total.statuses.map((s) => [s.value, s.tone, s.count, s.percent])).toEqual([
      ['pass', 'good', 2, 40],
      ['partial', 'warn', 1, 20],
      ['fail', 'bad', 1, 20],
    ]);
    expect(r.total.noStatus).toEqual({ count: 1, percent: 20 });
    expect(r.total.noCheck).toEqual({ count: 2, percent: 40 });
    expect(r.graphs).toHaveLength(1);
    expect(r.graphs[0]).toMatchObject({ graph: 'shop', conditions: 5 });
    expect(coverageMarkdown(r)).toContain('| Total | 5 | 2 (40%) | 1 (20%) | 1 (20%) | 1 (20%) | 2 (40%) |');
  });
});

describe('coverage filters', () => {
  it('selects with a scope node and with each filter of the explorer', () => {
    const total = (q: Parameters<typeof coverage>[1]) => coverage(graphs, { ...q, list: ['pass', 'partial', 'fail', 'no-status'], limit: 50 });
    expect(ids(total({ scope: 'epic-2' }))).toEqual(['story-2#s4', 'story-3#s5']);
    expect(ids(total({ scope: 'story-1' }))).toEqual(['story-1#s1', 'story-1#s2', 'story-1#s3']);
    expect(total({ kinds: ['epic'] }).total.conditions).toBe(5);
    expect(total({ kinds: ['decision'] }).total.conditions).toBe(0);
    expect(ids(total({ lifecycles: ['active'] }))).toEqual(['story-3#s5']);
    expect(ids(total({ deliveries: ['r2'] }))).toEqual(['story-2#s4']);
    expect(ids(total({ statuses: ['fail', 'partial'] }))).toEqual(['story-1#s2', 'story-2#s4']);
    expect(ids(total({ statuses: [''] }))).toEqual(['story-1#s3']);
    expect(ids(total({ markers: ['verified'] }))).toEqual(['story-1#s1', 'story-1#s2', 'story-1#s3']);
    expect(ids(total({ fields: { teams: ['api'] } }))).toEqual(['story-2#s4', 'story-3#s5']);
    expect(coverage(graphs, { scope: 'epic-2' }).scope).toBe('epic-2');
  });
  it('ORs the values of 1 filter and ANDs the filters', () => {
    const q = (extra: Parameters<typeof coverage>[1]) => coverage(graphs, { list: ['pass', 'partial', 'fail', 'no-status'], ...extra });
    expect(ids(q({ statuses: ['pass', 'fail'] }))).toEqual(['story-1#s1', 'story-1#s2', 'story-3#s5']);
    expect(ids(q({ fields: { teams: ['api', 'web'] } })).length).toBe(5);
    expect(ids(q({ fields: { teams: ['api'] }, statuses: ['pass'] }))).toEqual(['story-3#s5']);
    expect(ids(q({ kinds: ['story'], deliveries: ['r1', 'r2'], markers: ['verified'] }))).toEqual(['story-1#s1', 'story-1#s2', 'story-1#s3']);
    expect(q({ scope: 'epic-1', lifecycles: ['active'] }).total.conditions).toBe(0);
  });
  it('matches each inherited filter on its own node above a condition', () => {
    const r = coverage(graphs, { kinds: ['epic'], deliveries: ['r1'], gate: ['bad'], list: ['pass', 'partial', 'fail', 'no-status'] });
    expect(ids(r)).toEqual(['story-1#s1', 'story-1#s2', 'story-1#s3']);
    expect(r.gate).toMatchObject({ pass: false });
    expect(r.gate!.failing.map((i) => i.id)).toEqual(['story-1#s2']);
    expect(coverage(graphs, { kinds: ['product'], deliveries: ['r2'], markers: ['inferred'], list: ['partial'] }).list!.items.map((i) => i.id)).toEqual(['story-2#s4']);
    expect(coverage(graphs, { kinds: ['epic'], deliveries: ['r9'] }).total.conditions).toBe(0);
  });
  it('refuses an unknown field filter, an unknown graph and a scope without a graph in a workspace', () => {
    expect(() => coverage(graphs, { fields: { nope: ['x'] } })).toThrow(/Unknown field filter "nope".*teams/);
    expect(() => coverage(graphs, { graph: 'nope' })).toThrow(QueryError);
    expect(() => coverage(graphs, { scope: 'nope' })).toThrow(/Unknown node id "nope"/);
    expect(() => coverage(graphs, { gate: ['red' as 'bad'] })).toThrow(/Unknown tone/);
    expect(() => coverage(graphs, { list: ['nope'] })).toThrow(/Unknown list value/);
    const two = indexGraphs([
      { id: 'a', label: 'A', model: buildModel(graph, productProfile) },
      { id: 'b', label: 'B', model: buildModel(graph, productProfile) },
    ]);
    expect(() => coverage(two, { scope: 'epic-1' })).toThrow(/needs "graph"/);
    expect(coverage(two, { scope: 'epic-1', graph: 'b' }).graphs.map((g) => g.graph)).toEqual(['b']);
  });
});

describe('coverage groups', () => {
  it('groups by the nodes of a hierarchy kind and counts a condition in each group of its owner', () => {
    const r = coverage(graphs, { group: 'epic' });
    const groups = r.graphs[0].groups!;
    expect(groups.map((g) => [g.key, g.label, g.kind, g.conditions])).toEqual([
      ['epic-1', 'Epic 1', 'epic', 4],
      ['epic-2', 'Epic 2', 'epic', 2],
    ]);
    expect(counts(groups[0])).toEqual({ pass: 1, partial: 1, fail: 1 });
    expect(groups[0].noStatus).toEqual({ count: 1, percent: 25 });
    expect(groups[0].noCheck).toEqual({ count: 2, percent: 50 });
    expect(groups[1].statuses.map((s) => s.percent)).toEqual([50, 50, 0]);
    expect(r.total.conditions).toBe(5);
    expect(coverage(graphs, { group: 'product' }).graphs[0].groups!.map((g) => [g.key, g.conditions])).toEqual([['prd-a', 5]]);
    expect(coverage(graphs, { group: 'story', scope: 'epic-2' }).graphs[0].groups!.map((g) => [g.key, g.conditions])).toEqual([
      ['story-2', 1],
      ['story-3', 1],
    ]);
    expect(coverageMarkdown(r)).toContain('| Epic 1 (epic-1) | 4 |');
  });
  it('groups by the values of a field', () => {
    const groups = coverage(graphs, { group: 'teams' }).graphs[0].groups!;
    expect(groups.map((g) => [g.key, g.label, g.conditions])).toEqual([
      ['api', 'api', 2],
      ['web', 'Web shop', 4],
    ]);
    expect(counts(groups[1])).toEqual({ pass: 1, partial: 1, fail: 1 });
    const priority = coverage(graphs, { group: 'release' }).graphs[0].groups!;
    expect(priority.map((g) => [g.key, g.conditions])).toEqual([['r1', 3], ['r2', 1], ['', 1]]);
    expect(priority[2].label).toBe('(none)');
  });
  it('gives a row to a group node above the scope', () => {
    const groups = coverage(graphs, { group: 'epic', scope: 'story-1' }).graphs[0].groups!;
    expect(groups.map((g) => [g.key, g.conditions])).toEqual([['epic-1', 3]]);
    expect(coverage(graphs, { group: 'epic', scope: 'story-3' }).graphs[0].groups!.map((g) => [g.key, g.conditions])).toEqual([['epic-2', 1]]);
  });
  it('refuses a group that is no hierarchy kind and no field', () => {
    expect(() => coverage(graphs, { group: 'scenario' })).toThrow(/Unknown group "scenario"/);
    expect(() => coverage(graphs, { group: 'nope' })).toThrow(QueryError);
  });
});

describe('coverage list', () => {
  it('lists the conditions of chosen status values with owner, text and checks', () => {
    const r = coverage(graphs, { list: ['pass'] });
    expect(r.list).toMatchObject({ statuses: ['pass'], limit: 50, total: 2 });
    expect(r.list!.items[0]).toMatchObject({
      graph: 'shop',
      id: 'story-1#s1',
      owner: { id: 'story-1', kind: 'story' },
      status: 'pass',
      tone: 'good',
      text: 'S1 text.',
      checks: [{ type: 'unit', title: 'T1' }],
    });
    const open = coverage(graphs, { list: ['no-status', 'no-check'] });
    expect(ids(open)).toEqual(['story-1#s2', 'story-1#s3', 'story-2#s4']);
    expect(open.list!.items[0].checks).toEqual([]);
    expect(coverageMarkdown(r)).toContain('- `story-1#s1` [pass] of `story-1`: S1 text.');
  });
  it('cuts the list at the limit and names the limit', () => {
    const r = coverage(graphs, { list: ['pass', 'partial', 'fail'], limit: 2 });
    expect(r.list).toMatchObject({ limit: 2, total: 4 });
    expect(r.list!.items).toHaveLength(2);
    expect(r.truncated).toEqual({ list: 2 });
    expect(coverageMarkdown(r)).toContain('The list shows 2 of 4 conditions. The limit is 2.');
    expect(coverage(graphs, { list: ['pass'] }).truncated).toBeUndefined();
    expect(() => coverage(graphs, { list: ['pass'], limit: 0 })).toThrow(/limit/);
  });
});

describe('coverage workspace', () => {
  it('counts each graph and the total in a workspace', () => {
    const requirements = loadProfile(`${root}requirements/profile.yaml`);
    const second: Graph = {
      nodes: [{ id: 'req-x', kind: 'requirement', title: 'X', acceptance: [{ id: 'a', text: 'A.', status: 'verified', tests: [unit('ta')] }, { id: 'b', text: 'B.', status: 'partial' }] }],
    };
    const both = indexGraphs([
      { id: 'shop', label: 'Shop', model: buildModel(graph, productProfile) },
      { id: 'self', label: 'Self', model: buildModel(second, requirements) },
    ]);
    const r = coverage(both);
    expect(r.graphs.map((g) => [g.graph, g.conditions])).toEqual([['shop', 5], ['self', 2]]);
    expect(counts(r.graphs[1])).toEqual({ verified: 1, partial: 1, open: 0 });
    expect(r.total.conditions).toBe(7);
    expect(counts(r.total)).toEqual({ pass: 2, partial: 2, fail: 1, verified: 1, open: 0 });
    expect(r.total.noStatus.count).toBe(1);
    expect(r.total.noCheck).toEqual({ count: 3, percent: 42.9 });
    const one = coverage(both, { graph: 'self', group: 'requirement' });
    expect(one.graphs.map((g) => g.graph)).toEqual(['self']);
    expect(one.total.conditions).toBe(2);
    expect(coverageMarkdown(r)).toContain('| self | 2 |');
    const fixture = indexGraphs(loadWorkspace(workspacePath).data.graphs);
    expect(coverage(fixture).graphs.map((g) => [g.graph, g.conditions])).toEqual([['req', 2], ['domain', 0]]);
    expect(() => coverage(both, { group: 'nope' })).toThrow(/Unknown group/);
  });
});

describe('coverage gate', () => {
  it('fails the gate for a condition with a tone and names it', () => {
    const bad = coverage(graphs, { gate: ['bad'] });
    expect(bad.gate).toMatchObject({ tones: ['bad'], pass: false });
    expect(bad.gate!.failing.map((i) => i.id)).toEqual(['story-1#s2']);
    expect(coverage(graphs, { gate: ['bad', 'warn'] }).gate!.failing.map((i) => i.id)).toEqual(['story-1#s2', 'story-2#s4']);
    expect(coverage(graphs, { gate: ['bad'], scope: 'story-3' }).gate).toMatchObject({ pass: true, failing: [] });
    expect(coverage(graphs).gate).toBeUndefined();
    const text = coverageMarkdown(bad);
    expect(text).toContain('The gate fails. 1 condition(s) have a status with the tone bad.');
    expect(text).toContain('`story-1#s2`');
  });
  it('exits with 1 from the command when the gate fails and with 0 when it passes', async () => {
    const failed = await cli([...own, '--gate', 'bad']);
    expect(failed.code).toBe(1);
    expect(failed.out).toContain('`story-1#s2`');
    const passed = await cli([...own, '--gate', 'bad', '--scope', 'story-3']);
    expect(passed.code).toBe(0);
    expect(passed.out).toContain('The gate passes.');
    expect((await cli(own)).code).toBe(0);
    const wrong = await cli([...own, '--gate', 'red']);
    expect(wrong.code).toBe(2);
    expect(wrong.err).toContain('Unknown tone "red"');
    expect((await cli(['--graph', graphPath])).code).toBe(2);
  });
});

describe('coverage options', () => {
  it('exits with 2 for an unknown option and for an option with no value', async () => {
    const unknown = await cli([...own, '--gaet', 'bad']);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('Unknown option "--gaet"');
    const gateThenStatus = await cli([...own, '--gate', 'bad', '--status']);
    expect(gateThenStatus.code).toBe(2);
    expect(gateThenStatus.err).toContain('--status needs a value');
    const swallowed = await cli([...own, '--kind', '--json', '--gate', 'bad']);
    expect(swallowed.code).toBe(2);
    expect(swallowed.err).toContain('--kind needs a value');
    expect((await cli([...own, '--scope'])).code).toBe(2);
  });
});

describe('coverage command and tool', () => {
  const args = ['--group', 'epic', '--field', 'teams=web,api', '--status', 'pass,fail', '--list', 'pass', '--limit', '1', '--gate', 'bad'];
  const input = { group: 'epic', fields: { teams: ['web', 'api'] }, statuses: ['pass', 'fail'], list: ['pass'], limit: 1, gate: ['bad'] };
  it('gives the same answer through the tool and the command, as JSON and as Markdown', async () => {
    const loader = mcpLoader({ graph: graphPath, profile: productProfilePath });
    const json = await cli([...own, ...args, '--json']);
    expect(json.code).toBe(1);
    const viaTool = callTool(loader, 'coverage', { ...input, format: 'json' });
    expect(JSON.parse(json.out)).toEqual(viaTool);
    expect(viaTool).toEqual(coverage(indexGraphs(loader().graphs), { ...input, gate: ['bad'] }));
    const markdown = await cli([...own, ...args]);
    expect(markdown.out + '\n').toBe(callTool(loader, 'coverage', input));
    expect((viaTool as CoverageResult).list).toMatchObject({ limit: 1 });
    expect(() => callTool(loader, 'coverage', { format: 'xml' })).toThrow(/format/);
    expect(() => callTool(loader, 'coverage', { fields: { teams: 'web' } })).toThrow(/fields/);
    expect(() => callTool(loader, 'coverage', { gate: ['red'] })).toThrow(/Unknown tone/);
  });
  it('reads the filters of the command from the options', async () => {
    const r = JSON.parse((await cli([...own, '--kind', 'story', '--lifecycle', 'active', '--delivery', 'r1', '--marker', 'verified', '--scope', 'story-1', '--json'])).out);
    expect(r.filters).toEqual({ kinds: ['story'], lifecycles: ['active'], deliveries: ['r1'], markers: ['verified'] });
    expect(r.total.conditions).toBe(0);
    const field = JSON.parse((await cli([...own, '--field', 'teams=api', '--json'])).out);
    expect(field.total.conditions).toBe(2);
    expect((await cli([...own, '--field', 'teams'])).err).toContain('name=value');
    expect((await cli([...own, '--limit', 'x'])).err).toContain('--limit');
    expect((await cli([...own, 'stray'])).err).toContain('Unexpected argument');
    const ws = await cli(['--workspace', workspacePath, '--in', 'req']);
    expect(ws.code).toBe(0);
    expect(ws.out).toContain('| Total | 2 |');
  });
});
