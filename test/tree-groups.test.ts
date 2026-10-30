// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the sub-groups of the hierarchy tree. Every test runs on 2 profiles with different kinds.
import { describe, expect, it } from 'vitest';
import { hierarchyGroupKey, hierarchyRootKinds, hierarchySections, type Profile } from '@semspec/core';

const kind = (id: string, role: string, parents?: string[][]) => ({ id, label: id, plural: `${id}s`, role, color: { light: '#000', dark: '#fff' }, ...(parents ? { parents } : {}) });
const profileOf = (kinds: ReturnType<typeof kind>[]) => ({ kinds }) as unknown as Profile;

const cases = [
  { name: 'alpha', profile: profileOf([kind('zone', 'hierarchy'), kind('site', 'hierarchy', [['zone']]), kind('rule', 'hierarchy'), kind('team', 'linked'), kind('group', 'hierarchy')]), order: ['zone', 'rule', 'group'] },
  { name: 'beta', profile: profileOf([kind('book', 'hierarchy'), kind('page', 'hierarchy', [['book']]), kind('note', 'hierarchy'), kind('tag', 'linked')]), order: ['book', 'note'] },
];

describe.each(cases)('hierarchy sub-groups on $name', ({ profile, order }) => {
  const nodes = [...order].reverse().flatMap((k) => [`${k}1`, `${k}2`].map((id) => ({ id, kind: k }))).concat([{ id: 'child', kind: profile.kinds.find((k) => k.parents)!.id }, { id: 'ext', kind: profile.kinds.find((k) => k.role === 'linked')!.id }]);

  it('lists the root kinds in the order of the profile', () => {
    expect(hierarchyRootKinds(profile, nodes.map((n) => n.kind))).toEqual(order);
  });

  it('makes 1 section per root kind with its roots', () => {
    const sections = hierarchySections(profile, nodes);
    expect(sections.map((s) => s.kind)).toEqual(order);
    expect(sections.map((s) => s.key)).toEqual(order.map((k) => `g:hier:${k}`));
    sections.forEach((s) => expect(s.ids.sort()).toEqual([`${s.kind}1`, `${s.kind}2`]));
  });

  it('makes no section when the roots have 1 kind', () => {
    const one = nodes.filter((n) => n.kind === order[0]);
    expect(hierarchySections(profile, one)).toEqual([]);
    expect(hierarchyGroupKey(hierarchyRootKinds(profile, one.map((n) => n.kind)), order[0])).toBe('g:hier');
  });

  it('gives the sub-group key to a node of each root kind', () => {
    const kinds = hierarchyRootKinds(profile, nodes.map((n) => n.kind));
    expect(hierarchyGroupKey(kinds, order[1])).toBe(`g:hier:${order[1]}`);
  });
});
