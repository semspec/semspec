// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the pure logic. Every test that reads a graph runs on 2 profiles with different kinds,
// so a hard-coded kind or field fails.
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  badgeCount,
  buildIndex,
  buildModel,
  computeScope,
  applyFilters,
  deriveTitle,
  facetCounts,
  fieldValues,
  checkCrossLinks,
  humanise,
  incomingCrossLinks,
  kindSchemas,
  neighbourGroups,
  neighbourIds,
  statusOf,
  summaryOf,
  toCsv,
  walkCollapse,
  walkExpand,
  walkHide,
  walkStart,
  wordCasing,
  type Graph,
  type Profile,
} from '@semspec/core';

const load = (name: string) => ({
  graph: JSON.parse(readFileSync(new URL(`../fixtures/${name}/graph.json`, import.meta.url), 'utf8')) as Graph,
  profile: JSON.parse(readFileSync(new URL(`../fixtures/${name}/profile.json`, import.meta.url), 'utf8')) as Profile,
});
const product = load('product');
const safety = load('safety');
const glossary = load('glossary');
const pModel = buildModel(product.graph, product.profile);
const pIndex = buildIndex(pModel);
const sModel = buildModel(safety.graph, safety.profile);
const sIndex = buildIndex(sModel);
const gModel = buildModel(glossary.graph, glossary.profile);
const gIndex = buildIndex(gModel);
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
  it('uses the display name of a citation as written, and falls back when it is empty', () => {
    expect(title(pModel, 'std-privacy-notice')).toBe('PR Clause 2');
    expect(title(pModel, 'std-refund-window')).toBe('Refund Law Clause 7');
    expect(title(sModel, 'hz-shock')).toBe('TC Cl. 2');
    expect(title(sModel, 'hz-fire')).toBe('Fire Code Cl. 5');
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
    expect(sorted(computeScope(pIndex, { id: 'std-card-data' }).ids)).toEqual(['card-data-standard', 'std-card-data', 'story-pay-by-card']);
  });
});

describe('filters', () => {
  const ids = computeScope(pIndex, { id: 'epic-checkout' }).ids;
  const none = { q: '', kinds: [], lifecycles: [], deliveries: [], modules: [], statuses: [] };
  it('applies on top of a scope', () => {
    expect(applyFilters(pIndex, ids, { ...none, kinds: ['story'], deliveries: ['r2'] })).toEqual(['story-save-card']);
    // A search text ranks the nodes: the node with both words comes first, and a node with 1 word follows.
    expect(applyFilters(pIndex, ids, { ...none, q: 'second step', kinds: ['story'] })).toEqual(['story-pay-by-card', 'story-pay-by-card-3ds']);
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
    expect(s.chips.map((c) => c.text)).toEqual(['HIGH', 'Planned', 'r1', '1 of 2 verified']);
    const dropped = summaryOf(pIndex, pIndex.byId.get('story-loose-child')!);
    expect(dropped.muted).toBe(true);
    expect(dropped.chips.find((c) => c.text === 'Dropped')?.struck).toBe(true);
    expect(summaryOf(sIndex, sIndex.byId.get('hz-overheat')!).chips.map((c) => c.text)).toEqual(['critical']);
    expect(summaryOf(sIndex, sIndex.byId.get('sg-detect-overheat')!).chips.map((c) => c.text)).toEqual(['open', '1 of 2 verified']);
  });
});

