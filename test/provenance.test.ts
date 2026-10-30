// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of provenance: the checks, the edges to source nodes, the filter by marker and the count of
// nodes with no source. Every test runs on 2 profiles. The product profile has source nodes. The
// glossary profile has free-text sources. Where a test needs source nodes, a copy of the glossary
// profile names the kind of the groups as the source kind.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyFilters,
  buildIndex,
  buildModel,
  facetCounts,
  isFutureDate,
  kindSchemas,
  markerOf,
  missingSource,
  provenanceFields,
  provenanceOf,
  provenanceProblems,
  type Filters,
  type Graph,
  type Profile,
} from '@core/index';
import { loadProfile } from '../src/cli/index';
import { validateGraph, validateProfile } from '../src/cli/validate';

const fixture = (name: string, file: string) => new URL(`../fixtures/${name}/${file}`, import.meta.url).pathname;
const TODAY = '2026-10-30';

interface Case {
  name: string;
  graph: Graph;
  profile: Profile;
  // A node that has all parts, and the values it holds.
  full: { id: string; marker: string; label: string; retrieved: string; agent: string };
  // The marker field, the code that needs a source, and 2 codes that do not.
  needs: string;
  free: string[];
  // A node of the source kind in a copy of the case, and a node of another kind.
  sourceNode: string;
  otherNode: string;
  // An edge item in the graph: the node, the field and the index of the item. The item has a marker and no source.
  edge: { node: string; field: string; index: number; target: string; marker: string };
  // The marker counts over the whole graph, and a scope with its count of nodes with no source.
  counts: Record<string, number>;
  scope: { ids: string[]; missing: number; total: number };
}

const clone = <T>(v: T): T => structuredClone(v);
const load = (name: string) => ({
  graph: JSON.parse(readFileSync(fixture(name, 'graph.json'), 'utf8')) as Graph,
  profile: loadProfile(fixture(name, 'profile.json')),
});
const cases: Case[] = [
  {
    name: 'product',
    ...load('product'),
    full: { id: 'story-pay-by-card', marker: 'verified', label: 'Read in a source', retrieved: '2026-02-10', agent: 'Ana' },
    needs: 'verified',
    free: ['inferred', 'reported'],
    sourceNode: 'src-support-log',
    otherNode: 'story-loose',
    edge: { node: 'story-save-card', field: 'follows', index: 0, target: 'story-pay-by-card', marker: 'inferred' },
    counts: { verified: 1, inferred: 1, reported: 1 },
    scope: { ids: ['story-pay-by-card', 'story-save-card', 'story-search-synonyms', 'src-market-study'], missing: 2, total: 3 },
  },
  {
    name: 'glossary',
    ...load('glossary'),
    full: { id: 'scale', marker: 'quoted', label: 'Quoted from a text', retrieved: '2025-11-02', agent: 'Mia' },
    needs: 'quoted',
    free: ['derived', 'told'],
    sourceNode: 'grp-harmony',
    otherNode: 'beat',
    edge: { node: 'tempo', field: 'relations', index: 0, target: 'beat', marker: 'told' },
    counts: { quoted: 1, derived: 1, told: 1 },
    scope: { ids: ['scale', 'chord', 'tempo', 'beat'], missing: 2, total: 4 },
  },
];

const nodesOf = (c: { graph: Graph; profile: Profile }) => (c.graph as any)[c.profile.source.nodes] as Record<string, any>[];
const node = (c: { graph: Graph; profile: Profile }, id: string) => nodesOf(c).find((n) => n[c.profile.source.id] === id)!;
const spec = (c: Case) => c.profile.provenance!;
const copy = (c: Case): Case => ({ ...c, graph: clone(c.graph), profile: clone(c.profile) });
// A copy where the source is a node. The glossary has free-text sources, so the copy names the kind of the groups.
const withSourceKind = (c: Case): Case => {
  const x = copy(c);
  if (!spec(x).source!.kind) spec(x).source!.kind = 'group';
  // Free-text sources of the glossary are not nodes. Each one now names the source node.
  nodesOf(x).forEach((n) => n[sourceField(x)] !== undefined && (n[sourceField(x)] = c.sourceNode));
  return x;
};
const edgeItem = (c: Case) => node(c, c.edge.node)[c.edge.field][c.edge.index] as Record<string, unknown>;
const errorsOf = (c: Case) => validateGraph(c.graph, c.profile, undefined, TODAY).errors;
const warningsOf = (c: Case) => validateGraph(c.graph, c.profile, undefined, TODAY).warnings;
const field = (c: Case, part: 'retrieved' | 'agent' | 'note') => spec(c)[part]!;
const markerField = (c: Case) => spec(c).marker!.field;
const sourceField = (c: Case) => spec(c).source!.field;
const noFilters: Filters = { q: '', kinds: [], lifecycles: [], deliveries: [], modules: [], statuses: [], markers: [], fields: {} };

