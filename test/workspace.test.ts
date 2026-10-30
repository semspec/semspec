// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the workspace: the file, the cross links, the checks and the page.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildIndex, buildModel, checkCrossLinks, fieldLabel, incomingCrossLinks, propertyLabel, type Graph, type Profile, type WorkspaceData } from '@core/index';
import { findContainers } from '../src/app/lib/layouts';
import { run, startWorkspaceServer } from '../src/cli/index';
import { loadWorkspace } from '../src/cli/workspace';
import { validateGraph, validateProfile } from '../src/cli/validate';

const fixtures = new URL('../fixtures/workspace/', import.meta.url).pathname;
const workspacePath = join(fixtures, 'workspace.json');
// Each temp folder goes when the file ends.
const made: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ws-'));
  made.push(dir);
  return dir;
};
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));
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
      ['domain', 'Retail market'],
    ]);
    const links = data.graphs[0].model.crossLinks;
    expect(links.length).toBe(37);
    expect(links.filter((c) => c.s === 'story-pay-by-card').map((c) => c.t)).toEqual(['pay-card', 'prov-payvale', 'prov-tillpay', 'prov-quillpay']);
    expect(links.every((c) => c.field === 'concerns' && c.graph === 'domain')).toBe(true);
    expect(data.graphs[1].model.crossLinks.every((c) => c.field === 'area' && c.graph === 'req')).toBe(true);
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
    writeFileSync(join(dir, 'domain', 'profile.yaml'), 'project: x\n');
    expect(() => loadWorkspace(join(dir, 'workspace.json'))).toThrow(/Graph "domain": The profile/);
  });
  it('refuses a cross link to a graph that the workspace does not have', () => {
    const file = copyWorkspace((ws) => (ws.graphs = ws.graphs.slice(0, 1)));
    expect(() => loadWorkspace(file)).toThrow(/Graph "req": the cross link "concerns" names the unknown graph "domain"/);
  });
  it('warns about a cross link to a node that the target graph does not have', () => {
    const dir = tmp();
    cpSync(fixtures, dir, { recursive: true });
    const graph = json<{ nodes: Record<string, unknown>[] }>('product/graph.json');
    graph.nodes.find((n) => n.id === 'epic-checkout')!.concerns = ['pay-card', 'missing-term'];
    writeFileSync(join(dir, 'product', 'graph.json'), JSON.stringify(graph));
    const { warnings } = loadWorkspace(join(dir, 'workspace.json'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Graph "req": 1 cross link\(s\) in "concerns" name a node that is not in the graph "domain" \("missing-term"\)/);
  });
  it('excludes paths of a graph folder with the exclude option', () => {
    const dir = tmp();
    cpSync(fixtures, dir, { recursive: true });
    cpSync(new URL('../fixtures/glossary/yaml', import.meta.url).pathname, join(dir, 'domain', 'yaml'), { recursive: true });
    cpSync(new URL('../fixtures/glossary/yaml/term', import.meta.url).pathname, join(dir, 'domain', 'yaml', 'schema'), { recursive: true });
    const ws = JSON.parse(readFileSync(join(dir, 'workspace.json'), 'utf8'));
    cpSync(new URL('../fixtures/glossary/profile.json', import.meta.url).pathname, join(dir, 'domain', 'glossary-profile.json'));
    cpSync(new URL('../fixtures/glossary/vocabularies', import.meta.url).pathname, join(dir, 'domain', 'vocabularies'), { recursive: true });
    ws.graphs[1].graph = 'domain/yaml';
    ws.graphs[1].profile = 'domain/glossary-profile.json';
    writeFileSync(join(dir, 'workspace.json'), JSON.stringify(ws));
    expect(() => loadWorkspace(join(dir, 'workspace.json'))).toThrow(/Graph "domain".*not unique/s);
    ws.graphs[1].exclude = ['schema'];
    writeFileSync(join(dir, 'workspace.json'), JSON.stringify(ws));
    expect(loadWorkspace(join(dir, 'workspace.json')).data.graphs[1].model.nodes.length).toBeGreaterThan(0);
  });
});

