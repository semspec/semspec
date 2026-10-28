// SPDX-License-Identifier: Apache-2.0
// Tests of the pure logic. Every test that reads a graph runs on 2 profiles with different kinds,
// so a hard-coded kind or field fails.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  badgeCount,
  buildIndex,
  buildModel,
  computeScope,
  applyFilters,
  deriveTitle,
  facetCounts,
  humanise,
  neighbourGroups,
  neighbourIds,
  summaryOf,
  toCsv,
  walkCollapse,
  walkExpand,
  walkHide,
  walkStart,
  wordCasing,
  type Graph,
  type Profile,
} from '@core/index';

const load = (name: string) => ({
  graph: JSON.parse(readFileSync(new URL(`../fixtures/${name}/graph.json`, import.meta.url), 'utf8')) as Graph,
  profile: JSON.parse(readFileSync(new URL(`../fixtures/${name}/profile.json`, import.meta.url), 'utf8')) as Profile,
});
const product = load('product');
const safety = load('safety');
const pModel = buildModel(product.graph, product.profile);
const pIndex = buildIndex(pModel);
const sModel = buildModel(safety.graph, safety.profile);
const sIndex = buildIndex(sModel);
const sorted = (s: Iterable<string>) => Array.from(s).sort();
const title = (m: typeof pModel, id: string) => m.nodes.find((n) => n.id === id)!.title;

describe('titles', () => {
  it('derives a sentence from an id', () => {
    expect(deriveTitle('story-basket-is-emptied-once-per-order', new Map(), '^[a-z]+-')).toBe('Basket is emptied once per order');
    expect(title(pModel, 'epic-search')).toBe('Search');
    expect(title(sModel, 'sg-detect-overheat')).toBe('Detect overheat');
  });
  it('keeps the casing that the statements give a word', () => {
    expect(title(pModel, 'story-pay-by-card-3ds')).toBe('Pay by card 3DS');
    expect(title(sModel, 'mit-thermal-fuse')).toBe('Thermal fuse');
    const casing = wordCasing(['The payment MUST be sent. A late payment MAY wait. Payment of PSD2 fees. Use PSD2 and the iOS app on iOS.']);
    expect(casing.get('psd2')).toBe('PSD2');
    expect(casing.get('ios')).toBe('iOS');
    expect(casing.has('payment')).toBe(false); // a capital at the start of a sentence is no casing
    expect(casing.has('may')).toBe(false); // a keyword is no casing
    expect(casing.has('the')).toBe(false);
  });
  it('shows a given title as it is', () => {
    expect(title(pModel, 'prd-shop')).toBe('Shop');
    expect(title(sModel, 'hz-overheat')).toBe('Overheat of the housing');
  });
  it('builds the title of a citation kind from its parts', () => {
    const n = pModel.nodes.find((x) => x.id === 'std-card-data')!;
    expect(n.title).toBe('Card Data Standard Clause 3(a)');
    expect(n.sub).toBe('Card Data Standard');
  });
  it('turns a check name into a sentence', () => {
    expect(humanise('aValidBasketIsCharged', new Map([['basket', 'Basket']]))).toBe('A valid Basket is charged');
    expect(title(pModel, 'unit:tests/pay.test.ts#showsDeclineMessage')).toBe('Shows decline message');
    expect(title(sModel, 'analysis:FMEA-3#4.2')).toBe('Analysis 4 2');
  });
});

describe('placement', () => {
  it('puts a node that follows another node under it, and keeps every parent field for the scope', () => {
    expect(pIndex.byId.get('story-pay-by-card-3ds')!.parents).toEqual(['story-pay-by-card']);
    expect(pIndex.byId.get('story-save-card')!.parents).toEqual(['epic-checkout']);
    expect(pIndex.byId.get('story-save-card')!.up.sort()).toEqual(['epic-checkout', 'story-pay-by-card']);
    expect(computeScope(pIndex, { id: 'story-pay-by-card' }).ids.has('story-save-card')).toBe(true);
    expect(computeScope(pIndex, { id: 'epic-checkout' }).ids.has('story-save-card')).toBe(true);
  });
  it('lists the nodes that reach no node of the kind they are placed under', () => {
    expect(sorted(pModel.unplaced)).toEqual(['story-loose', 'story-loose-child']);
    expect(pModel.stats).toEqual({ unplaced: 2, unplacedLive: 1 });
    expect(sorted(sModel.unplaced)).toEqual(['mit-loose', 'mit-loose-old', 'mit-watchdog']);
    expect(sModel.stats).toEqual({ unplaced: 3, unplacedLive: 2 });
    expect(sIndex.byId.get('mit-watchdog')!.parents).toEqual(['g-safe-operation']);
  });
});

