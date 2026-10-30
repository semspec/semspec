// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The grouped layout and the force layout of the canvas. The module has no React import. Each
// function takes the set of `down` edges as an argument, so a test needs no profile.
import * as dagre from '@dagrejs/dagre';
import { forceCenter, forceLink, forceManyBody, forceSimulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { SIZE, type Mode, type Pos, type Size } from './layout';
import type { VEdge } from './core';

export type LayoutName = 'layered' | 'grouped' | 'force';
export const LAYOUTS: LayoutName[] = ['layered', 'grouped', 'force'];

export interface Rect extends Pos, Size {}

// The space of a container around its members. The title bar sits on top.
export const GROUP_PAD = 16;
export const GROUP_TITLE = 32;
export const GROUP_MIN_W = 180;
const MARGIN = 20;
export const FORCE_TICKS = 300;

export interface Containers {
  // The container of each member. A member has 1 container, the first one that is on the canvas.
  parentOf: Map<string, string>;
  // The members of each container, in the order of the ids.
  children: Map<string, string[]>;
  // The nodes that are in no container, in the order of the ids. A container can be among them.
  roots: string[];
}

// A node that is the target of `groupEdge` from a node on the canvas is a container. A member
// with 2 containers goes in the first one. A link that would close a cycle is skipped.
export function findContainers(ids: string[], edges: VEdge[], groupEdge: string | undefined): Containers {
  const parentOf = new Map<string, string>();
  const onCanvas = new Set(ids);
  if (groupEdge) {
    const wanted = new Map<string, string[]>();
    edges.forEach((e) => {
      if (e.k !== groupEdge || e.s === e.t || !onCanvas.has(e.s) || !onCanvas.has(e.t)) return;
      wanted.set(e.s, [...(wanted.get(e.s) ?? []), e.t]);
    });
    ids.forEach((id) => {
      for (const target of wanted.get(id) ?? []) {
        let up: string | undefined = target;
        while (up !== undefined && up !== id) up = parentOf.get(up);
        if (up === id) continue;
        parentOf.set(id, target);
        return;
      }
    });
  }
  const children = new Map<string, string[]>();
  ids.forEach((id) => {
    const p = parentOf.get(id);
    if (p !== undefined) children.set(p, [...(children.get(p) ?? []), id]);
  });
  return { parentOf, children, roots: ids.filter((id) => !parentOf.has(id)) };
}

// The chain of containers of a node, from the outermost to the node itself.
function chainOf(parentOf: Map<string, string>, id: string): string[] {
  const chain = [id];
  for (let up = parentOf.get(id); up !== undefined; up = parentOf.get(up)) chain.unshift(up);
  return chain;
}

// The box of a container: the bounds of its members plus the padding and the title bar.
function boxAround(rects: Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX - GROUP_PAD, y: minY - GROUP_PAD - GROUP_TITLE, w: Math.max(GROUP_MIN_W, maxX - minX + 2 * GROUP_PAD), h: maxY - minY + 2 * GROUP_PAD + GROUP_TITLE };
}

const asRect = (p: Pos, s: Size): Rect => ({ x: p.x, y: p.y, w: s.w, h: s.h });

// The boxes of all containers, from the absolute positions of their members. A container that
// holds a container gets its box after the inner one.
export function containerBoxes(parentOf: Map<string, string>, pos: Map<string, Pos>, mode: Mode): Map<string, Rect> {
  const members = new Map<string, string[]>();
  parentOf.forEach((p, id) => members.set(p, [...(members.get(p) ?? []), id]));
  const boxes = new Map<string, Rect>();
  const box = (id: string): Rect => {
    const known = boxes.get(id);
    if (known) return known;
    const list = members.get(id);
    if (!list) return asRect(pos.get(id) ?? { x: 0, y: 0 }, SIZE[mode]);
    const made = boxAround(list.map(box));
    boxes.set(id, made);
    return made;
  };
  members.forEach((_, id) => box(id));
  return boxes;
}

