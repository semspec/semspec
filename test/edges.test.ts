// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the edge properties and of the edge type constraints. The model is a labelled property
// graph. Every test runs on 2 profiles with different kinds and field names.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel, formatEdgeProps, isIsoDate, kindSchemas, propsKey, type Graph, type Profile } from '@core/index';
import { validateGraph, validateProfile } from '../src/cli/validate';

type Case = {
  name: string;
  graph: Graph;
  profile: Profile;
  // A refs edge with a number property and a date property, and the node that holds an item of it.
  refs: { field: string; node: string; target: string; note: string; number: string; date: string };
};
const load = (name: string) => ({
  graph: JSON.parse(readFileSync(new URL(`../fixtures/${name}/graph.json`, import.meta.url), 'utf8')) as Graph,
  profile: JSON.parse(readFileSync(new URL(`../fixtures/${name}/profile.json`, import.meta.url), 'utf8')) as Profile,
});
const cases: Case[] = [
  { name: 'product', ...load('product'), refs: { field: 'notes', node: 'dec-use-psp', target: 'epic-checkout', note: 'governs the epic', number: 'share', date: 'since' } },
  { name: 'glossary', ...load('glossary'), refs: { field: 'relations', node: 'scale', target: 'chord', note: 'chords are built from it', number: 'weight', date: 'since' } },
];

// The product fixture holds a link field with objects.
const link = { field: 'complies', node: 'story-pay-by-card', target: 'std-card-data' };
const clone = <T>(v: T): T => structuredClone(v);
const nodesOf = (c: { graph: Graph; profile: Profile }) => (c.graph as any)[c.profile.source.nodes] as Record<string, any>[];
const find = (c: { graph: Graph; profile: Profile }, id: string) => nodesOf(c).find((n) => n[c.profile.source.id] === id)!;
const edgesOf = (c: { graph: Graph; profile: Profile }, k: string, s?: string) => buildModel(c.graph, c.profile).edges.filter((e) => e.k === k && (s === undefined || e.s === s));

// A copy of a case where the first item of a refs field is changed.
function editRef(c: Case, fn: (item: Record<string, any>) => void, edit?: (profile: Profile) => void) {
  const copy = { graph: clone(c.graph), profile: clone(c.profile) };
  fn(find(copy, c.refs.node)[c.refs.field][0]);
  edit?.(copy.profile);
  return copy;
}
const problems = (c: { graph: Graph; profile: Profile }) => validateGraph(c.graph, c.profile);

// A profile with a plain link field `see` that has the default target key. Used on both profiles.
function withLinkField(c: Case) {
  const copy = { graph: clone(c.graph), profile: clone(c.profile) };
  copy.profile.links = [...(copy.profile.links ?? []), 'see'];
  copy.profile.edges.see = { labels: ['Sees', 'Seen by'], properties: { rank: { type: 'number' } } };
  const list = nodesOf(copy);
  list[0].see = [list[1][c.profile.source.id], { id: list[2][c.profile.source.id], rank: 2 }, { id: list[3][c.profile.source.id], rank: 5, extra: 'x' }];
  return { ...copy, ids: [1, 2, 3].map((i) => list[i][c.profile.source.id] as string), from: list[0][c.profile.source.id] as string };
}

