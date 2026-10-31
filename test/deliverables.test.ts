// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the deliverables: each type of deliverable, the report, the gate kind, the gaps, the slice section and the command.
// The 2 fixture profiles are the product profile (parts, checks, status) and the domain profile (links, fields, provenance) of the workspace fixture.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { GATE_KINDS, deliverableReport, gateFindings, indexGraphs, slice, sliceMarkdown, gaps, type DeliverableSpec, type GraphIndex } from '@semspec/core';
import { run } from '../packages/cli/src/index';
import { validateProfile } from '../packages/cli/src/validate';
import { loadWorkspace } from '../packages/cli/src/workspace';

const workspacePath = new URL('../fixtures/workspace/workspace.json', import.meta.url).pathname;
const base = loadWorkspace(workspacePath).data.graphs;

// The workspace graphs with deliverables in the profile of each graph.
function graphsWith(req: Record<string, DeliverableSpec>, domain: Record<string, DeliverableSpec> = {}, fail: string[] = []): GraphIndex[] {
  return indexGraphs(
    base.map((g) => ({ ...g, model: { ...g.model, profile: { ...g.model.profile, deliverables: g.id === 'req' ? req : domain, ...(fail.length ? { gates: { fail: fail as never } } : {}) } } })),
  );
}
const ids = (r: { findings: { node: string }[] }) => r.findings.map((f) => f.node);
const items = (r: { findings: { item: string }[] }) => r.findings.map((f) => f.item);

describe('deliverable types on the product profile', () => {
  it('reports a node with fewer parts than the minimum', () => {
    const r = deliverableReport(graphsWith({ story: { parts: { min: 1 } } }), { graph: 'req' });
    expect(r.findings.every((f) => f.deliverable === 'parts')).toBe(true);
    expect(ids(r)).toContain('story-pay-by-card-3ds');
    expect(ids(r)).not.toContain('story-pay-by-card');
    expect(r.findings[0].message).toBe('The story "Pay by card 3DS" has 0 part(s). It needs at least 1.');
  });
  it('reports each part with no check', () => {
    const r = deliverableReport(graphsWith({ story: { checks: 'each-part' } }), { graph: 'req' });
    expect(r.findings).toMatchObject([{ node: 'story-pay-by-card', deliverable: 'checks', item: 'story-pay-by-card#charged' }]);
    expect(r.findings[0].message).toContain('has the part "story-pay-by-card#charged" with no check');
  });
  it('reports a node with no check of its own', () => {
    const r = deliverableReport(graphsWith({ story: { checks: 'node' } }), { graph: 'req' });
    expect(ids(r)).not.toContain('story-pay-by-card-3ds');
    expect(ids(r)).toContain('story-pay-by-card');
  });
  it('reports a status that is not allowed, by value and by tone, and a missing status', () => {
    const byValue = deliverableReport(graphsWith({ story: { status: ['pass'] } }), { graph: 'req' });
    const byTone = deliverableReport(graphsWith({ story: { status: ['good'] } }), { graph: 'req' });
    expect(ids(byValue)).toEqual(ids(byTone));
    expect(ids(byValue)).not.toContain('story-save-card');
    expect(byValue.findings.find((f) => f.node === 'story-pay-by-card')).toMatchObject({ deliverable: 'status', item: 'partial' });
    expect(byValue.findings.find((f) => f.node === 'story-loose')?.message).toBe('The story "Loose" has no status. It needs one of: pass.');
  });
  it('reports a part with a status that is not allowed', () => {
    const r = deliverableReport(graphsWith({ scenario: { status: ['pass'], checks: 'node' } }), { graph: 'req' });
    expect(r.findings.map((f) => `${f.node}:${f.deliverable}`)).toEqual(['story-pay-by-card#charged:checks', 'story-pay-by-card#charged:status']);
  });
  it('reports a link rule on an edge, in both directions, and on a cross link field', () => {
    const out = deliverableReport(graphsWith({ story: { links: { complies: { min: 1 } } } }), { graph: 'req' });
    expect(ids(out)).not.toContain('story-pay-by-card');
    expect(ids(out)).toContain('story-save-card');
    const inc = deliverableReport(graphsWith({ story: { links: { follows: { min: 1, direction: 'in' } } } }), { graph: 'req' });
    expect(ids(inc)).not.toContain('story-pay-by-card');
    expect(ids(inc)).toContain('story-save-card');
    const cross = deliverableReport(graphsWith({ story: { links: { concerns: { min: 4 } } } }), { graph: 'req' });
    expect(ids(cross)).toContain('story-save-card');
    expect(ids(cross)).not.toContain('story-pay-by-card');
  });
});

