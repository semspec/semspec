// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildIndex, buildModel, type ProfileInput } from '../../src/core/index';
import { loadInputs } from '../../src/cli/inputs';
import { buildHeroGraph, type HeroGraphData, type HeroNode } from '../src/lib/hero-graph';

// The names of a small profile. 2 sets of names show that the module reads the kinds by their role, not by their names.
interface Names {
  product: string;
  products: string;
  feature: string;
  features: string;
  capability: string;
  capabilities: string;
  requirement: string;
  requirements: string;
  condition: string;
  conditionField: string;
  check: string;
  // The linked kind and the edge that its nodes use.
  decision: string;
  link: string;
  // The lifecycle field and the muted state.
  stateField: string;
  retired: string;
}

const SHOP: Names = {
  product: 'product', products: 'products', feature: 'feature', features: 'features', capability: 'capability', capabilities: 'capabilities',
  requirement: 'requirement', requirements: 'requirements', condition: 'condition', conditionField: 'acceptance', check: 'test',
  decision: 'decision', link: 'governs', stateField: 'state', retired: 'retired',
};
const HARBOUR: Names = {
  product: 'programme', products: 'programmes', feature: 'epic', features: 'epics', capability: 'theme', capabilities: 'themes',
  requirement: 'story', requirements: 'stories', condition: 'criterion', conditionField: 'criteria', check: 'proof',
  decision: 'ruling', link: 'informs', stateField: 'stage', retired: 'closed',
};

const kind = (id: string, plural: string, role: string, color: string, parents?: string[][]) => ({
  id, label: id, plural, role, color: { light: `#${color}`, dark: `#${color}` }, ...(parents ? { parents } : {}),
});

function profileOf(n: Names): ProfileInput {
  return {
    project: 'Test',
    source: { nodes: 'nodes', id: 'id', kind: 'kind' },
    fields: { title: ['title'], statement: ['statement'] },
    lifecycle: { field: n.stateField, fallback: 'active', states: { [n.retired]: { muted: true } } },
    kinds: [
      kind(n.product, n.products, 'hierarchy', '111111'),
      kind(n.feature, n.features, 'hierarchy', '222222', [[n.products]]),
      kind(n.capability, n.capabilities, 'hierarchy', '333333', [[n.features]]),
      // A requirement sits below a capability, or else below another requirement.
      kind(n.requirement, n.requirements, 'hierarchy', '444444', [[n.capabilities], [n.requirements]]),
      kind(n.condition, 'conditions', 'part', '555555'),
      kind(n.check, 'checks', 'check', '666666'),
      kind(n.decision, 'decisions', 'linked', '777777'),
    ],
    edges: {
      [n.products]: { labels: ['In product', 'Contains'], down: true },
      [n.features]: { labels: ['In feature', 'Contains'], down: true },
      [n.capabilities]: { labels: ['In capability', 'Contains'], down: true },
      [n.requirements]: { labels: ['In requirement', 'Contains'], down: true },
      [n.condition]: { labels: ['Condition of', 'Has condition'], down: true },
      [n.link]: { labels: ['Links to', 'Linked from'] },
      tested: { labels: ['Tested by', 'Proves'] },
    },
    links: [n.link],
    parts: [{ kind: n.condition, owner: n.requirement, field: n.conditionField, id: 'id', text: 'text', edge: n.condition }],
    checks: { kind: n.check, field: 'tests', edge: 'tested', typeField: 'type', types: { unit: { key: ['file', 'name'], title: ['name'] } } },
  } as unknown as ProfileInput;
}

