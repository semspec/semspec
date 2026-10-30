// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildIndex, buildModel, type ProfileInput } from '../../src/core/index';
import { loadInputs } from '../../src/cli/inputs';
import { buildTrace } from '../src/lib/trace';

// The names of a small profile. 2 sets of names show that the module reads the names and the edge labels from the profile.
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
  // The fields of a check item.
  typeField: string;
  type: string;
  fileField: string;
  nameField: string;
  // The profile names the file of a check in `detail`. When false, the file comes from the key of the check type.
  detail: boolean;
  // The labels of the edges, read from the more general node.
  contains: string;
  hasCondition: string;
  testedBy: string;
  good: string;
  bad: string;
}

const SHOP: Names = {
  product: 'product', products: 'products', feature: 'feature', features: 'features', capability: 'capability', capabilities: 'capabilities',
  requirement: 'requirement', requirements: 'requirements', condition: 'condition', conditionField: 'acceptance', check: 'test',
  typeField: 'type', type: 'unit', fileField: 'file', nameField: 'name', detail: false,
  contains: 'Contains', hasCondition: 'Has condition', testedBy: 'Tested by', good: 'verified', bad: 'open',
};
const HARBOUR: Names = {
  product: 'programme', products: 'programmes', feature: 'epic', features: 'epics', capability: 'theme', capabilities: 'themes',
  requirement: 'story', requirements: 'stories', condition: 'criterion', conditionField: 'criteria', check: 'proof',
  typeField: 'method', type: 'spec', fileField: 'path', nameField: 'label', detail: true,
  contains: 'Holds', hasCondition: 'Needs', testedBy: 'Proved by', good: 'pass', bad: 'fail',
};

const kind = (id: string, label: string, plural: string, role: string, color: string, parents?: string[][]) => ({
  id, label, plural, role, color: { light: `#${color}`, dark: `#${color}` }, ...(parents ? { parents } : {}),
});

function profileOf(n: Names): ProfileInput {
  return {
    project: 'Test',
    source: { nodes: 'nodes', id: 'id', kind: 'kind' },
    fields: { title: ['title'], statement: ['statement'] },
    lifecycle: { field: 'state', fallback: 'active' },
    kinds: [
      kind(n.product, `Label of ${n.product}`, n.products, 'hierarchy', '111111'),
      kind(n.feature, `Label of ${n.feature}`, n.features, 'hierarchy', '222222', [[n.products]]),
      kind(n.capability, `Label of ${n.capability}`, n.capabilities, 'hierarchy', '333333', [[n.features]]),
      kind(n.requirement, `Label of ${n.requirement}`, n.requirements, 'hierarchy', '444444', [[n.capabilities]]),
      kind(n.condition, `Label of ${n.condition}`, 'conditions', 'part', '555555'),
      kind(n.check, `Label of ${n.check}`, 'checks', 'check', '666666'),
    ],
    edges: {
      [n.products]: { labels: ['In product', n.contains], down: true },
      [n.features]: { labels: ['In feature', n.contains], down: true },
      [n.capabilities]: { labels: ['In capability', n.contains], down: true },
      [n.condition]: { labels: ['Condition of', n.hasCondition], down: true },
      tested: { labels: [n.testedBy, 'Proves'] },
    },
    parts: [{ kind: n.condition, owner: n.requirement, field: n.conditionField, id: 'id', text: 'text', edge: n.condition }],
    checks: {
      kind: n.check,
      field: 'tests',
      edge: 'tested',
      typeField: n.typeField,
      types: { [n.type]: { key: [n.fileField, n.nameField], title: [n.nameField] } },
      ...(n.detail ? { detail: { name: [n.nameField], file: n.fileField } } : {}),
    },
    status: {
      label: 'Status',
      field: 'status',
      values: [
        { value: n.good, label: 'Passed', tone: 'good' },
        { value: 'partial', label: 'Some', tone: 'warn' },
        { value: n.bad, label: 'Failed', tone: 'bad' },
      ],
    },
  } as unknown as ProfileInput;
}

