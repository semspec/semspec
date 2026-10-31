// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Turns the index of a requirements graph into a radial drawing of its hierarchy for the hero of the home page.
// The root is at the centre and each level of the tree has a ring. A node gets its angle from the number of
// leaves below it, so the subtrees do not overlap. A linked node, for example a decision, sits on the outer ring
// at the mean angle of the nodes it links to. The module has no framework dependency. The Vite config runs it at
// build time, so it imports the core module by a relative path.
import { isMuted, kindsWithRole } from '../../../packages/core/src/index';
import type { Index, VNode } from '../../../packages/core/src/index';

export interface HeroNode {
  id: string;
  kind: string;
  x: number;
  y: number;
  // The radius of the dot. It falls with the depth of the node.
  r: number;
}

export interface HeroEdge {
  from: string;
  to: string;
  // True for a link between a linked node and a hierarchy node. False for a tree edge.
  linked: boolean;
}

export interface HeroGraphData {
  // The side of the square box. Every dot lies inside it.
  size: number;
  nodes: HeroNode[];
  edges: HeroEdge[];
}

const SIZE = 1000;
// The space between the box and the outer ring.
const MARGIN = 24;
// The radius of a dot: START at the centre, less STEP for each ring, and never less than MIN.
const R_START = 9;
const R_STEP = 2;
const R_MIN = 3;
// The smallest angle between 2 linked nodes, in radians.
const MIN_GAP = 0.05;
// The first leaf starts at the top of the circle.
const START_ANGLE = -Math.PI / 2;
const TURN = 2 * Math.PI;

