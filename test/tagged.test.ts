// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyFilters, buildIndex, buildModel, fieldValues, filterValues, taggedKeys, taggedLines, type Filters, type Graph, type Profile } from '@semspec/core';
import { validateProfile } from '../packages/cli/src/validate';

const load = (name: string) => ({
  graph: JSON.parse(readFileSync(new URL(`../fixtures/${name}/graph.json`, import.meta.url), 'utf8')) as Graph,
  profile: JSON.parse(readFileSync(new URL(`../fixtures/${name}/profile.json`, import.meta.url), 'utf8')) as Profile,
});
const sorted = (s: Iterable<string>) => Array.from(s).sort();
const none: Filters = { q: '', kinds: [], lifecycles: [], deliveries: [], modules: [], statuses: [] };

const labels = { 'a.area': 'Area A', 'b.type': 'Type B', 'b.property': 'Property B', own: 'Own term' };

describe('the lines of a tagged entry', () => {
  it('gives 1 line for each inner key, with the label of "<tag>.<key>"', () => {
    expect(taggedLines({ a: { area: 'X' } }, labels)).toEqual(['Area A: X']);
    expect(taggedLines({ b: { type: 'Y', property: 'Z' } }, labels)).toEqual(['Type B: Y', 'Property B: Z']);
  });
  it('gives the label of the tag alone when the tag has no inner key', () => {
    expect(taggedLines({ own: {} }, labels)).toEqual(['Own term']);
    expect(taggedLines({ own: null }, labels)).toEqual(['Own term']);
  });
  it('falls back to the tag and the key as written when a label is missing', () => {
    expect(taggedLines({ a: { other: 'X' } }, labels)).toEqual(['a other: X']);
    expect(taggedLines({ c: {} }, labels)).toEqual(['c']);
    expect(taggedLines({ a: { area: 'X' } })).toEqual(['a area: X']);
  });
  it('shows an entry that is not an object with exactly 1 key as compact JSON', () => {
    expect(taggedLines({ a: {}, b: {} }, labels)).toEqual(['{"a":{},"b":{}}']);
    expect(taggedLines({}, labels)).toEqual(['{}']);
    expect(taggedLines('text', labels)).toEqual(['"text"']);
    expect(taggedLines(['a'], labels)).toEqual(['["a"]']);
    expect(taggedLines(null, labels)).toEqual(['null']);
    expect(taggedLines({ a: 'x' }, labels)).toEqual(['{"a":"x"}']);
    expect(taggedLines({ a: ['x'] }, labels)).toEqual(['{"a":["x"]}']);
  });
  it('shows a value that is not a string as compact JSON', () => {
    expect(taggedLines({ a: { area: 3, other: { k: 1 } } }, labels)).toEqual(['Area A: 3', 'a other: {"k":1}']);
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
  it('rejects an unknown key inside a taggedLists entry and a wrong value of from', () => {
    const entry = { title: 'T', field: 'f', label: 'x' };
    expect(validateProfile({ ...profile, details: { taggedLists: [entry] } }).join('\n')).toMatch(/taggedLists\/0 must NOT have additional properties/);
    const filter = { field: 'origin', label: 'O', from: 'values' };
    expect(validateProfile({ ...profile, fieldFilters: [filter] }).join('\n')).toMatch(/from/);
  });
});
