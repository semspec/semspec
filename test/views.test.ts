// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the views of a workspace: the list, the default views, the profile, the parents rule, the
// layout, the filters, the identity of the nodes and the check.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { workspaceViews, type WorkspaceData } from '@semspec/core';
import { run } from '../packages/cli/src/index';
import { loadWorkspace } from '../packages/cli/src/workspace';

const fixtures = new URL('../fixtures/workspace/', import.meta.url).pathname;
const workspacePath = join(fixtures, 'workspace.json');
const viewsPath = join(fixtures, 'workspace-views.json');
const made: string[] = [];
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

// A copy of the fixture folder with a workspace file that an edit changes, and an alternative profile.
function copyViews(edit: (ws: any) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'views-'));
  made.push(dir);
  cpSync(fixtures, dir, { recursive: true });
  const profile = readFileSync(join(dir, 'domain', 'profile.yaml'), 'utf8').replace('project: Online retail market', 'project: Retail ownership');
  writeFileSync(join(dir, 'domain', 'profile-ownership.yaml'), profile);
  const ws = JSON.parse(readFileSync(join(dir, 'workspace-views.json'), 'utf8'));
  edit(ws);
  writeFileSync(join(dir, 'workspace.json'), JSON.stringify(ws));
  return join(dir, 'workspace.json');
}

const messageOf = (file: string): string => {
  try {
    loadWorkspace(file);
  } catch (e) {
    return (e as Error).message;
  }
  return '';
};

function pageData(html: string) {
  const m = html.match(/<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/);
  expect(m, 'the page has a graph-data element').toBeTruthy();
  return JSON.parse(m![1]);
}

describe('req-workspace-views: list', () => {
  it('loads the views in the order of the list with their graph ids', () => {
    const { data, warnings } = loadWorkspace(viewsPath);
    expect(warnings).toEqual([]);
    expect(data.views!.map((v) => [v.id, v.label, v.graph])).toEqual([
      ['req', 'Requirements', 'req'],
      ['market', 'Market model', 'domain'],
      ['ownership', 'Ownership', 'domain'],
    ]);
    expect(workspaceViews(data).map((v) => v.id)).toEqual(['req', 'market', 'ownership']);
  });
  it('writes the views into the page', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'views-')), 'page.html');
    made.push(join(out, '..'));
    expect(await run(['build', '--workspace', viewsPath, '--out', out])).toBe(0);
    const data = pageData(readFileSync(out, 'utf8')) as WorkspaceData;
    expect(data.views!.map((v) => v.id)).toEqual(['req', 'market', 'ownership']);
  });
});

describe('req-workspace-views: default-views', () => {
  it('gives 1 view for each graph in the order of the graphs when the file has no views', () => {
    const { data } = loadWorkspace(workspacePath);
    expect(data.views).toBeUndefined();
    const views = workspaceViews(data);
    expect(views.map((v) => [v.id, v.label, v.graph])).toEqual(data.graphs.map((g) => [g.id, g.label, g.id]));
    views.forEach((v, i) => expect(v.model).toBe(data.graphs[i].model));
  });
});

describe('req-workspace-views: profile', () => {
  it('builds the model of a view from the profile file of the view', () => {
    const file = copyViews((ws) => (ws.views[1].profile = 'domain/profile-ownership.yaml'));
    const { data } = loadWorkspace(file);
    const market = workspaceViews(data)[1];
    expect(market.model.profile.project).toBe('Retail ownership');
    expect(data.graphs[1].model.profile.project).toBe('Online retail market');
    expect(market.model.nodes.map((n) => n.id)).toEqual(data.graphs[1].model.nodes.map((n) => n.id));
  });
  it('uses the model of the graph for a view with no profile, parents rule or layout', () => {
    const { data } = loadWorkspace(viewsPath);
    const [req, market] = workspaceViews(data);
    expect(req.model).toBe(data.graphs[0].model);
    expect(market.model).toBe(data.graphs[1].model);
  });
});