const round1 = (v: number) => Math.round(v * 10) / 10;
const byId = (a: VNode, b: VNode) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// The drawing of the live nodes of the hierarchy kinds, with the live linked nodes that link to a drawn node.
// The sort by id makes the result the same for any order of the nodes in the input.
// A node has 1 place in the tree: below the first of its parents that is drawn. A node with no such parent
// is a root. With 1 root, the root is at the centre. With more roots, the centre is empty and the roots share ring 1.
export function buildHeroGraph(index: Index): HeroGraphData {
  const profile = index.profile;
  const hierarchyKinds = new Set(kindsWithRole(profile, 'hierarchy'));
  const linkedKinds = new Set(kindsWithRole(profile, 'linked'));
  const live = (n: VNode | undefined, kinds: Set<string>): n is VNode => !!n && kinds.has(n.kind) && !isMuted(profile, n.lifecycle);

  const hierarchy = index.model.nodes.filter((n) => live(n, hierarchyKinds)).sort(byId);

  // The tree parent of each node.
  const parentOf = new Map<string, string>();
  for (const n of hierarchy) {
    const parent = n.parents.map((id) => index.byId.get(id)).find((p) => p !== undefined && p.id !== n.id && live(p, hierarchyKinds));
    if (parent) parentOf.set(n.id, parent.id);
  }
  const kidsOf = (id: string) => hierarchy.filter((n) => parentOf.get(n.id) === id);

  // Walk the tree from the roots. A node that no root reaches lies on a cycle of parents. It becomes a root too.
  const roots = hierarchy.filter((n) => !parentOf.has(n.id));
  const order: VNode[] = [];
  const depth = new Map<string, number>();
  const visit = (n: VNode, d: number) => {
    depth.set(n.id, d);
    order.push(n);
    for (const kid of kidsOf(n.id)) if (!depth.has(kid.id)) visit(kid, d + 1);
  };
  roots.forEach((r) => visit(r, 0));
  for (const n of hierarchy) {
    if (depth.has(n.id)) continue;
    parentOf.delete(n.id);
    roots.push(n);
    visit(n, 0);
  }

  // The leaves below each node. A leaf counts 1. The children come after the parent in `order`.
  const leaves = new Map<string, number>();
  for (const n of [...order].reverse()) {
    const kids = kidsOf(n.id);
    leaves.set(n.id, kids.length ? kids.reduce((sum, k) => sum + leaves.get(k.id)!, 0) : 1);
  }

  // Each node takes a wedge of its parent, as wide as its share of the leaves. Its angle is the middle of the wedge.
  const angle = new Map<string, number>();
  const split = (n: VNode, from: number, to: number) => {
    angle.set(n.id, (from + to) / 2);
    let at = from;
    for (const kid of kidsOf(n.id)) {
      const width = ((to - from) * leaves.get(kid.id)!) / leaves.get(n.id)!;
      split(kid, at, at + width);
      at += width;
    }
  };
  const rootLeaves = roots.reduce((sum, r) => sum + leaves.get(r.id)!, 0);
  let at = START_ANGLE;
  for (const root of roots) {
    const width = (TURN * leaves.get(root.id)!) / rootLeaves;
    split(root, at, at + width);
    at += width;
  }

  // The linked nodes: the live ones that have a link to a drawn node, with the drawn nodes at the other end.
  const linkEdges: { from: string; to: string }[] = [];
  const linkedAt = new Map<string, number>();
  const seenLink = new Set<string>();
  for (const n of index.model.nodes.filter((x) => live(x, linkedKinds)).sort(byId)) {
    const neighbours: string[] = [];
    for (const e of [...(index.out.get(n.id) ?? []), ...(index.inc.get(n.id) ?? [])]) {
      const other = e.s === n.id ? e.t : e.s;
      if (!angle.has(other)) continue;
      if (!neighbours.includes(other)) neighbours.push(other);
      const key = `${e.s}\0${e.t}`;
      if (!seenLink.has(key)) {
        seenLink.add(key);
        linkEdges.push({ from: e.s, to: e.t });
      }
    }
    if (!neighbours.length) continue;
    // The mean of angles is the direction of the sum of their unit vectors. The plain mean fails at the seam of the circle.
    const sin = neighbours.reduce((sum, id) => sum + Math.sin(angle.get(id)!), 0);
    const cos = neighbours.reduce((sum, id) => sum + Math.cos(angle.get(id)!), 0);
    const mean = Math.hypot(sin, cos) < 1e-6 ? angle.get(neighbours[0])! : Math.atan2(sin, cos);
    linkedAt.set(n.id, ((mean % TURN) + TURN) % TURN);
  }

  // Pushes a linked node on when it is too close to the one before.
  const linkedOrder = [...linkedAt.keys()].sort((a, b) => linkedAt.get(a)! - linkedAt.get(b)! || (a < b ? -1 : 1));
  for (let i = 1; i < linkedOrder.length; i++) {
    linkedAt.set(linkedOrder[i], Math.max(linkedAt.get(linkedOrder[i])!, linkedAt.get(linkedOrder[i - 1])! + MIN_GAP));
  }

  // The rings. The linked nodes have the outer ring, when there are any.
  const shift = roots.length > 1 ? 1 : 0;
  const lastRing = Math.max(0, ...[...depth.values()].map((d) => d + shift));
  const linkedRing = lastRing + 1;
  const ringCount = linkedAt.size ? linkedRing : lastRing;
  const ringRadius = (ring: number) => (ring * (SIZE / 2 - MARGIN)) / Math.max(1, ringCount);
  const dotRadius = (ring: number) => Math.max(R_MIN, R_START - R_STEP * ring);
  const place = (id: string, kind: string, theta: number, ring: number): HeroNode => ({
    id,
    kind,
    x: round1(SIZE / 2 + ringRadius(ring) * Math.cos(theta)),
    y: round1(SIZE / 2 + ringRadius(ring) * Math.sin(theta)),
    r: dotRadius(ring),
  });

  const nodes: HeroNode[] = order.map((n) => place(n.id, n.kind, angle.get(n.id)!, depth.get(n.id)! + shift));
  for (const id of linkedOrder) nodes.push(place(id, index.byId.get(id)!.kind, linkedAt.get(id)!, linkedRing));

  const edges: HeroEdge[] = [];
  for (const n of order) {
    const parent = parentOf.get(n.id);
    if (parent) edges.push({ from: parent, to: n.id, linked: false });
  }
  // The model lists the edges in the order of the input nodes. The sort makes the order the same for any input order.
  linkEdges.sort((a, b) => (a.from + '\0' + a.to < b.from + '\0' + b.to ? -1 : 1));
  for (const e of linkEdges) edges.push({ ...e, linked: true });

  return { size: SIZE, nodes, edges };
}