// 1 product, 2 features, 4 capabilities and 5 live requirements. Each requirement is a leaf of the tree, so the
// tree has 5 leaves. `r-5` names 2 capabilities and sits below the first. The 3 nodes with the retired state, `c-old`,
// `r-old` and `d-old`, are muted. The decision `d-3` links to nothing.
function graphOf(n: Names) {
  const tests = [{ type: 'unit', file: 'a/b.test.ts', name: 'checks it' }];
  const requirement = (id: string, capability: string[], extra: Record<string, unknown> = {}) => ({
    id, kind: n.requirement, title: id, [n.capabilities]: capability,
    [n.conditionField]: [{ id: 'one', text: 'First.', tests }, { id: 'two', text: 'Second.' }], ...extra,
  });
  return {
    nodes: [
      { id: 'p-1', kind: n.product, title: 'The product' },
      { id: 'f-1', kind: n.feature, title: 'f-1', [n.products]: ['p-1'] },
      { id: 'f-2', kind: n.feature, title: 'f-2', [n.products]: ['p-1'] },
      { id: 'c-1', kind: n.capability, title: 'c-1', [n.features]: ['f-1'] },
      { id: 'c-2', kind: n.capability, title: 'c-2', [n.features]: ['f-1'] },
      { id: 'c-3', kind: n.capability, title: 'c-3', [n.features]: ['f-2'] },
      { id: 'c-4', kind: n.capability, title: 'c-4', [n.features]: ['f-2'] },
      { id: 'c-old', kind: n.capability, title: 'c-old', [n.features]: ['f-2'], [n.stateField]: n.retired },
      requirement('r-1', ['c-1']),
      requirement('r-2', ['c-1']),
      requirement('r-3', ['c-2']),
      requirement('r-4', ['c-3']),
      requirement('r-5', ['c-4', 'c-3']),
      requirement('r-old', ['c-1'], { [n.stateField]: n.retired }),
      { id: 'd-1', kind: n.decision, title: 'd-1', [n.link]: ['r-1', 'r-5'] },
      { id: 'd-2', kind: n.decision, title: 'd-2', [n.link]: ['r-3'] },
      { id: 'd-4', kind: n.decision, title: 'd-4', [n.link]: ['r-3'] },
      { id: 'd-3', kind: n.decision, title: 'd-3' },
      { id: 'd-old', kind: n.decision, title: 'd-old', [n.link]: ['r-2'], [n.stateField]: n.retired },
    ],
  };
}

// The same graph with 2 more roots: a requirement with no parent, and 2 requirements that are the parent of each other.
function graphWithRootsOf(n: Names) {
  const base = graphOf(n);
  return {
    nodes: [
      ...base.nodes,
      { id: 'r-orphan', kind: n.requirement, title: 'r-orphan' },
      { id: 'r-cycle-a', kind: n.requirement, title: 'r-cycle-a', [n.requirements]: ['r-cycle-b'] },
      { id: 'r-cycle-b', kind: n.requirement, title: 'r-cycle-b', [n.requirements]: ['r-cycle-a'] },
    ],
  };
}

const HALF = 500;
const distance = (n: HeroNode) => Math.hypot(n.x - HALF, n.y - HALF);
const angleOf = (n: HeroNode) => Math.atan2(n.y - HALF, n.x - HALF);
// The difference of 2 angles, from -PI to PI.
const turn = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const ids = (data: HeroGraphData) => data.nodes.map((n) => n.id);

