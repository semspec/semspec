// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel, type Graph, type Profile, type VEdge } from '@semspec/core';
import { setProfile } from '../packages/app/src/lib/core';
import { SIZE, layered, type Pos } from '../packages/app/src/lib/layout';
import { boundsOf, containerBoxes, facingSides, findContainers, forceLayout, grouped, moveWithMembers, rectsOf } from '../packages/app/src/lib/layouts';
import { validateProfile } from '../packages/cli/src/validate';
import { loadWorkspace } from '../packages/cli/src/workspace';

const load = (name: string) => ({
  graph: JSON.parse(readFileSync(new URL(`../fixtures/${name}/graph.json`, import.meta.url), 'utf8')) as Graph,
  profile: JSON.parse(readFileSync(new URL(`../fixtures/${name}/profile.json`, import.meta.url), 'utf8')) as Profile,
});
const edge = (s: string, t: string, k = 'in'): VEdge => ({ s, t, k });
const none = new Set<string>();

// 2 levels: a, b are in box1, box1 is in outer, c is in outer. d is free.
const nestedIds = ['outer', 'box1', 'a', 'b', 'c', 'd'];
const nestedEdges = [edge('box1', 'outer'), edge('a', 'box1'), edge('b', 'box1'), edge('c', 'outer'), edge('a', 'b', 'rel'), edge('b', 'd', 'rel'), edge('c', 'a', 'rel')];

const inside = (inner: { x: number; y: number; w: number; h: number }, outer: { x: number; y: number; w: number; h: number }) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

describe('the layered layout', () => {
  it('puts the general node left of the specific node and keeps every node apart', () => {
    const { graph, profile } = load('product');
    setProfile(profile);
    const model = buildModel(graph, profile);
    const ids = model.nodes.map((n) => n.id);
    const pos = layered(ids, model.edges, 'graph');
    expect(pos.size).toBe(ids.length);
    expect(pos.get('prd-shop')!.x).toBeLessThan(pos.get('epic-checkout')!.x);
    expect(pos.get('epic-checkout')!.x).toBeLessThan(pos.get('story-pay-by-card')!.x);
    expect(Array.from(layered(ids, model.edges, 'graph'))).toEqual(Array.from(pos));
  });
});

describe('the containers', () => {
  it('finds epics as containers and stories as members in the product fixture', () => {
    const { graph, profile } = load('product');
    const model = buildModel(graph, profile);
    const ids = model.nodes.map((n) => n.id);
    const found = findContainers(ids, model.edges, profile.layout!.groupEdge);
    expect(found.parentOf.get('story-pay-by-card')).toBe('epic-checkout');
    expect(found.parentOf.get('story-search-synonyms')).toBe('epic-search');
    expect(Array.from(found.children.keys()).sort()).toEqual(['epic-checkout', 'epic-search']);
    expect(found.children.get('epic-checkout')).toContain('story-save-card');
    expect(found.roots).toContain('epic-checkout');
    expect(found.roots).not.toContain('story-pay-by-card');
  });
  it('makes no container of a node whose members are not on the canvas', () => {
    const found = findContainers(['story-a', 'epic-x'], [edge('story-a', 'epic-y')], 'in');
    expect(found.parentOf.size).toBe(0);
    expect(found.children.size).toBe(0);
  });
  it('puts a member with 2 containers in the first one', () => {
    const found = findContainers(['m', 'g1', 'g2'], [edge('m', 'g1'), edge('m', 'g2')], 'in');
    expect(found.parentOf.get('m')).toBe('g1');
    expect(found.children.has('g2')).toBe(false);
  });
  it('finds nested containers and skips a cycle', () => {
    const found = findContainers(nestedIds, nestedEdges, 'in');
    expect(found.parentOf.get('a')).toBe('box1');
    expect(found.parentOf.get('box1')).toBe('outer');
    expect(found.roots).toEqual(['outer', 'd']);
    const cycle = findContainers(['x', 'y'], [edge('x', 'y'), edge('y', 'x')], 'in');
    expect(cycle.parentOf.size).toBe(1);
  });
  it('finds nothing without a group edge', () => {
    expect(findContainers(nestedIds, nestedEdges, undefined).parentOf.size).toBe(0);
  });
});

