// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the search: the words, BM25, the exact match, the synonyms, the filters, the limit and the snippet.
// The fixtures are the workspace (2 profiles) and the glossary profile with a profile `search` key.
import { describe, expect, it, vi } from 'vitest';
import { QueryError, applyFilters, buildIndex, SYNONYM_WEIGHT, buildModel, indexGraphs, queryTerms, rankIndexOf, searchGraphs, stem, tokenise, type Filters, type Graph } from '@semspec/core';
import { run } from '../packages/cli/src/index';
import { loadInputs } from '../packages/cli/src/inputs';
import { loadWorkspace } from '../packages/cli/src/workspace';

const workspacePath = new URL('../fixtures/workspace/workspace.json', import.meta.url).pathname;
const graphs = indexGraphs(loadWorkspace(workspacePath).data.graphs);
const ids = (r: { hits: { id: string }[] }) => r.hits.map((h) => h.id);

const glossaryPath = (f: string) => new URL(`../fixtures/glossary/${f}`, import.meta.url).pathname;
const glossary = loadInputs(glossaryPath('graph.json'), glossaryPath('profile.json'));
function glossaryGraphs(search?: object, extra: Record<string, object> = {}) {
  const entries = (glossary.graph.entries as { id: string }[]).map((e) => ({ ...e, ...(extra[e.id] ?? {}) }));
  const model = buildModel({ entries } as Graph, { ...glossary.profile, ...(search ? { search } : {}) });
  return indexGraphs([{ id: 'glossary', label: 'Glossary', model }]);
}

describe('words', () => {
  it('lowers the case, splits on non-letters and keeps codes and acronyms whole', () => {
    expect(tokenise('PSD2 and 3DS: Card-data, e-mail')).toEqual(['psd2', 'and', '3ds', 'card', 'data', 'e', 'mail']);
    expect(tokenise('synonymFields')).toEqual(['synonym', 'field']);
  });
  it('cuts a plural ending and keeps other words', () => {
    expect([stem('nodes'), stem('capabilities'), stem('matches'), stem('status'), stem('statuses'), stem('class'), stem('3ds')]).toEqual(['node', 'capability', 'match', 'status', 'status', 'class', '3ds']);
    expect(stem('shops')).toBe(stem('shop'));
  });
});