describe('reading the parts', () => {
  it('reads the marker, the source, the date and the agent of a node under the fields of the profile', () => {
    for (const c of cases) {
      const p = provenanceOf(spec(c), node(c, c.full.id));
      expect(p.marker, c.name).toBe(c.full.marker);
      expect(p.retrieved, c.name).toBe(c.full.retrieved);
      expect(p.agent, c.name).toBe(c.full.agent);
      expect(p.source, c.name).toBeDefined();
      expect(markerOf(spec(c), node(c, c.full.id)), c.name).toBe(c.full.marker);
    }
  });
  it('reads the same fields from the properties of an edge', () => {
    for (const c of cases) {
      const model = buildModel(c.graph, c.profile);
      const e = model.edges.find((x) => x.s === c.edge.node && x.t === c.edge.target && x.k === c.edge.field)!;
      expect(markerOf(spec(c), e.p), c.name).toBe(c.edge.marker);
    }
  });
  it('gives nothing for a part that the profile or the record lacks', () => {
    for (const c of cases) {
      expect(provenanceOf(undefined, node(c, c.full.id)), c.name).toEqual({});
      expect(provenanceOf(spec(c), undefined), c.name).toEqual({});
      expect(markerOf(spec(c), { [markerField(c)]: 4 }), c.name).toBe('');
      expect(provenanceFields(spec(c)).length, c.name).toBeGreaterThan(3);
    }
  });
});

describe('the fixtures', () => {
  it('have no error and no warning about the provenance fields', () => {
    for (const c of cases) {
      expect(errorsOf(c), c.name).toEqual([]);
      expect(warningsOf(c).filter((w) => provenanceFields(spec(c)).some((f) => w.includes(`"${f}"`))), c.name).toEqual([]);
    }
  });
  it('pass the schema of the profile', () => {
    for (const c of cases) expect(validateProfile(c.profile), c.name).toEqual([]);
  });
});

describe('the date of retrieval', () => {
  it('takes YYYY, YYYY-MM and YYYY-MM-DD in the past and today', () => {
    for (const c of cases) {
      for (const value of ['2020', '2026-10', '2026-10-30', '2026-01-31']) {
        const x = copy(c);
        node(x, c.full.id)[field(c, 'retrieved')] = value;
        expect(errorsOf(x), `${c.name} ${value}`).toEqual([]);
      }
    }
  });
  it('is an error when it is not an ISO date', () => {
    for (const c of cases) {
      for (const value of ['10/02/2026', '2026-13', '2026-02-30', 'yesterday', 20260210, true]) {
        const x = copy(c);
        node(x, c.full.id)[field(c, 'retrieved')] = value;
        const errors = errorsOf(x);
        expect(errors.length, `${c.name} ${String(value)}`).toBe(1);
        expect(errors[0], c.name).toContain('is not an ISO date');
        expect(errors[0], c.name).toContain(c.full.id);
      }
    }
  });
  it('is an error when it is in the future', () => {
    for (const c of cases) {
      for (const value of ['2027', '2026-11', '2026-10-31', '2030-01-01']) {
        const x = copy(c);
        node(x, c.full.id)[field(c, 'retrieved')] = value;
        const errors = errorsOf(x);
        expect(errors.length, `${c.name} ${value}`).toBe(1);
        expect(errors[0], c.name).toContain('is after today (2026-10-30)');
      }
    }
  });
  it('is checked on an edge too', () => {
    for (const c of cases) {
      const x = copy(c);
      edgeItem(x)[field(c, 'retrieved')] = '2999';
      expect(errorsOf(x).join('\n'), c.name).toContain(`edge "${c.edge.field}" to "${c.edge.target}" has the field "${field(c, 'retrieved')}" with the date 2999`);
      edgeItem(x)[field(c, 'retrieved')] = 'soon';
      expect(errorsOf(x).join('\n'), c.name).toContain('is not an ISO date');
    }
  });
  it('compares by the part of today that the value has', () => {
    expect(isFutureDate('2026', TODAY)).toBe(false);
    expect(isFutureDate('2026-10', TODAY)).toBe(false);
    expect(isFutureDate('2026-11', TODAY)).toBe(true);
    expect(isFutureDate('2026-10-30', TODAY)).toBe(false);
    expect(isFutureDate('2026-10-31', TODAY)).toBe(true);
  });
});

