// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyFilters, buildIndex, buildModel, fieldValues, fillSpecs, indexGraphs, filterValues, taggedKeys, taggedLines, type Filters, type Graph, type Profile } from '@semspec/core';
import { validateProfile } from '../packages/cli/src/validate';

const load = (name: string) => ({
  graph: JSON.parse(readFileSync(new URL(`../fixtures/${name}/graph.json`, import.meta.url), 'utf8')) as Graph,
  profile: JSON.parse(readFileSync(new URL(`../fixtures/${name}/profile.json`, import.meta.url), 'utf8')) as Profile,
});
const sorted = (s: Iterable<string>) => Array.from(s).sort();
const none: Filters = { q: '', kinds: [], lifecycles: [], deliveries: [], modules: [], statuses: [] };

const labels = { 'a.area': 'Area A', 'b.type': 'Type B', 'b.property': 'Property B', own: 'Own term' };

const texts = (lines: { text: string }[]) => lines.map((l) => l.text);
const nested = { specialises: { std: { type: 'Device', url: 'https://example.org/x.yaml#L1' } } };
const nodes: Record<string, { graph: string; id: string; title: string }> = { 'obl-1': { graph: 'g2', id: 'obl-1', title: 'Pay on time' } };
const resolve = (id: string) => nodes[id];

describe('the lines of a tagged entry', () => {
  it('gives 1 line for each inner key, with the label of "<tag>.<key>"', () => {
    expect(texts(taggedLines({ a: { area: 'X' } }, labels))).toEqual(['Area A: X']);
    expect(texts(taggedLines({ b: { type: 'Y', property: 'Z' } }, labels))).toEqual(['Type B: Y', 'Property B: Z']);
  });
  it('gives the label of the tag alone when the tag has no inner key', () => {
    expect(texts(taggedLines({ own: {} }, labels))).toEqual(['Own term']);
    expect(texts(taggedLines({ own: null }, labels))).toEqual(['Own term']);
  });
  it('falls back to the tag and the key as written when a label is missing', () => {
    expect(texts(taggedLines({ a: { other: 'X' } }, labels))).toEqual(['a other: X']);
    expect(texts(taggedLines({ c: {} }, labels))).toEqual(['c']);
    expect(texts(taggedLines({ a: { area: 'X' } }))).toEqual(['a area: X']);
  });
  it('shows an entry that is not an object with exactly 1 key as compact JSON', () => {
    expect(texts(taggedLines({ a: {}, b: {} }, labels))).toEqual(['{"a":{},"b":{}}']);
    expect(texts(taggedLines({}, labels))).toEqual(['{}']);
    expect(texts(taggedLines('text', labels))).toEqual(['"text"']);
    expect(texts(taggedLines(['a'], labels))).toEqual(['["a"]']);
    expect(texts(taggedLines(null, labels))).toEqual(['null']);
    expect(texts(taggedLines({ a: ['x'] }, labels))).toEqual(['{"a":["x"]}']);
    expect(texts(taggedLines({ a: 3 }, labels))).toEqual(['{"a":3}']);
  });
  it('shows a value that is not a string as compact JSON', () => {
    expect(texts(taggedLines({ a: { area: 3, other: { k: 1 } } }, labels))).toEqual(['Area A: 3', 'a other: {"k":1}']);
  });
});

describe('the link key of a tagged list', () => {
  it('makes the value of the link key the link of the line and gives no line of its own', () => {
    const lines = taggedLines({ std: { type: 'Entry', url: 'https://example.org/e' } }, { 'std.type': 'Kind' }, { linkKey: 'url' });
    expect(lines).toEqual([{ label: 'Kind', value: 'Entry', text: 'Kind: Entry', href: 'https://example.org/e' }]);
    expect(taggedLines({ std: { type: 'Entry', url: 'https://example.org/e' } }, {}).map((l) => l.text)).toEqual(['std type: Entry', 'std url: https://example.org/e']);
  });
  it('links every line of the entry and refuses an address that is not http or https', () => {
    const two = taggedLines({ std: { type: 'A', note: 'B', url: 'https://example.org/e' } }, {}, { linkKey: 'url' });
    expect(two.map((l) => l.href)).toEqual(['https://example.org/e', 'https://example.org/e']);
    const bad = taggedLines({ std: { type: 'A', url: 'javascript:alert(1)' } }, {}, { linkKey: 'url' });
    expect(bad.map((l) => [l.text, l.href])).toEqual([['std type: A', undefined]]);
  });
  it('gives the label of the tag with the link when the tag has only the link key', () => {
    expect(taggedLines({ std: { url: 'https://example.org/e' } }, { std: 'Standard' }, { linkKey: 'url' })).toEqual([{ label: 'Standard', value: '', text: 'Standard', href: 'https://example.org/e' }]);
  });
});