describe('status', () => {
  const of = (index: typeof pIndex, id: string) => statusOf(index, id);
  it('takes the own value of a node, and gives no value when no node below has a status', () => {
    expect(of(pIndex, 'story-pay-by-card#charged')).toMatchObject({ value: 'fail', tone: 'bad', total: 1 });
    expect(of(pIndex, 'story-save-card')).toMatchObject({ value: 'pass', tone: 'good', total: 1 });
    expect(of(pIndex, 'epic-search')).toMatchObject({ value: null, tone: null, total: 0 });
    expect(of(sIndex, 'mit-watchdog').value).toBeNull();
  });
  it('rolls up good when all is good, bad when all is bad, and warn for a mix', () => {
    expect(of(pIndex, 'story-pay-by-card')).toEqual({ value: 'partial', tone: 'warn', counts: { pass: 2, partial: 0, fail: 1 }, total: 3 });
    expect(of(sIndex, 'sg-detect-overheat')).toMatchObject({ value: 'partly', tone: 'warn', total: 2 });
    expect(of(sIndex, 'sg-stop-heater')).toMatchObject({ value: 'gap', tone: 'bad', counts: { gap: 1 } });
    expect(of(sIndex, 'g-safe-operation').counts).toEqual({ assured: 1, partly: 0, gap: 2 });
  });
  it('counts a node under 2 parents once', () => {
    // story-save-card is under epic-checkout and follows story-pay-by-card.
    expect(of(pIndex, 'epic-checkout').total).toBe(3);
  });
  it('leaves out a node with a muted lifecycle', () => {
    expect(of(pIndex, 'story-loose-child').value).toBeNull();
    expect(of(pIndex, 'story-loose').total).toBe(0);
  });
  it('keeps the detail field on a part node', () => {
    expect(pIndex.byId.get('story-pay-by-card#charged')!.d.openBrowsers).toEqual(['Safari', 'Firefox']);
    expect(sIndex.byId.get('sg-detect-overheat#sensor-drift')!.d.gaps).toEqual(['cold start']);
  });
  it('filters by the status value', () => {
    const ids = computeScope(pIndex, { id: 'epic-checkout' }).ids;
    expect(sorted(applyFilters(pIndex, ids, { q: '', kinds: [], lifecycles: [], deliveries: [], modules: [], statuses: ['partial', 'fail'] }))).toEqual(
      sorted(['epic-checkout', 'story-pay-by-card', 'story-pay-by-card#charged']),
    );
  });
});

