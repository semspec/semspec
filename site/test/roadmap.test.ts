// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildIndex, buildModel, statusOf, type ProfileInput } from '../../packages/core/src/index';
import { loadInputs } from '../../packages/cli/src/inputs';
import { buildRoadmap } from '../src/lib/roadmap';

// The names of a small profile. 2 sets of names show that the module reads the names from its options and from the profile.
interface Names {
  feature: string;
  features: string;
  capability: string;
  capabilities: string;
  requirement: string;
  requirements: string;
  condition: string;
  conditionField: string;
  lifecycleField: string;
  planned: string;
  areaField: string;
  good: string;
  warn: string;
  bad: string;
}

const SHOP: Names = {
  feature: 'feature', features: 'features', capability: 'capability', capabilities: 'capabilities', requirement: 'requirement', requirements: 'requirements',
  condition: 'condition', conditionField: 'acceptance', lifecycleField: 'state', planned: 'draft', areaField: 'area', good: 'verified', warn: 'partial', bad: 'open',
};
const HARBOUR: Names = {
  feature: 'epic', features: 'epics', capability: 'theme', capabilities: 'themes', requirement: 'story', requirements: 'stories',
  condition: 'criterion', conditionField: 'criteria', lifecycleField: 'phase', planned: 'proposed', areaField: 'scope', good: 'pass', warn: 'mixed', bad: 'fail',
};

const kind = (id: string, plural: string, role: string, parents?: string[][]) => ({
  id, label: id, plural, role, color: { light: `#${id.length}${id.length}${id.length}000`, dark: `#fff${id.length}00` }, ...(parents ? { parents } : {}),
});

function profileOf(n: Names): ProfileInput {
  return {
    project: 'Test',
    source: { nodes: 'nodes', id: 'id', kind: 'kind' },
    fields: { title: ['title'], statement: ['statement'] },
    lifecycle: { field: n.lifecycleField, fallback: 'active', states: { [n.planned]: {}, retired: { muted: true } } },
    kinds: [
      kind(n.feature, n.features, 'hierarchy'),
      kind(n.capability, n.capabilities, 'hierarchy', [[n.features]]),
      kind(n.requirement, n.requirements, 'hierarchy', [[n.capabilities]]),
      kind(n.condition, 'conditions', 'part'),
      kind('test', 'tests', 'check'),
    ],
    edges: {
      [n.features]: { labels: ['In feature', 'Contains'], down: true },
      [n.capabilities]: { labels: ['In capability', 'Contains'], down: true },
      [n.condition]: { labels: ['Condition of', 'Has condition'], down: true },
      tested: { labels: ['Tested by', 'Tests'] },
    },
    parts: [{ kind: n.condition, owner: n.requirement, field: n.conditionField, id: 'id', text: 'text', edge: n.condition }],
    checks: { kind: 'test', field: 'tests', edge: 'tested', typeField: 'type', types: { unit: { key: ['file', 'name'], title: ['name'] } } },
    status: {
      label: 'Status',
      field: 'status',
      values: [
        { value: n.good, label: 'Passed', tone: 'good' },
        { value: n.warn, label: 'Some', tone: 'warn' },
        { value: n.bad, label: 'Failed', tone: 'bad' },
      ],
    },
    fieldFilters: [{ field: n.areaField, label: 'Area', values: { core: 'Core library' } }],
  } as unknown as ProfileInput;
}

function graphOf(n: Names) {
  const unit = (name: string) => [{ type: 'unit', file: 'a.test.ts', name }];
  return {
    nodes: [
      { id: 'f-zeta', kind: n.feature, title: 'Zeta', statement: 'Zeta is planned.', [n.lifecycleField]: n.planned },
      { id: 'f-alpha', kind: n.feature, title: 'Alpha', statement: 'Alpha is planned.', [n.lifecycleField]: n.planned },
      { id: 'f-mid', kind: n.feature, title: 'Mid', statement: 'Mid has shipped.' },
      { id: 'f-beta', kind: n.feature, title: 'Beta', statement: 'Beta has shipped.' },
      { id: 'f-old', kind: n.feature, title: 'Old', statement: 'Old is retired.', [n.lifecycleField]: 'retired' },
      { id: 'c-alpha', kind: n.capability, title: 'Alpha capability', [n.features]: ['f-alpha'] },
      { id: 'c-mid', kind: n.capability, title: 'Mid capability', [n.features]: ['f-mid'] },
      { id: 'c-beta', kind: n.capability, title: 'Beta capability', [n.features]: ['f-beta'] },
      {
        id: 'r-one', kind: n.requirement, title: 'One', statement: 'One holds.', [n.capabilities]: ['c-alpha'], [n.areaField]: ['core', 'other'],
        [n.conditionField]: [
          { id: 'first', text: 'The first condition.', status: n.good, tests: unit('first') },
          { id: 'second', text: 'The second condition.', status: n.bad },
        ],
      },
      {
        id: 'r-two', kind: n.requirement, title: 'Two', statement: 'Two holds.', [n.capabilities]: ['c-alpha'],
        // The third condition has no status. It counts in the total and not in the verified count.
        [n.conditionField]: [{ id: 'third', text: 'The third condition.', status: n.warn }, { id: 'fourth', text: 'The fourth condition.' }],
      },
      { id: 'r-mid', kind: n.requirement, title: 'Mid', [n.capabilities]: ['c-mid'], [n.conditionField]: [{ id: 'm1', text: 'M1', status: n.good }, { id: 'm2', text: 'M2', status: n.good }] },
      { id: 'r-beta', kind: n.requirement, title: 'Beta', [n.capabilities]: ['c-beta'], [n.conditionField]: [{ id: 'b1', text: 'B1', status: n.good }, { id: 'b2', text: 'B2', status: n.warn }] },
    ],
  };
}

