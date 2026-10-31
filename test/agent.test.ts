// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the agent functions of the core: schema, node detail, trace, walk, impact, gaps and the check of a new node.
// The fixtures are the 2 profiles of the workspace fixture.
import { describe, expect, it } from 'vitest';
import { QueryError, buildModel, describeSchema, gaps, impact, indexGraphs, nodeDetail, trace, validateNode, walk } from '@semspec/core';
import { loadWorkspace } from '../packages/cli/src/workspace';

const workspacePath = new URL('../fixtures/workspace/workspace.json', import.meta.url).pathname;
const { data, sources } = loadWorkspace(workspacePath);
const graphs = indexGraphs(data.graphs);
const req = sources.get('req')!;
const domain = sources.get('domain')!;
const ids = (list: unknown) => (list as { id: string }[]).map((x) => x.id);

describe('describeSchema', () => {
  it('lists kinds, edges, vocabularies and cross links of the product profile', () => {
    const s = describeSchema(graphs[0].index.profile) as any;
    expect(s.kinds.map((k: any) => k.id)).toContain('story');
    expect(s.kinds.find((k: any) => k.id === 'story')).toMatchObject({ role: 'hierarchy', parentFields: ['epics', 'follows'], placedUnder: 'epic' });
    expect(s.crossLinks).toEqual([{ field: 'concerns', graph: 'domain', label: 'Concerns' }]);
    expect(s.status.values.map((v: any) => v.value)).toEqual(['pass', 'partial', 'fail']);
  });
  it('lists edge properties, vocabulary codes and provenance of the domain profile', () => {
    const s = describeSchema(graphs[1].index.profile) as any;
    expect(s.edges.find((e: any) => e.name === 'ownedBy').properties).toEqual({ share: { type: 'number', required: true }, since: { type: 'date', required: true } });
    const how = s.vocabularies.find((v: any) => v.id === 'how');
    expect(how.concepts.map((c: any) => c.code)).toEqual(['verified', 'reported', 'inferred']);
    expect(how.concepts[0].definition).toBeTruthy();
    expect(s.provenance).toMatchObject({ marker: { field: 'how', vocabulary: 'how' }, source: { field: 'source', kind: 'source', edge: 'derivedFrom' }, requireSource: ['verified'] });
  });
  it('returns the JSON Schema of 1 kind, and refuses an unknown kind', () => {
    expect((describeSchema(graphs[0].index.profile, 'story') as any).schema.title).toBe('Story');
    expect(() => describeSchema(graphs[0].index.profile, 'nope')).toThrow(QueryError);
  });
});

describe('nodeDetail', () => {
  it('returns the node with status, edges, parents and cross links', () => {
    const d = nodeDetail(graphs, 'req', 'story-pay-by-card') as any;
    expect(d).toMatchObject({ graph: 'req', kind: 'story', title: 'Pay by card', lifecycle: 'planned', status: { value: 'partial', tone: 'warn', own: false } });
    expect(d.fields).toEqual({ priority: 'high', release: 'r1', teams: ['payments', 'web'] });
    expect(ids(d.parents)).toEqual(['epic-checkout']);
    expect(ids(d.edges.out.complies)).toEqual(['std-card-data']);
    expect(ids(d.edges.in.scenario)).toEqual(['story-pay-by-card#declined', 'story-pay-by-card#charged']);
    expect(ids(d.crossLinks)).toEqual(['pay-card', 'prov-payvale', 'prov-tillpay', 'prov-quillpay']);
    expect(d.crossLinks[0]).toMatchObject({ graph: 'domain', title: 'Card payment' });
  });
  it('returns edge properties, provenance and used-by links', () => {
    const shop = nodeDetail(graphs, 'domain', 'shop-brightcart') as any;
    expect(shop.edges.out.ownedBy[0].props).toMatchObject({ share: expect.any(Number), since: expect.any(String) });
    const withSource = (graphs[1].index.model.nodes.find((n) => n.d.source) as any).id;
    const p = (nodeDetail(graphs, 'domain', withSource) as any).provenance;
    expect(p.source).toBeTruthy();
    expect(p.sourceTitle).toBeTruthy();
    const area = nodeDetail(graphs, 'req', 'epic-checkout') as any;
    expect(area.usedBy.length).toBeGreaterThan(0);
  });
  it('cuts a list at the limit and says so', () => {
    const d = nodeDetail(graphs, 'domain', 'pay-card', 2) as any;
    expect(d.edges.in.offers).toHaveLength(2);
    expect(d.truncated['edges.in.offers']).toBeGreaterThan(0);
  });
  it('names an unknown id and an unknown graph', () => {
    expect(() => nodeDetail(graphs, 'req', 'nope')).toThrow('Unknown node id "nope"');
    expect(() => nodeDetail(graphs, 'zzz', 'nope')).toThrow('Unknown graph "zzz"');
    expect((nodeDetail(graphs, undefined, 'prd-shop') as any).graph).toBe('req');
  });
});