describe('scope', () => {
  it('collects what is below a node, the linked nodes and the checks', () => {
    const ids = computeScope(pIndex, { id: 'epic-checkout' }).ids;
    expect(sorted(ids)).toEqual(
      sorted([
        'epic-checkout',
        'story-pay-by-card',
        'story-pay-by-card-3ds',
        'story-save-card',
        'story-pay-by-card#declined',
        'story-pay-by-card#charged',
        'unit:tests/pay.test.ts#showsDeclineMessage',
        'manual:plan-7',
        'std-card-data',
        'dec-use-psp',
        'dec-use-two-psp',
      ]),
    );
    expect(sorted(computeScope(sIndex, { id: 'g-safe-operation' }).ids)).toEqual(
      sorted([
        'g-safe-operation',
        'sg-detect-overheat',
        'sg-stop-heater',
        'mit-watchdog',
        'mit-thermal-fuse',
        'sg-detect-overheat#sensor-redundant',
        'sg-detect-overheat#sensor-drift',
        'report:FTA-12',
        'analysis:FMEA-3#4.2',
        'hz-overheat',
      ]),
    );
  });
  it('limits the depth and the kinds, and keeps the root', () => {
    expect(sorted(computeScope(pIndex, { id: 'epic-checkout', maxDepth: 1 }).ids)).toEqual(sorted(['epic-checkout', 'story-pay-by-card', 'story-save-card', 'dec-use-psp', 'dec-use-two-psp', 'std-card-data']));
    expect(sorted(computeScope(pIndex, { id: 'epic-checkout', kinds: ['story'] }).ids)).toEqual(sorted(['epic-checkout', 'story-pay-by-card', 'story-pay-by-card-3ds', 'story-save-card']));
  });
  it('gives a linked node its direct neighbours only', () => {
    expect(sorted(computeScope(pIndex, { id: 'std-card-data' }).ids)).toEqual(['std-card-data', 'story-pay-by-card']);
  });
});

describe('filters', () => {
  const ids = computeScope(pIndex, { id: 'epic-checkout' }).ids;
  const none = { q: '', kinds: [], lifecycles: [], deliveries: [], modules: [] };
  it('applies on top of a scope', () => {
    expect(applyFilters(pIndex, ids, { ...none, kinds: ['story'], deliveries: ['r2'] })).toEqual(['story-save-card']);
    expect(applyFilters(pIndex, ids, { ...none, q: 'second step', kinds: ['story'] })).toEqual(['story-pay-by-card']);
    expect(applyFilters(pIndex, ids, { ...none, modules: ['epic-search'] })).toEqual([]);
    expect(applyFilters(pIndex, ids, { ...none, modules: ['epic-checkout'], kinds: ['story'] }).length).toBe(3);
  });
  it('counts a facet with the other filters applied and its own ignored', () => {
    const counts = facetCounts(pIndex, ids, { ...none, kinds: ['story'], deliveries: ['r1'] }, 'kinds');
    expect(counts.get('story')).toBe(1);
    expect(counts.get('decision') ?? 0).toBe(0);
  });
});

