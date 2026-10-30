// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the vocabularies: the pure logic, the checks, the schemas and the chips. Every test runs
// on 2 profiles. The product profile keeps its vocabularies inline. The glossary profile keeps the
// vocabulary of the lifecycle in a file.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  broaderChain,
  buildIndex,
  buildModel,
  codeLabel,
  codeProblem,
  codedOptions,
  conceptTree,
  fieldConcept,
  fieldLabel,
  formatEdgeProps,
  groupLabelOf,
  kindSchemas,
  orderCodes,
  propertyLabel,
  schemeOfField,
  sortConcepts,
  summaryOf,
  vocabularyProblems,
  type Graph,
  type Profile,
  type Vocabulary,
} from '@core/index';
import { loadProfile } from '../src/cli/index';
import { validateGraph, validateProfile } from '../src/cli/validate';

const fixture = (name: string, file: string) => new URL(`../fixtures/${name}/${file}`, import.meta.url).pathname;
type Case = {
  name: string;
  graph: Graph;
  profile: Profile;
  // A field of the lifecycle and a node with a code in it.
  life: { field: string; scheme: string; node: string; code: string; label: string };
  // A field with a vocabulary that is not the lifecycle field, and a node with a code in it.
  field: { path: string; scheme: string; node: string; code: string };
  // A refs edge with a property that has a vocabulary.
  edge: { name: string; node: string; property: string; scheme: string; code: string; label: string };
};
const load = (name: string) => ({
  graph: JSON.parse(readFileSync(fixture(name, 'graph.json'), 'utf8')) as Graph,
  // The loader reads the vocabulary files of the profile.
  profile: loadProfile(fixture(name, 'profile.json')),
});
const clone = <T>(v: T): T => structuredClone(v);
const cases: Case[] = [
  {
    name: 'product',
    ...load('product'),
    life: { field: 'status', scheme: 'lifecycle', node: 'epic-search', code: 'active', label: 'Active' },
    field: { path: 'priority', scheme: 'priority', node: 'story-pay-by-card', code: 'high' },
    edge: { name: 'notes', node: 'dec-use-psp', property: 'force', scheme: 'force', code: 'mandatory', label: 'Mandatory' },
  },
  {
    name: 'glossary',
    ...load('glossary'),
    life: { field: 'state', scheme: 'state', node: 'beat', code: 'draft', label: 'Draft' },
    // The glossary has no second coded field. The tests add one to a copy.
    field: { path: 'level', scheme: 'level', node: 'scale', code: 'basic' },
    edge: { name: 'relations', node: 'scale', property: 'role', scheme: 'role', code: 'basis', label: 'Basis' },
  },
];
// A copy of the case where the field `field.path` has the scheme `field.scheme` and the node holds a code.
function withField(c: Case) {
  const copy = { ...c, graph: clone(c.graph), profile: clone(c.profile) };
  copy.profile.vocabularies = { level: { label: 'Level', concepts: [{ code: 'basic', label: 'Basic' }, { code: 'expert', label: 'Expert' }] }, ...copy.profile.vocabularies };
  copy.profile.fieldVocabularies = { ...copy.profile.fieldVocabularies, [c.field.path]: c.field.scheme };
  nodesOf(copy).find((n) => n.id === c.field.node)![c.field.path] = c.field.code;
  return copy;
}
const nodesOf = (c: { graph: Graph; profile: Profile }) => (c.graph as any)[c.profile.source.nodes] as Record<string, any>[];
const node = (c: { graph: Graph; profile: Profile }, id: string) => nodesOf(c).find((n) => n[c.profile.source.id] === id)!;
const schemeOf = (c: Case, id: string) => c.profile.vocabularies![id];
const errorsOf = (c: { graph: Graph; profile: Profile }) => validateGraph(c.graph, c.profile).errors;
// A scheme of 3 levels for the tests of the hierarchy.
const tree: Vocabulary = {
  label: 'Tree',
  concepts: [
    { code: 'leaf-b', label: 'Beta', broader: 'branch' },
    { code: 'root', label: 'Root' },
    { code: 'leaf-a', label: 'Alpha', broader: 'branch', order: 1 },
    { code: 'branch', label: 'Branch', broader: 'root' },
    { code: 'other', label: 'Other', order: 0 },
  ],
};