describe('trace', () => {
  it('goes up to the root', () => {
    const t = trace(graphs, 'req', 'story-pay-by-card', 'up') as any;
    expect(t.paths).toEqual([['story-pay-by-card', 'epic-checkout', 'prd-shop']]);
    expect(t.nodes['prd-shop']).toEqual({ kind: 'product', title: 'Shop' });
  });
  it('goes up through 2 parent kinds in the domain graph', () => {
    const t = trace(graphs, 'domain', 'shop-brightcart', 'up') as any;
    expect(t.paths.every((p: string[]) => p[0] === 'shop-brightcart')).toBe(true);
    expect(t.paths.length).toBeGreaterThan(0);
  });
  it('goes down to a depth, marks a repeated node and counts the nodes below', () => {
    const t = trace(graphs, 'req', 'epic-checkout', 'down', 1) as any;
    expect(t.tree.children.map((c: any) => c.id)).toEqual(['story-pay-by-card', 'story-save-card']);
    expect(t.tree.children[0].more).toBe(4);
    const deep = trace(graphs, 'req', 'epic-checkout', 'down', 2) as any;
    expect(deep.tree.children[1].seen).toBe(true);
    expect(deep.below).toBe(5);
  });
  it('cuts the tree at the limit', () => {
    const t = trace(graphs, 'req', 'prd-shop', 'down', 5, 3) as any;
    expect(t.truncated.nodes).toBeGreaterThan(0);
  });
  it('names an unknown id', () => {
    expect(() => trace(graphs, 'req', 'nope', 'up')).toThrow('Unknown node id "nope"');
  });
});

describe('impact', () => {
  it('groups nodes below, nodes that link in, and cross links in, by graph and kind', () => {
    const r = impact(graphs, 'domain', 'pay-card') as any;
    const group = (graph: string, kind: string) => r.groups.find((g: any) => g.graph === graph && g.kind === kind);
    expect(ids(group('req', 'story').items)).toContain('story-pay-by-card');
    expect(group('req', 'story').items[0].via).toBe('cross:concerns');
    expect(group('domain', 'shop').items[0].via).toBe('edge:offers');
    expect(r.total).toBe(14);
  });
  it('lists everything below a node in the scope', () => {
    const r = impact(graphs, 'req', 'epic-checkout') as any;
    const below = r.groups.flatMap((g: any) => g.items).filter((i: any) => i.via === 'below');
    expect(below.map((i: any) => i.id)).toContain('story-pay-by-card#declined');
    expect(r.groups.flatMap((g: any) => g.items).filter((i: any) => i.via.startsWith('cross:')).map((i: any) => i.id).length).toBeGreaterThan(0);
  });
  it('cuts a group at the limit', () => {
    const r = impact(graphs, 'domain', 'pay-card', 1) as any;
    expect(r.truncated['req.story']).toBe(3);
    expect(r.groups.find((g: any) => g.kind === 'story').count).toBe(4);
  });
  it('names an unknown id', () => {
    expect(() => impact(graphs, 'req', 'nope')).toThrow('Unknown node id "nope"');
  });
});