describe('the nested tag of a tagged list', () => {
  it('gives 1 line with the label of "<tag>.<nested tag>", the inner values and the link', () => {
    expect(taggedLines(nested, { 'specialises.std': 'Narrows STD' }, { linkKey: 'url' })).toEqual([
      { label: 'Narrows STD', value: 'Device', text: 'Narrows STD Device', href: 'https://example.org/x.yaml#L1' },
    ]);
  });
  it('joins several inner values with a space, in key order, and falls back to the tag and the nested tag', () => {
    const lines = taggedLines({ a: { b: { y: 'Two', x: 'One', url: 'https://example.org/z' } } }, {}, { linkKey: 'url' });
    expect(texts(lines)).toEqual(['a b Two One']);
    expect(lines[0].href).toBe('https://example.org/z');
  });
  it('gives the label of the nested tag alone when it has no inner value', () => {
    expect(texts(taggedLines({ a: { b: {} } }, { 'a.b': 'Bee' }))).toEqual(['Bee']);
  });
});

describe('the text value of a tagged list', () => {
  it('gives the label of the tag and the text when no node has the text as its id', () => {
    expect(texts(taggedLines({ obligation: 'obl-9' }, { obligation: 'Obligation' }, { resolve }))).toEqual(['Obligation: obl-9']);
    expect(texts(taggedLines({ obligation: 'obl-1' }, { obligation: 'Obligation' }))).toEqual(['Obligation: obl-1']);
  });
  it('shows the title of the node that has the text as its id, with the node', () => {
    expect(taggedLines({ obligation: 'obl-1' }, { obligation: 'Obligation' }, { resolve })).toEqual([
      { label: 'Obligation', value: 'Pay on time', text: 'Obligation: Pay on time', node: nodes['obl-1'] },
    ]);
  });
});

describe('the tags of a list', () => {
  it('are the keys of the objects, each once, in order of first use', () => {
    expect(taggedKeys([{ b: {} }, { a: {} }, { b: { x: 1 } }, 'text', null])).toEqual(['b', 'a']);
    expect(taggedKeys([])).toEqual([]);
    expect(taggedKeys(undefined)).toEqual([]);
    expect(taggedKeys('text')).toEqual([]);
  });
  it('are the values of a filter with from "keys", and the items without it', () => {
    expect(filterValues([{ a: {} }, { b: {} }], 'keys')).toEqual(['a', 'b']);
    expect(filterValues(['x', 2])).toEqual(['x', '2']);
    expect(filterValues('x')).toEqual(['x']);
    expect(filterValues('')).toEqual([]);
  });
});

describe.each(['glossary', 'product'])('the filter by tag of the %s fixture', (name) => {
  const { graph, profile } = load(name);
  const index = buildIndex(buildModel(graph, profile));
  const spec = profile.fieldFilters!.find((f) => f.from === 'keys')!;
  const field = spec.field;
  const ids = index.model.nodes.map((n) => n.id);
  const carriers = index.model.nodes.filter((n) => n.d[field] !== undefined);

  it('takes the values from the keys', () => {
    expect(spec.from).toBe('keys');
    const tags = new Set(carriers.flatMap((n) => taggedKeys(n.d[field])));
    expect(tags.size).toBeGreaterThanOrEqual(2);
    for (const n of carriers) {
      const own = taggedKeys(n.d[field]);
      for (const t of own) expect(fieldValues(index, field, n.id).has(t), `${n.id} has ${t}`).toBe(true);
    }
    for (const t of tags) expect(Object.keys(spec.values ?? {})).toContain(t);
  });
  it('selects the nodes that carry a tag, and no other carrier', () => {
    const tag = taggedKeys(carriers.find((n) => taggedKeys(n.d[field]).length)!.d[field])[0];
    const hit = applyFilters(index, ids, { ...none, fields: { [field]: [tag] } });
    for (const n of carriers) expect(hit.includes(n.id), n.id).toBe(taggedKeys(n.d[field]).includes(tag));
  });
  it('gives the value "" to a carrier with an empty list or no field', () => {
    const empty = carriers.filter((n) => !taggedKeys(n.d[field]).length);
    const hit = applyFilters(index, ids, { ...none, fields: { [field]: [''] } });
    for (const n of empty) expect(hit.includes(n.id), n.id).toBe(true);
  });
});