describe('resolving a value', () => {
  it('gives the concept and the label of a code, and the value itself for a value that is not a code', () => {
    for (const c of cases) {
      const scheme = schemeOf(c, c.life.scheme);
      expect(schemeOfField(c.profile, c.life.field)?.id, c.name).toBe(c.life.scheme);
      expect(fieldConcept(c.profile, c.life.field, c.life.code)?.label, c.name).toBe(c.life.label);
      expect(fieldLabel(c.profile, c.life.field, c.life.code), c.name).toBe(c.life.label);
      expect(fieldLabel(c.profile, c.life.field, 'nothing'), c.name).toBe('nothing');
      expect(fieldLabel(c.profile, 'no-such-field', c.life.code), c.name).toBe(c.life.code);
      expect(codeLabel(scheme, c.life.code), c.name).toBe(c.life.label);
    }
  });
  it('gives the label of a code of an edge property and the value itself for any other value', () => {
    for (const c of cases) {
      expect(propertyLabel(c.profile, c.edge.name, c.edge.property, c.edge.code), c.name).toBe(c.edge.label);
      expect(propertyLabel(c.profile, c.edge.name, c.edge.property, 'nothing'), c.name).toBe('nothing');
      expect(propertyLabel(c.profile, c.edge.name, 'no-such-property', 4), c.name).toBe('4');
      expect(formatEdgeProps({ [c.edge.property]: c.edge.code, other: 1 }, (k, v) => propertyLabel(c.profile, c.edge.name, k, v)), c.name).toBe(`${c.edge.property} ${c.edge.label} · other 1`);
    }
  });
});

describe('the order of the concepts', () => {
  it('sorts by order, then by label, and puts a concept with no order last', () => {
    expect(sortConcepts(tree.concepts).map((c) => c.code)).toEqual(['other', 'leaf-a', 'leaf-b', 'branch', 'root']);
    for (const c of cases) {
      const scheme = schemeOf(c, c.life.scheme);
      expect(sortConcepts([...scheme.concepts].reverse()).map((x) => x.code), c.name).toEqual(sortConcepts(scheme.concepts).map((x) => x.code));
    }
  });
  it('orders the codes of a list, with a value that is not a code after the codes and the empty value last', () => {
    expect(orderCodes(tree, ['', 'zzz', 'root', 'aaa', 'leaf-a', 'other'])).toEqual(['other', 'leaf-a', 'root', 'aaa', 'zzz', '']);
    for (const c of cases) {
      const codes = schemeOf(c, c.life.scheme).concepts.map((x) => x.code);
      expect(orderCodes(schemeOf(c, c.life.scheme), [...codes].reverse()), c.name).toEqual(sortConcepts(schemeOf(c, c.life.scheme).concepts).map((x) => x.code));
    }
  });
  it('gives the options of a list with the labels and the order of the vocabulary', () => {
    for (const c of cases) {
      const codes = schemeOf(c, c.life.scheme).concepts.map((x) => x.code);
      const options = codedOptions(schemeOf(c, c.life.scheme), ['', 'nothing', ...codes.slice().reverse()]);
      expect(options.map((o) => o.value), c.name).toEqual([...orderCodes(schemeOf(c, c.life.scheme), codes), 'nothing', '']);
      expect(options.find((o) => o.value === c.life.code)?.label, c.name).toBe(c.life.label);
      expect(options.find((o) => o.value === 'nothing')?.label, c.name).toBe('nothing');
    }
  });
});

describe('the hierarchy of a vocabulary', () => {
  it('names the group of a concept by the label of its broader concept', () => {
    expect(groupLabelOf(tree, 'leaf-a')).toBe('Branch');
    expect(groupLabelOf(tree, 'root')).toBeUndefined();
    expect(groupLabelOf(tree, 'nothing')).toBeUndefined();
    const glossary = cases[1];
    expect(groupLabelOf(schemeOf(glossary, 'state'), 'replaced')).toBe('Retired');
    expect(codedOptions(schemeOf(glossary, 'state'), ['stable', 'replaced']).map((o) => o.group)).toEqual([undefined, 'Retired']);
  });
  it('lists the codes from a concept up to the top', () => {
    expect(broaderChain(tree, 'leaf-b')).toEqual(['leaf-b', 'branch', 'root']);
    expect(broaderChain(tree, 'root')).toEqual(['root']);
    expect(broaderChain({ label: 'Loop', concepts: [{ code: 'a', label: 'A', broader: 'b' }, { code: 'b', label: 'B', broader: 'a' }] }, 'a')).toEqual(['a', 'b']);
  });
  it('builds a forest in list order and leaves out a concept in a cycle', () => {
    const shape = (nodes: ReturnType<typeof conceptTree>): unknown => nodes.map((n) => [n.concept.code, shape(n.children)]);
    expect(shape(conceptTree(tree))).toEqual([['other', []], ['root', [['branch', [['leaf-a', []], ['leaf-b', []]]]]]]);
    const loop: Vocabulary = { label: 'Loop', concepts: [{ code: 'a', label: 'A', broader: 'b' }, { code: 'b', label: 'B', broader: 'a' }, { code: 'c', label: 'C' }] };
    expect(shape(conceptTree(loop))).toEqual([['c', []]]);
  });
});