describe('searchGraphs', () => {
  it('ranks by the words of the query across all graphs', () => {
    const r = searchGraphs(graphs, 'prepaid code');
    expect(r.hits[0]).toMatchObject({ graph: 'domain', id: 'pay-voucher', kind: 'method', title: 'Voucher payment' });
    expect(r.hits[0].score).toBeGreaterThan(r.hits[1].score);
    expect(searchGraphs(graphs, 'card').hits.map((h) => h.graph)).toEqual(expect.arrayContaining(['req', 'domain']));
  });
  it('puts an exact id first, then an exact title', () => {
    expect(ids(searchGraphs(graphs, 'shop-orbit'))[0]).toBe('shop-orbit');
    expect(ids(searchGraphs(graphs, 'what is SHOP-ORBIT?'))[0]).toBe('shop-orbit');
    expect(ids(searchGraphs(graphs, 'Voucher payment'))[0]).toBe('pay-voucher');
    expect(ids(searchGraphs(graphs, 'electronics'))[0]).toBe('cat-electronics');
  });
  it('returns an empty list for a query with no match, not an error', () => {
    expect(searchGraphs(graphs, 'zzqqxx')).toEqual({ query: 'zzqqxx', total: 0, hits: [], omitted: 0 });
    expect(searchGraphs(graphs, '???').hits).toEqual([]);
  });
  it('finds a word by its plural and by a prefix', () => {
    expect(ids(searchGraphs(graphs, 'laptop'))).toContain('cat-laptops');
    expect(ids(searchGraphs(graphs, 'portab'))).toContain('cat-laptops');
  });
  it('gives each hit the kind, the parent, the status and a snippet with the matched words marked', () => {
    const r = searchGraphs(graphs, 'second step 3DS', { graph: 'req' });
    const hit = r.hits.find((h) => h.id === 'story-pay-by-card')!;
    expect(hit).toMatchObject({ graph: 'req', kind: 'story', parent: { id: 'epic-checkout', title: 'Checkout' }, status: 'partial' });
    expect(hit.snippet).toContain('**3DS**');
    expect(hit.snippet).toContain('**second**');
    expect(searchGraphs(graphs, 'second step', { graph: 'domain' }).hits.every((h) => h.graph === 'domain')).toBe(true);
    const root = searchGraphs(graphs, 'online shop', { graph: 'req' }).hits.find((h) => h.id === 'prd-shop')!;
    expect(root.parent).toBeNull();
  });
  it('reads the text of the parts and the labels of coded fields', () => {
    expect(ids(searchGraphs(graphs, 'prepaid')).length).toBeGreaterThan(0);
    const g = glossaryGraphs();
    expect(ids(searchGraphs(g, 'replaced'))).toContain('fermata');
    expect(ids(searchGraphs(g, 'editors still write'))).toContain('beat');
  });
  it('filters by kind, lifecycle and status, and refuses an unknown kind or graph', () => {
    expect(new Set(searchGraphs(graphs, 'shop', { kinds: ['shop'] }).hits.map((h) => h.kind))).toEqual(new Set(['shop']));
    const closed = searchGraphs(graphs, 'shop', { graph: 'domain', lifecycles: ['closed'] }).hits;
    expect(closed.every((h) => graphs[1].index.byId.get(h.id)!.lifecycle === 'closed')).toBe(true);
    const partial = searchGraphs(graphs, 'card', { graph: 'req', statuses: ['partial'] }).hits;
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.every((h) => h.status === 'partial')).toBe(true);
    expect(() => searchGraphs(graphs, 'shop', { kinds: ['nope'] })).toThrow(QueryError);
    expect(() => searchGraphs(graphs, 'shop', { graph: 'nope' })).toThrow(QueryError);
  });
  it('keeps only the nodes in the scope of a node', () => {
    const all = ids(searchGraphs(graphs, 'buyer', { graph: 'req' }));
    const scoped = searchGraphs(graphs, 'buyer', { scope: 'epic-checkout' });
    expect(ids(scoped)).toContain('story-pay-by-card');
    expect(ids(scoped)).not.toContain('epic-search');
    expect(scoped.hits.every((h) => h.graph === 'req')).toBe(true);
    expect(all).toContain('epic-search');
    expect(() => searchGraphs(graphs, 'buyer', { scope: 'nope' })).toThrow(QueryError);
  });
  it('cuts the list at the limit and counts the omitted hits', () => {
    const all = searchGraphs(graphs, 'buyer');
    expect(all.total).toBeGreaterThan(5);
    const cut = searchGraphs(graphs, 'buyer', { limit: 5 });
    expect(cut.hits.length).toBe(5);
    expect(cut.total).toBe(all.total);
    expect(cut.omitted).toBe(all.total - 5);
    expect(ids(cut)).toEqual(ids(all).slice(0, 5));
  });
});

describe('synonyms', () => {
  it('widens the query with the alt labels of a concept', () => {
    // The glossary vocabulary gives the code "replaced" the alt label "superseded". No node holds that word.
    const g = glossaryGraphs();
    const alt = searchGraphs(g, 'superseded');
    const word = searchGraphs(g, 'replaced');
    expect(ids(alt)).toContain('fermata');
    expect(alt.hits.find((h) => h.id === 'fermata')!.snippet).toContain('**');
    expect(alt.hits.find((h) => h.id === 'fermata')!.score).toBeLessThan(word.hits.find((h) => h.id === 'fermata')!.score);
  });
  it('widens the query with the synonym fields of the profile', () => {
    const extra = { scale: { avoid: ['ladder of tones'] } };
    expect(ids(searchGraphs(glossaryGraphs(undefined, extra), 'ladder of tones'))).toEqual([]);
    expect(ids(searchGraphs(glossaryGraphs({ fields: ['avoid'] }, extra), 'ladder of tones'))).toEqual(['scale']);
    const widened = searchGraphs(glossaryGraphs({ synonymFields: ['avoid'] }, extra), 'ladder of tones');
    expect(ids(widened)[0]).toBe('scale');
    // The title of the entry widens to its avoid words, and the other way round.
    const g = glossaryGraphs({ synonymFields: ['avoid'] }, extra);
    const terms = queryTerms(rankIndexOf(g[0].index), 'scale');
    expect(terms.get('ladder')).toBe(SYNONYM_WEIGHT);
  });
  it('counts a synonym less than the word of the query', () => {
    const g = glossaryGraphs({ synonymFields: ['avoid'] }, { scale: { avoid: ['ladder of tones'] } });
    const terms = queryTerms(rankIndexOf(g[0].index), 'ladder of tones');
    expect(terms.get('ladder')).toBe(1);
    expect(terms.get('scale')).toBe(SYNONYM_WEIGHT);
    expect(SYNONYM_WEIGHT).toBeLessThan(1);
    const alt = queryTerms(rankIndexOf(glossaryGraphs()[0].index), 'superseded');
    expect([alt.get('superseded'), alt.get('replaced')]).toEqual([1, SYNONYM_WEIGHT]);
  });
});

