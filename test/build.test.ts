// SPDX-License-Identifier: Apache-2.0
// Tests of the inputs, the page and the command line tool. The page is built for 2 profiles.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildModel, type Graph, type Profile } from '@core/index';
import { pageFor, run, startServer } from '../src/cli/index';
import { validateGraph, validateProfile } from '../src/cli/validate';
import { renderPage } from '../src/cli/page';

const path = (name: string, file: string) => new URL(`../fixtures/${name}/${file}`, import.meta.url).pathname;
const json = <T>(name: string, file: string) => JSON.parse(readFileSync(path(name, file), 'utf8')) as T;

// Every edge of each fixture, written out by hand: [source, target, kind].
const EDGES: Record<string, [string, string, string][]> = {
  product: [
    ['epic-checkout', 'prd-shop', 'products'],
    ['epic-search', 'prd-shop', 'products'],
    ['story-pay-by-card', 'epic-checkout', 'epics'],
    ['story-save-card', 'epic-checkout', 'epics'],
    ['story-search-synonyms', 'epic-search', 'epics'],
    ['story-pay-by-card-3ds', 'story-pay-by-card', 'follows'],
    ['story-save-card', 'story-pay-by-card', 'follows'],
    ['story-loose-child', 'story-loose', 'follows'],
    ['story-pay-by-card', 'std-card-data', 'complies'],
    ['dec-use-psp', 'epic-checkout', 'notes'],
    ['dec-use-two-psp', 'story-pay-by-card', 'notes'],
    ['dec-use-psp', 'dec-use-two-psp', 'replacedBy'],
    ['story-pay-by-card#declined', 'story-pay-by-card', 'scenario'],
    ['story-pay-by-card#charged', 'story-pay-by-card', 'scenario'],
    ['story-pay-by-card#declined', 'unit:tests/pay.test.ts#showsDeclineMessage', 'tested'],
    ['story-pay-by-card-3ds', 'manual:plan-7', 'tested'],
  ],
  safety: [
    ['sg-detect-overheat', 'g-safe-operation', 'goals'],
    ['sg-stop-heater', 'g-safe-operation', 'goals'],
    ['mit-watchdog', 'g-safe-operation', 'goals'],
    ['mit-thermal-fuse', 'sg-stop-heater', 'subgoals'],
    ['mit-thermal-fuse', 'hz-overheat', 'addresses'],
    ['sg-detect-overheat#sensor-redundant', 'sg-detect-overheat', 'argument'],
    ['sg-detect-overheat#sensor-drift', 'sg-detect-overheat', 'argument'],
    ['sg-detect-overheat#sensor-redundant', 'report:FTA-12', 'evidence'],
    ['mit-thermal-fuse', 'analysis:FMEA-3#4.2', 'evidence'],
  ],
};

function pageData(html: string) {
  const m = html.match(/<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/);
  expect(m, 'the page has a graph-data element').toBeTruthy();
  return JSON.parse(m![1]);
}

// Fails when a node of the graph or an expected edge is missing from the page data.
function assertEmbeds(html: string, graph: Graph, profile: Profile, edges: [string, string, string][]) {
  const data = pageData(html);
  const ids = new Set<string>(data.nodes.map((n: { id: string }) => n.id));
  for (const n of graph[profile.source.nodes] as Record<string, string>[]) expect(ids.has(n[profile.source.id]), `node ${n[profile.source.id]} is in the page data`).toBe(true);
  const have = new Set<string>(data.edges.map((e: { s: string; t: string; k: string }) => `${e.s}|${e.t}|${e.k}`));
  for (const [s, t, k] of edges) expect(have.has(`${s}|${t}|${k}`), `edge ${s} -${k}-> ${t} is in the page data`).toBe(true);
}