describe('walk', () => {
  it('counts the badge as the neighbours minus the nodes on the canvas', () => {
    const id = 'story-pay-by-card';
    const neighbours = neighbourIds(pIndex, id);
    expect(neighbours.size).toBeGreaterThan(3);
    expect(badgeCount(pIndex, new Set([id, 'epic-checkout']), id)).toBe(neighbours.size - 1);
    expect(badgeCount(pIndex, new Set([id, ...neighbours]), id)).toBe(0);
  });
  it('counts the hidden neighbours by edge kind and by node kind', () => {
    const g = neighbourGroups(pIndex, new Set(['story-pay-by-card']), 'story-pay-by-card');
    const kinds = Object.fromEntries(g.kind.map((k) => [k.kind, k.count]));
    expect(kinds.scenario).toBe(2);
    expect(kinds.standard).toBe(1);
    expect(g.total).toBe(badgeCount(pIndex, new Set(['story-pay-by-card']), 'story-pay-by-card'));
  });
  it('returns the same node set after an expand and a collapse', () => {
    const start = walkStart(['story-pay-by-card']);
    const expanded = walkExpand(pIndex, start, 'story-pay-by-card').walk;
    expect(expanded.shown.size).toBeGreaterThan(1);
    const again = walkExpand(pIndex, expanded, 'epic-checkout').walk;
    expect(again.shown.size).toBeGreaterThan(expanded.shown.size);
    expect(sorted(walkCollapse(again, 'epic-checkout').shown)).toEqual(sorted(expanded.shown));
    expect(Array.from(walkCollapse(expanded, 'story-pay-by-card').shown)).toEqual(['story-pay-by-card']);
  });
  it('expands by node kind, and hides a node with what only it introduced', () => {
    expect(walkExpand(pIndex, walkStart(['story-pay-by-card']), 'story-pay-by-card', { kind: 'standard' }).added).toEqual(['std-card-data']);
    const w = walkExpand(pIndex, walkStart(['story-pay-by-card']), 'story-pay-by-card').walk;
    const hidden = walkHide(w, 'std-card-data');
    expect(hidden.shown.has('std-card-data')).toBe(false);
    expect(hidden.shown.has('story-pay-by-card')).toBe(true);
  });
});

describe('summary', () => {
  it('shows the chips that the profile names for each kind', () => {
    const s = summaryOf(pIndex, pIndex.byId.get('story-pay-by-card')!);
    expect(s.chips.map((c) => c.text)).toEqual(['HIGH', 'planned', 'r1', '1 of 2 verified']);
    const dropped = summaryOf(pIndex, pIndex.byId.get('story-loose-child')!);
    expect(dropped.muted).toBe(true);
    expect(dropped.chips.find((c) => c.text === 'dropped')?.struck).toBe(true);
    expect(summaryOf(sIndex, sIndex.byId.get('hz-overheat')!).chips.map((c) => c.text)).toEqual(['critical']);
    expect(summaryOf(sIndex, sIndex.byId.get('sg-detect-overheat')!).chips.map((c) => c.text)).toEqual(['open', '1 of 2 verified']);
  });
});

describe('profile defaults', () => {
  it('builds a model from a profile with 1 kind and no optional part', () => {
    const profile: Profile = {
      project: 'Minimal',
      source: { nodes: 'nodes', id: 'id', kind: 'kind' },
      fields: { title: ['title'], statement: ['text'] },
      lifecycle: { field: 'state', fallback: 'open' },
      kinds: [{ id: 'item', label: 'Item', plural: 'items', role: 'hierarchy', color: { light: '#000', dark: '#fff' } }],
      edges: {},
    };
    const model = buildModel({ nodes: [{ id: 'a-b-c', kind: 'item' }] }, profile);
    expect(model.nodes[0].title).toBe('A b c');
    expect(model.edges).toEqual([]);
  });
  it('uses only kinds of its own profile', () => {
    for (const [model, kinds] of [[pModel, product.profile.kinds], [sModel, safety.profile.kinds]] as const) {
      const ids = new Set(kinds.map((k) => k.id));
      for (const n of model.nodes) expect(ids.has(n.kind)).toBe(true);
    }
  });
});

describe('export', () => {
  it('quotes cells and neutralises a formula', () => {
    expect(toCsv([{ label: 'A', text: (r: { a: string }) => r.a }], [{ a: 'say "hi"' }, { a: '=1+1' }])).toBe('"A"\r\n"say ""hi"""\r\n"\'=1+1"\r\n');
  });
});