describe('the retail market model of the workspace', () => {
  const { data, warnings } = loadWorkspace(workspacePath);
  const domain = data.graphs[1];
  const profile = domain.model.profile;
  const count = (kind: string) => domain.model.nodes.filter((n) => n.kind === kind).length;
  const index = buildIndex(domain.model);
  const edge = (s: string, k: string, t: string) => index.out.get(s)!.find((e) => e.k === k && e.t === t);

  it('has 80 nodes in 15 kinds and no validation warning', () => {
    expect(warnings).toEqual([]);
    expect(domain.model.nodes.length).toBe(80);
    const kinds = ['group', 'shop', 'marketplace', 'provider', 'carrier', 'zone', 'market', 'authority', 'category', 'delivery', 'method', 'rule', 'article', 'source', 'area'];
    expect(kinds.map(count)).toEqual([3, 6, 2, 4, 3, 3, 6, 3, 12, 4, 4, 6, 14, 8, 2]);
    expect(domain.model.unresolved).toEqual([]);
  });
  it('shows the zones as containers of the markets in the grouped layout', () => {
    expect(profile.layout).toEqual({ default: 'grouped', groupEdge: 'inZone' });
    const ids = domain.model.nodes.map((n) => n.id);
    const found = findContainers(ids, domain.model.edges, 'inZone');
    expect(found.parentOf.get('mkt-alderland')).toBe('zone-north');
    expect(found.children.get('zone-coast')!.sort()).toEqual(['mkt-eastreach', 'mkt-fenwick']);
    expect(found.roots.filter((id) => found.children.has(id)).sort()).toEqual(['zone-central', 'zone-coast', 'zone-north']);
  });
  it('keeps the properties of an edge, with the provenance of the edge', () => {
    expect(edge('shop-brightcart', 'operatesIn', 'mkt-calder')!.p).toMatchObject({ status: 'pilot', since: '2025', how: 'verified', source: 'src-market-survey' });
    expect(edge('shop-brightcart', 'ownedBy', 'grp-veldt')!.p).toMatchObject({ share: 0.8, since: '2019' });
    expect(edge('shop-brightcart', 'usesProvider', 'car-swiftroad')!.p).toMatchObject({ share: 0.7, since: '2019' });
    expect(edge('shop-oldcart', 'succeededBy', 'shop-brightcart')!.p).toMatchObject({ date: '2021-06' });
    expect(edge('mkt-calder', 'supervisedBy', 'auth-north')).toBeDefined();
    expect(index.out.get('mkt-calder')!.filter((e) => e.k === 'supervisedBy').length).toBe(2);
  });
  it('declares from, to and typed properties for every edge', () => {
    for (const [name, spec] of Object.entries(profile.edges)) {
      expect(spec.from?.length, name).toBeGreaterThan(0);
      expect(spec.to?.length, name).toBeGreaterThan(0);
    }
    expect(profile.edges.operatesIn.properties).toMatchObject({ status: { type: 'string', vocabulary: 'status', required: true }, since: { type: 'date', required: true } });
    expect(profile.edges.ownedBy.to).toEqual(['group']);
    expect(profile.edges.broader.from).toEqual(['category']);
  });
  it('builds the category taxonomy in 3 levels and the articles of a rule', () => {
    expect(edge('cat-running-shoes', 'broader', 'cat-footwear')).toBeDefined();
    expect(edge('cat-footwear', 'broader', 'cat-fashion')).toBeDefined();
    expect(domain.model.nodes.filter((n) => n.kind === 'category' && !n.parents.length).length).toBe(4);
    expect(edge('art-refund-time', 'inRule', 'rule-refund')).toBeDefined();
    expect(domain.model.nodes.filter((n) => n.kind === 'article' && n.parents.includes('rule-refund')).length).toBe(3);
  });
  it('gives each coded field a vocabulary with labels, and the segments a broader level', () => {
    expect(fieldLabel(profile, 'state', 'pilot')).toBe('Pilot');
    expect(fieldLabel(profile, 'segment', 'fashion')).toBe('Fashion retail');
    expect(fieldLabel(profile, 'zoneCode', 'coa')).toBe('COA');
    expect(profile.vocabularies!.segment.concepts.find((c) => c.code === 'payments')!.broader).toBe('infrastructure');
    expect(profile.vocabularies!.how.concepts.map((c) => c.code)).toEqual(['verified', 'reported', 'inferred']);
    expect(propertyLabel(profile, 'operatesIn', 'status', 'suspended')).toBe('Suspended');
  });
  it('records the provenance marker of the nodes, and gives each verified fact a source', () => {
    const marked = domain.model.nodes.filter((n) => n.kind !== 'source' && n.kind !== 'area');
    const by = (how: string) => marked.filter((n) => n.d.how === how);
    expect(by('verified').length + by('reported').length + by('inferred').length).toBe(marked.length);
    expect(by('verified').length).toBeGreaterThan(by('reported').length);
    expect(by('inferred').length).toBeGreaterThan(0);
    expect(by('verified').every((n) => typeof n.d.source === 'string')).toBe(true);
    expect(profile.provenance!.requireSource).toEqual(['verified']);
    expect(edge('art-withdrawal-period', 'derivedFrom', 'src-consumer-code')).toBeDefined();
  });
  it('keeps the basis of a rule as a tagged list with the keys as filter values', () => {
    const rule = domain.model.nodes.find((n) => n.id === 'rule-warranty')!;
    expect(rule.d.basis).toEqual([{ ruling: { court: 'Basin Court' } }, { guideline: {} }]);
    expect(profile.fieldFilters!.find((f) => f.field === 'basis')).toMatchObject({ from: 'keys' });
  });
  it('maps some kinds to schema.org classes, with a base IRI under example.org', () => {
    expect(profile.iri!.base).toBe('https://example.org/retail/');
    expect(profile.kinds.filter((k) => k.iri?.startsWith('schema:')).map((k) => k.iri!).sort()).toEqual([
      'schema:Legislation', 'schema:Organization', 'schema:Organization', 'schema:Organization', 'schema:Organization', 'schema:Place', 'schema:Product', 'schema:Store',
    ]);
  });
});