describe.each([['shop', SHOP], ['harbour', HARBOUR]] as const)('roadmap of the %s profile', (_name, names) => {
  const options = { featureKind: names.feature, requirementKind: names.requirement, conditionKind: names.condition, plannedState: names.planned };
  const index = buildIndex(buildModel(graphOf(names), profileOf(names)));
  const data = buildRoadmap(index, options);

  it('splits the features into planned and shipped, sorted by title, and leaves out a retired feature', () => {
    expect(data.planned.map((f) => f.title)).toEqual(['Alpha', 'Zeta']);
    expect(data.shipped.map((f) => f.title)).toEqual(['Beta', 'Mid']);
  });

  it('lists the requirements of a planned feature through its capabilities, with area labels and conditions', () => {
    const alpha = data.planned[0];
    expect(alpha.requirements.map((r) => r.title)).toEqual(['One', 'Two']);
    // A value with a label shows the label. A value with no label shows as it is.
    expect(alpha.requirements[0].areas).toEqual(['Core library', 'other']);
    expect(alpha.requirements[1].areas).toEqual([]);
    expect(alpha.requirements[0].conditions).toEqual([
      { id: 'r-one#first', text: 'The first condition.', status: { value: names.good, label: 'Passed', tone: 'good' } },
      { id: 'r-one#second', text: 'The second condition.', status: { value: names.bad, label: 'Failed', tone: 'bad' } },
    ]);
    expect(alpha.requirements[1].conditions[1].status).toBeNull();
    expect(data.planned[1].requirements).toEqual([]);
  });

  it('counts the verified conditions and all conditions below a feature', () => {
    expect(data.planned[0]).toMatchObject({ verified: 1, total: 4 });
    expect(data.planned[1]).toMatchObject({ verified: 0, total: 0 });
    expect(data.shipped.map((f) => [f.title, f.verified, f.total])).toEqual([['Beta', 1, 2], ['Mid', 2, 2]]);
  });

  it('takes the verified count from the status roll-up of the core module', () => {
    const rolled = statusOf(index, 'f-alpha');
    expect(rolled.counts[names.good]).toBe(data.planned[0].verified);
    // The roll-up counts only the conditions that have a status.
    expect(rolled.total).toBe(data.planned[0].total - 1);
    expect(statusOf(index, 'f-mid')).toMatchObject({ value: names.good, tone: 'good' });
  });

  it('gives the colours of the kinds', () => {
    expect(Object.keys(data.kinds)).toEqual([names.feature, names.capability, names.requirement, names.condition, 'test']);
    expect(data.kinds[names.feature].light).toMatch(/^#/);
  });
});

describe('roadmap of the requirements of this repository', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const { graph, profile } = loadInputs(`${root}requirements/graph`, `${root}requirements/profile.yaml`);
  const data = buildRoadmap(buildIndex(buildModel(graph, profile)));

  it('lists every feature with state draft as planned', () => {
    const dir = `${root}requirements/graph/feature/`;
    const draft = readdirSync(dir)
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => parse(readFileSync(dir + f, 'utf8')) as { id: string; state?: string })
      .filter((f) => f.state === 'draft')
      .map((f) => f.id)
      .sort();
    expect(data.planned.map((f) => f.id).sort()).toEqual(draft);
    // No feature is in both lists.
    const shipped = new Set(data.shipped.map((f) => f.id));
    expect(data.planned.some((f) => shipped.has(f.id))).toBe(false);
  });
});
