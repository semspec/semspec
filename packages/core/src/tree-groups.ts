// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The groups of the hierarchy tree that need no framework.
import type { Profile } from './types.js';
import { kindsWithRole } from './profile.js';

export const HIERARCHY_GROUP = 'g:hier';

// The root kinds of the hierarchy group that have a node, in the order of the profile.
export function hierarchyRootKinds(profile: Profile, kindsInUse: Iterable<string>): string[] {
  const used = new Set(kindsInUse);
  const hierarchy = new Set(kindsWithRole(profile, 'hierarchy'));
  return profile.kinds.filter((k) => hierarchy.has(k.id) && !k.parents?.length && used.has(k.id)).map((k) => k.id);
}

// The key of the tree group that holds a root of this kind. With 1 root kind, the hierarchy group
// holds the roots in 1 list. With more, each kind has its own sub-group.
export function hierarchyGroupKey(rootKinds: string[], kind: string): string {
  return rootKinds.length > 1 ? `${HIERARCHY_GROUP}:${kind}` : HIERARCHY_GROUP;
}

// The sub-groups of the hierarchy group. The list is empty when the group needs no sub-groups.
export function hierarchySections(profile: Profile, nodes: { id: string; kind: string }[]): { key: string; kind: string; ids: string[] }[] {
  const kinds = hierarchyRootKinds(profile, nodes.map((n) => n.kind));
  if (kinds.length < 2) return [];
  return kinds.map((kind) => ({ key: hierarchyGroupKey(kinds, kind), kind, ids: nodes.filter((n) => n.kind === kind).map((n) => n.id) }));
}