describe.each([['shop', SHOP], ['harbour', HARBOUR]] as const)('hero graph of the %s profile', (_name, names) => {
  const make = (graph: { nodes: unknown[] }) => buildHeroGraph(buildIndex(buildModel(graph, profileOf(names))));
  const index = buildIndex(buildModel(graphOf(names), profileOf(names)));
  const data = buildHeroGraph(index);
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const node = (id: string) => byId.get(id)!;

  const hierarchyKinds = [names.product, names.feature, names.capability, names.requirement];
  const live = index.model.nodes.filter((n) => hierarchyKinds.includes(n.kind) && n.lifecycle !== names.retired).map((n) => n.id);
  const hierarchy = data.nodes.filter((n) => hierarchyKinds.includes(n.kind));
  const linked = data.nodes.filter((n) => n.kind === names.decision);

  it('gives the same result for the same input, and for the nodes in another order', () => {
    expect(make(graphOf(names))).toEqual(data);
    expect(JSON.stringify(make(graphOf(names)))).toBe(JSON.stringify(data));
    expect(make({ nodes: [...graphOf(names).nodes].reverse() })).toEqual(data);
  });

  it('has every live node of the hierarchy once', () => {
    expect(ids(data).filter((id) => live.includes(id)).sort()).toEqual([...live].sort());
    expect(new Set(ids(data)).size).toBe(data.nodes.length);
    expect(hierarchy).toHaveLength(live.length);
  });

  it('has no part, no check and no muted node', () => {
    const kinds = new Set(data.nodes.map((n) => n.kind));
    expect(kinds.has(names.condition)).toBe(false);
    expect(kinds.has(names.check)).toBe(false);
    for (const id of ['c-old', 'r-old', 'd-old']) expect(byId.has(id)).toBe(false);
    expect(data.edges.some((e) => e.from.includes('#') || e.to.includes('#'))).toBe(false);
  });

  it('has the linked nodes that link to a drawn node, and no other', () => {
    expect(linked.map((n) => n.id).sort()).toEqual(['d-1', 'd-2', 'd-4']);
  });

  it('keeps every dot inside the box', () => {
    for (const n of data.nodes) {
      expect(n.x - n.r).toBeGreaterThanOrEqual(0);
      expect(n.x + n.r).toBeLessThanOrEqual(data.size);
      expect(n.y - n.r).toBeGreaterThanOrEqual(0);
      expect(n.y + n.r).toBeLessThanOrEqual(data.size);
    }
  });

  it('rounds the coordinates to 1 decimal place', () => {
    for (const n of data.nodes) {
      expect(Math.round(n.x * 10) / 10).toBe(n.x);
      expect(Math.round(n.y * 10) / 10).toBe(n.y);
    }
  });

  it('puts the product at the centre and 1 ring for each level, with smaller dots further out', () => {
    expect(distance(node('p-1'))).toBe(0);
    const ring = (id: string) => distance(node(id));
    expect(ring('f-1')).toBeCloseTo(ring('f-2'), 0);
    expect(ring('c-1')).toBeCloseTo(ring('c-4'), 0);
    expect(ring('r-1')).toBeCloseTo(ring('r-5'), 0);
    expect(ring('f-1')).toBeLessThan(ring('c-1'));
    expect(ring('c-1')).toBeLessThan(ring('r-1'));
    expect(node('p-1').r).toBeGreaterThan(node('f-1').r);
    expect(node('f-1').r).toBeGreaterThan(node('c-1').r);
    expect(node('c-1').r).toBeGreaterThan(node('r-1').r);
  });

  it('sets the angle of a node from the number of leaves below it', () => {
    // c-1 has 2 leaves, c-2 has 1, and the tree has 5. The wedges are 2/5 and 1/5 of the circle, so their middles are 3/10 of a turn apart.
    expect(turn(angleOf(node('c-2')), angleOf(node('c-1')))).toBeCloseTo(0.6 * Math.PI, 2);
    // The 5 leaves are evenly spread.
    expect(turn(angleOf(node('r-2')), angleOf(node('r-1')))).toBeCloseTo(0.4 * Math.PI, 2);
    expect(turn(angleOf(node('r-4')), angleOf(node('r-3')))).toBeCloseTo(0.4 * Math.PI, 2);
  });

  it('puts a node with 2 parents below the first one, with 1 tree edge', () => {
    expect(data.edges.filter((e) => !e.linked && e.to === 'r-5')).toEqual([{ from: 'c-4', to: 'r-5', linked: false }]);
    expect(data.edges.filter((e) => !e.linked)).toHaveLength(hierarchy.length - 1);
  });

  it('puts a linked node outside the ring of the requirements', () => {
    expect(Math.min(...linked.map(distance))).toBeGreaterThan(Math.max(...hierarchy.map(distance)));
    for (const n of linked) expect(n.r).toBeLessThan(node('c-1').r);
  });

  it('puts a linked node at the mean angle of the nodes it links to', () => {
    expect(turn(angleOf(node('d-2')), angleOf(node('r-3')))).toBeCloseTo(0, 2);
    // r-1 is the first leaf and r-5 is the last. The mean is at the seam of the circle, which is the top. The plain mean would be at the bottom.
    expect(turn(angleOf(node('d-1')), -Math.PI / 2)).toBeCloseTo(0, 2);
  });

  it('keeps 2 linked nodes with the same targets apart', () => {
    const [a, b] = [node('d-2'), node('d-4')];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r);
  });

  it('has the link edges of the drawn linked nodes only, after the tree edges', () => {
    const links = data.edges.filter((e) => e.linked);
    expect(links.map((e) => `${e.from}>${e.to}`).sort()).toEqual(['d-1>r-1', 'd-1>r-5', 'd-2>r-3', 'd-4>r-3']);
    expect(data.edges.slice(0, hierarchy.length - 1).every((e) => !e.linked)).toBe(true);
  });

  it('draws every node of a graph with several roots once, and leaves the centre empty', () => {
    const several = make(graphWithRootsOf(names));
    const rooted = buildIndex(buildModel(graphWithRootsOf(names), profileOf(names)));
    const expected = rooted.model.nodes.filter((n) => hierarchyKinds.includes(n.kind) && n.lifecycle !== names.retired).map((n) => n.id);
    expect(ids(several).filter((id) => expected.includes(id)).sort()).toEqual([...expected].sort());
    expect(new Set(ids(several)).size).toBe(several.nodes.length);
    expect(several.nodes.every((n) => Math.hypot(n.x - HALF, n.y - HALF) > 0)).toBe(true);
    expect(several.nodes.every((n) => n.x >= n.r && n.x <= several.size - n.r && n.y >= n.r && n.y <= several.size - n.r)).toBe(true);
    // The nodes of the cycle hang below the first of them.
    expect(several.edges.filter((e) => e.to === 'r-cycle-b')).toEqual([{ from: 'r-cycle-a', to: 'r-cycle-b', linked: false }]);
  });

  it('draws nothing for a graph with no node', () => {
    expect(make({ nodes: [] })).toEqual({ size: data.size, nodes: [], edges: [] });
  });
});