describe('req-workspace-views: tree', () => {
  it('places the nodes of 2 views of 1 graph under different parents', () => {
    const { data } = loadWorkspace(viewsPath);
    const [, market, ownership] = workspaceViews(data);
    const parentsOf = (m: typeof market.model, id: string) => m.nodes.find((n) => n.id === id)!.parents;
    const shop = market.model.nodes.find((n) => n.kind === 'shop' && n.parents.length > 0 && ownership.model.nodes.find((x) => x.id === n.id)!.parents.length > 0)!;
    expect(parentsOf(market.model, shop.id).every((p) => market.model.nodes.find((n) => n.id === p)!.kind === 'group')).toBe(true);
    expect(parentsOf(ownership.model, shop.id).every((p) => ownership.model.nodes.find((n) => n.id === p)!.kind === 'market')).toBe(true);
    expect(parentsOf(ownership.model, shop.id)).not.toEqual(parentsOf(market.model, shop.id));
  });
  it('keeps the rule of a kind that the view does not name', () => {
    const { data } = loadWorkspace(viewsPath);
    const [, market, ownership] = workspaceViews(data);
    expect(ownership.model.profile.kinds.find((k) => k.id === 'market')!.parents).toEqual(market.model.profile.kinds.find((k) => k.id === 'market')!.parents);
    expect(ownership.model.profile.kinds.find((k) => k.id === 'shop')!.parents).toEqual([['operatesIn'], ['ownedBy']]);
  });
});

describe('req-workspace-views: layout', () => {
  it('sets the layout keys of a view over the keys of the profile', () => {
    const { data } = loadWorkspace(viewsPath);
    const [, market, ownership] = workspaceViews(data);
    expect(market.model.profile.layout).toEqual({ default: 'grouped', groupEdge: 'inZone' });
    expect(ownership.model.profile.layout).toEqual({ default: 'grouped', groupEdge: 'inZone', groupBy: 'parents' });
  });
});

describe('req-workspace-views: filters', () => {
  it('carries the default filters of a view into the page data', () => {
    const { data } = loadWorkspace(viewsPath);
    expect(workspaceViews(data)[2].filters).toEqual({ kinds: ['shop', 'market'] });
    expect(workspaceViews(data)[1].filters).toBeUndefined();
  });
});

describe('req-workspace-views: identity', () => {
  it('shows the same node ids in 2 views of 1 graph', () => {
    const { data } = loadWorkspace(viewsPath);
    const [, market, ownership] = workspaceViews(data);
    expect(ownership.model.nodes.map((n) => n.id)).toEqual(market.model.nodes.map((n) => n.id));
    expect(ownership.model.crossLinks).toEqual(market.model.crossLinks);
    expect(ownership.graph).toBe(market.graph);
  });
});

describe('req-workspace-views: check', () => {
  it('refuses a view id that appears twice and names the view', () => {
    const file = copyViews((ws) => (ws.views[2].id = 'market'));
    expect(messageOf(file)).toMatch(/The view id "market" is not unique/);
  });
  it('refuses a view that names an unknown graph and names the view', () => {
    const file = copyViews((ws) => (ws.views[1].graph = 'nothing'));
    expect(messageOf(file)).toMatch(/View "market": the graph "nothing" is not in the workspace/);
  });
  it('refuses a view profile that is not valid and names the view', () => {
    const file = copyViews((ws) => (ws.views[1].profile = 'domain/profile-ownership.yaml'));
    const broken = join(dirname(file), 'domain', 'profile-ownership.yaml');
    writeFileSync(broken, readFileSync(broken, 'utf8').replace('layout: { default: grouped, groupEdge: inZone }', 'layout: { default: spiral }'));
    expect(messageOf(file)).toMatch(/View "market": The profile .* is not valid/s);
  });
  it('refuses a parents rule that names an unknown kind and names the view', () => {
    const file = copyViews((ws) => (ws.views[2].parents = { nothing: [['inZone']] }));
    expect(messageOf(file)).toMatch(/View "ownership": parents names the unknown kind "nothing"/);
  });
  it('refuses a parents rule that names an edge the profile lacks and names the view', () => {
    const file = copyViews((ws) => (ws.views[2].parents = { shop: [['nothing']] }));
    expect(messageOf(file)).toMatch(/View "ownership": profile kind shop parents names the edge "nothing"/);
  });
  it('fails the check command for a view that names an unknown graph', async () => {
    const file = copyViews((ws) => (ws.views[1].graph = 'nothing'));
    expect(await run(['check', '--workspace', file])).toBe(1);
    expect(await run(['check', '--workspace', viewsPath])).toBe(0);
  });
});