describe('the problems of a vocabulary', () => {
  it('report a duplicated code', () => {
    for (const c of cases) {
      const scheme = clone(schemeOf(c, c.life.scheme));
      scheme.concepts.push({ ...scheme.concepts[0] });
      expect(vocabularyProblems(c.life.scheme, scheme).join('\n'), c.name).toMatch(new RegExp(`vocabulary "${c.life.scheme}" has the code "${scheme.concepts[0].code}" more than once`));
      const copy = clone(c.profile);
      copy.vocabularies![c.life.scheme] = scheme;
      expect(validateProfile(copy).join('\n'), c.name).toMatch(/more than once/);
    }
  });
  it('report a broader code that does not exist', () => {
    for (const c of cases) {
      const copy = clone(c.profile);
      copy.vocabularies![c.life.scheme].concepts[0].broader = 'nothing';
      expect(validateProfile(copy).join('\n'), c.name).toMatch(/has the broader code "nothing", which is not a code of the vocabulary/);
    }
  });
  it('report a cycle in broader, also a concept that is its own broader', () => {
    for (const c of cases) {
      const copy = clone(c.profile);
      const [a, b] = copy.vocabularies![c.life.scheme].concepts;
      a.broader = b.code;
      b.broader = a.code;
      expect(validateProfile(copy).join('\n'), c.name).toMatch(/has a cycle in broader/);
      delete a.broader;
      b.broader = b.code;
      expect(validateProfile(copy).join('\n'), c.name).toMatch(/has a cycle in broader: .*/);
    }
  });
  it('report a scheme that fieldVocabularies or an edge property names and the profile lacks', () => {
    for (const c of cases) {
      const copy = clone(c.profile);
      copy.fieldVocabularies = { ...copy.fieldVocabularies, extra: 'nothing' };
      expect(validateProfile(copy).join('\n'), c.name).toMatch(/names the vocabulary "nothing" for the field "extra"/);
      const edge = clone(c.profile);
      edge.edges[c.edge.name].properties![c.edge.property].vocabulary = 'nothing';
      expect(validateProfile(edge).join('\n'), c.name).toMatch(new RegExp(`edge ${c.edge.name}, property "${c.edge.property}", names the vocabulary "nothing"`));
    }
  });
  it('report an edge property with a vocabulary that is not a string', () => {
    for (const c of cases) {
      const copy = clone(c.profile);
      copy.edges[c.edge.name].properties![c.edge.property].type = 'number';
      expect(validateProfile(copy).join('\n'), c.name).toMatch(/has a vocabulary and the type number/);
    }
  });
  it('report a lifecycle fallback, a fallback for a kind and a state that are not codes of the lifecycle vocabulary', () => {
    for (const c of cases) {
      const copy = clone(c.profile);
      copy.lifecycle.fallback = 'nothing';
      copy.lifecycle.byKind = { [c.profile.kinds[0].id]: 'other' };
      copy.lifecycle.states = { ...copy.lifecycle.states, gone: { muted: true } };
      const text = validateProfile(copy).join('\n');
      expect(text, c.name).toMatch(/lifecycle fallback has the value "nothing"/);
      expect(text, c.name).toMatch(/lifecycle byKind ".*" has the value "other"/);
      expect(text, c.name).toMatch(/lifecycle state "gone" has the value "gone"/);
    }
  });
  it('accept the vocabularies of both fixtures', () => {
    for (const c of cases) expect(validateProfile(c.profile), c.name).toEqual([]);
  });
});