describe('applyFilters with a search text', () => {
  const index = buildIndex(graphs[1].index.model);
  const none: Filters = { q: '', kinds: [], lifecycles: [], deliveries: [], modules: [], statuses: [] };
  const all = index.model.nodes.map((n) => n.id);
  it('lists the best ranked nodes first and keeps the nodes that contain the text', () => {
    const r = applyFilters(index, all, { ...none, q: 'prepaid code' });
    expect(r[0]).toBe('pay-voucher');
    const part = applyFilters(index, all, { ...none, q: 'vouch' });
    expect(part).toContain('pay-voucher');
    expect(applyFilters(index, all, { ...none, q: 'zzqqxx' })).toEqual([]);
  });
  it('applies the other filters to the ranked nodes', () => {
    const r = applyFilters(index, all, { ...none, q: 'shop', kinds: ['shop'] });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((id) => index.byId.get(id)!.kind === 'shop')).toBe(true);
  });
});

describe('semspec search', () => {
  async function search(args: string[]): Promise<{ code: number; out: string; err: string }> {
    const out: string[] = [];
    const err: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((m) => void out.push(String(m)));
    const error = vi.spyOn(console, 'error').mockImplementation((m) => void err.push(String(m)));
    try {
      const code = await run(['search', ...args]);
      return { code, out: out.join('\n'), err: err.join('\n') };
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  }
  it('prints the ranked hits of a workspace as text and as JSON', async () => {
    const text = await search(['--workspace', workspacePath, 'prepaid', 'code']);
    expect(text.code).toBe(0);
    expect(text.out.split('\n')[0]).toContain('domain:pay-voucher  [method]  Voucher payment');
    expect(text.out).toContain('**prepaid**');
    const json = await search(['--workspace', workspacePath, 'buyer', '--kind', 'story', '--limit', '2', '--json']);
    const parsed = JSON.parse(json.out);
    expect(parsed.hits.length).toBe(2);
    expect(parsed.hits.every((h: any) => h.kind === 'story')).toBe(true);
    expect(parsed.omitted).toBe(parsed.total - 2);
    const one = await search(['--workspace', workspacePath, '--in', 'domain', 'electronics']);
    expect(one.out.split('\n')[0]).toMatch(/^1\. cat-electronics /);
  });
  it('searches 1 graph and says when nothing matches', async () => {
    const r = await search(['--graph', glossaryPath('graph.json'), '--profile', glossaryPath('profile.json'), 'steady pulse']);
    expect(r.out.split('\n')[0]).toContain('beat');
    expect((await search(['--graph', glossaryPath('graph.json'), '--profile', glossaryPath('profile.json'), 'zzqqxx'])).out).toBe('No node matches "zzqqxx".');
  });
  it('fails with a message when the options are wrong', async () => {
    expect((await search(['--workspace', workspacePath])).err).toContain('Give the words');
    expect((await search(['prepaid'])).code).toBe(1);
    expect((await search(['--workspace', workspacePath, 'x', '--limit', '0'])).err).toContain('--limit');
    expect((await search(['--workspace', workspacePath, 'x', '--kind', 'nope'])).code).toBe(1);
  });
});
