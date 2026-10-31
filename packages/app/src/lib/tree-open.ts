// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The open groups of the tree. A reveal opens the groups and the parents above a node.
import { Core, type Index, type Model, type VNode } from './core';

// The tree group that holds a node.
export function groupOf(index: Index, id: string): string {
  let n = index.byId.get(id)!;
  const seen = new Set<string>();
  while (n.parents.length && !seen.has(n.id)) {
    seen.add(n.id);
    n = index.byId.get(n.parents[0])!;
  }
  if (Core.LINKED_KINDS.includes(n.kind)) return `g:${n.kind}`;
  if (!Core.kindSpec(n.kind)?.parents?.length) {
    const kinds = Core.hierarchyRootKinds(index.profile, Array.from(index.byId.values(), (x) => x.kind));
    return Core.hierarchyGroupKey(kinds, n.kind);
  }
  if (index.unplaced.has(n.id)) return `g:unplaced:${n.kind}`;
  return `g:un:${n.kind}`;
}

// The open set after a reveal of a node.
export function revealed(index: Index, open: Set<string>, id: string): Set<string> {
  const next = new Set(open);
  next.add(groupOf(index, id));
  let n: VNode | undefined = index.byId.get(id);
  const seen = new Set<string>();
  while (n && n.parents.length && !seen.has(n.id)) {
    seen.add(n.id);
    n = index.byId.get(n.parents[0]);
    if (n) next.add(n.id);
  }
  return next;
}

// The groups that are open when the reader has not changed them.
export function defaultOpen(model: Model): Set<string> {
  return new Set(['g:hier', ...Core.hierarchySections(model.profile, model.nodes).map((s) => s.key)]);
}