describe('walk', () => {
  const group = (r: any, step: number, edge: string, direction: string) => r.steps.find((x: any) => x.step === step)?.groups.find((x: any) => x.edge === edge && x.direction === direction);
  const all = (r: any) => r.steps.flatMap((x: any) => x.groups.flatMap((y: any) => y.nodes.map((n: any) => `${n.graph}:${n.id}`)));

  it('groups the neighbours by edge and direction, with the label of that direction (product profile)', () => {
    const r = walk(graphs, 'req', 'story-pay-by-card') as any;
    expect(r.steps).toHaveLength(1);
    expect(group(r, 1, 'epics', 'out')).toMatchObject({ label: 'In epic', nodes: [{ graph: 'req', id: 'epic-checkout', kind: 'epic', title: 'Checkout', status: 'partial' }] });
    expect(group(r, 1, 'scenario', 'in').label).toBe('Has scenario');
    expect(ids(group(r, 1, 'scenario', 'in').nodes)).toEqual(['story-pay-by-card#declined', 'story-pay-by-card#charged']);
    expect(group(r, 1, 'scenario', 'in').nodes[0].status).toBe('pass');
    expect(r.paths).toBeUndefined();
  });
  it('returns edge properties (domain profile)', () => {
    const r = walk(graphs, 'domain', 'shop-brightcart', { edges: ['ownedBy'], direction: 'out' }) as any;
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].groups).toHaveLength(1);
    expect(r.steps[0].groups[0]).toMatchObject({ edge: 'ownedBy', direction: 'out', label: 'Owned by' });
    expect(r.steps[0].groups[0].nodes[0].props).toMatchObject({ share: expect.any(Number), since: expect.any(String) });
  });
  it('filters by edge name', () => {
    const r = walk(graphs, 'req', 'story-pay-by-card', { edges: ['complies'], crossLinks: false }) as any;
    expect(all(r)).toEqual(['req:std-card-data']);
  });
  it('filters by direction', () => {
    const out = walk(graphs, 'req', 'story-pay-by-card', { direction: 'out', crossLinks: false }) as any;
    const inc = walk(graphs, 'req', 'story-pay-by-card', { direction: 'in', crossLinks: false }) as any;
    expect(out.steps[0].groups.map((x: any) => x.edge)).toEqual(['epics', 'complies']);
    expect(inc.steps[0].groups.every((x: any) => x.direction === 'in')).toBe(true);
    expect(inc.steps[0].groups.map((x: any) => x.edge)).toContain('scenario');
  });
  it('keeps only the kinds that are asked for', () => {
    const r = walk(graphs, 'req', 'story-pay-by-card', { kinds: ['scenario'] }) as any;
    expect(all(r)).toEqual(['req:story-pay-by-card#declined', 'req:story-pay-by-card#charged']);
    expect(() => walk(graphs, 'req', 'story-pay-by-card', { kinds: ['nope'] })).toThrow('Unknown kind "nope"');
    expect(() => walk(graphs, 'req', 'story-pay-by-card', { edges: ['nope'] })).toThrow('Unknown edge "nope"');
  });
  it('follows cross links out and in, and skips them with crossLinks false', () => {
    const out = walk(graphs, 'req', 'story-pay-by-card') as any;
    expect(group(out, 1, 'concerns', 'out')).toMatchObject({ cross: true, label: 'Concerns' });
    expect(group(out, 1, 'concerns', 'out').nodes[0]).toMatchObject({ graph: 'domain', id: 'pay-card' });
    const inc = walk(graphs, 'domain', 'pay-card', { edges: ['concerns'] }) as any;
    expect(group(inc, 1, 'concerns', 'in').nodes.map((n: any) => `${n.graph}:${n.id}`)).toContain('req:story-pay-by-card');
    expect(all(walk(graphs, 'req', 'story-pay-by-card', { crossLinks: false })).some((x: string) => x.startsWith('domain:'))).toBe(false);
  });
  it('walks 2 steps with paths and never repeats a node', () => {
    const r = walk(graphs, 'req', 'epic-checkout', { depth: 2, limit: 500 }) as any;
    const list = all(r);
    expect(new Set(list).size).toBe(list.length);
    expect(list).not.toContain('req:epic-checkout');
    expect(r.steps.map((x: any) => x.step)).toEqual([1, 2]);
    expect(r.steps[1].groups.flatMap((x: any) => x.nodes).every((n: any) => typeof n.from === 'string')).toBe(true);
    expect(r.paths.length).toBe(r.steps[1].groups.flatMap((x: any) => x.nodes).length);
    expect(r.paths.every((p: string) => p.startsWith('epic-checkout ') && p.includes(' -') || p.includes(' <'))).toBe(true);
    const step1 = new Set(r.steps[0].groups.flatMap((x: any) => x.nodes.map((n: any) => n.id)));
    expect(r.steps[1].groups.flatMap((x: any) => x.nodes).some((n: any) => step1.has(n.id))).toBe(false);
    expect(r.total).toBe(list.length);
  });
  it('passes into the other graph at depth 2 and names the way', () => {
    const r = walk(graphs, 'req', 'story-pay-by-card', { depth: 2, edges: ['concerns', 'offers'], limit: 500 }) as any;
    expect(r.paths).toContain('story-pay-by-card =concerns=> domain:pay-card <-offers- domain:shop-brightcart');
  });
  it('cuts the nodes at the limit and says so', () => {
    const r = walk(graphs, 'domain', 'pay-card', { depth: 3, limit: 3 }) as any;
    expect(all(r)).toHaveLength(3);
    expect(r.truncated.nodes).toBeGreaterThan(0);
    expect(r.note).toContain('limit of 3');
    expect(walk(graphs, 'domain', 'pay-card', { depth: 1, limit: 500 })).not.toHaveProperty('truncated');
  });
  it('names an unknown id, graph, direction and depth', () => {
    expect(() => walk(graphs, 'req', 'nope')).toThrow('Unknown node id "nope"');
    expect(() => walk(graphs, 'zzz', 'x')).toThrow('Unknown graph "zzz"');
    expect(() => walk(graphs, 'req', 'prd-shop', { direction: 'up' as any })).toThrow('"direction"');
    expect(() => walk(graphs, 'req', 'prd-shop', { depth: 4 })).toThrow('"depth"');
  });
});