// The rectangle of each node on the canvas: a container with its box, any other node with the
// size of the mode.
export function rectsOf(ids: string[], parentOf: Map<string, string>, pos: Map<string, Pos>, mode: Mode): Map<string, Rect> {
  const boxes = containerBoxes(parentOf, pos, mode);
  return new Map(ids.map((id) => [id, boxes.get(id) ?? asRect(pos.get(id) ?? { x: 0, y: 0 }, SIZE[mode])]));
}

// Moves a node to a new position. The members of a container move by the same distance.
export function moveWithMembers(pos: Map<string, Pos>, parentOf: Map<string, string>, id: string, to: Pos): void {
  const from = pos.get(id);
  if (!from) {
    pos.set(id, to);
    return;
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  pos.forEach((p, other) => {
    if (other === id || chainOf(parentOf, other).includes(id)) pos.set(other, { x: p.x + dx, y: p.y + dy });
  });
}

interface Level {
  // The position of each item inside the level, with the top left corner of the level at 0,0.
  pos: Map<string, Pos>;
  size: Size;
}

function spacing(mode: Mode) {
  return { nodesep: mode === 'cards' ? 28 : 18, ranksep: mode === 'cards' ? 90 : 110 };
}

// The grouped layout. It lays out 1 level at a time. The members of a container get their layout
// first, which gives the size of the container. Then the container is a node in the level above.
// The result holds the absolute position of every node, a container with the top left of its box.
export function grouped(ids: string[], edges: VEdge[], mode: Mode, groupEdge: string, down: Set<string>): Map<string, Pos> {
  const { parentOf, children, roots } = findContainers(ids, edges, groupEdge);
  const leaf = SIZE[mode];
  const chains = new Map(ids.map((id) => [id, chainOf(parentOf, id)]));
  const sizes = new Map<string, Size>();
  const inner = new Map<string, Level>();

  // The item of `level` that holds the node, or undefined when the node is not in the level.
  const itemOf = (level: string | null, id: string): string | undefined => {
    const chain = chains.get(id)!;
    if (level === null) return chain[0];
    const at = chain.indexOf(level);
    return at < 0 ? undefined : chain[at + 1];
  };

  const lay = (level: string | null, items: string[]): Level => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', ...spacing(mode), marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));
    items.forEach((id) => g.setNode(id, { width: (sizes.get(id) ?? leaf).w, height: (sizes.get(id) ?? leaf).h }));
    edges.forEach((e) => {
      if (e.k === groupEdge || !chains.has(e.s) || !chains.has(e.t)) return;
      const a = itemOf(level, e.s);
      const b = itemOf(level, e.t);
      if (a === undefined || b === undefined || a === b) return;
      if (down.has(e.k)) g.setEdge(b, a);
      else g.setEdge(a, b);
    });
    dagre.layout(g);
    const rects = items.map((id) => {
      const n = g.node(id);
      const s = sizes.get(id) ?? leaf;
      return { id, x: n.x - s.w / 2, y: n.y - s.h / 2, w: s.w, h: s.h };
    });
    const minX = Math.min(...rects.map((r) => r.x));
    const minY = Math.min(...rects.map((r) => r.y));
    const pos = new Map(rects.map((r) => [r.id, { x: r.x - minX, y: r.y - minY }]));
    return { pos, size: { w: Math.max(...rects.map((r) => r.x + r.w)) - minX, h: Math.max(...rects.map((r) => r.y + r.h)) - minY } };
  };

  // Deepest containers first, so every container has a size when its level is laid out.
  const order: string[] = [];
  const visit = (id: string) => {
    (children.get(id) ?? []).forEach(visit);
    if (children.has(id)) order.push(id);
  };
  roots.forEach(visit);
  order.forEach((c) => {
    const level = lay(c, children.get(c)!);
    inner.set(c, level);
    const box = boxAround(Array.from(level.pos).map(([id, p]) => asRect(p, sizes.get(id) ?? leaf)));
    sizes.set(c, { w: box.w, h: box.h });
  });
  const top = lay(null, roots);

  const out = new Map<string, Pos>();
  const place = (id: string, at: Pos) => {
    out.set(id, at);
    const level = inner.get(id);
    if (!level) return;
    level.pos.forEach((p, member) => place(member, { x: at.x + GROUP_PAD + p.x, y: at.y + GROUP_PAD + GROUP_TITLE + p.y }));
  };
  top.pos.forEach((p, id) => place(id, { x: p.x + MARGIN, y: p.y + MARGIN }));
  return out;
}

