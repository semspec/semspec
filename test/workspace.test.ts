// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the workspace: the file, the cross links, the checks and the page.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildIndex, buildModel, checkCrossLinks, incomingCrossLinks, type Graph, type Profile, type WorkspaceData } from '@core/index';
import { run, startWorkspaceServer } from '../src/cli/index';
import { loadWorkspace } from '../src/cli/workspace';
import { validateGraph, validateProfile } from '../src/cli/validate';

const fixtures = new URL('../fixtures/workspace/', import.meta.url).pathname;
const workspacePath = join(fixtures, 'workspace.json');
const tmp = () => mkdtempSync(join(tmpdir(), 'ws-'));
const json = <T>(file: string) => JSON.parse(readFileSync(join(fixtures, file), 'utf8')) as T;

// A copy of the workspace fixture in a new folder, with an edit of the workspace file.
function copyWorkspace(edit: (ws: any) => void): string {
  const dir = tmp();
  cpSync(fixtures, dir, { recursive: true });
  const ws = JSON.parse(readFileSync(join(dir, 'workspace.json'), 'utf8'));
  edit(ws);
  writeFileSync(join(dir, 'workspace.json'), JSON.stringify(ws));
  return join(dir, 'workspace.json');
}

function pageData(html: string) {
  const m = html.match(/<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/);
  expect(m, 'the page has a graph-data element').toBeTruthy();
  return JSON.parse(m![1]);
}