describe('the properties of a refs edge', () => {
  it('are the keys of the item except the target key and the note key', () => {
    for (const c of cases) {
      const e = edgesOf(c, c.refs.field, c.refs.node).find((x) => x.t === c.refs.target)!;
      expect(e.n, c.name).toBe(c.refs.note);
      expect(e.p, c.name).toBeDefined();
      expect(Object.keys(e.p!), c.name).toContain(c.refs.date);
      expect(e.p).not.toHaveProperty(c.profile.refs ? (c.profile.refs as any).target : '');
      expect(e.p).not.toHaveProperty((c.profile.refs as any).note);
    }
  });
  it('hold the values with their types', () => {
    const product = cases[0];
    expect(edgesOf(product, 'notes', 'dec-use-psp')[0].p).toEqual({ since: '2024', share: 0.4, force: 'mandatory' });
    const glossary = cases[1];
    expect(edgesOf(glossary, 'relations', 'scale')[0].p).toEqual({ weight: 0.9, since: '1750', role: 'basis' });
  });
  it('are missing when the item has only the target key and the note key', () => {
    for (const c of cases) {
      const copy = editRef(c, (item) => {
        delete item[c.refs.number];
        delete item[c.refs.date];
        delete item.force;
        delete item.role;
      });
      const e = edgesOf(copy, c.refs.field, c.refs.node)[0];
      expect(e.p, c.name).toBeUndefined();
      expect(e, c.name).not.toHaveProperty('p');
    }
  });
  it('leave out the many key', () => {
    for (const c of cases) {
      const copy = editRef(c, (item) => (item.multi = true), (profile) => ((profile.refs as any) = { ...(profile.refs as any), many: 'multi' }));
      const e = edgesOf(copy, c.refs.field, c.refs.node)[0];
      expect(e.n).toBe(`${c.refs.note}[]`);
      expect(e.p).not.toHaveProperty('multi');
    }
  });
});

describe('the properties of a link field', () => {
  it('come from an object that holds the target key, and a plain id gives an edge with no properties', () => {
    for (const c of cases) {
      const x = withLinkField(c);
      const edges = edgesOf(x, 'see', x.from);
      expect(edges.map((e) => [e.t, e.p]), c.name).toEqual([
        [x.ids[0], undefined],
        [x.ids[1], { rank: 2 }],
        [x.ids[2], { rank: 5, extra: 'x' }],
      ]);
    }
  });
  it('use the target key of the profile', () => {
    for (const c of cases) {
      const x = withLinkField(c);
      x.profile.edges.see.target = 'to';
      const first = nodesOf(x)[0];
      first.see = [{ to: x.ids[0], rank: 1 }];
      expect(edgesOf(x, 'see').map((e) => [e.t, e.p]), c.name).toEqual([[x.ids[0], { rank: 1 }]]);
    }
  });
  it('are in the product fixture on the complies edge', () => {
    const c = cases[0];
    const edges = edgesOf(c, 'complies', link.node);
    expect(edges.map((e) => e.p)).toEqual([{ since: '2024-03', audited: true }, { since: '2025' }]);
  });
  it('still place a node in the tree when the parent field holds objects', () => {
    for (const c of cases) {
      const x = withLinkField(c);
      const first = nodesOf(x)[0];
      x.profile.kinds.find((k) => k.id === (first[c.profile.source.kind] ?? c.profile.source.defaultKind))!.parents = [['see']];
      first.see = [x.ids[0]];
      const plain = buildModel(x.graph, x.profile).nodes.find((n) => n.id === x.from)!;
      first.see = [{ id: x.ids[0], rank: 1 }, { id: x.ids[0], rank: 2 }];
      const objects = buildModel(x.graph, x.profile).nodes.find((n) => n.id === x.from)!;
      expect(plain.parents, c.name).toEqual([x.ids[0]]);
      expect(objects.parents, c.name).toEqual([x.ids[0]]);
      expect(objects.up, c.name).toEqual([x.ids[0]]);
    }
  });
});

describe('the parallel edges', () => {
  it('stay 2 edges when the properties differ', () => {
    for (const c of cases) {
      const x = withLinkField(c);
      const to = x.ids[0];
      nodesOf(x)[0].see = [{ id: to, rank: 1 }, { id: to, rank: 2 }, to];
      expect(edgesOf(x, 'see').map((e) => e.p), c.name).toEqual([{ rank: 1 }, { rank: 2 }, undefined]);
    }
  });
  it('merge to 1 edge when the properties are equal, whatever the order of the keys', () => {
    for (const c of cases) {
      const x = withLinkField(c);
      const to = x.ids[0];
      nodesOf(x)[0].see = [{ id: to, rank: 1, tag: 'a' }, { tag: 'a', rank: 1, id: to }, to, to];
      expect(edgesOf(x, 'see').map((e) => e.p), c.name).toEqual([{ rank: 1, tag: 'a' }, undefined]);
    }
  });
  it('keep 2 refs edges with the same note and different properties', () => {
    for (const c of cases) {
      const copy = editRef(c, () => {});
      const list = find(copy, c.refs.node)[c.refs.field];
      list.push({ ...list[0], [c.refs.number]: 99 });
      expect(edgesOf(copy, c.refs.field, c.refs.node).filter((e) => e.t === c.refs.target), c.name).toHaveLength(2);
      list.push({ ...list[0] });
      expect(edgesOf(copy, c.refs.field, c.refs.node).filter((e) => e.t === c.refs.target), c.name).toHaveLength(2);
    }
  });
  it('compare property sets by value', () => {
    expect(propsKey({ a: 1, b: { c: 2, d: 3 } })).toBe(propsKey({ b: { d: 3, c: 2 }, a: 1 }));
    expect(propsKey({ a: 1 })).not.toBe(propsKey({ a: '1' }));
    expect(propsKey(undefined)).toBe('');
  });
});