describe('field filters', () => {
  const none = { q: '', kinds: [], lifecycles: [], deliveries: [], modules: [], statuses: [] };
  const ids = computeScope(pIndex, { id: 'epic-checkout' }).ids;
  it('keeps the carriers that match, the nodes above and below them, and their linked nodes and checks', () => {
    expect(sorted(applyFilters(pIndex, ids, { ...none, fields: { teams: ['web'] } }))).toEqual(
      sorted([
        'epic-checkout',
        'story-pay-by-card',
        'story-pay-by-card#declined',
        'story-pay-by-card#charged',
        'unit:tests/pay.test.ts#showsDeclineMessage',
        'std-card-data',
        'dec-use-psp',
        'dec-use-two-psp',
      ]),
    );
  });
  it('needs 1 carrier that matches all field filters together', () => {
    const f = (fields: Record<string, string[]>) => sorted(applyFilters(pIndex, ids, { ...none, kinds: ['epic', 'story'], fields }));
    // story-pay-by-card is web and high. story-save-card is payments and low.
    expect(f({ teams: ['web'], priority: ['low'] })).toEqual([]);
    // story-save-card follows story-pay-by-card, so story-pay-by-card matches through it.
    expect(f({ teams: ['payments'], priority: ['low'] })).toEqual(['epic-checkout', 'story-pay-by-card', 'story-save-card']);
  });
  it('selects the carriers with no value by the value ""', () => {
    // story-pay-by-card has teams, but story-pay-by-card-3ds below it has none.
    expect(sorted(applyFilters(pIndex, ids, { ...none, kinds: ['story'], fields: { teams: [''] } }))).toEqual(['story-pay-by-card', 'story-pay-by-card-3ds']);
  });
  it('reads a list field and a text field', () => {
    expect(sorted(fieldValues(pIndex, 'teams', 'prd-shop'))).toEqual(['', 'payments', 'search', 'web']);
    expect(sorted(fieldValues(pIndex, 'teams', 'story-pay-by-card#charged'))).toEqual(['payments', 'web']);
    expect(sorted(fieldValues(sIndex, 'parts', 'g-safe-operation'))).toEqual(['mcu.watchdog', 'psu.fuse', 'psu.relay']);
    expect(sorted(fieldValues(sIndex, 'parts', 'hz-overheat'))).toEqual(['psu.fuse', 'psu.relay']);
  });
  it('counts the values of a field with the other filters applied', () => {
    const counts = facetCounts(pIndex, ids, { ...none, kinds: ['story'] }, 'field:teams');
    expect(Object.fromEntries(counts)).toEqual({ payments: 2, web: 1, '': 2 });
  });
  it('rolls up only the nodes that match, and works with the status filter', () => {
    expect(statusOf(pIndex, 'epic-checkout', { teams: ['payments'] }).total).toBe(3);
    expect(statusOf(pIndex, 'epic-checkout', { teams: ['web'] })).toMatchObject({ value: 'partial', counts: { pass: 1, fail: 1 }, total: 2 });
    expect(statusOf(sIndex, 'g-safe-operation', { parts: ['mcu.watchdog'] }).total).toBe(0);
    const red = applyFilters(pIndex, ids, { ...none, kinds: ['scenario'], statuses: ['fail'], fields: { teams: ['web'] } });
    expect(red).toEqual(['story-pay-by-card#charged']);
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

describe('kind schemas', () => {
  const pSchemas = kindSchemas(product.profile) as Record<string, any>;
  const sSchemas = kindSchemas(safety.profile) as Record<string, any>;
  const list = { type: 'array', items: { type: 'string' } };
  // A link field holds node ids, or objects with the node id and the properties of the edge.
  const links = (target = 'id', properties: Record<string, unknown> = {}, required: string[] = []) => ({
    type: 'array',
    items: { anyOf: [{ type: 'string' }, { type: 'object', properties: { [target]: { type: 'string' }, ...properties }, required: [target, ...required], additionalProperties: true }] },
  });

  it('gives 1 schema for each kind with the title, the description and the open shape', () => {
    expect(Object.keys(pSchemas)).toEqual(product.profile.kinds.map((k) => k.id));
    expect(Object.keys(sSchemas)).toEqual(safety.profile.kinds.map((k) => k.id));
    expect(pSchemas.story.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(pSchemas.story.title).toBe('Story');
    expect(pSchemas.story.description).toContain('Story');
    expect(pSchemas.story.additionalProperties).toBe(true);
  });
  it('requires the id and the kind under the keys of the profile', () => {
    expect(pSchemas.story.required).toEqual(['id', 'kind']);
    expect(sSchemas.mitigation.required).toEqual(['key', 'type']);
    expect(pSchemas.story.properties.kind).toEqual({ const: 'story' });
    expect(sSchemas.mitigation.properties.type).toEqual({ const: 'mitigation' });
    expect(pSchemas.story.properties.id.pattern).toBe('^story-');
    expect(sSchemas.mitigation.properties.key.pattern).toBe('^mit-');
    expect(sSchemas.argument.properties.key).toEqual({ type: 'string' });
  });
  it('types the title, statement and lifecycle fields and the parent and link fields', () => {
    expect(pSchemas.story.properties.summary).toEqual({ type: 'string' });
    expect(pSchemas.story.properties.status).toMatchObject({ type: 'string', enum: ['planned', 'active', 'dropped', 'replaced'] });
    expect(pSchemas.story.properties.epics).toEqual(links());
    expect(pSchemas.story.properties.follows).toEqual(links());
    expect(pSchemas.story.properties.complies).toEqual(links('std', { since: { type: 'string', pattern: expect.any(String) }, audited: { type: 'boolean' } }, ['since']));
    expect(pSchemas.epic.properties.epics).toBeUndefined();
    expect(sSchemas.mitigation.properties.subgoals).toEqual(links());
    expect(sSchemas.mitigation.properties.addresses).toEqual(links());
    expect(sSchemas.mitigation.properties.claim).toEqual({ type: 'string' });
  });
  it('describes the refs and the supersededBy field', () => {
    expect(pSchemas.decision.properties.notes.items.properties).toEqual({ ref: { type: 'string' }, text: { type: 'string' }, since: { type: 'string', pattern: expect.any(String) }, share: { type: 'number' }, force: { type: 'string', enum: ['mandatory', 'advisory'], description: expect.any(String) } });
    expect(pSchemas.decision.properties.replacedBy).toEqual({ type: 'string' });
    expect(sSchemas.hazard.properties.notes).toBeUndefined();
  });
  it('describes the parts of the owner kind only, with the checks and the status', () => {
    const scenarios = pSchemas.story.properties.scenarios.items;
    expect(Object.keys(scenarios.properties).sort()).toEqual(['key', 'openBrowsers', 'result', 'tests', 'text']);
    expect(scenarios.required).toBeUndefined();
    expect(scenarios.properties.result.enum).toEqual(['pass', 'partial', 'fail']);
    expect(pSchemas.epic.properties.scenarios).toBeUndefined();
    expect(sSchemas.subgoal.properties.arguments.items.properties.assurance.enum).toEqual(['assured', 'partly', 'gap']);
    expect(sSchemas.mitigation.properties.arguments).toBeUndefined();
  });
  it('gives the check type an enum, and the status and its detail field to a node', () => {
    expect(pSchemas.story.properties.tests.items.properties.type.enum).toEqual(['unit', 'manual']);
    expect(sSchemas.mitigation.properties.evidence.items.properties.form.enum).toEqual(['report', 'analysis']);
    expect(pSchemas.story.properties.result.enum).toEqual(['pass', 'partial', 'fail']);
    expect(pSchemas.story.properties.openBrowsers).toEqual(list);
    expect(sSchemas.mitigation.properties.gaps).toEqual(list);
  });
  it('allows a string or a list of strings for a field filter', () => {
    const either = { anyOf: [{ type: 'string' }, list] };
    expect(pSchemas.story.properties.teams).toEqual(either);
    expect(pSchemas.story.properties.priority.anyOf[1].type).toBe('array');
    expect(sSchemas.mitigation.properties.parts).toEqual(either);
  });
  it.each([
    ['product', product, pSchemas],
    ['safety', safety, sSchemas],
  ])('accepts each node of the %s fixture and refuses a changed node', (_name, data, schemas) => {
    const { profile, graph } = data;
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validators = Object.fromEntries(Object.entries(schemas).map(([k, s]) => [k, ajv.compile(s)]));
    const nodes = graph[profile.source.nodes] as Record<string, any>[];
    for (const n of nodes) {
      const validate = validators[n[profile.source.kind]];
      expect(validate(n), `${n[profile.source.id]}: ${ajv.errorsText(validate.errors)}`).toBe(true);
    }
    const first = nodes[0];
    expect(validators[first[profile.source.kind]]({ ...first, [profile.source.id]: 'wrong-prefix' })).toBe(false);
    expect(validators[first[profile.source.kind]]({ ...first, [profile.source.kind]: 'other' })).toBe(false);
  });
  it.each([
    ['product', 'story', 'scenarios', pSchemas],
    ['safety', 'subgoal', 'arguments', sSchemas],
  ])('accepts a part item with no id field in the %s fixture', (name, kind, field, schemas) => {
    const profile = name === 'product' ? product.profile : safety.profile;
    const node = { [profile.source.id]: `${kind === 'story' ? 'story' : 'sg'}-x`, [profile.source.kind]: kind, [field]: [{ text: 'A part with no id.' }] };
    expect(new Ajv({ strict: false }).compile(schemas[kind])(node)).toBe(true);
  });
  it('refuses a status that the profile does not know, on a node and on a part', () => {
    const story = new Ajv({ strict: false }).compile(pSchemas.story);
    expect(story({ id: 'story-x', kind: 'story', result: 'maybe' })).toBe(false);
    expect(story({ id: 'story-x', kind: 'story', scenarios: [{ key: 'a', result: 'maybe' }] })).toBe(false);
    expect(story({ id: 'story-x', kind: 'story', tests: [{ type: 'nothing' }] })).toBe(false);
  });
});

// For each fixture: the owners of each embedded node, the field of the first object, the title,
// and the graph node that wins over an object with the same id.
const EMBEDDED = [
  {
    name: 'product',
    graph: product.graph,
    model: pModel,
    index: pIndex,
    kind: 'body',
    edge: 'issuedBy',
    field: 'body',
    owners: { 'card-data-standard': ['std-card-data', 'std-card-storage'], 'privacy-rules': ['std-privacy-notice'], 'refund-law': ['std-refund-window'], 'tax-code': ['std-tax-rate'] } as Record<string, string[]>,
    titles: { 'card-data-standard': 'Card Data Standard', 'privacy-rules': 'PR', 'refund-law': 'Refund Law', 'tax-code': 'Tax Code Office' } as Record<string, string>,
    wins: 'tax-code',
    loser: 'Tax Code From The Standard',
  },
  {
    name: 'safety',
    graph: safety.graph,
    model: sModel,
    index: sIndex,
    kind: 'source',
    edge: 'origin',
    field: 'source',
    owners: { 'thermal-code': ['hz-overheat', 'hz-shock'], 'fire-code': ['hz-fire'], 'wiring-rules': ['hz-wire'] } as Record<string, string[]>,
    titles: { 'thermal-code': 'TC', 'fire-code': 'Fire Code', 'wiring-rules': 'Wiring Rules' } as Record<string, string>,
    wins: 'wiring-rules',
    loser: 'Title From The Hazard',
  },
];

describe('embedded nodes', () => {
  it('makes 1 node for each distinct id, with the title from the fields of the first object', () => {
    for (const c of EMBEDDED) {
      const nodes = c.model.nodes.filter((n) => n.kind === c.kind);
      expect(nodes.map((n) => n.id).sort(), c.name).toEqual(Object.keys(c.owners).sort());
      for (const [id, t] of Object.entries(c.titles)) expect(title(c.model, id), `${c.name} ${id}`).toBe(t);
    }
    expect(pModel.nodes.find((n) => n.id === 'card-data-standard')!.d).toEqual({ title: 'Card Data Standard' });
  });
  it('adds an edge from each owner to the new node', () => {
    for (const c of EMBEDDED) {
      const edges = c.model.edges.filter((e) => e.k === c.edge).map((e) => `${e.s}>${e.t}`).sort();
      const expected = Object.entries(c.owners).flatMap(([id, owners]) => owners.map((o) => `${o}>${id}`)).sort();
      expect(edges, c.name).toEqual(expected);
    }
  });
  it('makes the new node a tree parent and a scope parent of its owners', () => {
    for (const c of EMBEDDED) {
      for (const [id, owners] of Object.entries(c.owners)) {
        for (const o of owners) {
          const n = c.index.byId.get(o)!;
          expect(n.parents, `${c.name} ${o}`).toEqual([id]);
          expect(n.up, `${c.name} ${o}`).toEqual([id]);
        }
        expect(sorted(c.index.children.get(id)!), `${c.name} ${id}`).toEqual(sorted(owners));
        expect(sorted(computeScope(c.index, { id }).ids), `${c.name} ${id}`).toEqual(sorted([id, ...owners]));
      }
    }
  });
  it('keeps the graph node when it has the same id as an object, and adds the edges only', () => {
    for (const c of EMBEDDED) {
      const nodes = c.model.nodes.filter((n) => n.id === c.wins);
      expect(nodes.length, c.name).toBe(1);
      expect(nodes[0].title, c.name).not.toBe(c.loser);
      expect(JSON.stringify(nodes[0].d), c.name).not.toContain(c.loser);
      expect(c.model.edges.filter((e) => e.t === c.wins && e.k === c.edge).length, c.name).toBe(c.owners[c.wins].length);
    }
    expect(title(pModel, 'tax-code')).toBe('Tax Code Office');
    expect(title(sModel, 'wiring-rules')).toBe('Wiring Rules');
  });
  it('removes the object from the details of the owner', () => {
    for (const c of EMBEDDED) {
      for (const owners of Object.values(c.owners)) for (const o of owners) expect(c.index.byId.get(o)!.d, `${c.name} ${o}`).not.toHaveProperty(c.field);
    }
    // The input graph keeps the object.
    expect((product.graph.nodes as Record<string, unknown>[]).find((n) => n.id === 'std-card-data')).toHaveProperty('body');
    expect((safety.graph.items as Record<string, unknown>[]).find((n) => n.key === 'hz-shock')).toHaveProperty('source');
  });
  it('reaches an owner from a walk over the new node', () => {
    const w = walkExpand(pIndex, walkStart(['card-data-standard']), 'card-data-standard');
    expect(sorted(w.added)).toEqual(['std-card-data', 'std-card-storage']);
  });
});

// The profile of the glossary fixture has a default kind and a plain id as the embedded value.
describe('the default kind', () => {
  const FIXTURES = [
    { name: 'product', ...product },
    { name: 'safety', ...safety },
    { name: 'glossary', ...glossary },
  ];
  // The kind that most nodes of the graph have.
  const commonKind = (graph: Graph, profile: Profile) => {
    const counts = new Map<string, number>();
    for (const n of graph[profile.source.nodes] as Record<string, string>[]) {
      const k = n[profile.source.kind] ?? profile.source.defaultKind!;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };

  it('gives a node with no kind the default kind', () => {
    for (const f of FIXTURES) {
      const kind = commonKind(f.graph, f.profile);
      const key = f.profile.source.kind;
      const stripped = structuredClone(f.graph) as Record<string, any>;
      for (const n of stripped[f.profile.source.nodes]) if (n[key] === kind) delete n[key];
      const profile: Profile = { ...f.profile, source: { ...f.profile.source, defaultKind: kind } };
      const model = buildModel(stripped, profile);
      const expected = buildModel(f.graph, f.profile);
      expect(model.nodes, f.name).toEqual(expected.nodes);
      expect(model.edges, f.name).toEqual(expected.edges);
    }
    expect(gModel.nodes.filter((n) => n.kind === 'term').map((n) => n.id).sort()).toEqual(['beat', 'chord', 'fermata', 'scale', 'tempo']);
  });
  it('treats an empty kind as no kind, and keeps a kind that is set', () => {
    for (const f of FIXTURES) {
      const kind = commonKind(f.graph, f.profile);
      const other = f.profile.kinds.find((k) => k.id !== kind && k.role === 'hierarchy')!.id;
      const graph = structuredClone(f.graph) as Record<string, any>;
      const key = f.profile.source.kind;
      const list = graph[f.profile.source.nodes] as Record<string, any>[];
      const first = list.find((n) => (n[key] ?? f.profile.source.defaultKind) === kind)!;
      first[key] = '';
      const model = buildModel(graph, { ...f.profile, source: { ...f.profile.source, defaultKind: other } });
      expect(model.nodes.find((n) => n.id === first[f.profile.source.id])!.kind, f.name).toBe(other);
    }
  });
});

describe('a plain id as an embedded value', () => {
  // Replaces the embedded object of each owner with its id.
  const plain = (c: (typeof EMBEDDED)[number], value: (id: string) => string | number = (id) => id) => {
    const profile = c.name === 'product' ? product.profile : safety.profile;
    const e = profile.embedded![0];
    const graph = structuredClone(c.graph) as Record<string, any>;
    for (const n of graph[profile.source.nodes] as Record<string, any>[]) {
      const object = n[e.field];
      if (n[profile.source.kind] === e.owner && object?.[e.id!]) n[e.field] = value(object[e.id!]);
    }
    return { profile, model: buildModel(graph, profile) };
  };

  it('makes a node with the id and no other field, and derives the title from the id', () => {
    for (const c of EMBEDDED) {
      const { profile, model } = plain(c);
      const nodes = model.nodes.filter((n) => n.kind === c.kind);
      expect(nodes.map((n) => n.id).sort(), c.name).toEqual(Object.keys(c.owners).sort());
      // The node of the graph with the same id keeps its own fields.
      for (const n of nodes.filter((x) => x.id !== c.wins)) {
        expect(n.d, `${c.name} ${n.id}`).toEqual({});
        expect(n.title, `${c.name} ${n.id}`).toBe(deriveTitle(n.id, wordCasing([]), profile.fields.idPrefixPattern));
      }
    }
    expect(title(gModel, 'grp-harmony')).toBe('Harmony');
    expect(title(gModel, 'grp-rhythm')).toBe('Rhythm');
    expect(gModel.nodes.find((n) => n.id === 'grp-harmony')!.d).toEqual({});
  });
  it('keeps the edges and the parents of the owners', () => {
    for (const c of EMBEDDED) {
      const { model } = plain(c);
      const index = buildIndex(model);
      for (const [id, owners] of Object.entries(c.owners)) {
        for (const o of owners) expect(index.byId.get(o)!.parents, `${c.name} ${o}`).toEqual([id]);
        expect(model.edges.filter((e) => e.t === id && e.k === c.edge).map((e) => e.s).sort(), `${c.name} ${id}`).toEqual([...owners].sort());
      }
    }
  });
  it('reads a number as an id, and skips an empty value', () => {
    for (const c of EMBEDDED) {
      const { model } = plain(c, () => 42);
      const nodes = model.nodes.filter((n) => n.kind === c.kind && n.id !== c.wins);
      expect(nodes.map((n) => n.id), c.name).toEqual(['42']);
    }
    const graph = structuredClone(glossary.graph) as Record<string, any>;
    graph.entries[0].owner = '';
    delete graph.entries[1].owner;
    const model = buildModel(graph, glossary.profile);
    expect(model.nodes.filter((n) => n.kind === 'group').map((n) => n.id).sort()).toEqual(['grp-rhythm']);
  });
});

describe('the groups in the scope', () => {
  it('shows the terms of a group, and the group of a term', () => {
    expect(sorted(computeScope(gIndex, { id: 'grp-harmony' }).ids)).toEqual(['chord', 'grp-harmony', 'scale']);
    expect(sorted(computeScope(gIndex, { id: 'grp-rhythm' }).ids)).toEqual(['beat', 'fermata', 'grp-rhythm', 'tempo']);
    expect(gIndex.byId.get('scale')!.parents).toEqual(['grp-harmony']);
    expect(gIndex.byId.get('scale')!.up).toEqual(['grp-harmony']);
    expect(sorted(gIndex.children.get('grp-rhythm')!)).toEqual(['beat', 'fermata', 'tempo']);
  });
  it('links the terms through the refs', () => {
    expect(gModel.edges.filter((e) => e.k === 'relations').map((e) => `${e.s}>${e.t}:${e.n}`).sort()).toEqual(['chord>scale:is built from', 'scale>chord:chords are built from it', 'tempo>beat:sets the speed of']);
    expect(gModel.unresolved).toEqual([]);
  });
});

describe('a cross link field with 1 id', () => {
  const FIXTURES = [
    { name: 'product', ...product },
    { name: 'safety', ...safety },
  ];
  it('reads a single string as a list of 1 id, and drops other values', () => {
    for (const f of FIXTURES) {
      const profile: Profile = { ...f.profile, crossLinks: [{ field: 'ref', graph: 'other', label: 'Ref' }] };
      const graph = structuredClone(f.graph) as Record<string, any>;
      const list = graph[f.profile.source.nodes] as Record<string, any>[];
      list[0].ref = 'x-1';
      list[1].ref = ['x-2', 'x-3'];
      list[2].ref = 42;
      const model = buildModel(graph, profile);
      const id = (i: number) => list[i][f.profile.source.id];
      expect(model.crossLinks, f.name).toEqual([
        { s: id(0), field: 'ref', graph: 'other', t: 'x-1' },
        { s: id(1), field: 'ref', graph: 'other', t: 'x-2' },
        { s: id(1), field: 'ref', graph: 'other', t: 'x-3' },
      ]);
    }
  });
});

describe('a field that is an embedded field and a cross link field', () => {
  // The glossary holds plain ids. The safety graph holds objects, so each owner gets its id.
  const plainCases = () => {
    const safetyGraph = structuredClone(safety.graph) as Record<string, any>;
    const e = safety.profile.embedded![0];
    for (const n of safetyGraph[safety.profile.source.nodes] as Record<string, any>[]) {
      if (n[safety.profile.source.kind] === e.owner && n[e.field]?.[e.id!]) n[e.field] = n[e.field][e.id!];
    }
    return [
      { name: 'glossary', graph: glossary.graph as Record<string, any>, profile: glossary.profile },
      { name: 'safety', graph: safetyGraph, profile: safety.profile },
    ];
  };
  const withCross = (profile: Profile): Profile => ({ ...profile, crossLinks: [{ field: profile.embedded![0].field, graph: 'other', label: 'Other' }] });

  it('keeps the group node, the edge and a cross link from each member and from the group node', () => {
    for (const c of plainCases()) {
      const profile = withCross(c.profile);
      const e = profile.embedded![0];
      const model = buildModel(c.graph, profile);
      const plain = buildModel(c.graph, c.profile);
      expect(model.nodes, c.name).toEqual(plain.nodes);
      expect(model.edges, c.name).toEqual(plain.edges);
      const groups = model.nodes.filter((n) => n.kind === e.kind && !(c.graph[profile.source.nodes] as Record<string, any>[]).some((x) => x[profile.source.id] === n.id));
      expect(groups.length, c.name).toBeGreaterThan(0);
      const idKey = profile.source.id;
      const members = (c.graph[profile.source.nodes] as Record<string, any>[]).filter((n) => (n[profile.source.kind] ?? profile.source.defaultKind) === e.owner && typeof n[e.field] === 'string');
      for (const g of groups) {
        const own = model.crossLinks.filter((l) => l.s === g.id);
        expect(own, `${c.name} ${g.id}`).toEqual([{ s: g.id, field: e.field, graph: 'other', t: g.id }]);
        for (const m of members.filter((x) => x[e.field] === g.id)) {
          expect(model.crossLinks.filter((l) => l.s === m[idKey]), `${c.name} ${m[idKey]}`).toEqual([{ s: m[idKey], field: e.field, graph: 'other', t: g.id }]);
          expect(model.nodes.find((n) => n.id === m[idKey])!.d, c.name).not.toHaveProperty(e.field);
        }
      }
      expect(buildIndex(model).crossOut.get(groups[0].id)!.map((l) => l.t), c.name).toEqual([groups[0].id]);
    }
  });
  it('shows the members and the group node as Used by on the target node', () => {
    for (const c of plainCases()) {
      const profile = withCross(c.profile);
      const e = profile.embedded![0];
      const model = buildModel(c.graph, profile);
      const group = model.nodes.find((n) => n.kind === e.kind && model.crossLinks.some((l) => l.s === n.id))!;
      const target: Graph = { nodes: [{ id: group.id, kind: 'any' }] };
      const targetProfile: Profile = { ...profile, source: { nodes: 'nodes', id: 'id', kind: 'kind' }, embedded: [], crossLinks: [] };
      const graphs = [
        { id: 'one', label: 'One', model },
        { id: 'other', label: 'Other', model: buildModel(target, targetProfile) },
      ];
      const used = incomingCrossLinks(graphs).get('other')!.get(group.id)!;
      expect(used.map((l) => l.s).sort(), c.name).toEqual(model.crossLinks.filter((l) => l.t === group.id).map((l) => l.s).sort());
      expect(used.length, c.name).toBeGreaterThanOrEqual(2);
      expect(checkCrossLinks(graphs).errors, c.name).toEqual([]);
    }
  });
  it('adds no cross link to the group node of an object value', () => {
    const e = safety.profile.embedded![0];
    const model = buildModel(safety.graph, withCross(safety.profile));
    const groups = model.nodes.filter((n) => n.kind === e.kind).map((n) => n.id);
    expect(model.crossLinks.filter((l) => groups.includes(l.s))).toEqual([]);
  });
});

describe('the Lifecycle facet', () => {
  const none = { q: '', kinds: [], lifecycles: [], deliveries: [], modules: [], statuses: [] };
  const roleOf = (index: typeof pIndex, kind: string) => index.profile.kinds.find((k) => k.id === kind)?.role;
  for (const [name, index] of [['product', pIndex], ['safety', sIndex]] as const) {
    const all = index.model.nodes.map((n) => n.id);
    const own = (id: string) => ['part', 'check'].includes(roleOf(index, index.byId.get(id)!.kind) ?? '');
    it(`counts only the nodes of kinds that have a lifecycle (${name})`, () => {
      const counts = facetCounts(index, all, none, 'lifecycles');
      const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
      expect(total).toBe(all.filter((id) => !own(id)).length);
      expect(own(all.find(own)!)).toBe(true);
      // The profile has a fallback lifecycle, so no node of a lifecycle kind counts as None here.
      expect(counts.get('') ?? 0).toBe(all.filter((id) => !own(id) && index.byId.get(id)!.lifecycle === '').length);
    });
    it(`keeps the parts and checks of an owner that matches (${name})`, () => {
      const owner = index.model.nodes.find((n) => n.cov && n.cov.parts > 0)!;
      const hit = applyFilters(index, all, { ...none, lifecycles: [owner.lifecycle] });
      const partIds = all.filter((id) => index.byId.get(id)!.parents.includes(owner.id));
      expect(partIds.length).toBeGreaterThan(0);
      partIds.forEach((id) => expect(hit).toContain(id));
      const checkIds = partIds.flatMap((id) => (index.out.get(id) ?? []).map((e) => e.t)).filter(own);
      expect(checkIds.length).toBeGreaterThan(0);
      checkIds.forEach((id) => expect(hit).toContain(id));
      // A value that no owner has hides the parts and checks too.
      const other = applyFilters(index, all, { ...none, lifecycles: ['no-such-state'] });
      expect(other).toEqual([]);
    });
  }
});