describe('the check of a value', () => {
  it('accepts a code and refuses an alternative label or any other text', () => {
    for (const c of cases) {
      const scheme = clone(schemeOf(c, c.life.scheme));
      scheme.concepts[0].altLabels = ['alt'];
      expect(codeProblem(c.life.scheme, scheme, scheme.concepts[0].code), c.name).toBeUndefined();
      expect(codeProblem(c.life.scheme, scheme, 'alt'), c.name).toMatch(/is not a code/);
      expect(codeProblem(c.life.scheme, scheme, scheme.concepts[0].label.toUpperCase() + 'x'), c.name).toMatch(/is not a code/);
    }
  });
  it('refuses a lifecycle value that is not a code and names the node and the allowed codes', () => {
    for (const c of cases) {
      const copy = { ...c, graph: clone(c.graph), profile: c.profile };
      node(copy, c.life.node)[c.life.field] = 'nothing';
      const text = errorsOf(copy).join('\n');
      expect(text, c.name).toContain(`${c.life.node} has the field "${c.life.field}" with the value "nothing", which is not a code of the vocabulary "${c.life.scheme}".`);
      expect(text, c.name).toContain(`Allowed codes: ${schemeOf(c, c.life.scheme).concepts.map((x) => x.code).join(', ')}.`);
    }
  });
  it('accepts a node with a code and a node with no value', () => {
    for (const c of cases) {
      expect(errorsOf(c), c.name).toEqual([]);
      const copy = { ...c, graph: clone(c.graph), profile: c.profile };
      delete node(copy, c.life.node)[c.life.field];
      expect(errorsOf(copy), c.name).toEqual([]);
    }
  });
  it('refuses a value of another field with a vocabulary, also in a list', () => {
    for (const c of cases) {
      const copy = withField(c);
      expect(errorsOf(copy), c.name).toEqual([]);
      node(copy, c.field.node)[c.field.path] = ['nothing', c.field.code];
      const text = errorsOf(copy).join('\n');
      expect(text, c.name).toContain(`has the field "${c.field.path}" with the value "nothing"`);
      expect(text, c.name).not.toContain(`with the value "${c.field.code}"`);
    }
  });
  it('lists the allowed codes only when the vocabulary has 10 codes or fewer', () => {
    for (const c of cases) {
      const copy = withField(c);
      const concepts = Array.from({ length: 11 }, (_, i) => ({ code: `c${i}`, label: `Code ${i}` }));
      copy.profile.vocabularies![c.field.scheme] = { label: 'Long', concepts };
      node(copy, c.field.node)[c.field.path] = 'nothing';
      expect(errorsOf(copy).join('\n'), c.name).not.toContain('Allowed codes');
      copy.profile.vocabularies![c.field.scheme] = { label: 'Short', concepts: concepts.slice(0, 10) };
      expect(errorsOf(copy).join('\n'), c.name).toContain(`Allowed codes: ${concepts.slice(0, 10).map((x) => x.code).join(', ')}.`);
    }
  });
  it('refuses a value of an edge property that is not a code and names the edge', () => {
    for (const c of cases) {
      const copy = { ...c, graph: clone(c.graph), profile: c.profile };
      node(copy, c.edge.node)[c.edge.name][0][c.edge.property] = 'nothing';
      const text = errorsOf(copy).join('\n');
      expect(text, c.name).toContain(`${c.edge.node}, edge "${c.edge.name}" to`);
      expect(text, c.name).toContain(`has the property "${c.edge.property}" with the value "nothing", which is not a code of the vocabulary "${c.edge.scheme}".`);
      expect(text, c.name).toContain('Allowed codes:');
    }
  });
});

describe('the schema of a kind', () => {
  it('gives a field with a vocabulary the enum of the codes, with the labels in the description', () => {
    for (const c of cases) {
      const copy = withField(c);
      const schemas = kindSchemas(copy.profile) as Record<string, any>;
      const kind = copy.profile.kinds[0].id;
      const life = schemas[kind].properties[c.life.field];
      const codes = schemeOf(c, c.life.scheme).concepts.map((x) => x.code);
      expect(life.enum, c.name).toEqual(codes);
      expect(life.description, c.name).toContain(`${c.life.code} = ${c.life.label}`);
      const other = schemas[kind].properties[c.field.path];
      expect(other.anyOf[0].enum, c.name).toEqual(copy.profile.vocabularies![c.field.scheme].concepts.map((x) => x.code));
      expect(other.anyOf[1], c.name).toMatchObject({ type: 'array', items: { enum: other.anyOf[0].enum } });
    }
  });
  it('gives an edge property with a vocabulary the enum of the codes', () => {
    for (const c of cases) {
      const schemas = kindSchemas(c.profile) as Record<string, any>;
      const holder = Object.values(schemas).find((s) => s.properties[c.edge.name]);
      const property = holder.properties[c.edge.name].items.properties[c.edge.property];
      expect(holder, c.name).toBeDefined();
      expect(property.enum, c.name).toEqual(schemeOf(c, c.edge.scheme).concepts.map((x) => x.code));
      expect(property.description, c.name).toContain(`${c.edge.code} = ${c.edge.label}`);
    }
  });
});

describe('the chips', () => {
  it('show the label of a coded lifecycle and of a coded field', () => {
    for (const c of cases) {
      const index = buildIndex(buildModel(c.graph, c.profile));
      const n = index.byId.get(c.life.node)!;
      expect(summaryOf(index, n).chips.map((x) => x.text), c.name).toContain(c.life.label);
    }
    const product = cases[0];
    const index = buildIndex(buildModel(product.graph, product.profile));
    expect(summaryOf(index, index.byId.get('story-pay-by-card')!).chips.map((x) => x.text)).toContain('HIGH');
  });
  it('show a value that is not a code as it is', () => {
    for (const c of cases) {
      const graph = clone(c.graph);
      (graph as any)[c.profile.source.nodes].find((n: any) => n[c.profile.source.id] === c.life.node)[c.life.field] = 'nothing';
      const index = buildIndex(buildModel(graph, c.profile));
      expect(summaryOf(index, index.byId.get(c.life.node)!).chips.map((x) => x.text), c.name).toContain('nothing');
    }
  });
});