describe('the cross links in the model', () => {
  const { data } = loadWorkspace(workspacePath);
  const [req, domain] = data.graphs;

  it('stay apart from the edges of the graph', () => {
    expect(req.model.edges.some((e) => e.k === 'concerns')).toBe(false);
    expect(req.model.unresolved).toEqual([]);
  });
  it('give each node of the index a list of outgoing cross links', () => {
    const index = buildIndex(req.model);
    expect(index.crossOut.get('story-pay-by-card')!.map((c) => c.t).slice(0, 2)).toEqual(['pay-card', 'prov-payvale']);
    expect(index.crossOut.get('prd-shop')).toBeUndefined();
  });
  it('give the incoming cross links of each target node across the workspace', () => {
    const incoming = incomingCrossLinks(data.graphs);
    const refund = incoming.get('domain')!.get('rule-refund')!;
    expect(refund.map((c) => c.s)).toEqual(['story-loose-child']);
    expect(refund[0]).toEqual({ graph: 'req', s: 'story-loose-child', field: 'concerns', label: 'Concerns' });
    const card = incoming.get('domain')!.get('pay-card')!;
    expect(card.map((c) => c.s)).toEqual(['epic-checkout', 'story-pay-by-card', 'story-pay-by-card-3ds', 'story-save-card', 'story-loose-child', 'dec-use-psp']);
    expect(incoming.get('domain')!.get('rule-warranty')).toBeUndefined();
    expect(incoming.get('domain')!.size).toBeGreaterThanOrEqual(20);
    expect(incoming.get('req')!.size).toBe(2);
  });
  it('leave a link to a missing node out of the incoming links and report it as a warning', () => {
    const graph = json<{ nodes: Record<string, unknown>[] }>('product/graph.json');
    graph.nodes[1].concerns = ['nothing'];
    const model = buildModel(graph, req.model.profile);
    const graphs = [{ ...req, model }, domain];
    expect(incomingCrossLinks(graphs).get('domain')!.has('nothing')).toBe(false);
    const checked = checkCrossLinks(graphs);
    expect(checked.errors).toEqual([]);
    expect(checked.warnings.some((w) => w.includes('"nothing"'))).toBe(true);
  });
  it('report a link to an unknown graph as an error', () => {
    expect(checkCrossLinks([req]).errors).toEqual(['Graph "req": the cross link "concerns" names the unknown graph "domain"']);
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
  it('refuse a cross link field that is not an id or a list of ids', () => {
    const graph: Graph = { nodes: [{ id: 'a', kind: 'epic', concerns: 42 }] };
    expect(validateGraph(graph, profile).errors.join()).toMatch(/Cross link field "concerns" of "a" is not an id or a list of ids/);
  });
  it('accept a cross link field with 1 id', () => {
    const graph: Graph = { nodes: [{ id: 'a', kind: 'epic', concerns: 'pay-card' }] };
    expect(validateGraph(graph, profile).errors).toEqual([]);
  });
  it('refuse a cross link field that is a parent field, and accept one that is an embedded field', () => {
    const domain = loadWorkspace(workspacePath).data.graphs[1].model.profile;
    expect(domain.crossLinks).toEqual([{ field: 'area', graph: 'req', label: 'Area in the requirements' }]);
    expect(domain.embedded!.some((e) => e.field === 'area')).toBe(true);
    for (const field of ['inArea', 'ownedBy', 'supervisedBy']) {
      expect(validateProfile({ ...domain, crossLinks: [{ field, graph: 'req', label: 'x' }] }).join(), field).toMatch(/also a parent or link field/);
    }
  });
  it('make the group node and its members point at the same node of the other graph', () => {
    const { data } = loadWorkspace(workspacePath);
    const [req, domain] = data.graphs;
    const links = domain.model.crossLinks.map((c) => `${c.s}>${c.t}`).sort();
    expect(links).toEqual(['auth-central>epic-search', 'auth-coast>epic-checkout', 'auth-north>epic-checkout', 'epic-checkout>epic-checkout', 'epic-search>epic-search']);
    expect(domain.model.nodes.find((n) => n.id === 'epic-checkout')!.kind).toBe('area');
    expect(domain.model.nodes.find((n) => n.id === 'auth-north')!.d).not.toHaveProperty('area');
    const used = incomingCrossLinks(data.graphs).get('req')!.get('epic-checkout')!;
    expect(used.map((c) => c.s).sort()).toEqual(['auth-coast', 'auth-north', 'epic-checkout']);
    expect(req.model.nodes.some((n) => n.id === 'epic-checkout')).toBe(true);
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
    expect(ids(1).has('pay-card')).toBe(true);
    expect(data.graphs[0].model.crossLinks.length).toBe(37);
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