describe('hero graph of the requirements of this repository', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const { graph, profile } = loadInputs(`${root}requirements/graph`, `${root}requirements/profile.yaml`);
  const index = buildIndex(buildModel(graph, profile));
  const data = buildHeroGraph(index);
  const kindsOf = (...kinds: string[]) => data.nodes.filter((n) => kinds.includes(n.kind));
  const liveOf = (...kinds: string[]) => index.model.nodes.filter((n) => kinds.includes(n.kind) && n.lifecycle !== 'retired');

  it('has every live product, feature, capability and requirement once, and the decisions', () => {
    for (const k of ['product', 'feature', 'capability', 'requirement', 'decision']) {
      expect(kindsOf(k).map((n) => n.id).sort(), k).toEqual(liveOf(k).map((n) => n.id).sort());
    }
    expect(kindsOf('product')).toHaveLength(1);
    expect(new Set(ids(data)).size).toBe(data.nodes.length);
  });

  it('has no condition and no test', () => {
    expect(kindsOf('condition', 'test')).toHaveLength(0);
  });

  it('puts the product at the centre and the decisions outside the requirements, inside the box', () => {
    expect(distance(kindsOf('product')[0])).toBe(0);
    expect(Math.min(...kindsOf('decision').map(distance))).toBeGreaterThan(Math.max(...kindsOf('requirement').map(distance)));
    for (const n of data.nodes) expect(n.x >= n.r && n.x <= data.size - n.r && n.y >= n.r && n.y <= data.size - n.r).toBe(true);
  });

  it('links each decision to the nodes it governs', () => {
    const governed = index.model.edges.filter((e) => e.k === 'governs' && ids(data).includes(e.s) && ids(data).includes(e.t));
    expect(data.edges.filter((e) => e.linked).map((e) => `${e.from}>${e.to}`).sort()).toEqual(governed.map((e) => `${e.s}>${e.t}`).sort());
  });
});