describe('the marker', () => {
  it('is an error when the value is not a code of the vocabulary, on a node and on an edge', () => {
    for (const c of cases) {
      const x = copy(c);
      node(x, c.full.id)[markerField(c)] = 'nothing';
      edgeItem(x)[markerField(c)] = 'nothing';
      const errors = errorsOf(x);
      expect(errors.length, c.name).toBe(2);
      errors.forEach((m) => expect(m, c.name).toContain(`which is not a code of the vocabulary "${spec(c).marker!.vocabulary}"`));
      expect(errors[0], c.name).toContain('Allowed codes');
    }
  });
  it('is an error when the value is not text', () => {
    for (const c of cases) {
      const x = copy(c);
      node(x, c.full.id)[markerField(c)] = 3;
      expect(errorsOf(x)[0], c.name).toContain('which is not text');
    }
  });
});

describe('the source', () => {
  it('is a node of the source kind, so a missing id and a node of another kind are errors', () => {
    for (const c of cases) {
      const x = withSourceKind(c);
      node(x, c.full.id)[sourceField(c)] = 'nothing';
      let errors = errorsOf(x);
      expect(errors.length, c.name).toBe(1);
      expect(errors[0], c.name).toContain(`has the source "nothing", which is not a node of the graph. It must be a node of the kind "${spec(x).source!.kind}".`);
      node(x, c.full.id)[sourceField(c)] = c.otherNode;
      errors = errorsOf(x);
      expect(errors.length, c.name).toBe(1);
      expect(errors[0], c.name).toContain(`which is a node of the kind "${buildModel(x.graph, x.profile).nodes.find((n) => n.id === c.otherNode)!.kind}"`);
      node(x, c.full.id)[sourceField(c)] = c.sourceNode;
      expect(errorsOf(x), c.name).toEqual([]);
    }
  });
  it('is checked on an edge too', () => {
    for (const c of cases) {
      const x = withSourceKind(c);
      edgeItem(x)[sourceField(c)] = 'nothing';
      const errors = errorsOf(x);
      expect(errors.length, c.name).toBe(1);
      expect(errors[0], c.name).toContain(`edge "${c.edge.field}" to "${c.edge.target}" has the source "nothing"`);
      edgeItem(x)[sourceField(c)] = c.sourceNode;
      expect(errorsOf(x), c.name).toEqual([]);
    }
  });
  it('is free text when the profile names no source kind', () => {
    for (const c of cases) {
      const x = copy(c);
      delete spec(x).source!.kind;
      node(x, c.full.id)[sourceField(c)] = 'a text that names no node';
      expect(errorsOf(x), c.name).toEqual([]);
    }
  });
  it('is an error when a source is not text', () => {
    for (const c of cases) {
      const x = copy(c);
      node(x, c.full.id)[sourceField(c)] = ['a', 'b'];
      expect(errorsOf(x)[0], c.name).toContain('which is not text');
    }
  });
});

describe('the rule requireSource', () => {
  it('is an error for a node and for an edge with a marker that needs a source', () => {
    for (const c of cases) {
      const x = copy(c);
      delete node(x, c.full.id)[sourceField(c)];
      edgeItem(x)[markerField(c)] = c.needs;
      delete edgeItem(x)[sourceField(c)];
      const errors = errorsOf(x);
      expect(errors.length, c.name).toBe(2);
      errors.forEach((m) => expect(m, c.name).toContain(`has the marker "${c.needs}", which needs a source`));
      expect(errors[0], c.name).toContain(c.full.id);
      expect(errors[1], c.name).toContain(`edge "${c.edge.field}"`);
    }
  });
  it('is no error for a marker that needs none', () => {
    for (const c of cases) {
      for (const code of c.free) {
        const x = copy(c);
        node(x, c.full.id)[markerField(c)] = code;
        delete node(x, c.full.id)[sourceField(c)];
        edgeItem(x)[markerField(c)] = code;
        expect(errorsOf(x), `${c.name} ${code}`).toEqual([]);
      }
    }
  });
  it('is no error when the node has the source, and no check runs without the rule', () => {
    for (const c of cases) {
      const x = copy(c);
      delete spec(x).requireSource;
      delete node(x, c.full.id)[sourceField(c)];
      expect(errorsOf(x), c.name).toEqual([]);
    }
  });
});