describe('gaps', () => {
  it('finds red nodes, parts with no check and unplaced nodes in the product graph', () => {
    const r = gaps(graphs, 'req') as any;
    expect(ids(r.status)).toEqual(['story-loose-child', 'story-pay-by-card#charged']);
    expect(r.status[0].tone).toBe('bad');
    expect(r.uncheckedParts).toEqual([{ id: 'story-pay-by-card#charged', kind: 'scenario', title: 'Charged', owner: 'story-pay-by-card' }]);
    expect(ids(r.unplaced)).toEqual(['story-loose', 'story-loose-child']);
    expect(r.counts).toMatchObject({ status: 2, uncheckedParts: 1, unplaced: 2, unresolvedLinks: 0 });
  });
  it('finds facts with no source in the domain graph', () => {
    const r = gaps(graphs, 'domain') as any;
    expect(ids(r.withoutSource)).toContain('mkt-eastreach');
    expect(r.counts.withoutSource).toBe(7);
  });
  it('limits the scope to a node and adds the roll-up', () => {
    const r = gaps(graphs, 'req', 'story-pay-by-card') as any;
    expect(r.scope).toBe('story-pay-by-card');
    expect(ids(r.status)).toEqual(['story-pay-by-card#charged']);
    expect(r.rollup.value).toBe('partial');
    expect(r.unplaced).toEqual([]);
  });
  it('cuts a list at the limit', () => {
    const r = gaps(graphs, 'domain', undefined, 2) as any;
    expect(r.withoutSource).toHaveLength(2);
    expect(r.truncated.withoutSource).toBe(5);
  });
  it('reports a link to a missing node and a broken cross link', () => {
    const graph = structuredClone(req.graph) as any;
    graph.nodes.push({ id: 'story-ghost', kind: 'story', epics: ['epic-checkout'], follows: ['story-missing'], concerns: ['no-such-node'] });
    const patched = indexGraphs([{ ...data.graphs[0], model: buildModel(graph, req.profile) }, data.graphs[1]]);
    const r = gaps(patched, 'req') as any;
    expect(r.unresolvedLinks).toEqual([{ from: 'story-ghost', edge: 'follows', to: 'story-missing' }]);
    expect(r.brokenCrossLinks).toEqual([{ from: 'story-ghost', field: 'concerns', graph: 'domain', to: 'no-such-node' }]);
  });
  it('names an unknown scope', () => {
    expect(() => gaps(graphs, 'req', 'nope')).toThrow('Unknown node id "nope"');
  });
});