interface Body extends SimulationNodeDatum {
  id: string;
}

// A force that pushes apart the rectangles that overlap. It moves along the axis with the smaller
// overlap. `gap` is the space that it keeps between 2 nodes.
function rectCollide(bodies: Body[], size: Size, gap: number, strength: number): (alpha?: number) => boolean {
  return () => {
    let moved = false;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        const dx = (b.x as number) - (a.x as number);
        const dy = (b.y as number) - (a.y as number);
        const ox = size.w + gap - Math.abs(dx);
        const oy = size.h + gap - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (ox < oy) {
          const push = (ox / 2) * strength * (dx < 0 ? -1 : 1);
          a.x = (a.x as number) - push;
          b.x = (b.x as number) + push;
        } else {
          const push = (oy / 2) * strength * (dy < 0 ? -1 : 1);
          a.y = (a.y as number) - push;
          b.y = (b.y as number) + push;
        }
      }
    }
    return moved;
  };
}

// An organic layout from d3-force. It runs a fixed number of ticks, with no animation. The start
// positions come from the order of the ids and not from a random number, so the same input gives
// the same result. A last pass removes the overlaps that are left.
export function forceLayout(ids: string[], edges: VEdge[], mode: Mode): Map<string, Pos> {
  const size = SIZE[mode];
  const gap = mode === 'cards' ? 28 : 18;
  const reach = Math.hypot(size.w, size.h);
  // The golden angle puts the nodes on a spiral, so no 2 nodes start at the same point.
  const bodies: Body[] = ids.map((id, i) => {
    const angle = i * 2.399963229728653;
    const radius = reach * 0.6 * Math.sqrt(i + 0.5);
    return { id, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  const known = new Set(ids);
  const links: SimulationLinkDatum<Body>[] = edges
    .filter((e) => e.s !== e.t && known.has(e.s) && known.has(e.t))
    .map((e) => ({ source: e.s, target: e.t }));
  const collide = rectCollide(bodies, size, gap, 0.7);
  const sim = forceSimulation<Body>(bodies)
    .stop()
    .randomSource(() => 0.5)
    .force('link', forceLink<Body, SimulationLinkDatum<Body>>(links).id((b) => b.id).distance(reach * 0.9).strength(0.5))
    .force('charge', forceManyBody<Body>().strength(-reach * 2).distanceMax(reach * 12))
    .force('center', forceCenter(0, 0))
    .force('collide', collide);
  sim.tick(FORCE_TICKS);
  // Pushing apart 1 pair can overlap another pair, so the pass repeats. The cap keeps it finite.
  const settle = rectCollide(bodies, size, gap, 1);
  for (let i = 0; i < 200 && settle(); i++);
  const minX = Math.min(...bodies.map((b) => b.x as number));
  const minY = Math.min(...bodies.map((b) => b.y as number));
  const out = new Map<string, Pos>();
  bodies.forEach((b) => out.set(b.id, { x: (b.x as number) - minX + MARGIN, y: (b.y as number) - minY + MARGIN }));
  return out;
}

export type Side = 'left' | 'right' | 'top' | 'bottom';

// The bounds of a set of rectangles. The rectangles hold absolute positions.
export function boundsOf(rects: Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  return { x: minX, y: minY, w: Math.max(...rects.map((r) => r.x + r.w)) - minX, h: Math.max(...rects.map((r) => r.y + r.h)) - minY };
}

// The sides that face each other. The main direction between the centres decides: horizontal when
// the distance in x is at least the distance in y.
export function facingSides(from: Rect, to: Rect): { source: Side; target: Side } {
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  const dy = to.y + to.h / 2 - (from.y + from.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { source: 'right', target: 'left' } : { source: 'left', target: 'right' };
  return dy >= 0 ? { source: 'bottom', target: 'top' } : { source: 'top', target: 'bottom' };
}