describe('the problems of the profile', () => {
  const problems = (c: Case, edit: (p: Profile) => void) => {
    const x = copy(c);
    edit(x.profile);
    return validateProfile(x.profile);
  };
  it('are the vocabulary of the marker, the codes of requireSource and the source kind', () => {
    for (const c of cases) {
      expect(problems(c, (p) => (p.provenance!.marker!.vocabulary = 'nothing')).join('\n'), c.name).toContain('names the vocabulary "nothing"');
      expect(problems(c, (p) => (p.provenance!.requireSource = ['nothing'])).join('\n'), c.name).toContain('requireSource names the code "nothing"');
      expect(problems(c, (p) => (p.provenance!.source!.kind = 'nothing')).join('\n'), c.name).toContain('source names the unknown kind "nothing"');
      expect(problems(c, (p) => delete p.provenance!.source).join('\n'), c.name).toContain('requireSource needs a source');
      expect(problems(c, (p) => delete p.provenance!.marker).join('\n'), c.name).toContain('requireSource needs a marker');
    }
  });
  it('are an edge name with no source kind, a field used twice and an unknown key', () => {
    for (const c of cases) {
      expect(problems(c, (p) => ((p.provenance!.source!.kind = undefined), (p.provenance!.source!.edge = 'from'))).join('\n'), c.name).toContain('has an edge and no kind');
      expect(problems(c, (p) => (p.provenance!.agent = p.provenance!.retrieved)).join('\n'), c.name).toContain('for 2 parts');
      expect(problems(c, (p) => ((p.provenance as any).extra = 1)).join('\n'), c.name).toContain('provenance');
    }
  });
});

describe('the edge to a source node', () => {
  it('goes from the node to the source node, with the default name and labels', () => {
    const c = cases[0];
    const model = buildModel(c.graph, c.profile);
    const edges = model.edges.filter((e) => e.k === 'derivedFrom');
    expect(edges.map((e) => `${e.s}>${e.t}`)).toEqual(['story-pay-by-card>src-market-study']);
    expect(model.profile.edges.derivedFrom.labels).toEqual(['Derived from', 'Source of']);
    expect(edges[0].p).toBeUndefined();
  });
  it('is missing when the profile names no source kind', () => {
    const c = cases[1];
    expect(buildModel(c.graph, c.profile).edges.some((e) => e.k === 'derivedFrom')).toBe(false);
    expect(buildModel(c.graph, c.profile).profile.edges.derivedFrom).toBeUndefined();
  });
  it('uses the edge name and the labels of the profile', () => {
    for (const c of cases) {
      const x = withSourceKind(c);
      spec(x).source!.edge = 'cites';
      x.profile.edges.cites = { labels: ['Cites', 'Cited by'] };
      node(x, c.full.id)[sourceField(c)] = c.sourceNode;
      const model = buildModel(x.graph, x.profile);
      expect(model.edges.filter((e) => e.k === 'cites').map((e) => `${e.s}>${e.t}`), c.name).toContain(`${c.full.id}>${c.sourceNode}`);
      expect(model.edges.some((e) => e.k === 'derivedFrom'), c.name).toBe(false);
      expect(model.profile.edges.cites.labels, c.name).toEqual(['Cites', 'Cited by']);
    }
  });
  it('is made for each node with a source, and a source that names no node is unresolved', () => {
    for (const c of cases) {
      const x = withSourceKind(c);
      node(x, c.full.id)[sourceField(c)] = c.sourceNode;
      node(x, c.edge.node)[sourceField(c)] = 'nothing';
      const model = buildModel(x.graph, x.profile);
      expect(model.edges.filter((e) => e.k === 'derivedFrom' && e.s === c.full.id), c.name).toHaveLength(1);
      expect(model.unresolved.filter((u) => u.k === 'derivedFrom'), c.name).toEqual([{ s: c.edge.node, t: 'nothing', k: 'derivedFrom' }]);
    }
  });
});

