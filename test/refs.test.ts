// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the refs entries of a profile: 1 entry, a list of entries, the many suffix and the checks.
// Every test runs on 2 profiles with different kinds and field names.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel, kindSchemas, normalise, refsOf, type Graph, type Profile } from '@semspec/core';
import { validateProfile } from '../packages/cli/src/validate';

const load = (name: string) => ({
  graph: JSON.parse(readFileSync(new URL(`../fixtures/${name}/graph.json`, import.meta.url), 'utf8')) as Graph,
  profile: JSON.parse(readFileSync(new URL(`../fixtures/${name}/profile.json`, import.meta.url), 'utf8')) as Profile,
});
const cases = [load('product'), load('glossary')];

// The profile with a second refs entry, and a graph where the first node names the second node.
function withSecond(c: { graph: Graph; profile: Profile }, many = true) {
  const first = refsOf(c.profile)[0];
  const second = { field: 'extraRefs', target: 'who', note: 'why', ...(many ? { many: 'multi' } : {}) };
  const profile = { ...c.profile, refs: [first, second], edges: { ...c.profile.edges, extraRefs: { labels: ['Extra to', 'Extra from'] as [string, string] } } };
  const key = c.profile.source.nodes;
  const nodes = ((c.graph as any)[key] as Record<string, any>[]).map((n) => ({ ...n }));
  const [a, b] = nodes;
  a.extraRefs = [{ who: b.id, why: 'is linked to', multi: true }, { who: nodes[2].id, why: 'is near', multi: false }, { who: nodes[3].id }];
  return { profile, graph: { ...c.graph, [key]: nodes } as Graph, a: a.id as string, ids: [b.id, nodes[2].id, nodes[3].id] as string[] };
}

describe('the refs entries', () => {
  it('keep the old form, where 1 object becomes a list of 1', () => {
    for (const c of cases) {
      const one = refsOf(c.profile);
      expect(one).toHaveLength(1);
      expect(normalise(c.profile).refs).toEqual(one);
      expect(buildModel(c.graph, c.profile).profile.refs).toEqual(one);
      expect(normalise({ ...c.profile, refs: undefined }).refs).toEqual([]);
    }
  });
  it('accept a list and keep the order', () => {
    for (const c of cases) {
      const { profile } = withSecond(c);
      expect(normalise(profile).refs!.map((r) => r.field)).toEqual([refsOf(c.profile)[0].field, 'extraRefs']);
      expect(validateProfile(profile)).toEqual([]);
    }
  });
  it('make the edges of every entry, and the model of the old form stays the same', () => {
    for (const c of cases) {
      const before = buildModel(c.graph, c.profile).edges;
      const { profile, graph, a, ids } = withSecond(c);
      const edges = buildModel(graph, profile).edges;
      expect(edges.filter((e) => e.k !== 'extraRefs')).toEqual(before);
      expect(edges.filter((e) => e.k === 'extraRefs').map((e) => [e.s, e.t])).toEqual(ids.map((t) => [a, t]));
    }
  });
  it('append [] to the note of an item that is marked many', () => {
    for (const c of cases) {
      const { profile, graph } = withSecond(c);
      const notes = buildModel(graph, profile).edges.filter((e) => e.k === 'extraRefs').map((e) => e.n);
      expect(notes).toEqual(['is linked to[]', 'is near', undefined]);
    }
  });
  it('give a many item with no note the note []', () => {
    for (const c of cases) {
      const { profile, graph } = withSecond(c);
      const nodes = (graph as any)[profile.source.nodes] as Record<string, any>[];
      nodes[0].extraRefs = [{ who: nodes[1].id, multi: true }];
      expect(buildModel(graph, profile).edges.filter((e) => e.k === 'extraRefs').map((e) => e.n)).toEqual(['[]']);
    }
  });
  it('ignore the many key when the entry has none', () => {
    for (const c of cases) {
      const { profile, graph } = withSecond(c, false);
      expect(buildModel(graph, profile).edges.filter((e) => e.k === 'extraRefs').map((e) => e.n)).toEqual(['is linked to', 'is near', undefined]);
    }
  });
  it('type the field of every entry in the schema of a kind, with a boolean for the many key', () => {
    for (const c of cases) {
      const { profile } = withSecond(c);
      const schema = kindSchemas(profile)[profile.kinds[0].id].properties as Record<string, any>;
      expect(schema.extraRefs.items.properties).toEqual({ who: { type: 'string' }, why: { type: 'string' }, multi: { type: 'boolean' } });
      expect(schema.extraRefs.items.required).toEqual(['who']);
      expect(schema[refsOf(c.profile)[0].field]).toBeDefined();
    }
  });
  it('refuse an entry whose field has no entry in edges, in the list form and in the old form', () => {
    for (const c of cases) {
      const { profile } = withSecond(c);
      const noEdge = { ...profile, edges: c.profile.edges };
      expect(validateProfile(noEdge).join()).toMatch(/refs names the edge "extraRefs", which has no entry in edges/);
      expect(validateProfile({ ...c.profile, refs: { ...refsOf(c.profile)[0], field: 'nothing' } }).join()).toMatch(/refs names the edge "nothing"/);
    }
  });
  it('refuse an entry with a missing key, an unknown key or a many key that is not text', () => {
    for (const c of cases) {
      const { profile } = withSecond(c);
      const first = refsOf(c.profile)[0];
      expect(validateProfile({ ...profile, refs: [first, { field: 'extraRefs', target: 'who' }] }).join()).toMatch(/note/);
      expect(validateProfile({ ...profile, refs: [first, { field: 'extraRefs', target: 'who', note: 'why', label: 'x' }] }).join()).toMatch(/additional properties/);
      expect(validateProfile({ ...profile, refs: [first, { field: 'extraRefs', target: 'who', note: 'why', many: true }] }).join()).toMatch(/must be string/);
    }
  });
});