describe('deliverable types on the domain profile', () => {
  const domain = (spec: DeliverableSpec) => deliverableReport(graphsWith({}, { market: spec }), { graph: 'domain' });
  it('reports a field with no value', () => {
    const r = domain({ fields: ['summary', 'note'] });
    expect(r.nodes).toBe(6);
    expect(r.findings).toHaveLength(6);
    expect(items(r)).toEqual(Array(6).fill('note'));
  });
  it('reports a link rule below the minimum', () => {
    const r = domain({ links: { boundBy: { min: 4 } } });
    expect(ids(r)).toEqual(['mkt-brightmark', 'mkt-dunmere', 'mkt-fenwick']);
    expect(r.findings[0].message).toBe('The market "Brightmark" has 3 link(s) of "boundBy". It needs at least 4.');
  });
  it('reports a node with no source and keeps the marker apart', () => {
    const r = domain({ provenance: true });
    expect(r.findings).toMatchObject([{ node: 'mkt-eastreach', deliverable: 'provenance', item: 'source' }]);
  });
  it('limits the report by kind and by scope', () => {
    const graphs = graphsWith({}, { market: { fields: ['note'] }, zone: { fields: ['note'] } });
    expect(deliverableReport(graphs, { graph: 'domain', kinds: ['zone'] }).findings.every((f) => f.kind === 'zone')).toBe(true);
    const scoped = deliverableReport(graphs, { graph: 'domain', scope: 'zone-north' });
    expect(ids(scoped)).toContain('zone-north');
    expect(ids(scoped).length).toBeLessThan(deliverableReport(graphs, { graph: 'domain' }).findings.length);
  });
});

describe('the report', () => {
  it('reads a workspace or a model, and has no finding without the profile key', () => {
    const both = deliverableReport(graphsWith({ story: { parts: { min: 1 } } }, { market: { fields: ['note'] } }));
    expect(new Set(both.findings.map((f) => f.graph))).toEqual(new Set(['req', 'domain']));
    expect(deliverableReport(base[0].model)).toEqual({ nodes: 0, findings: [] });
    expect(deliverableReport(graphsWith({ story: { parts: { min: 1 } } }).slice(0, 1)).findings.length).toBeGreaterThan(0);
  });
});

describe('the profile key', () => {
  const profile = () => structuredClone(base[0].model.profile) as unknown as Record<string, unknown>;
  it('accepts a valid entry and refuses a wrong shape or a name that the profile does not define', () => {
    const ok = { story: { parts: { min: 1 }, checks: 'each-part', status: ['good', 'partial'], fields: ['summary'], links: { complies: { min: 1, direction: 'out' } } } };
    expect(validateProfile({ ...profile(), deliverables: ok })).toEqual([]);
    expect(validateProfile({ ...profile(), deliverables: { story: { provenance: true } } }).join()).toContain('provenance');
    expect(validateProfile({ ...profile(), deliverables: { story: { checks: 'all' } } }).length).toBeGreaterThan(0);
    expect(validateProfile({ ...profile(), deliverables: { story: { parts: { min: 0 } } } }).length).toBeGreaterThan(0);
    expect(validateProfile({ ...profile(), deliverables: { story: { other: 1 } } }).length).toBeGreaterThan(0);
    expect(validateProfile({ ...profile(), deliverables: { nothing: { fields: ['a'] } } }).join()).toContain('unknown kind "nothing"');
    expect(validateProfile({ ...profile(), deliverables: { story: { status: ['nonsense'] } } }).join()).toContain('"nonsense"');
    expect(validateProfile({ ...profile(), deliverables: { story: { links: { nolink: { min: 1 } } } } }).join()).toContain('"nolink"');
    expect(validateProfile({ ...profile(), deliverables: { epic: { checks: 'each-part' } } }).join()).toContain('each-part');
  });
});

describe('the gate kind', () => {
  it('names the gate in the core and fails on a missing deliverable only when the profile lists it', () => {
    expect(GATE_KINDS).toContain('missing-deliverable');
    const off = gateFindings(graphsWith({ story: { checks: 'each-part' } }, {}, ['unplaced']));
    expect(off.filter((f) => f.gate === 'missing-deliverable')).toEqual([]);
    const on = gateFindings(graphsWith({ story: { checks: 'each-part' } }, { market: { provenance: true } }, ['missing-deliverable']));
    expect(on.map((f) => `${f.graph}:${f.node}:${f.gate}`)).toEqual(['req:story-pay-by-card:missing-deliverable', 'domain:mkt-eastreach:missing-deliverable']);
    expect(on[0].message).toContain('story-pay-by-card#charged');
  });
});

