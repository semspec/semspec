// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the inputs, the page and the command line tool. The page is built for 2 profiles.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { buildModel, type Graph, type Profile } from '@core/index';
import { loadInputs, pageFor, parseArgs, run, startServer } from '../src/cli/index';
import { excludeMatcher } from '../src/cli/yaml';
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
    ['std-card-data', 'card-data-standard', 'issuedBy'],
    ['std-card-storage', 'card-data-standard', 'issuedBy'],
    ['std-privacy-notice', 'privacy-rules', 'issuedBy'],
    ['std-refund-window', 'refund-law', 'issuedBy'],
    ['std-tax-rate', 'tax-code', 'issuedBy'],
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
    ['hz-overheat', 'thermal-code', 'origin'],
    ['hz-shock', 'thermal-code', 'origin'],
    ['hz-fire', 'fire-code', 'origin'],
    ['hz-wire', 'wiring-rules', 'origin'],
  ],
  glossary: [
    ['scale', 'grp-harmony', 'inGroup'],
    ['chord', 'grp-harmony', 'inGroup'],
    ['tempo', 'grp-rhythm', 'inGroup'],
    ['beat', 'grp-rhythm', 'inGroup'],
    ['fermata', 'grp-rhythm', 'inGroup'],
    ['scale', 'chord', 'relations'],
    ['chord', 'scale', 'relations'],
    ['tempo', 'beat', 'relations'],
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

describe.each(['product', 'safety', 'glossary'])('the page of the %s fixture', (name) => {
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
    expect(html).toContain(`Semspec – ${profile.project}`);
  });
});

describe('the inputs', () => {
  it('accept all fixtures', () => {
    for (const name of ['product', 'safety', 'glossary']) {
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

const folder = (name: string) => path(name, 'yaml');
const byId = <T extends { id: string }>(list: T[]) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1));
const edgeKeys = (m: { edges: { s: string; t: string; k: string }[] }) => m.edges.map((e) => `${e.s}|${e.t}|${e.k}`).sort();
const tmp = () => mkdtempSync(join(tmpdir(), 're-'));

describe.each(['product', 'safety', 'glossary'])('the YAML input of the %s fixture', (name) => {
  const profile = json<Profile>(name, 'profile.json');
  const graph = json<Graph>(name, 'graph.json');
  const nodes = graph[profile.source.nodes] as Record<string, string>[];

  it('gives the same nodes and edges as the JSON graph', () => {
    const fromYaml = buildModel(loadInputs(folder(name), path(name, 'profile.json')).graph, profile);
    const fromJson = buildModel(graph, profile);
    expect(byId(fromYaml.nodes)).toEqual(byId(fromJson.nodes));
    expect(edgeKeys(fromYaml)).toEqual(edgeKeys(fromJson));
    expect(fromYaml.nodes.length).toBeGreaterThanOrEqual(nodes.length);
  });
  it('reads a YAML profile and a YAML file with the whole graph', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'profile.yaml'), stringify(profile));
    writeFileSync(join(dir, 'graph.yml'), stringify(graph));
    const read = loadInputs(join(dir, 'graph.yml'), join(dir, 'profile.yaml'));
    expect(read.profile).toEqual(profile);
    expect(buildModel(read.graph, read.profile).nodes.length).toBe(buildModel(graph, profile).nodes.length);
  });
  it('reads a file with a list of nodes and ignores other files', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'a', 'b'), { recursive: true });
    writeFileSync(join(dir, 'a', 'list.yaml'), stringify(nodes.slice(0, 2)));
    writeFileSync(join(dir, 'a', 'b', 'rest.yml'), stringify(nodes.slice(2)));
    writeFileSync(join(dir, 'a', 'notes.txt'), 'not YAML: [');
    const read = loadInputs(dir, path(name, 'profile.json')).graph[profile.source.nodes] as Record<string, string>[];
    expect(byId(read.map((n) => ({ ...n, id: n[profile.source.id] })))).toEqual(byId(nodes.map((n) => ({ ...n, id: n[profile.source.id] }))));
  });
  it('names the file of a node with an unknown kind or no id', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'bad-kind.yaml'), stringify({ [profile.source.id]: 'x', [profile.source.kind]: 'nothing' }));
    writeFileSync(join(dir, 'no-id.yaml'), stringify([{ [profile.source.kind]: profile.kinds[0].id }]));
    let message = '';
    try {
      loadInputs(dir, path(name, 'profile.json'));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain(`File "${join(dir, 'bad-kind.yaml')}" has the unknown kind "nothing"`);
    expect(message).toContain(`File "${join(dir, 'no-id.yaml')}", node 0 has no "${profile.source.id}"`);
  });
  it('names the file of a duplicate id', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'one.yaml'), stringify(nodes[0]));
    writeFileSync(join(dir, 'two.yaml'), stringify(nodes[0]));
    expect(() => loadInputs(dir, path(name, 'profile.json'))).toThrow(/not unique \(File ".*two\.yaml"\)/);
  });
  it('names the file when it is not a mapping or a list of mappings, or not YAML', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'text.yaml'), 'just a text');
    expect(() => loadInputs(dir, path(name, 'profile.json'))).toThrow(/text\.yaml" must hold a mapping or a list of mappings/);
    writeFileSync(join(dir, 'text.yaml'), 'a: [1, 2');
    expect(() => loadInputs(dir, path(name, 'profile.json'))).toThrow(/Cannot read the graph file ".*text\.yaml"/);
  });
  it('reads the folder again on each request of the server', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'a.yaml'), stringify(nodes[0]));
    const server = await startServer(dir, path(name, 'profile.json'), 0, '127.0.0.1');
    try {
      const before = pageData(await (await fetch(server.url)).text()).nodes.length;
      writeFileSync(join(dir, 'b.yaml'), stringify(nodes[1]));
      expect(pageData(await (await fetch(server.url)).text()).nodes.length).toBeGreaterThan(before);
    } finally {
      await server.close();
    }
  });
});