describe('the workspace file', () => {
  it('loads all graphs with their cross links', () => {
    const { data, warnings } = loadWorkspace(workspacePath);
    expect(warnings).toEqual([]);
    expect(data.title).toBe('Shop workspace');
    expect(data.graphs.map((g) => [g.id, g.label])).toEqual([
      ['req', 'Requirements'],
      ['domain', 'Domain model'],
    ]);
    expect(data.graphs[0].model.crossLinks).toEqual([
      { s: 'epic-checkout', field: 'terms', graph: 'domain', t: 'basket' },
      { s: 'story-pay-by-card', field: 'terms', graph: 'domain', t: 'card' },
      { s: 'story-pay-by-card', field: 'terms', graph: 'domain', t: 'payment' },
      { s: 'story-save-card', field: 'terms', graph: 'domain', t: 'card' },
    ]);
    expect(data.graphs[1].model.crossLinks).toEqual([]);
  });
  it('refuses a graph id that appears twice', () => {
    const file = copyWorkspace((ws) => (ws.graphs[1].id = 'req'));
    expect(() => loadWorkspace(file)).toThrow(/"req" is not unique/);
  });
  it('refuses a file that does not match the schema', () => {
    const file = copyWorkspace((ws) => delete ws.graphs[0].label);
    expect(() => loadWorkspace(file)).toThrow(/label/);
  });
  it('names the graph id in the message of an invalid graph or profile', () => {
    const badGraph = copyWorkspace((ws) => (ws.graphs[1].graph = 'domain/missing.json'));
    expect(() => loadWorkspace(badGraph)).toThrow(/Graph "domain": Cannot read the graph/);
    const dir = tmp();
    cpSync(fixtures, dir, { recursive: true });
    writeFileSync(join(dir, 'domain', 'profile.json'), '{"project":"x"}');
    expect(() => loadWorkspace(join(dir, 'workspace.json'))).toThrow(/Graph "domain": The profile/);
  });
  it('refuses a cross link to a graph that the workspace does not have', () => {
    const file = copyWorkspace((ws) => (ws.graphs = ws.graphs.slice(0, 1)));
    expect(() => loadWorkspace(file)).toThrow(/Graph "req": the cross link "terms" names the unknown graph "domain"/);
  });
  it('warns about a cross link to a node that the target graph does not have', () => {
    const dir = tmp();
    cpSync(fixtures, dir, { recursive: true });
    const graph = json<{ nodes: Record<string, unknown>[] }>('product/graph.json');
    graph.nodes.find((n) => n.id === 'epic-checkout')!.terms = ['basket', 'missing-term'];
    writeFileSync(join(dir, 'product', 'graph.json'), JSON.stringify(graph));
    const { warnings } = loadWorkspace(join(dir, 'workspace.json'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Graph "req": 1 cross link\(s\) in "terms" name a node that is not in the graph "domain" \("missing-term"\)/);
  });
  it('excludes paths of a graph folder with the exclude option', () => {
    const dir = tmp();
    cpSync(fixtures, dir, { recursive: true });
    cpSync(new URL('../fixtures/glossary/yaml', import.meta.url).pathname, join(dir, 'domain', 'yaml'), { recursive: true });
    cpSync(new URL('../fixtures/glossary/yaml/term', import.meta.url).pathname, join(dir, 'domain', 'yaml', 'schema'), { recursive: true });
    const ws = JSON.parse(readFileSync(join(dir, 'workspace.json'), 'utf8'));
    ws.graphs[1].graph = 'domain/yaml';
    writeFileSync(join(dir, 'workspace.json'), JSON.stringify(ws));
    expect(() => loadWorkspace(join(dir, 'workspace.json'))).toThrow(/Graph "domain".*not unique/s);
    ws.graphs[1].exclude = ['schema'];
    writeFileSync(join(dir, 'workspace.json'), JSON.stringify(ws));
    expect(loadWorkspace(join(dir, 'workspace.json')).data.graphs[1].model.nodes.length).toBeGreaterThan(0);
  });
});

describe('the cross links in the model', () => {
  const { data } = loadWorkspace(workspacePath);
  const [req, domain] = data.graphs;

  it('stay apart from the edges of the graph', () => {
    expect(req.model.edges.some((e) => e.k === 'terms')).toBe(false);
    expect(req.model.unresolved).toEqual([]);
  });
  it('give each node of the index a list of outgoing cross links', () => {
    const index = buildIndex(req.model);
    expect(index.crossOut.get('story-pay-by-card')!.map((c) => c.t)).toEqual(['card', 'payment']);
    expect(index.crossOut.get('story-search-synonyms')).toBeUndefined();
  });
  it('give the incoming cross links of each target node across the workspace', () => {
    const incoming = incomingCrossLinks(data.graphs);
    const card = incoming.get('domain')!.get('card')!;
    expect(card.map((c) => c.s)).toEqual(['story-pay-by-card', 'story-save-card']);
    expect(card[0]).toEqual({ graph: 'req', s: 'story-pay-by-card', field: 'terms', label: 'Uses term' });
    expect(incoming.get('domain')!.get('refund')).toBeUndefined();
    expect(incoming.get('req')!.size).toBe(0);
  });
  it('leave a link to a missing node out of the incoming links and report it as a warning', () => {
    const graph = json<{ nodes: Record<string, unknown>[] }>('product/graph.json');
    graph.nodes[1].terms = ['nothing'];
    const model = buildModel(graph, req.model.profile);
    const graphs = [{ ...req, model }, domain];
    expect(incomingCrossLinks(graphs).get('domain')!.has('nothing')).toBe(false);
    const checked = checkCrossLinks(graphs);
    expect(checked.errors).toEqual([]);
    expect(checked.warnings.some((w) => w.includes('"nothing"'))).toBe(true);
  });
  it('report a link to an unknown graph as an error', () => {
    expect(checkCrossLinks([req]).errors).toEqual(['Graph "req": the cross link "terms" names the unknown graph "domain"']);
  });
});

describe('the cross link fields in the inputs', () => {
  const profile = json<Profile>('product/profile.json');
  it('accept the profile with crossLinks', () => {
    expect(validateProfile(profile)).toEqual([]);
  });
  it('refuse a crossLinks entry that is also a link field', () => {
    const bad = { ...profile, crossLinks: [{ field: 'complies', graph: 'domain', label: 'x' }] };
    expect(validateProfile(bad).join()).toMatch(/also a parent or link field/);
  });
  it('refuse a cross link field that is not a list of ids', () => {
    const graph: Graph = { nodes: [{ id: 'a', kind: 'epic', terms: 'basket' }] };
    expect(validateGraph(graph, profile).errors.join()).toMatch(/Cross link field "terms" of "a" is not a list of ids/);
  });
});

describe('the workspace on the command line', () => {
  it('refuses --workspace together with --graph or --profile', async () => {
    const out = join(tmp(), 'page.html');
    expect(await run(['build', '--workspace', workspacePath, '--graph', 'a.json', '--out', out])).toBe(1);
    expect(await run(['build', '--workspace', workspacePath, '--profile', 'p.json', '--out', out])).toBe(1);
    expect(await run(['serve', '--workspace', workspacePath, '--graph', 'a.json'])).toBe(1);
  });
  it('writes 1 page that holds all graphs with the build command', async () => {
    const out = join(tmp(), 'out', 'page.html');
    expect(await run(['build', '--workspace', workspacePath, '--out', out])).toBe(0);
    const html = readFileSync(out, 'utf8');
    expect(html).toContain('<title>Semspec – Shop workspace</title>');
    const data = pageData(html) as WorkspaceData;
    expect(data.title).toBe('Shop workspace');
    expect(data.graphs.map((g) => g.id)).toEqual(['req', 'domain']);
    const ids = (i: number) => new Set(data.graphs[i].model.nodes.map((n) => n.id));
    expect(ids(0).has('story-pay-by-card')).toBe(true);
    expect(ids(1).has('basket')).toBe(true);
    expect(data.graphs[0].model.crossLinks.length).toBe(4);
  });
  it('serves the workspace page with the serve command', async () => {
    const server = await startWorkspaceServer(workspacePath, 0, '127.0.0.1');
    try {
      const html = await (await fetch(server.url)).text();
      expect((pageData(html) as WorkspaceData).graphs).toHaveLength(2);
    } finally {
      await server.close();
    }
  });
  it('refuses a build with --workspace and no --out', async () => {
    expect(await run(['build', '--workspace', workspacePath])).toBe(1);
  });
});