describe('the edge type constraints', () => {
  it('pass for the fixtures', () => {
    for (const c of cases) {
      expect(validateProfile(c.profile), c.name).toEqual([]);
      expect(problems(c), c.name).toEqual({ errors: [], warnings: [] });
    }
  });
  it('report an edge whose source kind is not in from, and name the node and the edge', () => {
    for (const c of cases) {
      const copy = { graph: c.graph, profile: clone(c.profile) };
      copy.profile.edges[c.refs.field].from = ['nothing'];
      const errors = problems(copy).errors.join('\n');
      expect(errors, c.name).toContain(`Node ${c.refs.node}, edge "${c.refs.field}" to "${c.refs.target}" starts at a node of the kind`);
      expect(errors, c.name).toContain('not in from (nothing)');
    }
  });
  it('report an edge whose target kind is not in to', () => {
    for (const c of cases) {
      const copy = { graph: c.graph, profile: clone(c.profile) };
      copy.profile.edges[c.refs.field].to = ['nothing'];
      const errors = problems(copy).errors.join('\n');
      expect(errors, c.name).toContain(`Node ${c.refs.node}, edge "${c.refs.field}" to "${c.refs.target}" ends at a node of the kind`);
      expect(errors, c.name).toContain('not in to (nothing)');
    }
  });
  it('report an edge from a part, a check or an embedded owner against the constraint of its name', () => {
    for (const c of cases) {
      const edge = c.profile.embedded![0].edge;
      const copy = { graph: c.graph, profile: clone(c.profile) };
      copy.profile.edges[edge].to = ['nothing'];
      expect(problems(copy).errors.join('\n'), c.name).toContain(`edge "${edge}"`);
    }
  });
  it('warn about a property that the profile does not declare', () => {
    for (const c of cases) {
      const copy = editRef(c, (item) => (item.colour = 'red'));
      const { errors, warnings } = problems(copy);
      expect(errors, c.name).toEqual([]);
      expect(warnings.join('\n'), c.name).toContain(`Node ${c.refs.node}, edge "${c.refs.field}" to "${c.refs.target}" has the property "colour", which the profile does not declare`);
    }
  });
  it('accept any property on an edge name with no properties declaration', () => {
    for (const c of cases) {
      const copy = editRef(c, (item) => (item.colour = 'red'), (profile) => delete profile.edges[c.refs.field].properties);
      expect(problems(copy), c.name).toEqual({ errors: [], warnings: [] });
    }
  });
  it('report a required property that is missing', () => {
    for (const c of cases) {
      const required = Object.entries(c.profile.edges[c.refs.field].properties ?? {}).find(([, d]) => d.required)?.[0] ?? c.refs.number;
      const copy = editRef(c, (item) => delete item[required], (profile) => (profile.edges[c.refs.field].properties![required].required = true));
      expect(problems(copy).errors.join('\n'), c.name).toContain(`edge "${c.refs.field}" to "${c.refs.target}" lacks the required property "${required}"`);
    }
  });
  it('report a required property that is missing on a link object and on an edge with no properties at all', () => {
    const c = cases[0];
    const copy = { graph: clone(c.graph), profile: c.profile };
    delete find(copy, link.node).complies[0].since;
    expect(problems(copy).errors.join('\n')).toContain('lacks the required property "since"');
    find(copy, link.node).complies[0] = { std: link.target, since: '2024' };
    find(copy, link.node).complies[1] = link.target;
    expect(problems(copy).errors.join('\n')).toContain('lacks the required property "since"');
  });
  it('report a value of a wrong type', () => {
    for (const c of cases) {
      const wrongNumber = editRef(c, (item) => (item[c.refs.number] = 'high'));
      expect(problems(wrongNumber).errors.join('\n'), c.name).toContain(`has the property "${c.refs.number}" with the value "high", which is not of the type number`);
      const wrongDate = editRef(c, (item) => (item[c.refs.date] = '2024-13'));
      expect(problems(wrongDate).errors.join('\n'), c.name).toContain(`"${c.refs.date}" with the value "2024-13", which is not of the type date`);
      const wrongString = editRef(c, (item) => (item.label = 5), (profile) => (profile.edges[c.refs.field].properties!.label = { type: 'string' }));
      expect(problems(wrongString).errors.join('\n'), c.name).toContain('"label" with the value 5, which is not of the type string');
      const wrongFlag = editRef(c, (item) => (item.flag = 'yes'), (profile) => (profile.edges[c.refs.field].properties!.flag = { type: 'boolean' }));
      expect(problems(wrongFlag).errors.join('\n'), c.name).toContain('"flag" with the value "yes", which is not of the type boolean');
      const goodFlag = editRef(c, (item) => (item.flag = false), (profile) => (profile.edges[c.refs.field].properties!.flag = { type: 'boolean' }));
      expect(problems(goodFlag).errors, c.name).toEqual([]);
    }
  });
  it('check a property of a link object', () => {
    const c = cases[0];
    const copy = { graph: clone(c.graph), profile: c.profile };
    find(copy, link.node).complies[0].audited = 'yes';
    expect(problems(copy).errors.join('\n')).toContain(`Node ${link.node}, edge "complies" to "${link.target}" has the property "audited"`);
  });
  it('report a link field with an object that has no target key, and name the node', () => {
    for (const c of cases) {
      const x = withLinkField(c);
      nodesOf(x)[0].see = [{ rank: 1 }];
      const errors = validateGraph(x.graph, x.profile).errors.join('\n');
      expect(errors, c.name).toContain(`Field "see" of "${x.from}" holds an item that is not a node id and has no "id" key`);
      x.profile.edges.see.target = 'to';
      nodesOf(x)[0].see = [{ id: x.ids[0] }];
      expect(validateGraph(x.graph, x.profile).errors.join('\n'), c.name).toContain('has no "to" key');
      nodesOf(x)[0].see = [7];
      expect(validateGraph(x.graph, x.profile).errors.join('\n'), c.name).toContain(`Field "see" of "${x.from}"`);
    }
  });
  it('count a link object to a missing node as a missing link', () => {
    for (const c of cases) {
      const x = withLinkField(c);
      nodesOf(x)[0].see = [{ id: 'nothing-here', rank: 1 }];
      expect(validateGraph(x.graph, x.profile).warnings.join('\n'), c.name).toContain('1 link(s) name a node that is not in the graph');
    }
  });
  it('use the label of the source when the graph comes from files', () => {
    for (const c of cases) {
      const copy = { graph: c.graph, profile: clone(c.profile) };
      copy.profile.edges[c.refs.field].to = ['nothing'];
      const labels = nodesOf(copy).map((n) => `File "${n[c.profile.source.id]}.yaml"`);
      const errors = validateGraph(copy.graph, copy.profile, labels).errors.join('\n');
      expect(errors, c.name).toContain(`File "${c.refs.node}.yaml", edge "${c.refs.field}"`);
    }
  });
});