function graphOf(n: Names) {
  const check = (name: string) => [{ [n.typeField]: n.type, [n.fileField]: 'a/b.test.ts', [n.nameField]: name }];
  return {
    nodes: [
      { id: 'p-1', kind: n.product, title: 'The product' },
      { id: 'f-1', kind: n.feature, title: 'The feature', [n.products]: ['p-1'] },
      { id: 'c-1', kind: n.capability, title: 'The capability', [n.features]: ['f-1'] },
      {
        id: 'r-1', kind: n.requirement, title: 'The requirement', [n.capabilities]: ['c-1'],
        [n.conditionField]: [
          { id: 'bare', text: 'This condition has no check.', status: n.bad },
          { id: 'checked', text: 'This condition has a check.', status: n.good, tests: check('rejects a bad value, with a message') },
          { id: 'later', text: 'This condition has a check too.', tests: check('accepts a good value') },
        ],
      },
      { id: 'r-bare', kind: n.requirement, title: 'No checks', [n.capabilities]: ['c-1'], [n.conditionField]: [{ id: 'only', text: 'No check.' }] },
      { id: 'r-orphan', kind: n.requirement, title: 'No parent', [n.conditionField]: [{ id: 'one', text: 'Alone.', tests: check('stands alone') }] },
    ],
  };
}

describe.each([['shop', SHOP], ['harbour', HARBOUR]] as const)('trace of the %s profile', (_name, names) => {
  const index = buildIndex(buildModel(graphOf(names), profileOf(names)));
  const trace = buildTrace(index, 'r-1');

  it('lists the nodes from the top of the tree down to a check', () => {
    expect(trace.map((t) => t.kind)).toEqual([names.product, names.feature, names.capability, names.requirement, names.condition, names.check]);
    expect(trace.map((t) => t.id).slice(0, 4)).toEqual(['p-1', 'f-1', 'c-1', 'r-1']);
  });

  it('takes the kind labels from the profile', () => {
    expect(trace.map((t) => t.kindLabel)).toEqual([names.product, names.feature, names.capability, names.requirement, names.condition, names.check].map((k) => `Label of ${k}`));
  });

  it('reads each edge label from the more general node, whatever the direction of the edge', () => {
    expect(trace.map((t) => t.edge)).toEqual([null, names.contains, names.contains, names.contains, names.hasCondition, names.testedBy]);
  });

  it('takes the first condition that has a check and shows its text and status', () => {
    const condition = trace[4];
    expect(condition.id).toBe('r-1#checked');
    expect(condition.title).toBe('This condition has a check.');
    expect(condition.status).toEqual({ value: names.good, label: 'Passed', tone: 'good' });
  });

  it('shows the name of the check as written, with its punctuation, and its file', () => {
    expect(trace[5]).toMatchObject({ title: 'Rejects a bad value, with a message', file: 'a/b.test.ts' });
  });

  it('sets the status only on the condition and the file only on the check', () => {
    expect(trace.filter((t) => t.status !== undefined).map((t) => t.id)).toEqual(['r-1#checked']);
    expect(trace.filter((t) => t.file !== undefined).map((t) => t.kind)).toEqual([names.check]);
  });

  it('starts at the requirement when the requirement has no parent', () => {
    const orphan = buildTrace(index, 'r-orphan');
    expect(orphan.map((t) => t.kind)).toEqual([names.requirement, names.condition, names.check]);
    expect(orphan[0].edge).toBeNull();
  });

  it('throws when the node is missing or no condition has a check', () => {
    expect(() => buildTrace(index, 'missing')).toThrow('no node missing');
    expect(() => buildTrace(index, 'r-bare')).toThrow('No condition of r-bare has a check');
  });
});

describe('trace of the requirements of this repository', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const { graph, profile } = loadInputs(`${root}requirements/graph`, `${root}requirements/profile.yaml`);
  const trace = buildTrace(buildIndex(buildModel(graph, profile)), 'req-scope-collects');

  it('has 6 nodes: product, feature, capability, requirement, condition and test', () => {
    expect(trace).toHaveLength(6);
    expect(trace.map((t) => t.kind)).toEqual(['product', 'feature', 'capability', 'requirement', 'condition', 'test']);
  });

  it('shows the file of the test and the status of the condition', () => {
    expect(trace[4].status?.tone).toBe('good');
    expect(trace[5].file).toBe('test/core.test.ts');
  });
});