describe.each(['product', 'safety'])('the page of the %s fixture', (name) => {
  const graph = json<Graph>(name, 'graph.json');
  const profile = json<Profile>(name, 'profile.json');

  it('has every node and every edge of the graph', async () => {
    assertEmbeds(await renderPage(buildModel(graph, profile)), graph, profile, EDGES[name]);
  });
  it('has no edge that the graph does not name', async () => {
    const data = pageData(await renderPage(buildModel(graph, profile)));
    expect(data.edges.length).toBe(EDGES[name].length);
    expect(data.unresolved).toEqual([]);
  });
  it('fails the check when a node is dropped', async () => {
    const key = profile.source.nodes;
    const list = graph[key] as Record<string, string>[];
    const dropped = { ...graph, [key]: list.filter((n) => n[profile.source.id] !== list[1][profile.source.id]) };
    const html = await renderPage(buildModel(dropped, profile));
    expect(() => assertEmbeds(html, graph, profile, EDGES[name])).toThrow(list[1][profile.source.id]);
  });
  it('is self-contained: no external script, style or request', async () => {
    const html = await renderPage(buildModel(graph, profile));
    expect(html).not.toMatch(/<script[^>]*\ssrc\s*=/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/url\(\s*['"]?(https?:)?\/\//i);
    expect(html).not.toMatch(/<(img|iframe|source|video|audio)\b[^>]*\ssrc\s*=\s*["']?https?:/i);
  });
  it('sets 1 colour variable for each kind from the profile', async () => {
    const html = await renderPage(buildModel(graph, profile));
    for (const k of profile.kinds) expect(html).toContain(`--kind-${k.id}:${k.color.light};`);
    expect(html).toContain(`Requirement Explorer – ${profile.project}`);
  });
});

describe('the inputs', () => {
  it('accept both fixtures', () => {
    for (const name of ['product', 'safety']) {
      const profile = json<Profile>(name, 'profile.json');
      expect(validateProfile(profile)).toEqual([]);
      expect(validateGraph(json<Graph>(name, 'graph.json'), profile).errors).toEqual([]);
    }
  });
  it('refuse a profile with a missing part and an unknown kind', () => {
    const profile = json<Profile>('product', 'profile.json') as any;
    expect(validateProfile({ ...profile, kinds: undefined }).join()).toMatch(/kinds/);
    expect(validateProfile({ ...profile, entry: { ...profile.entry, kind: 'nothing' } }).join()).toMatch(/unknown kind "nothing"/);
  });
  it('refuse a graph with a duplicate id, an unknown kind or a field that is not a list', () => {
    const profile = json<Profile>('product', 'profile.json');
    const graph = json<Graph>('product', 'graph.json') as any;
    const nodes = [...graph.nodes, { ...graph.nodes[0] }, { id: 'x', kind: 'nothing' }, { id: 'y', kind: 'story', epics: 'epic-checkout' }];
    const { errors } = validateGraph({ nodes }, profile);
    expect(errors.join('\n')).toMatch(/not unique/);
    expect(errors.join('\n')).toMatch(/unknown kind "nothing"/);
    expect(errors.join('\n')).toMatch(/not a list/);
  });
  it('warn about a link to a node that is not in the graph', () => {
    const profile = json<Profile>('product', 'profile.json');
    const { errors, warnings } = validateGraph({ nodes: [{ id: 'a', kind: 'epic', products: ['missing'] }] }, profile);
    expect(errors).toEqual([]);
    expect(warnings[0]).toMatch(/1 link/);
  });
});

describe('the command line tool', () => {
  it('writes 1 HTML file with the build command', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 're-')), 'out', 'explorer.html');
    const code = await run(['build', '--graph', path('safety', 'graph.json'), '--profile', path('safety', 'profile.json'), '--out', out]);
    expect(code).toBe(0);
    const html = readFileSync(out, 'utf8');
    expect(html).toContain('id="graph-data"');
    expect(pageData(html).nodes.length).toBeGreaterThan(8);
  });
  it('refuses a missing option and an invalid profile', async () => {
    expect(await run(['build', '--graph', 'a.json'])).toBe(1);
    expect(await run(['nothing'])).toBe(1);
    const dir = mkdtempSync(join(tmpdir(), 're-'));
    writeFileSync(join(dir, 'p.json'), '{"project":"x"}');
    expect(await run(['build', '--graph', path('safety', 'graph.json'), '--profile', join(dir, 'p.json'), '--out', join(dir, 'o.html')])).toBe(1);
  });
  it('serves the page on a local port with the serve command', async () => {
    const server = await startServer(path('product', 'graph.json'), path('product', 'profile.json'), 0, '127.0.0.1');
    try {
      const res = await fetch(server.url);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('id="graph-data"');
      expect((await fetch(new URL('/nothing', server.url))).status).toBe(404);
    } finally {
      await server.close();
    }
  });
  it('builds the same page as the page function', async () => {
    const { html } = await pageFor(path('product', 'graph.json'), path('product', 'profile.json'));
    expect(pageData(html).profile.project).toBe('Shop product');
  });
});