describe('the profile check of an edge', () => {
  it('names an unknown kind in from and in to', () => {
    for (const c of cases) {
      const profile = clone(c.profile);
      profile.edges[c.refs.field].from = ['nothing'];
      profile.edges[c.refs.field].to = [c.profile.kinds[0].id, 'missing'];
      const text = validateProfile(profile).join('\n');
      expect(text, c.name).toContain(`profile edge ${c.refs.field} from names the unknown kind "nothing"`);
      expect(text, c.name).toContain(`profile edge ${c.refs.field} to names the unknown kind "missing"`);
    }
  });
  it('refuses a property with an unknown type and an unknown key', () => {
    for (const c of cases) {
      const profile = clone(c.profile);
      (profile.edges[c.refs.field].properties as any).bad = { type: 'integer' };
      expect(validateProfile(profile).join('\n'), c.name).toContain('edges/');
      const other = clone(c.profile);
      (other.edges[c.refs.field].properties as any).bad = { type: 'string', optional: true };
      expect(validateProfile(other).join('\n'), c.name).toMatch(/additional properties/);
    }
  });
});

describe('the schema of a kind', () => {
  it('types the declared properties of a refs field and requires the required ones', () => {
    for (const c of cases) {
      const required = clone(c.profile);
      required.edges[c.refs.field].properties![c.refs.number].required = true;
      const kind = c.profile.kinds.find((k) => nodesOf(c).some((n) => n[c.profile.source.kind] === k.id && n[c.refs.field]) || k.id === c.profile.source.defaultKind)!;
      const item = (kindSchemas(required)[kind.id].properties as any)[c.refs.field].items;
      expect(item.properties[c.refs.number], c.name).toEqual({ type: 'number' });
      expect(item.properties[c.refs.date].type, c.name).toBe('string');
      expect(item.required, c.name).toContain(c.refs.number);
    }
  });
  it('types a link field as ids or objects with the declared properties', () => {
    for (const c of cases) {
      const x = withLinkField(c);
      x.profile.edges.see.target = 'to';
      x.profile.edges.see.properties = { rank: { type: 'number', required: true }, since: { type: 'date' }, flag: { type: 'boolean' }, name: { type: 'string' } };
      const kind = x.profile.kinds[x.profile.kinds.length - 1].id;
      const parentKind = x.profile.kinds.find((k) => k.role === 'hierarchy')!.id;
      const field = (kindSchemas(x.profile)[parentKind].properties as any).see;
      expect(field.type, kind).toBe('array');
      expect(field.items.anyOf[0], c.name).toEqual({ type: 'string' });
      const object = field.items.anyOf[1];
      expect(object.required, c.name).toEqual(['to', 'rank']);
      expect(object.properties.to, c.name).toEqual({ type: 'string' });
      expect(object.properties.rank, c.name).toEqual({ type: 'number' });
      expect(object.properties.flag, c.name).toEqual({ type: 'boolean' });
      expect(object.properties.name, c.name).toEqual({ type: 'string' });
      const date = new RegExp(object.properties.since.pattern);
      for (const ok of ['2024', '2024-03', '2024-03-31']) expect(date.test(ok), ok).toBe(true);
      for (const bad of ['24', '2024-13', '2024-00', '2024-03-32', 'May 2024', '2024-3']) expect(date.test(bad), bad).toBe(false);
    }
  });
  it('keeps the target key "id" for a link field with no declaration', () => {
    for (const c of cases) {
      const x = withLinkField(c);
      delete x.profile.edges.see.properties;
      const parentKind = x.profile.kinds.find((k) => k.role === 'hierarchy')!.id;
      const object = (kindSchemas(x.profile)[parentKind].properties as any).see.items.anyOf[1];
      expect(object.required).toEqual(['id']);
    }
  });
});

describe('the date type', () => {
  it('accepts YYYY, YYYY-MM and YYYY-MM-DD and nothing else', () => {
    for (const ok of ['2024', '1750', '2024-02', '2024-02-29', '2023-12-31']) expect(isIsoDate(ok), ok).toBe(true);
    for (const bad of ['2023-02-29', '2024-13', '2024-04-31', '24', '2024/01/01', '2024-1-1', '', 2024, null, undefined]) expect(isIsoDate(bad), String(bad)).toBe(false);
  });
});

describe('the compact line of the properties', () => {
  it('joins the properties with a middle dot', () => {
    expect(formatEdgeProps({ since: '2024', share: 0.4 })).toBe('since 2024 · share 0.4');
    expect(formatEdgeProps({ audited: true })).toBe('audited true');
    expect(formatEdgeProps(undefined)).toBe('');
    expect(formatEdgeProps({})).toBe('');
  });
});