describe('the filter by marker', () => {
  it('counts the nodes for each marker value, and the nodes with no marker under the empty value', () => {
    for (const c of cases) {
      const index = buildIndex(buildModel(c.graph, c.profile));
      const counts = facetCounts(index, index.model.nodes.map((n) => n.id), noFilters, 'markers');
      for (const [code, n] of Object.entries(c.counts)) expect(counts.get(code), `${c.name} ${code}`).toBe(n);
      const marked = Object.values(c.counts).reduce((a, b) => a + b, 0);
      expect(counts.get(''), c.name).toBe(index.model.nodes.length - marked);
    }
  });
  it('keeps the nodes with one of the selected markers, and the nodes with no marker for the empty value', () => {
    for (const c of cases) {
      const index = buildIndex(buildModel(c.graph, c.profile));
      const all = index.model.nodes.map((n) => n.id);
      const codes = Object.keys(c.counts);
      expect(applyFilters(index, all, { ...noFilters, markers: [codes[0]] }), c.name).toEqual([c.full.id]);
      expect(applyFilters(index, all, { ...noFilters, markers: [codes[0], codes[1]] }), c.name).toHaveLength(2);
      expect(applyFilters(index, all, { ...noFilters, markers: [''] }), c.name).toHaveLength(all.length - 3);
      expect(applyFilters(index, all, { ...noFilters, markers: [] }), c.name).toHaveLength(all.length);
    }
  });
  it('works on a filter object with no markers key', () => {
    const c = cases[0];
    const index = buildIndex(buildModel(c.graph, c.profile));
    const { markers: _drop, ...old } = noFilters;
    expect(applyFilters(index, index.model.nodes.map((n) => n.id), old as Filters)).toHaveLength(index.model.nodes.length);
  });
});

describe('the nodes with no source', () => {
  it('counts the nodes of the scope that have no source, and leaves out source nodes, parts and checks', () => {
    for (const c of cases) {
      const index = buildIndex(buildModel(c.graph, c.profile));
      expect(missingSource(index, c.scope.ids), c.name).toEqual({ missing: c.scope.missing, total: c.scope.total });
    }
  });
  it('counts every node of the graph that needs a source', () => {
    for (const c of cases) {
      const index = buildIndex(buildModel(c.graph, c.profile));
      const roles = new Map(c.profile.kinds.map((k) => [k.id, k.role]));
      const need = index.model.nodes.filter((n) => ['hierarchy', 'linked'].includes(roles.get(n.kind)!) && n.kind !== spec(c).source!.kind);
      const have = need.filter((n) => n.d[sourceField(c)]);
      expect(missingSource(index, index.model.nodes.map((n) => n.id)), c.name).toEqual({ missing: need.length - have.length, total: need.length });
    }
  });
  it('is null when the profile has no source field, and counts a node with an empty source as missing', () => {
    for (const c of cases) {
      const none = copy(c);
      delete spec(none).source;
      delete spec(none).requireSource;
      expect(missingSource(buildIndex(buildModel(none.graph, none.profile)), [c.full.id]), c.name).toBeNull();
      const empty = copy(c);
      node(empty, c.full.id)[sourceField(c)] = '';
      expect(missingSource(buildIndex(buildModel(empty.graph, empty.profile)), [c.full.id]), c.name).toEqual({ missing: 1, total: 1 });
    }
  });
});

describe('provenanceProblems', () => {
  it('gives no problem for a profile with no provenance', () => {
    for (const c of cases) {
      const x = copy(c);
      delete x.profile.provenance;
      expect(provenanceProblems(x.profile, { anything: 'x' }, new Map(), TODAY), c.name).toEqual([]);
    }
  });
});

describe('the schema of a kind', () => {
  it('gives the marker the codes of its vocabulary and the date the ISO pattern', () => {
    for (const c of cases) {
      const props = kindSchemas(c.profile)[c.profile.kinds[0].id].properties as Record<string, any>;
      expect(props[markerField(c)].enum, c.name).toEqual(c.profile.vocabularies![spec(c).marker!.vocabulary].concepts.map((x) => x.code));
      expect(props[field(c, 'retrieved')].pattern, c.name).toContain('\\d{4}');
      expect(props[sourceField(c)], c.name).toEqual({ type: 'string' });
    }
  });
});