describe('the filter by tag with exact values', () => {
  const { graph, profile } = load('glossary');
  const index = buildIndex(buildModel(graph, profile));
  const ids = index.model.nodes.map((n) => n.id);
  const f = (fields: string[]) => sorted(applyFilters(index, ids, { ...none, kinds: ['term'], fields: { origin: fields } }));
  it('has the tags of the fixture as values', () => {
    expect(sorted(fieldValues(index, 'origin', 'scale'))).toEqual(['primer', 'theory']);
    expect(sorted(fieldValues(index, 'origin', 'chord'))).toEqual(['house', 'theory']);
  });
  it('selects by tag', () => {
    expect(f(['theory'])).toEqual(['chord', 'scale']);
    expect(f(['house'])).toEqual(['chord']);
    expect(f(['primer'])).toEqual(['scale', 'tempo']);
  });
  it('selects an empty list and a missing field by the value ""', () => {
    expect(fieldValues(index, 'origin', 'beat')).toEqual(new Set(['']));
    expect(fieldValues(index, 'origin', 'fermata')).toEqual(new Set(['']));
    expect(f([''])).toEqual(['beat', 'fermata']);
  });
});

describe('the schema of the profile', () => {
  const { profile } = load('glossary');
  it('accepts the details options with taggedLists and a filter with from', () => {
    expect(validateProfile(profile)).toEqual([]);
  });
  it('rejects an unknown details option', () => {
    const bad = { ...profile, details: { ...profile.details, taggedList: [] } };
    expect(validateProfile(bad).join('\n')).toMatch(/profile\/details must NOT have additional properties/);
  });
  it('accepts a text as the link key of a tagged list and rejects another type', () => {
    expect(validateProfile({ ...profile, details: { taggedLists: [{ title: 'T', field: 'f', linkKey: 'url' }] } })).toEqual([]);
    expect(validateProfile({ ...profile, details: { taggedLists: [{ title: 'T', field: 'f', linkKey: 3 }] } }).join('\n')).toMatch(/linkKey/);
  });
  it('rejects an unknown key inside a taggedLists entry and a wrong value of from', () => {
    const entry = { title: 'T', field: 'f', label: 'x' };
    expect(validateProfile({ ...profile, details: { taggedLists: [entry] } }).join('\n')).toMatch(/taggedLists\/0 must NOT have additional properties/);
    const filter = { field: 'origin', label: 'O', from: 'values' };
    expect(validateProfile({ ...profile, fieldFilters: [filter] }).join('\n')).toMatch(/from/);
  });
});

describe('the tagged list in the spec Markdown', () => {
  const profile = {
    project: 'Mini',
    source: { nodes: 'nodes', id: 'id', kind: 'kind' },
    fields: { title: ['title'], statement: ['text'] },
    lifecycle: { field: 'state', fallback: 'live' },
    kinds: [{ id: 'item', label: 'Item', plural: 'items', prefix: 'item-', role: 'hierarchy', color: { light: '#222222', dark: '#dddddd' }, chips: [] }],
    edges: {},
    details: { taggedLists: [{ title: 'Basis', field: 'basis', linkKey: 'url', labels: { 'specialises.std': 'Narrows STD', obligation: 'Obligation' } }] },
  };
  const graph = {
    nodes: [
      { id: 'item-a', kind: 'item', title: 'Alpha', text: 'A.', basis: [nested, { obligation: 'item-b' }, { obligation: 'gone' }] },
      { id: 'item-b', kind: 'item', title: 'Beta', text: 'B.' },
    ],
  };
  it('writes a link for the address of a line and a link to the node that a text names', () => {
    const graphs = indexGraphs([{ id: 'graph', label: 'Mini', model: buildModel(graph, profile as never) }]);
    const doc = '<!-- semspec:section shape=list show=fields -->\n<!-- semspec:end -->\n';
    const out = fillSpecs(graphs, [{ path: '/work/doc.md', text: doc }]).files[0].text;
    expect(out).toContain('[Narrows STD Device](https://example.org/x.yaml#L1); Obligation: [Beta](#item-b); Obligation: gone');
  });
});