describe('validateNode', () => {
  const ok = { id: 'story-new', kind: 'story', title: 'New', epics: ['epic-checkout'], priority: 'low' };
  it('accepts a valid node of the product profile and writes nothing', () => {
    const before = JSON.stringify(req.graph);
    const r = validateNode(req.graph, req.profile, ok, graphs);
    expect(r).toEqual({ valid: true, errors: [], warnings: [] });
    expect(JSON.stringify(req.graph)).toBe(before);
  });
  it('reports an unknown kind, a duplicate id and a link field that is not a list', () => {
    expect(validateNode(req.graph, req.profile, { id: 'story-x', kind: 'nope' }).errors).toEqual([expect.stringContaining('unknown kind "nope"')]);
    expect(validateNode(req.graph, req.profile, { ...ok, id: 'prd-shop' }).errors.join()).toContain('not unique');
    expect(validateNode(req.graph, req.profile, { ...ok, epics: 'epic-checkout' }).errors.join()).toContain('is not a list');
  });
  it('warns about an unknown link target and a bad status value', () => {
    const r = validateNode(req.graph, req.profile, { ...ok, epics: ['epic-checkout', 'epic-none'], result: 'maybe' });
    expect(r.valid).toBe(true);
    expect(r.warnings.join('\n')).toContain('unknown node "epic-none"');
    expect(r.warnings.join('\n')).toContain('"maybe", which is not a status value');
  });
  it('warns about a cross link to a node that the other graph lacks', () => {
    const r = validateNode(req.graph, req.profile, { ...ok, concerns: ['pay-card', 'no-such-node'] }, graphs);
    expect(r.warnings).toEqual([expect.stringContaining('"no-such-node", which is not a node of the graph "domain"')]);
  });
  it('checks edge properties, vocabulary codes and provenance rules of the domain profile', () => {
    const shop = { id: 'shop-new', kind: 'shop', name: 'New', ownedBy: [{ id: 'grp-none', share: 'half' }] };
    const group = graphs[1].index.model.nodes.find((n) => n.kind === 'group')!.id;
    // The edge and provenance rules apply once the structure of the graph is right.
    const structure = validateNode(domain.graph, domain.profile, { ...shop, ownedBy: [{ id: group, share: 1, since: '2020' }], segment: 'nonsense' });
    expect(structure.valid).toBe(false);
    expect(structure.errors.join()).toContain('not a code of the vocabulary "segment"');
    const bad = validateNode(domain.graph, domain.profile, { ...shop, ownedBy: [{ id: group, share: 'half' }], how: 'verified' });
    const text = bad.errors.join('\n');
    expect(bad.valid).toBe(false);
    expect(text).toContain('property "share"');
    expect(text).toContain('lacks the required property "since"');
    expect(text).toContain('needs a source');
    const good = validateNode(domain.graph, domain.profile, { ...shop, ownedBy: [{ id: group, share: 1, since: '2020' }], segment: 'retail' });
    expect(good).toEqual({ valid: true, errors: [], warnings: [] });
  });
  it('rejects an edge that joins the wrong kinds', () => {
    const r = validateNode(domain.graph, domain.profile, { id: 'zone-new', kind: 'zone', ownedBy: [{ id: 'zone-none' }] });
    expect(r.valid).toBe(true);
    const market = graphs[1].index.model.nodes.find((n) => n.kind === 'market')!.id;
    const wrong = validateNode(domain.graph, domain.profile, { id: 'auth-new', kind: 'authority', inArea: [market] });
    expect(wrong.errors.join()).toContain('ends at a node of the kind "market"');
  });
});