describe('the grouped layout', () => {
  it('gives every container a box that holds its members, 2 levels deep', () => {
    const pos = grouped(nestedIds, nestedEdges, 'graph', 'in', none);
    expect(Array.from(pos.keys()).sort()).toEqual([...nestedIds].sort());
    const { parentOf } = findContainers(nestedIds, nestedEdges, 'in');
    const rects = rectsOf(nestedIds, parentOf, pos, 'graph');
    expect(inside(rects.get('a')!, rects.get('box1')!)).toBe(true);
    expect(inside(rects.get('b')!, rects.get('box1')!)).toBe(true);
    expect(inside(rects.get('box1')!, rects.get('outer')!)).toBe(true);
    expect(inside(rects.get('c')!, rects.get('outer')!)).toBe(true);
    expect(inside(rects.get('d')!, rects.get('outer')!)).toBe(false);
    expect(rects.get('outer')!.h).toBeGreaterThan(rects.get('box1')!.h);
  });
  it('keeps the boxes equal to the positions that it returns', () => {
    const pos = grouped(nestedIds, nestedEdges, 'cards', 'in', none);
    const { parentOf } = findContainers(nestedIds, nestedEdges, 'in');
    containerBoxes(parentOf, pos, 'cards').forEach((box, id) => {
      expect(box.x).toBeCloseTo(pos.get(id)!.x);
      expect(box.y).toBeCloseTo(pos.get(id)!.y);
    });
  });
  it('keeps the members of 2 containers apart', () => {
    const { graph, profile } = load('product');
    const model = buildModel(graph, profile);
    const ids = model.nodes.map((n) => n.id);
    const pos = grouped(ids, model.edges, 'graph', 'epics', new Set(['products', 'epics', 'follows', 'issuedBy', 'scenario']));
    const { parentOf } = findContainers(ids, model.edges, 'epics');
    const rects = rectsOf(ids, parentOf, pos, 'graph');
    const a = rects.get('epic-checkout')!;
    const b = rects.get('epic-search')!;
    const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    expect(apart).toBe(true);
    parentOf.forEach((p, id) => expect(inside(rects.get(id)!, rects.get(p)!)).toBe(true));
  });
  it('lays out the same for the same input', () => {
    const one = grouped(nestedIds, nestedEdges, 'graph', 'in', none);
    const two = grouped(nestedIds, nestedEdges, 'graph', 'in', none);
    expect(Array.from(one)).toEqual(Array.from(two));
  });
  it('moves the members with their container', () => {
    const pos = grouped(nestedIds, nestedEdges, 'graph', 'in', none);
    const { parentOf } = findContainers(nestedIds, nestedEdges, 'in');
    const before = new Map(pos);
    const at = before.get('box1')!;
    moveWithMembers(pos, parentOf, 'box1', { x: at.x + 50, y: at.y - 10 });
    expect(pos.get('a')!.x).toBeCloseTo(before.get('a')!.x + 50);
    expect(pos.get('b')!.y).toBeCloseTo(before.get('b')!.y - 10);
    expect(pos.get('c')).toEqual(before.get('c'));
  });
});

function overlap(a: Pos, b: Pos, mode: 'graph' | 'cards') {
  const s = SIZE[mode];
  return Math.abs(a.x - b.x) < s.w && Math.abs(a.y - b.y) < s.h;
}

describe('the force layout', () => {
  const { graph, profile } = load('glossary');
  const model = buildModel(graph, profile);
  const ids = model.nodes.map((n) => n.id);

  it('gives the same positions on 2 runs', () => {
    const one = forceLayout(ids, model.edges, 'graph');
    const two = forceLayout(ids, model.edges, 'graph');
    expect(Array.from(one)).toEqual(Array.from(two));
    expect(one.size).toBe(ids.length);
  });
  it('leaves no 2 nodes on each other, in the 2 modes', () => {
    for (const mode of ['graph', 'cards'] as const) {
      const pos = forceLayout(ids, model.edges, mode);
      const list = Array.from(pos.values());
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) expect(overlap(list[i], list[j], mode)).toBe(false);
    }
  });
  it('keeps 40 linked nodes apart', () => {
    const many = Array.from({ length: 40 }, (_, i) => `n${i}`);
    const links = many.slice(1).map((id, i) => edge(id, many[Math.floor(i / 3)], 'rel'));
    const pos = forceLayout(many, links, 'graph');
    const list = Array.from(pos.values());
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) expect(overlap(list[i], list[j], 'graph')).toBe(false);
  });
  it('lays out 1 node and no node', () => {
    expect(forceLayout(['x'], [], 'graph').size).toBe(1);
    expect(forceLayout([], [], 'graph').size).toBe(0);
  });
});

describe('the layout key of a profile', () => {
  const { profile } = load('product');
  it('is valid in the fixtures', () => {
    expect(load('product').profile.layout).toEqual({ default: 'grouped', groupEdge: 'epics' });
    expect(load('glossary').profile.layout).toEqual({ default: 'force' });
    expect(validateProfile(profile)).toEqual([]);
  });
  it('refuses grouped without a group edge', () => {
    expect(validateProfile({ ...profile, layout: { default: 'grouped' } }).join()).toMatch(/needs a groupEdge/);
  });
  it('refuses a group edge that is not in edges', () => {
    expect(validateProfile({ ...profile, layout: { groupEdge: 'nothing' } }).join()).toMatch(/edge "nothing"/);
  });
  it('refuses an unknown layout name', () => {
    expect(validateProfile({ ...profile, layout: { default: 'spiral' } }).length).toBeGreaterThan(0);
  });
});

