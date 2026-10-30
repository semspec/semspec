// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Layout of the canvas: a layered layout from dagre, and a placement of new nodes next to the
// node they come from, so a walk keeps its orientation.
import * as dagre from '@dagrejs/dagre';
import { Core, type VEdge } from './core';

export type Mode = 'graph' | 'cards';
export interface Pos {
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}

// The size of a node of each mode. The layout and the placement use it to keep nodes apart.
export const SIZE: Record<Mode, Size> = {
  graph: { w: 230, h: 40 },
  cards: { w: 232, h: 120 },
};

// A layered layout from left to right: the hierarchy reads from the left. An edge that the profile
// marks `down` runs from the general node to the specific node. The others follow the edge itself.
export function layered(ids: string[], edges: VEdge[], mode: Mode): Map<string, Pos> {
  const size = SIZE[mode];
  const down = Core.DOWN_EDGES;
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: mode === 'cards' ? 28 : 18, ranksep: mode === 'cards' ? 90 : 110, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  ids.forEach((id) => g.setNode(id, { width: size.w, height: size.h }));
  edges.forEach((e) => {
    if (!g.hasNode(e.s) || !g.hasNode(e.t)) return;
    if (down.has(e.k)) g.setEdge(e.t, e.s);
    else g.setEdge(e.s, e.t);
  });
  dagre.layout(g);
  const out = new Map<string, Pos>();
  ids.forEach((id) => {
    const n = g.node(id);
    out.set(id, { x: n.x - size.w / 2, y: n.y - size.h / 2 });
  });
  return out;
}

function overlaps(a: Pos, b: Pos, size: Size): boolean {
  return Math.abs(a.x - b.x) < size.w + 12 && Math.abs(a.y - b.y) < size.h + 8;
}

// Places new nodes beside their source: to the right of it, or to the left when the source
// points at the new node. A new node never lands on a node that is already placed.
export function placeNear(
  placed: Map<string, Pos>,
  source: string,
  added: { id: string; left: boolean }[],
  mode: Mode,
): Map<string, Pos> {
  const size = SIZE[mode];
  const next = new Map(placed);
  const origin = placed.get(source) ?? { x: 0, y: 0 };
  const gapX = size.w + (mode === 'cards' ? 90 : 110);
  const stepY = size.h + (mode === 'cards' ? 28 : 18);
  const sides = { right: 0, left: 0 };
  added.forEach(({ id, left }) => {
    const side = left ? 'left' : 'right';
    const x = origin.x + (left ? -gapX : gapX);
    let slot = sides[side]++;
    for (let tries = 0; tries < 400; tries++) {
      // Slots alternate below and above the source row: 0, +1, -1, +2, -2 ...
      const offset = slot === 0 ? 0 : Math.ceil(slot / 2) * (slot % 2 ? 1 : -1);
      const candidate = { x, y: origin.y + offset * stepY };
      let free = true;
      next.forEach((p) => {
        if (free && overlaps(p, candidate, size)) free = false;
      });
      if (free) {
        next.set(id, candidate);
        return;
      }
      slot++;
      sides[side] = slot + 1;
    }
    next.set(id, { x, y: origin.y });
  });
  return next;
}