describe('the argument parser', () => {
  it('keeps all values of a repeated flag and the last value in flags', () => {
    const { command, flags, lists } = parseArgs(['build', '--graph', 'g', '--exclude', 'a', '--exclude', 'b/**', '--out', 'o']);
    expect(command).toBe('build');
    expect(lists.exclude).toEqual(['a', 'b/**']);
    expect(flags).toEqual({ graph: 'g', exclude: 'b/**', out: 'o' });
    expect(lists.graph).toEqual(['g']);
  });
});

describe('the exclude patterns', () => {
  const matches = (pattern: string, rel: string) => excludeMatcher(pattern)(rel);
  it('match a plain name at any depth', () => {
    expect(matches('schema', 'schema')).toBe(true);
    expect(matches('schema', 'a/schema/x.yaml')).toBe(true);
    expect(matches('schema', 'a/schema.yaml')).toBe(false);
    expect(matches('schema', 'schemas')).toBe(false);
  });
  it('match * inside 1 path segment', () => {
    expect(matches('gen-*', 'gen-1')).toBe(true);
    expect(matches('gen-*', 'a/gen-1')).toBe(false);
    expect(matches('a/*.yaml', 'a/x.yaml')).toBe(true);
    expect(matches('a/*.yaml', 'a/b/x.yaml')).toBe(false);
  });
  it('match ** across segments, and the folder itself for a trailing /**', () => {
    expect(matches('generated/**', 'generated')).toBe(true);
    expect(matches('generated/**', 'generated/a/b.yaml')).toBe(true);
    expect(matches('generated/**', 'other/generated')).toBe(false);
    expect(matches('**/draft.yaml', 'draft.yaml')).toBe(true);
    expect(matches('**/draft.yaml', 'a/b/draft.yaml')).toBe(true);
    expect(matches('a/**/z', 'a/b/c/z')).toBe(true);
  });
  it('match ? as 1 character except /', () => {
    expect(matches('v?/x', 'v1/x')).toBe(true);
    expect(matches('v?/x', 'v10/x')).toBe(false);
    expect(matches('a?b', 'a/b')).toBe(false);
  });
  it('treat other characters as text', () => {
    expect(matches('a.b/*', 'a.b/x')).toBe(true);
    expect(matches('a.b/*', 'aXb/x')).toBe(false);
  });
});