describe('the bounds and the sides', () => {
  it('bounds the absolute rectangles of containers, members and free nodes', () => {
    const pos = grouped(nestedIds, nestedEdges, 'graph', 'in', none);
    const { parentOf } = findContainers(nestedIds, nestedEdges, 'in');
    const rects = rectsOf(nestedIds, parentOf, pos, 'graph');
    const b = boundsOf(Array.from(rects.values()));
    rects.forEach((r) => expect(inside(r, b)).toBe(true));
    expect(b.x).toBe(Math.min(...Array.from(rects.values()).map((r) => r.x)));
    expect(b.w).toBe(Math.max(...Array.from(rects.values()).map((r) => r.x + r.w)) - b.x);
  });
  it('picks the sides that face each other', () => {
    const r = { w: 100, h: 40 };
    const o = { x: 0, y: 0, ...r };
    expect(facingSides(o, { x: 300, y: 20, ...r })).toEqual({ source: 'right', target: 'left' });
    expect(facingSides(o, { x: -300, y: 20, ...r })).toEqual({ source: 'left', target: 'right' });
    expect(facingSides(o, { x: 20, y: 200, ...r })).toEqual({ source: 'bottom', target: 'top' });
    expect(facingSides(o, { x: 20, y: -200, ...r })).toEqual({ source: 'top', target: 'bottom' });
    expect(facingSides(o, { x: 100, y: 100, ...r })).toEqual({ source: 'right', target: 'left' });
  });
});

describe('the packed grouped layout', () => {
  const { data } = loadWorkspace(new URL('../fixtures/workspace/workspace.json', import.meta.url).pathname);
  const domain = data.graphs[1];
  const profile = domain.model.profile;
  const ids = domain.model.nodes.map((n) => n.id);
  const groupEdge = profile.layout!.groupEdge!;
  const pos = grouped(ids, domain.model.edges, 'graph', groupEdge, new Set(Object.keys(profile.edges).filter((k) => profile.edges[k].down)));
  const { parentOf, roots } = findContainers(ids, domain.model.edges, groupEdge);
  const rects = rectsOf(ids, parentOf, pos, 'graph');
  const tops = roots.filter((id) => Array.from(parentOf.values()).includes(id));

  it('packs the containers of the retail market model into a drawing close to the view', () => {
    expect(tops.length).toBeGreaterThan(1);
    const b = boundsOf(Array.from(rects.values()));
    expect(b.w / b.h).toBeGreaterThanOrEqual(0.5);
    expect(b.w / b.h).toBeLessThanOrEqual(2.5);
  });
  it('leaves no 2 top level containers on each other', () => {
    for (let i = 0; i < tops.length; i++) {
      for (let j = i + 1; j < tops.length; j++) {
        const a = rects.get(tops[i])!;
        const c = rects.get(tops[j])!;
        expect(a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y).toBe(true);
      }
    }
  });
  it('keeps every member inside its container box', () => {
    parentOf.forEach((p, id) => expect(inside(rects.get(id)!, rects.get(p)!)).toBe(true));
  });
  it('packs 6 equal containers and the free nodes into rows, in a stable order', () => {
    const many = ['f1', 'f2', ...Array.from({ length: 6 }, (_, i) => `c${i}`), ...Array.from({ length: 6 }, (_, i) => `m${i}`)];
    const links = Array.from({ length: 6 }, (_, i) => edge(`m${i}`, `c${i}`));
    const one = grouped(many, links, 'graph', 'in', none);
    const r = rectsOf(many, findContainers(many, links, 'in').parentOf, one, 'graph');
    const b = boundsOf(Array.from(r.values()));
    expect(b.w / b.h).toBeLessThanOrEqual(2.5);
    expect(Array.from(grouped(many, links, 'graph', 'in', none))).toEqual(Array.from(one));
  });
  it('packs the containers inside a container when the row is too wide', () => {
    const many = ['top', ...Array.from({ length: 6 }, (_, i) => `a${i}`), ...Array.from({ length: 6 }, (_, i) => `m${i}`)];
    const links = [...Array.from({ length: 6 }, (_, i) => edge(`a${i}`, 'top')), ...Array.from({ length: 6 }, (_, i) => edge(`m${i}`, `a${i}`))];
    const r = rectsOf(many, findContainers(many, links, 'in').parentOf, grouped(many, links, 'graph', 'in', none), 'graph');
    const top = r.get('top')!;
    expect(top.w / top.h).toBeLessThanOrEqual(2.5);
  });
});