describe('the gate kind in the check command', () => {
  const made: string[] = [];
  afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const fixture = (name: string) => new URL(`../fixtures/product/${name}`, import.meta.url).pathname;
  async function check(gates: string[]): Promise<{ code: number; findings: { subject: string; gate?: string; message: string }[] }> {
    const dir = mkdtempSync(join(tmpdir(), 'dlv-'));
    made.push(dir);
    const profile = { ...JSON.parse(readFileSync(fixture('profile.json'), 'utf8')), deliverables: { story: { checks: 'each-part' } }, gates: { fail: gates } };
    writeFileSync(join(dir, 'profile.json'), JSON.stringify(profile));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const code = await run(['check', '--graph', fixture('graph.json'), '--profile', join(dir, 'profile.json'), '--json']);
      return { code, findings: JSON.parse(log.mock.calls.map((c) => c.join(' ')).join('\n')).findings };
    } finally {
      log.mockRestore();
    }
  }
  it('fails the check on a missing deliverable when the profile lists the gate', async () => {
    const r = await check(['missing-deliverable']);
    expect(r.code).toBe(1);
    expect(r.findings).toMatchObject([{ subject: 'story-pay-by-card', gate: 'missing-deliverable' }]);
    expect(r.findings[0].message).toContain('story-pay-by-card#charged');
  });
  it('passes the check when the profile does not list the gate', async () => {
    expect((await check(['unplaced'])).findings.some((f) => f.gate === 'missing-deliverable')).toBe(false);
  });
});

describe('the gaps and the slice', () => {
  const graphs = graphsWith({ story: { checks: 'each-part', status: ['good'] }, scenario: { checks: 'node' } });
  it('adds the missing deliverables to the gaps of a scope', () => {
    const g = gaps(graphs, 'req', 'story-pay-by-card') as { counts: Record<string, number>; missingDeliverables: { node: string }[] };
    expect(g.counts.missingDeliverables).toBe(4);
    expect(g.missingDeliverables.map((x) => x.node)).toEqual(['story-pay-by-card', 'story-pay-by-card', 'story-pay-by-card-3ds', 'story-pay-by-card#charged']);
  });
  it('adds the missing deliverables of the node and its parts to the slice, and says when all are delivered', () => {
    const s = slice(graphs, { graph: 'req', id: 'story-pay-by-card' });
    expect(s.deliverables.defined).toBe(true);
    expect(s.deliverables.missing.map((x) => x.node)).toEqual(['story-pay-by-card', 'story-pay-by-card', 'story-pay-by-card#charged']);
    const md = sliceMarkdown(s);
    expect(md).toContain('## Deliverables');
    expect(md).toContain('has the part "story-pay-by-card#charged" with no check');
    const done = slice(graphsWith({ story: { fields: ['summary'] } }), { graph: 'req', id: 'story-pay-by-card' });
    expect(sliceMarkdown(done)).toContain('All delivered.');
  });
  it('leaves the section out when the profile states no deliverable for the node', () => {
    const s = slice(graphsWith({ epic: { fields: ['note'] } }), { graph: 'req', id: 'story-pay-by-card' });
    expect(s.deliverables).toEqual({ defined: false, missing: [] });
    expect(sliceMarkdown(s)).not.toContain('## Deliverables');
  });
});

describe('the command semspec deliverables', () => {
  async function deliverables(args: string[]): Promise<{ code: number; out: string }> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const code = await run(['deliverables', ...args]);
      return { code, out: log.mock.calls.map((c) => c.join(' ')).join('\n') + error.mock.calls.map((c) => c.join(' ')).join('\n') };
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  }
  const repo = new URL('../', import.meta.url).pathname;
  it('prints the findings of the requirements of this repository as JSON and as text', async () => {
    const args = ['--graph', `${repo}requirements/graph`, '--profile', `${repo}requirements/profile.yaml`];
    const json = await deliverables([...args, '--json']);
    expect(json.code).toBe(0);
    const report = JSON.parse(json.out) as { nodes: number; findings: { node: string; deliverable: string }[] };
    expect(report.nodes).toBeGreaterThan(0);
    const one = await deliverables([...args, '--kind', 'requirement', '--scope', 'cap-deliverables']);
    expect(one.out).toMatch(/No missing deliverable in \d+ node\(s\)\.|missing deliverable\(s\) in/);
  });
  it('reads a workspace, names the graph in each line and refuses a wrong use', async () => {
    const r = await deliverables(['--workspace', workspacePath, '--in', 'domain']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('No missing deliverable in 0 node(s).');
    const wrong = await deliverables(['--workspace', workspacePath, '--graph', 'x']);
    expect(wrong.code).toBe(1);
    expect(wrong.out).toContain('Use --workspace alone');
  });
});