describe.each(['product', 'safety'])('--exclude on the YAML folder of the %s fixture', (name) => {
  const profilePath = path(name, 'profile.json');
  const count = (dir: string, exclude: string[] = []) => buildModel(loadInputs(dir, profilePath, exclude).graph, json<Profile>(name, 'profile.json')).nodes.length;
  const base = count(folder(name));
  // A copy of the fixture folder with a non-node YAML file at 3 places.
  const extra = () => {
    const dir = join(tmp(), 'g');
    cpSync(folder(name), dir, { recursive: true });
    mkdirSync(join(dir, 'schema'), { recursive: true });
    mkdirSync(join(dir, 'generated', 'deep'), { recursive: true });
    mkdirSync(join(dir, 'v1', 'schema'), { recursive: true });
    for (const file of ['schema/types.yaml', 'generated/deep/out.yaml', 'v1/schema/more.yaml']) writeFileSync(join(dir, file), 'title: not a node\n');
    return dir;
  };
  it('fails without the option', () => {
    expect(() => loadInputs(extra(), profilePath)).toThrow(/not valid/);
  });
  it.each([
    [['schema', 'generated']],
    [['schema', 'generated/**']],
    [['schema', 'gen*']],
    [['schema', 'g?nerated']],
    [['**/schema', 'generated']],
    [['schema', '**/out.yaml']],
  ])('passes with %j', (exclude) => {
    const dir = extra();
    expect(count(dir, exclude)).toBe(base);
  });
  it('does not walk an excluded folder', () => {
    const dir = extra();
    writeFileSync(join(dir, 'generated', 'deep', 'broken.yaml'), 'a: [1, 2');
    expect(() => loadInputs(dir, profilePath, ['schema'])).toThrow(/Cannot read the graph file/);
    expect(count(dir, ['schema', 'generated'])).toBe(base);
  });
  it('keeps the exclusions for the build command and the server', async () => {
    const dir = extra();
    const out = join(tmp(), 'o.html');
    const args = ['build', '--graph', dir, '--profile', profilePath, '--out', out];
    expect(await run(args)).toBe(1);
    expect(await run([...args, '--exclude', 'schema', '--exclude', 'generated/**'])).toBe(0);
    expect(pageData(readFileSync(out, 'utf8')).nodes.length).toBe(base);
    const server = await startServer(dir, profilePath, 0, '127.0.0.1', ['schema', 'generated']);
    try {
      expect((await fetch(server.url)).status).toBe(200);
      expect((await fetch(server.url)).status).toBe(200);
    } finally {
      await server.close();
    }
  });
  it('warns once and has no effect when the graph is a file', () => {
    const { warnings } = loadInputs(path(name, 'graph.json'), profilePath, ['schema']);
    expect(warnings.filter((w) => w.includes('--exclude'))).toHaveLength(1);
    expect(loadInputs(path(name, 'graph.json'), profilePath).warnings.some((w) => w.includes('--exclude'))).toBe(false);
  });
});

describe('the embedded nodes', () => {
  it('refuse a profile whose embedded entry names an unknown kind, owner or edge', () => {
    for (const name of ['product', 'safety']) {
      const profile = json<Profile>(name, 'profile.json') as any;
      const entry = profile.embedded[0];
      const check = (patch: object) => validateProfile({ ...profile, embedded: [{ ...entry, ...patch }] }).join('\n');
      expect(check({ kind: 'nothing' }), name).toMatch(/embedded .* kind names the unknown kind "nothing"/);
      expect(check({ owner: 'nothing' }), name).toMatch(/embedded .* owner names the unknown kind "nothing"/);
      expect(check({ edge: 'nothing' }), name).toMatch(/embedded names the edge "nothing", which has no entry in edges/);
    }
  });
  it('warn about 2 objects with the same id and different fields, and name both owners and the field', () => {
    const cases: [string, string, string, string][] = [
      ['product', 'std-card-data', 'std-card-storage', 'title'],
      ['safety', 'hz-overheat', 'hz-shock', 'title'],
    ];
    for (const [name, a, b, field] of cases) {
      const profile = json<Profile>(name, 'profile.json');
      const graph = json<Graph>(name, 'graph.json') as any;
      const list = graph[profile.source.nodes] as Record<string, any>[];
      const e = profile.embedded![0];
      const second = list.find((n) => n[profile.source.id] === b)!;
      second[e.field] = { ...second[e.field], [field]: 'Changed' };
      const text = validateGraph(graph, profile).warnings.join('\n');
      expect(text, name).toContain(`"${a}"`);
      expect(text, name).toContain(`"${b}"`);
      expect(text, name).toContain(`the field "${field}" differs`);
    }
  });
  it('gives no warning when the objects with the same id are equal', () => {
    for (const name of ['product', 'safety']) {
      expect(validateGraph(json<Graph>(name, 'graph.json'), json<Profile>(name, 'profile.json')).warnings, name).toEqual([]);
    }
  });
  it('keeps the first object when 2 objects with the same id differ', () => {
    const profile = json<Profile>('safety', 'profile.json');
    const graph = json<Graph>('safety', 'graph.json') as any;
    graph.items.find((n: any) => n.key === 'hz-shock').source = { id: 'thermal-code', title: 'Other', short: 'OT' };
    expect(buildModel(graph, profile).nodes.find((n) => n.id === 'thermal-code')!.title).toBe('TC');
  });
});

