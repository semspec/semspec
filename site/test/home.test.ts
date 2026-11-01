// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildIndex, buildModel, type ProfileInput } from '../../packages/core/src/index';
import { loadInputs } from '../../packages/cli/src/inputs';
import { buildCards } from '../src/lib/cards';
import { FEATURE_ICONS } from '../src/lib/feature-icons';

// 2 sets of names show that the module reads the names from its options.
interface Names {
  feature: string;
  condition: string;
  planned: string;
  good: string;
  bad: string;
  tagline: string;
}

const SHOP: Names = { feature: 'feature', condition: 'condition', planned: 'draft', good: 'verified', bad: 'open', tagline: 'tagline' };
const HARBOUR: Names = { feature: 'epic', condition: 'criterion', planned: 'proposed', good: 'pass', bad: 'fail', tagline: 'blurb' };

function profileOf(n: Names): ProfileInput {
  const color = { light: '#111111', dark: '#eeeeee' };
  return {
    project: 'Test',
    source: { nodes: 'nodes', id: 'id', kind: 'kind' },
    fields: { title: ['title'], statement: ['statement'] },
    lifecycle: { field: 'state', fallback: 'active', states: { [n.planned]: {}, retired: { muted: true } } },
    kinds: [
      { id: n.feature, label: n.feature, plural: `${n.feature}s`, role: 'hierarchy', color },
      { id: 'requirement', label: 'Requirement', plural: 'requirements', role: 'hierarchy', color, parents: [[`${n.feature}s`]] },
      { id: n.condition, label: n.condition, plural: 'conditions', role: 'part', color },
    ],
    edges: { [`${n.feature}s`]: { labels: ['In', 'Contains'], down: true }, [n.condition]: { labels: ['Of', 'Has'], down: true } },
    parts: [{ kind: n.condition, owner: 'requirement', field: 'acceptance', id: 'id', text: 'text', edge: n.condition }],
    status: {
      label: 'Status',
      field: 'status',
      values: [
        { value: n.good, label: 'Good', tone: 'good' },
        { value: n.bad, label: 'Bad', tone: 'bad' },
      ],
    },
  } as unknown as ProfileInput;
}

function graphOf(n: Names) {
  const feature = (id: string, extra: Record<string, unknown>) => ({ id, kind: n.feature, title: id.toUpperCase(), statement: `Statement of ${id}.`, ...extra });
  return {
    nodes: [
      feature('f-zeta', { [n.tagline]: 'Tagline of zeta.' }),
      feature('f-plan', { state: n.planned, [n.tagline]: 'Planned.' }),
      feature('f-alpha', {}),
      feature('f-blank', { [n.tagline]: '   ' }),
      feature('f-old', { state: 'retired', [n.tagline]: 'Retired.' }),
      { id: 'r-1', kind: 'requirement', title: 'R1', statement: 'R1.', [`${n.feature}s`]: ['f-zeta'], acceptance: [{ id: 'a', text: 'A', status: n.good }] },
    ],
  };
}

describe.each([['shop', SHOP], ['harbour', HARBOUR]] as const)('feature cards of the %s profile', (_name, n) => {
  const index = buildIndex(buildModel(graphOf(n), profileOf(n)));
  const cards = buildCards(index, { featureKind: n.feature, conditionKind: n.condition, plannedState: n.planned, taglineField: n.tagline });

  it('lists the shipped features in the order of the nodes, with no planned and no retired feature', () => {
    expect(cards.map((c) => c.id)).toEqual(['f-zeta', 'f-alpha', 'f-blank']);
  });

  it('uses the tagline of a feature and else its statement', () => {
    expect(cards.map((c) => c.text)).toEqual(['Tagline of zeta.', 'Statement of f-alpha.', 'Statement of f-blank.']);
  });
});

describe('feature cards of the requirements of this repository', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const { graph, profile } = loadInputs(`${root}requirements/graph`, `${root}requirements/profile.yaml`);
  const index = buildIndex(buildModel(graph, profile));
  const cards = buildCards(index);
  const dir = `${root}requirements/graph/feature/`;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => parse(readFileSync(dir + f, 'utf8')) as { id: string; state?: string; tagline?: string });
  const shipped = files.filter((f) => f.state !== 'draft' && f.state !== 'retired');

  it('shows 1 card for each shipped feature of the graph, in the order of the feature files', () => {
    expect(shipped.length).toBeGreaterThan(0);
    expect(cards.map((c) => c.id)).toEqual(shipped.map((f) => f.id));
  });

  it('gives each shipped feature of the graph a tagline of 1 or 2 sentences', () => {
    for (const f of shipped) {
      expect(f.tagline, f.id).toBeTruthy();
      expect(f.tagline!.split(/(?<=\.)\s+/).length, f.id).toBeLessThanOrEqual(2);
      expect(f.tagline, f.id).not.toContain('—');
    }
    expect(cards.map((c) => c.text)).toEqual(shipped.map((f) => f.tagline));
  });

  it('declares the tagline field in the profile', () => {
    const sections = (parse(readFileSync(`${root}requirements/profile.yaml`, 'utf8')) as { details: { textSections: { field: string; kinds?: string[] }[] } }).details.textSections;
    expect(sections.some((s) => s.field === 'tagline' && s.kinds?.includes('feature'))).toBe(true);
  });

  it('has an icon for each shipped feature and none for another id', () => {
    const missing = cards.filter((c) => !FEATURE_ICONS[c.id]).map((c) => c.id);
    expect(missing).toEqual([]);
    const ids = new Set(cards.map((c) => c.id));
    expect(Object.keys(FEATURE_ICONS).filter((id) => !ids.has(id))).toEqual([]);
  });
});