describe('the default kind in the inputs', () => {
  it('refuses a default kind that is not a kind of the profile', () => {
    for (const name of ['product', 'safety', 'glossary']) {
      const profile = json<Profile>(name, 'profile.json');
      const text = validateProfile({ ...profile, source: { ...profile.source, defaultKind: 'nothing' } }).join('\n');
      expect(text, name).toMatch(/source defaultKind names the unknown kind "nothing"/);
      expect(validateProfile({ ...profile, source: { ...profile.source, defaultKind: profile.kinds[0].id } }), name).toEqual([]);
    }
  });
  it('keeps the unknown kind error for a node with no kind when the profile has no default kind', () => {
    for (const name of ['product', 'safety', 'glossary']) {
      const profile = json<Profile>(name, 'profile.json');
      const graph = json<Graph>(name, 'graph.json') as any;
      const first = graph[profile.source.nodes][0];
      delete first[profile.source.kind];
      const { defaultKind, ...source } = profile.source;
      expect(validateGraph(graph, { ...profile, source }).errors.join('\n'), name).toContain(`has the unknown kind "undefined"`);
      const fixed = { ...profile, source: { ...source, defaultKind: profile.kinds[0].id } };
      expect(validateGraph(graph, fixed).errors, name).toEqual([]);
    }
  });
});

describe('the embedded values', () => {
  const cases = ['product', 'safety', 'glossary'];
  it('refuse an object with no id key, and name the owner node', () => {
    for (const name of cases) {
      const profile = json<Profile>(name, 'profile.json');
      const graph = json<Graph>(name, 'graph.json') as any;
      const e = profile.embedded![0];
      const owner = graph[profile.source.nodes].find((n: any) => (n[profile.source.kind] ?? profile.source.defaultKind) === e.owner && n[e.field] && typeof n[e.field] === 'object');
      if (!owner) {
        // The glossary holds plain ids. Make an object with no id key.
        graph[profile.source.nodes][0][e.field] = { title: 'No id' };
      } else delete owner[e.field][e.id!];
      const target = owner ?? graph[profile.source.nodes][0];
      const text = validateGraph(graph, profile).errors.join('\n');
      expect(text, name).toContain(`Node ${target[profile.source.id]} holds`);
      expect(text, name).toContain(`holds an object in "${e.field}"`);
    }
  });
  it('accept a profile entry with no id key, and a plain id in the graph', () => {
    const profile = json<Profile>('glossary', 'profile.json');
    expect(profile.embedded![0].id).toBeUndefined();
    expect(validateProfile(profile)).toEqual([]);
    expect(validateGraph(json<Graph>('glossary', 'graph.json'), profile)).toEqual({ errors: [], warnings: [] });
  });
  it('refuse an edge name that equals the field, or the first segment of a dotted field', () => {
    for (const name of cases) {
      const profile = json<Profile>(name, 'profile.json') as any;
      const entry = profile.embedded[0];
      const edges = { ...profile.edges, [entry.field]: { labels: ['a', 'b'] }, deep: { labels: ['a', 'b'] } };
      const same = validateProfile({ ...profile, edges, embedded: [{ ...entry, edge: entry.field }] }).join('\n');
      expect(same, name).toContain(`profile embedded entry for kind "${entry.owner}" uses the edge name "${entry.field}", which is also its field. Use a different edge name.`);
      const dotted = validateProfile({ ...profile, edges, embedded: [{ ...entry, field: `${entry.field}.deep`, edge: entry.field }] }).join('\n');
      expect(dotted, name).toContain(`uses the edge name "${entry.field}", which is also its field`);
      expect(validateProfile(profile), name).toEqual([]);
    }
  });
  it('refuse an edge name or a field that is also another link or parent field', () => {
    for (const name of cases) {
      const profile = json<Profile>(name, 'profile.json') as any;
      const entry = profile.embedded[0];
      const owner = profile.kinds.find((k: any) => k.id === entry.owner);
      const other = Object.keys(profile.edges).find((k) => k !== entry.edge)!;
      const asLink = validateProfile({ ...profile, links: [...(profile.links ?? []), entry.edge] }).join('\n');
      expect(asLink, name).toContain(`uses the edge name "${entry.edge}", which is also a link field`);
      const kinds = profile.kinds.map((k: any) => (k === owner ? { ...k, parents: [...(k.parents ?? []), [other]] } : k));
      const asField = validateProfile({ ...profile, kinds, embedded: [{ ...entry, field: other }] }).join('\n');
      expect(asField, name).toContain(`uses the field "${other}", which is also the link or parent field "${other}" of the kind`);
    }
  });
});

describe('the glossary fixture', () => {
  it('builds with its default kind, its plain-id groups and its sources in the details', async () => {
    const graph = json<Graph>('glossary', 'graph.json');
    const profile = json<Profile>('glossary', 'profile.json');
    const html = await renderPage(buildModel(graph, profile));
    const data = pageData(html);
    expect(data.nodes.filter((n: any) => n.kind === 'term')).toHaveLength(5);
    expect(data.nodes.filter((n: any) => n.kind === 'group').map((n: any) => n.title).sort()).toEqual(['Harmony', 'Rhythm']);
    expect(data.nodes.find((n: any) => n.id === 'chord').d.source).toHaveLength(2);
    expect(data.profile.details.sourceSections[0].field).toBe('source');
  });
  it('builds from the command line', async () => {
    const out = join(tmp(), 'glossary.html');
    expect(await run(['build', '--graph', path('glossary', 'graph.json'), '--profile', path('glossary', 'profile.json'), '--out', out])).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain('Music glossary');
  });
});

describe('the schema command', () => {
  it.each(['product', 'safety'])('writes 1 schema file for each kind of the %s fixture', async (name) => {
    const profile = json<Profile>(name, 'profile.json');
    const out = join(tmp(), 'schemas');
    expect(await run(['schema', '--profile', path(name, 'profile.json'), '--out', out])).toBe(0);
    expect(readdirSync(out).sort()).toEqual(profile.kinds.map((k) => `${k.id}.schema.json`).sort());
    const first = JSON.parse(readFileSync(join(out, `${profile.kinds[0].id}.schema.json`), 'utf8'));
    expect(first.title).toBe(profile.kinds[0].label);
  });
  it('refuses a missing option and reads a YAML profile', async () => {
    expect(await run(['schema', '--profile', path('product', 'profile.json')])).toBe(1);
    const dir = tmp();
    writeFileSync(join(dir, 'p.yaml'), stringify(json<Profile>('safety', 'profile.json')));
    expect(await run(['schema', '--profile', join(dir, 'p.yaml'), '--out', join(dir, 'out')])).toBe(0);
    expect(readdirSync(join(dir, 'out')).length).toBe(7);
  });
});

describe('the requirements of the repository', () => {
  const root = new URL('../', import.meta.url).pathname;
  const profilePath = join(root, 'requirements', 'profile.yaml');
  const graphPath = join(root, 'requirements', 'graph');

  it('has a valid profile and a graph folder that builds with no error', () => {
    const { graph, profile } = loadInputs(graphPath, profilePath);
    expect(validateProfile(profile)).toEqual([]);
    expect(buildModel(graph, profile).nodes.length).toBeGreaterThan(0);
  });
  it('points every test reference at an existing test with that exact title', () => {
    const { graph } = loadInputs(graphPath, profilePath);
    const refs = (graph.nodes as { acceptance?: { tests?: { file: string; name: string }[] }[] }[]).flatMap((n) => (n.acceptance ?? []).flatMap((a) => a.tests ?? []));
    expect(refs.length).toBeGreaterThan(0);
    const sources = new Map<string, string>();
    for (const { file, name } of refs) {
      if (!sources.has(file)) sources.set(file, readFileSync(join(root, file), 'utf8'));
      const source = sources.get(file)!;
      expect(source.includes(`it('${name}'`) || source.includes(`it("${name}"`), `${file} has a test titled "${name}"`).toBe(true);
    }
  });
});
