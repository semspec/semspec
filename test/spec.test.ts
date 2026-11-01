// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the spec command: the markers, the selection, the shapes, the presets, the check and the default documents.
// The fixtures are a small profile in this file, the music glossary, the product and retail workspace, and the requirements of this repository.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildModel, defaultDocuments, escapeMd, fillSpecs, indexGraphs, parseSpecMarkers, profileSpecProblems, type GraphIndex, type SpecFinding } from '@semspec/core';
import { run } from '../packages/cli/src/index';
import { loadInputs } from '../packages/cli/src/inputs';
import { validateProfile } from '../packages/cli/src/validate';
import { loadWorkspace } from '../packages/cli/src/workspace';

const repo = new URL('../', import.meta.url).pathname;
const workspacePath = `${repo}fixtures/workspace/workspace.json`;
const shop = indexGraphs(loadWorkspace(workspacePath).data.graphs);
const musicInputs = loadInputs(`${repo}fixtures/glossary/graph.json`, `${repo}fixtures/glossary/profile.json`);
const music = indexGraphs([{ id: 'graph', label: 'Music glossary', model: buildModel(musicInputs.graph, musicInputs.profile) }]);
const reqInputs = loadInputs(`${repo}requirements/graph`, `${repo}requirements/profile.yaml`);
const reqs = indexGraphs([{ id: 'graph', label: 'Semspec requirements', model: buildModel(reqInputs.graph, reqInputs.profile) }]);

// A small profile and graph with all the parts the shapes use.
const miniProfile = {
  project: 'Mini',
  source: { nodes: 'nodes', id: 'id', kind: 'kind' },
  fields: { title: ['title'], statement: ['text'], idPrefixPattern: '^[a-z]+-', level: 'rank' },
  lifecycle: { field: 'state', fallback: 'live', states: { old: { muted: true } } },
  kinds: [
    { id: 'area', label: 'Area', plural: 'areas', prefix: 'area-', role: 'hierarchy', color: { light: '#111111', dark: '#eeeeee' }, chips: [] },
    { id: 'item', label: 'Item', plural: 'items', prefix: 'item-', role: 'hierarchy', parents: [['areas']], color: { light: '#222222', dark: '#dddddd' }, chips: [] },
    { id: 'step', label: 'Step', plural: 'steps', role: 'part', color: { light: '#333333', dark: '#cccccc' }, chips: [] },
    { id: 'note', label: 'Note', plural: 'notes', prefix: 'note-', role: 'linked', color: { light: '#444444', dark: '#bbbbbb' }, chips: [] },
    { id: 'run', label: 'Run', plural: 'runs', role: 'check', color: { light: '#555555', dark: '#aaaaaa' }, chips: [] },
  ],
  edges: {
    areas: { labels: ['In area', 'Contains'], down: true },
    step: { labels: ['Step of', 'Has step'], down: true },
    ran: { labels: ['Run by', 'Runs'] },
    about: { labels: ['About', 'Subject of'] },
  },
  links: ['about'],
  parts: [{ kind: 'step', owner: 'item', field: 'steps', id: 'key', text: 'text', edge: 'step', sectionTitle: 'Steps' }],
  checks: { kind: 'run', field: 'runs', edge: 'ran', typeField: 'type', types: { auto: { key: ['file', 'name'], title: ['name'] } }, sectionTitle: 'Runs', noneText: 'No run.' },
  status: {
    label: 'State of work',
    field: 'result',
    values: [
      { value: 'done', label: 'Done', tone: 'good' },
      { value: 'part', label: 'Partly done', tone: 'warn' },
      { value: 'todo', label: 'To do', tone: 'bad' },
    ],
  },
  deliverables: { item: { parts: { min: 1 }, checks: 'each-part' } },
  fieldFilters: [
    { field: 'prio', label: 'Priority' },
    { field: 'tags', label: 'Tag', values: { x: 'Ex' } },
  ],
  vocabularies: {
    prio: { label: 'Priority', concepts: [{ code: 'hi', label: 'High', order: 1 }, { code: 'lo', label: 'Low', order: 2 }] },
    how: { label: 'How', concepts: [{ code: 'told', label: 'Told by a person' }] },
  },
  fieldVocabularies: { prio: 'prio' },
  provenance: { marker: { field: 'how', vocabulary: 'how' }, source: { field: 'cite' }, retrieved: 'seen', agent: 'who', note: 'why' },
  search: { synonymFields: ['aka'] },
  spec: { roots: ['area'], presets: { open: { shape: 'table', status: ['part', 'todo'], columns: 'id,title,status' }, wide: { shape: 'tree', level: 3, show: 'statement' } } },
};
const miniGraph = {
  nodes: [
    { id: 'area-core', kind: 'area', title: 'Core', text: 'The core area.' },
    { id: 'area-edge', kind: 'area', title: 'Edge', state: 'old' },
    {
      id: 'item-a',
      kind: 'item',
      title: 'Alpha',
      text: 'Does *a* | b <!-- semspec:end --> now.\n\nSecond paragraph.',
      areas: ['area-core'],
      prio: 'hi',
      tags: ['x', 'y'],
      rank: 1,
      aka: ['First', 'Alpha one'],
      about: ['note-1'],
      how: 'told',
      cite: 'a book',
      steps: [
        { key: 's1', text: 'First step', result: 'done', runs: [{ type: 'auto', file: 'a.test.ts', name: 'runs the first step' }] },
        { key: 's2', text: 'Second step', result: 'todo' },
      ],
    },
    { id: 'item-b', kind: 'item', title: 'Beta', text: 'The beta item.', areas: ['area-core'], prio: 'lo', rank: 2, steps: [{ key: 's1', text: 'Only step', result: 'done', runs: [{ type: 'auto', file: 'b.test.ts', name: 'runs the only step' }] }] },
    { id: 'item-c', kind: 'item', title: 'Gamma', text: 'The gamma item.', areas: ['area-edge'], rank: 1, steps: [{ key: 'g1', text: `Long ${'word '.repeat(60)}`, result: 'part' }] },
    { id: 'note-1', kind: 'note', title: 'Note one', text: 'A note.' },
  ],
};
const mini = indexGraphs([{ id: 'graph', label: 'Mini', model: buildModel(miniGraph, miniProfile as never) }]);

const HEADER = '<!-- generated by semspec; do not edit this section -->';
const template = (options: string) => `# Doc\n\nIntro by the author.\n\n<!-- semspec:section ${options} -->\n<!-- semspec:end -->\n\nEnd by the author.\n`;
const fill = (graphs: GraphIndex[], text: string, path = '/work/doc.md') => fillSpecs(graphs, [{ path, text }]);

// The generated text of 1 section, without the header. It fails when the run has an error.
function body(graphs: GraphIndex[], options: string): string {
  const r = fill(graphs, template(options));
  const errors = r.findings.filter((f) => f.code === 'error');
  expect(errors).toEqual([]);
  const text = r.files[0].text;
  const start = text.indexOf(HEADER) + HEADER.length;
  return text.slice(start, text.indexOf('<!-- semspec:end -->')).replace(/^\n+/, '').replace(/\n$/, '');
}
const errorsOf = (graphs: GraphIndex[], text: string): SpecFinding[] => fill(graphs, text).findings.filter((f) => f.code === 'error');
const anchors = (md: string) => [...md.matchAll(/<a id="([^"]+)"><\/a>/g)].map((m) => m[1]);

const temps: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'semspec-spec-'));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  vi.restoreAllMocks();
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

async function cli(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => void err.push(a.join(' ')));
  vi.spyOn(console, 'warn').mockImplementation((...a) => void err.push(a.join(' ')));
  const code = await run(args);
  vi.restoreAllMocks();
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('markers', () => {
  it('reads a section marker and a node marker, with quoted values and lists', () => {
    const text = '# T\n\n<!-- semspec:section shape=table kinds=item,area empty="No item, sorry" columns=\'id, title\' -->\nold\n<!-- semspec:end -->\n\ntext\n<!--semspec:node id=item-a-->\n<!-- semspec:end -->\n';
    const { markers, problems } = parseSpecMarkers(text);
    expect(problems).toEqual([]);
    expect(markers.map((m) => [m.type, m.line])).toEqual([['section', 3], ['node', 8]]);
    expect(markers[0].options).toEqual({ shape: 'table', kinds: 'item,area', empty: 'No item, sorry', columns: 'id, title' });
    expect(markers[1].options).toEqual({ id: 'item-a' });
    expect(text.slice(markers[0].start, markers[0].end)).toBe('\nold\n');
  });
  it('ignores a marker inside a fenced code block', () => {
    const text = 'Example:\n\n```md\n<!-- semspec:section shape=tree -->\n<!-- semspec:end -->\n```\n\n~~~\n<!-- semspec:node id=x -->\n~~~\n';
    expect(parseSpecMarkers(text)).toEqual({ markers: [], problems: [] });
    expect(fill(mini, text).files[0].changed).toBe(false);
  });
  it('replaces the text between the markers and keeps the author text byte for byte', () => {
    const before = '# Doc  \r\n\tIntro with trailing spaces   \n\n<!-- semspec:section shape=list kinds=area -->\nOLD TEXT\n<!-- semspec:end -->\n  Between\n\n\n<!--   semspec:section   shape=table   kinds=area   columns=id  -->\n<!-- semspec:end -->\nAfter without a final line break';
    const r = fill(mini, before);
    expect(r.findings.filter((f) => f.code === 'error')).toEqual([]);
    const after = r.files[0].text;
    const keep = ['# Doc  \r\n\tIntro with trailing spaces   \n\n<!-- semspec:section shape=list kinds=area -->', '<!-- semspec:end -->\n  Between\n\n\n<!--   semspec:section   shape=table   kinds=area   columns=id  -->', '<!-- semspec:end -->\nAfter without a final line break'];
    expect(after.startsWith(keep[0])).toBe(true);
    for (const piece of keep) expect(after).toContain(piece);
    expect(after).not.toContain('OLD TEXT');
    expect(after).toContain('**Core**');
  });
  it('changes no byte on a second run', () => {
    const first = fill(mini, template('shape=tree show=statement,fields,conditions,tests,links')).files[0];
    expect(first.changed).toBe(true);
    const second = fill(mini, first.text);
    expect(second.files[0].text).toBe(first.text);
    expect(second.files[0].changed).toBe(false);
    expect(second.findings).toEqual([]);
  });
  it('gives the same text for two runs, orders the nodes in a stable way and holds no time', () => {
    const t = template('shape=table kinds=item sort=kind');
    const a = fill(mini, t).files[0].text;
    expect(fill(mini, t).files[0].text).toBe(a);
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}/);
    expect(anchors(a)).toEqual(['item-a', 'item-b', 'item-c']);
  });
  it('starts each filled section with the generator line, with no version', () => {
    const text = fill(mini, template('shape=list kinds=area')).files[0].text;
    expect(text).toContain(`-->\n${HEADER}\n\n- `);
    const empty = fill(mini, template('shape=list lifecycle=nope')).files[0].text;
    expect(empty).toContain(`${HEADER}\n<!-- semspec:end -->`);
  });
  it('accepts a header with a version from an older run as the same header', () => {
    const fresh = fill(mini, template('shape=list kinds=area')).files[0].text;
    const old = fresh.replace('generated by semspec;', 'generated by semspec 0.1.0;');
    const r = fill(mini, old);
    expect(r.findings).toEqual([]);
    expect(r.files[0].text).toBe(old);
  });
  it('names the line of an unknown option', () => {
    const r = errorsOf(mini, `a\nb\n<!-- semspec:section shape=list colour=red -->\n<!-- semspec:end -->\n`);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ file: '/work/doc.md', line: 3 });
    expect(r[0].message).toContain('Unknown option "colour"');
  });
  it('names the line of an unknown node id', () => {
    const r = errorsOf(mini, `\n\n\n<!-- semspec:node id=item-zzz -->\n<!-- semspec:end -->\n`);
    expect(r[0]).toMatchObject({ line: 4 });
    expect(r[0].message).toContain('Unknown node id "item-zzz"');
    const scope = errorsOf(mini, `<!-- semspec:section shape=tree scope=nope -->\n<!-- semspec:end -->\n`);
    expect(scope[0].message).toContain('"nope"');
  });
  it('names the line of a marker that is not closed', () => {
    const r = errorsOf(mini, `a\n\n<!-- semspec:section shape=list -->\ntext\n`);
    expect(r).toEqual([expect.objectContaining({ line: 3, message: 'The marker is not closed. Add the end marker.' })]);
  });
  it('names the line of a nested marker and of an end marker without a start', () => {
    const nested = errorsOf(mini, `<!-- semspec:section shape=list -->\n\n<!-- semspec:section shape=table -->\n<!-- semspec:end -->\n`);
    expect(nested[0]).toMatchObject({ line: 3 });
    expect(nested[0].message).toContain('line 1');
    const stray = errorsOf(mini, `a\nb\nc\n<!-- semspec:end -->\n`);
    expect(stray[0]).toMatchObject({ line: 4, message: 'The end marker has no start marker.' });
    const bad = errorsOf(mini, `<!-- semspec:section shape -->\n<!-- semspec:end -->\n`);
    expect(bad[0]).toMatchObject({ line: 1 });
  });
  it('writes nothing and prints the file and the line of an error', async () => {
    const dir = temp();
    const file = join(dir, 'a.md');
    const original = 'x\n<!-- semspec:section shape=list colour=red -->\n<!-- semspec:end -->\n';
    writeFileSync(file, original);
    const r = await cli(['spec', '--workspace', workspacePath, file]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`${file}:2: Unknown option "colour"`);
    expect(readFileSync(file, 'utf8')).toBe(original);
  });
  it('inserts 1 node with a node marker', () => {
    const r = fill(mini, 'Before.\n\n<!-- semspec:node id=item-b show=statement,fields level=3 -->\n<!-- semspec:end -->\n\nAfter.\n');
    expect(r.findings.filter((f) => f.code === 'error')).toEqual([]);
    expect(r.files[0].text).toBe(
      `Before.\n\n<!-- semspec:node id=item-b show=statement,fields level=3 -->\n${HEADER}\n\n### <a id="item-b"></a>Beta\n\nThe beta item.\n\n- Kind: Item\n- Id: \`item-b\`\n- Lifecycle: live\n- State of work: Done\n- Priority: Low\n- rank: 2\n<!-- semspec:end -->\n\nAfter.\n`,
    );
    const many = fill(mini, '<!-- semspec:node id=area-core -->\n<!-- semspec:end -->\n').files[0].text;
    expect(anchors(many)).toEqual(['area-core']);
    expect(errorsOf(mini, '<!-- semspec:node shape=list -->\n<!-- semspec:end -->\n').map((e) => e.message)).toEqual(['The option "shape" is not an option of a node marker. The options are: id, graph, show, level, conditions.', 'The node marker needs the option id.']);
  });
});

describe('select', () => {
  it('selects by kinds, lifecycle, status roll-up, priority and a field filter', () => {
    expect(anchors(body(mini, 'shape=list kinds=item'))).toEqual(['item-a', 'item-b', 'item-c']);
    expect(anchors(body(mini, 'shape=list lifecycle=old'))).toEqual(['area-edge']);
    expect(anchors(body(mini, 'shape=list kinds=item status=done'))).toEqual(['item-b']);
    expect(anchors(body(mini, 'shape=list kinds=item status="Partly done"'))).toEqual(['item-a', 'item-c']);
    expect(anchors(body(mini, 'shape=list kinds=item prio=hi'))).toEqual(['item-a']);
    expect(anchors(body(mini, 'shape=list kinds=item prio=High'))).toEqual(['item-a']);
    expect(anchors(body(mini, 'shape=list kinds=item tags=x'))).toEqual(['item-a']);
    expect(anchors(body(mini, 'shape=list kinds=item priority=1'))).toEqual(['item-a', 'item-c']);
    expect(anchors(body(shop, 'shape=list kinds=story priority=high'))).toEqual(['story-pay-by-card']);
    expect(anchors(body(shop, 'shape=list kinds=story lifecycle=active'))).toEqual(['story-search-synonyms']);
    expect(anchors(body(shop, 'shape=list kinds=story status=pass'))).toEqual(['story-save-card']);
    expect(anchors(body(shop, 'shape=list kinds=story teams=payments'))).toEqual(['story-pay-by-card', 'story-save-card']);
  });
  it('selects by scope with depth and by ids', () => {
    expect(anchors(body(mini, 'shape=list scope=area-core'))).toEqual(['area-core', 'item-a', 'item-b']);
    expect(anchors(body(mini, 'shape=list scope=area-core self=no'))).toEqual(['item-a', 'item-b']);
    expect(anchors(body(mini, 'shape=list scope=area-core depth=0'))).toEqual(['area-core']);
    expect(anchors(body(shop, 'shape=list scope=prd-shop depth=1'))).toEqual(['prd-shop', 'epic-checkout', 'epic-search']);
    expect(anchors(body(mini, 'shape=list ids=item-c,area-core sort=ids'))).toEqual(['item-c', 'area-core']);
    expect(anchors(body(mini, 'shape=list ids=note-1'))).toEqual(['note-1']);
  });
  it('selects the nodes of the named graph of a workspace', () => {
    expect(anchors(body(shop, 'shape=list kinds=zone graph=domain'))).toEqual(['zone-central', 'zone-coast', 'zone-north']);
    expect(anchors(body(shop, 'shape=list kinds=epic'))).toEqual(['epic-checkout', 'epic-search']);
    const r = errorsOf(shop, template('shape=list graph=missing'));
    expect(r[0].message).toBe('Unknown graph "missing". The graphs are: req, domain.');
  });
  it('rejects a value that the profile does not know', () => {
    expect(errorsOf(mini, template('kinds=wizard'))[0].message).toContain('unknown kind "wizard"');
    expect(errorsOf(mini, template('status=late'))[0].message).toContain('The values are: done, part, todo.');
    expect(errorsOf(music, template('priority=1'))[0].message).toContain('Unknown option "priority"');
    expect(errorsOf(mini, template('shape=circle'))[0].message).toContain('The values are: tree, list, table, traceability, glossary, gaps.');
  });
});

describe('shapes', () => {
  it('writes a tree with the headings in tree order', () => {
    expect(body(mini, 'shape=tree scope=area-core')).toBe(
      [
        '## <a id="area-core"></a>Core',
        'The core area.',
        '### <a id="item-a"></a>Alpha',
        'Does \\*a\\* \\| b &lt;!-- semspec:end --&gt; now.',
        'Second paragraph.',
        '**Steps**',
        '- <a id="item-a#s1"></a>`s1` (Done): First step\n- <a id="item-a#s2"></a>`s2` (To do): Second step',
        '### <a id="item-b"></a>Beta',
        'The beta item.',
        '**Steps**',
        '- <a id="item-b#s1"></a>`s1` (Done): Only step',
      ].join('\n\n'),
    );
    expect(anchors(body(mini, 'shape=tree'))).toEqual(['area-core', 'item-a', 'item-a#s1', 'item-a#s2', 'item-b', 'item-b#s1', 'area-edge', 'item-c', 'item-c#g1']);
    expect(anchors(body(shop, 'shape=tree scope=epic-checkout self=no show=statement'))).toEqual(['story-pay-by-card', 'story-pay-by-card-3ds', 'story-save-card']);
  });
  it('writes a list', () => {
    expect(body(mini, 'shape=list ids=item-b,note-1 kinds=item,note')).toBe('- <a id="item-b"></a>**Beta**: The beta item.\n- <a id="note-1"></a>**Note one**: A note.');
    expect(body(music, 'shape=list kinds=term')).toContain('- <a id="beat"></a>**Beat**: The steady pulse of a piece.');
  });
  it('writes a table', () => {
    expect(body(mini, 'shape=table kinds=item')).toBe(
      [
        '| Id | Title | Kind | Lifecycle | State of work |',
        '| --- | --- | --- | --- | --- |',
        '| <a id="item-a"></a>`item-a` | Alpha | Item | live | Partly done |',
        '| <a id="item-b"></a>`item-b` | Beta | Item | live | Done |',
        '| <a id="item-c"></a>`item-c` | Gamma | Item | live | Partly done |',
      ].join('\n'),
    );
    const t = body(music, 'shape=table kinds=term columns=title,origin sort=id');
    expect(t).toContain('| Title | Origin |');
    expect(t).toContain('| <a id="chord"></a>Chord | Area: Harmony; House note |');
  });
  it('writes a traceability table with the words of the profile', () => {
    expect(body(mini, 'shape=traceability scope=area-core')).toBe(
      [
        '| Item | Step | State of work | Runs |',
        '| --- | --- | --- | --- |',
        '| <a id="item-a"></a>Alpha | `s1` First step | Done | Runs the first step |',
        '| Alpha | `s2` Second step | To do | No run. |',
        '| <a id="item-b"></a>Beta | `s1` Only step | Done | Runs the only step |',
      ].join('\n'),
    );
    const t = body(shop, 'shape=traceability scope=story-pay-by-card');
    expect(t).toBe(
      [
        '| Story | Scenario | Result | Tests |',
        '| --- | --- | --- | --- |',
        '| <a id="story-pay-by-card"></a>Pay by card | `declined` A declined card shows a message. | Pass | Shows decline message |',
        '| Pay by card | `charged` A valid card is charged once. | Fail | No test. |',
      ].join('\n'),
    );
    expect(body(music, 'shape=traceability')).toBe('');
  });
  it('writes a glossary with the definitions, the synonyms and the coded labels', () => {
    expect(body(mini, 'shape=glossary kinds=item ids=item-a,item-b')).toBe(
      [
        '## <a id="item-a"></a>Alpha',
        'Does \\*a\\* \\| b &lt;!-- semspec:end --&gt; now.\n\nSecond paragraph.\n\nAlso called: First, Alpha one',
        '## <a id="item-b"></a>Beta',
        'The beta item.',
      ].join('\n\n'),
    );
    const g = body(music, 'shape=glossary kinds=term');
    expect(anchors(g)).toEqual(['beat', 'chord', 'fermata', 'scale', 'tempo']);
    expect(g).toContain('## <a id="tempo"></a>Tempo\n\nThe speed of the beat.');
    expect(body(mini, 'shape=glossary vocabulary=prio')).toBe('## <a id="prio.hi"></a>High\n\n- Code: `hi`\n\n## <a id="prio.lo"></a>Low\n\n- Code: `lo`');
    expect(errorsOf(mini, template('shape=glossary vocabulary=nope'))[0].message).toBe('Unknown vocabulary "nope" in the graph "graph".');
  });
  it('writes the gaps: the status that is not good, the missing checks and the missing deliverables', () => {
    expect(body(mini, 'shape=gaps scope=area-core kinds=step')).toBe(
      ['## State of work is not Done', '- `item-a#s2` (To do): Second step', '## Without runs', '- `item-a#s2`: Second step'].join('\n\n'),
    );
  });
  it('writes the missing deliverables', () => {
    const graph = { nodes: [...miniGraph.nodes, { id: 'item-d', kind: 'item', title: 'Delta', areas: ['area-core'] }] };
    const more = indexGraphs([{ id: 'graph', label: 'Mini', model: buildModel(graph, miniProfile as never) }]);
    expect(body(more, 'shape=gaps ids=item-d')).toContain('## Missing deliverables\n\n- `item-d`: The item "Delta" has 0 part(s). It needs at least 1.');
  });
});

describe('options', () => {
  it('shows the parts that show names', () => {
    const one = body(mini, 'shape=tree ids=item-a show=fields,links,provenance');
    expect(one).toBe(
      [
        '## <a id="item-a"></a>Alpha',
        [
          '- Kind: Item',
          '- Id: `item-a`',
          '- Lifecycle: live',
          '- State of work: Partly done',
          '- Priority: High',
          '- Tag: Ex, y',
          '- rank: 1',
          '- aka: First, Alpha one',
          '- About: Note one (`note-1`)',
          '- Provenance: Told by a person',
          '- Source: a book',
        ].join('\n'),
      ].join('\n\n'),
    );
    const tests = body(mini, 'shape=tree ids=item-a show=conditions,tests');
    expect(tests).toContain('- <a id="item-a#s1"></a>`s1` (Done): First step\n  - Runs: Runs the first step\n- <a id="item-a#s2"></a>`s2` (To do): Second step\n  - Runs: No run.');
    expect(body(mini, 'shape=tree ids=item-a show=statement')).not.toContain('Steps');
    expect(body(shop, 'shape=tree ids=story-pay-by-card show=crosslinks')).toBe(
      '## <a id="story-pay-by-card"></a>Pay by card\n\n- Concerns: Card payment (`pay-card`), Payvale (`prov-payvale`), Tillpay (`prov-tillpay`), Quillpay (`prov-quillpay`)',
    );
    expect(errorsOf(mini, template('shape=tree show=colours'))[0].message).toContain('The values are: statement, fields, conditions, tests, links, crosslinks, provenance.');
  });
  it('limits a tree with depth and sorts the nodes with sort', () => {
    expect(anchors(body(shop, 'shape=tree scope=prd-shop depth=1 show=statement'))).toEqual(['prd-shop', 'epic-checkout', 'epic-search']);
    expect(anchors(body(shop, 'shape=tree scope=prd-shop depth=0 show=statement'))).toEqual(['prd-shop']);
    expect(anchors(body(mini, 'shape=list kinds=item sort=title'))).toEqual(['item-a', 'item-b', 'item-c']);
    expect(anchors(body(mini, 'shape=list kinds=item sort=id'))).toEqual(['item-a', 'item-b', 'item-c']);
    expect(anchors(body(mini, 'shape=list kinds=item,area sort=kind'))).toEqual(['area-core', 'area-edge', 'item-a', 'item-b', 'item-c']);
    expect(anchors(body(mini, 'shape=list kinds=item sort=status'))).toEqual(['item-b', 'item-a', 'item-c']);
    expect(anchors(body(shop, 'shape=list kinds=story sort=id lifecycle=planned'))).toEqual(['story-loose', 'story-pay-by-card', 'story-pay-by-card-3ds', 'story-save-card']);
  });
  it('sets the heading level of the first heading', () => {
    const h = (level: string) => body(mini, `shape=tree scope=area-core show=statement level=${level}`).split('\n').filter((l) => l.startsWith('#')).map((l) => l.split(' ')[0]);
    expect(h('1')).toEqual(['#', '##', '##']);
    expect(h('3')).toEqual(['###', '####', '####']);
    expect(h('6')).toEqual(['######', '######', '######']);
    expect(body(mini, 'shape=gaps scope=item-a kinds=step level=4').startsWith('#### ')).toBe(true);
    expect(errorsOf(mini, template('level=7'))[0].message).toContain('from 1 to 6');
  });
  it('writes the empty text for an empty selection', () => {
    expect(body(mini, 'shape=list kinds=note lifecycle=old empty="No note, as yet."')).toBe('No note, as yet.');
    expect(body(mini, 'shape=table kinds=note lifecycle=old')).toBe('');
    expect(body(mini, 'shape=gaps ids=item-b empty="Nothing is open."')).toContain('## ');
    expect(body(mini, 'shape=gaps ids=note-1 kinds=note empty="Nothing is open." status=done')).toBe('Nothing is open.');
  });
  it('shows vocabulary labels for coded values and the labels of kinds and edges', () => {
    const t = body(mini, 'shape=table kinds=item columns=title,prio,kind,status');
    expect(t).toContain('| <a id="item-a"></a>Alpha | High | Item | Partly done |');
    expect(t).toContain('| Title | Priority | Kind | State of work |');
    expect(body(shop, 'shape=list kinds=story ids=story-pay-by-card show=links,fields')).toContain('- Complies with: Card Data Standard Clause 3(a) (`std-card-data`)');
    expect(body(music, 'shape=table kinds=term columns=title,lifecycle sort=id')).toContain('| <a id="beat"></a>Beat | Draft |');
    expect(body(shop, 'shape=tree ids=story-pay-by-card show=fields')).toContain('- Team: payments, Web shop');
  });
  it('puts an anchor with the node id in each heading and links to it inside the document', () => {
    const text = '# Doc\n\n<!-- semspec:section shape=tree scope=area-core show=links -->\n<!-- semspec:end -->\n\n<!-- semspec:section shape=gaps scope=area-core kinds=step -->\n<!-- semspec:end -->\n\n<!-- semspec:section shape=list ids=note-1 -->\n<!-- semspec:end -->\n';
    const out = fill(mini, text).files[0].text;
    expect(out).toContain('## <a id="area-core"></a>Core');
    expect(out).toContain('### <a id="item-a"></a>Alpha');
    expect(out).toContain('- About: [Note one](#note-1)');
    expect(out).toContain('- [`item-a#s2`](#item-a) (To do): Second step');
    const parts = fill(mini, template('shape=tree ids=item-a show=conditions')).files[0].text;
    expect(parts).toContain('<a id="item-a#s1"></a>`s1`');
  });
  it('links to the generated document of another graph and writes plain text otherwise', () => {
    const docs = [
      { path: '/work/a/story.md', text: '<!-- semspec:section shape=tree ids=story-pay-by-card show=crosslinks -->\n<!-- semspec:end -->\n' },
      { path: '/work/b/glossary.md', text: '<!-- semspec:section shape=glossary graph=domain ids=pay-card,prov-payvale -->\n<!-- semspec:end -->\n' },
    ];
    const r = fillSpecs(shop, docs);
    expect(r.findings.filter((f) => f.code === 'error')).toEqual([]);
    expect(r.files[0].text).toContain('- Concerns: [Card payment](../b/glossary.md#pay-card), [Payvale](../b/glossary.md#prov-payvale), Tillpay (`prov-tillpay`), Quillpay (`prov-quillpay`)');
    const alone = fillSpecs(shop, [docs[0]]);
    expect(alone.files[0].text).toContain('- Concerns: Card payment (`pay-card`), Payvale (`prov-payvale`), Tillpay (`prov-tillpay`), Quillpay (`prov-quillpay`)');
  });
  it('sets the columns of a table and of a traceability table', () => {
    expect(body(mini, 'shape=table kinds=item columns=id,rank')).toBe(
      ['| Id | rank |', '| --- | --- |', '| <a id="item-a"></a>`item-a` | 1 |', '| <a id="item-b"></a>`item-b` | 2 |', '| <a id="item-c"></a>`item-c` | 1 |'].join('\n'),
    );
    const t = body(mini, 'shape=traceability ids=item-b columns=status,key,id,tests');
    expect(t).toBe(['| State of work | Step id | Id | Runs |', '| --- | --- | --- | --- |', '| <a id="item-b"></a>Done | `s1` | `item-b` | Runs the only step |'].join('\n'));
    expect(errorsOf(mini, template('shape=traceability columns=colour'))[0].message).toContain('The names are: requirement, id, condition, key, status, tests.');
  });
  it('cuts a long cell with an ellipsis, in 1 line, and escapes pipes and Markdown', () => {
    const t = body(mini, 'shape=table ids=item-c columns=id,title');
    expect(t.split('\n')).toHaveLength(3);
    const long = body(mini, 'shape=traceability ids=item-c').split('\n')[2];
    expect(long).toMatch(/word… \| Partly done \| No run\. \|$/);
    const a = body(mini, 'shape=table ids=item-a columns=statement');
    expect(a.split('\n')[2]).toBe('| <a id="item-a"></a>Does \\*a\\* \\| b &lt;!-- semspec:end --&gt; now. Second paragraph. |');
  });
  it('shows the acceptance conditions as a list or as a table', () => {
    const list = body(mini, 'shape=list ids=item-b show=conditions,tests conditions=list');
    expect(list).toBe(['- <a id="item-b"></a>**Beta**', '  - **Steps**', '    - <a id="item-b#s1"></a>`s1` (Done): Only step', '      - Runs: Runs the only step'].join('\n'));
    const table = body(mini, 'shape=tree ids=item-b show=conditions,tests conditions=table');
    expect(table).toBe(['## <a id="item-b"></a>Beta', '**Steps**', ['| Id | Step | State of work | Runs |', '| --- | --- | --- | --- |', '| <a id="item-b#s1"></a>`s1` | Only step | Done | Runs the only step |'].join('\n')].join('\n\n'));
    expect(errorsOf(mini, template('conditions=grid'))[0].message).toContain('The values are: list, table.');
  });
  it('names the node and the graph in the error of an unknown id', () => {
    expect(errorsOf(mini, '<!-- semspec:section shape=list ids=zzz -->\n<!-- semspec:end -->\n')[0].message).toBe('Unknown node id "zzz" in the graph "graph".');
  });
});

describe('presets', () => {
  it('accepts the spec key in a profile and rejects an unknown option in a preset', () => {
    expect(validateProfile(JSON.parse(JSON.stringify(miniProfile)))).toEqual([]);
    const bad = (spec: unknown) => validateProfile(JSON.parse(JSON.stringify({ ...miniProfile, spec })));
    expect(bad({ presets: { x: { colour: 'red' } } })[0]).toContain('profile spec preset "x" has the unknown option "colour"');
    expect(bad({ presets: { x: { use: 'open' } } })[0]).toContain('unknown option "use"');
    expect(bad({ presets: { x: { shape: 'circle' } } })[0]).toContain('preset "x": The option "shape" has the value "circle"');
    expect(bad({ presets: { x: { kinds: ['wizard'] } } })[0]).toContain('unknown kind "wizard"');
    expect(bad({ roots: ['wizard'] })).toEqual(['profile spec roots names the unknown kind "wizard"']);
    expect(bad({ roots: 'area' })[0]).toContain('profile/spec/roots');
    expect(bad({ presets: { x: { depth: { a: 1 } } } }).length).toBeGreaterThan(0);
    expect(profileSpecProblems(buildModel(miniGraph, miniProfile as never).profile)).toEqual([]);
  });
  it('uses the options of a preset, and the options of the marker win', () => {
    // The muted area has no status in the roll-up.
    expect(anchors(body(mini, 'use=open'))).toEqual(['area-core', 'item-a', 'item-c']);
    expect(body(mini, 'use=open kinds=item columns=title')).toBe('| Title |\n| --- |\n| <a id="item-a"></a>Alpha |\n| <a id="item-c"></a>Gamma |');
    expect(body(mini, 'use=open kinds=item')).toBe(['| Id | Title | State of work |', '| --- | --- | --- |', '| <a id="item-a"></a>`item-a` | Alpha | Partly done |', '| <a id="item-c"></a>`item-c` | Gamma | Partly done |'].join('\n'));
    const h = (o: string) => body(mini, o).split('\n').find((l) => l.startsWith('#'))!.split(' ')[0];
    expect(h('use=wide scope=item-b')).toBe('###');
    expect(h('use=wide scope=item-b level=4')).toBe('####');
    expect(body(mini, 'use=wide scope=item-b')).not.toContain('Steps');
    expect(body(mini, 'use=wide scope=item-b show=conditions')).toContain('Steps');
  });
  it('names the line of an unknown preset', () => {
    const r = errorsOf(mini, 'a\nb\n<!-- semspec:section use=nope -->\n<!-- semspec:end -->\n');
    expect(r).toEqual([expect.objectContaining({ line: 3, message: 'Unknown preset "nope". The presets are: open, wide.' })]);
    expect(errorsOf(shop, template('use=nope'))[0].message).toBe('Unknown preset "nope". The profile has no preset.');
  });
});

describe('the files of the command', () => {
  // Writes the small profile and graph as files, so a test can change the graph.
  function project() {
    const dir = temp();
    writeFileSync(join(dir, 'profile.json'), JSON.stringify(miniProfile));
    writeFileSync(join(dir, 'graph.json'), JSON.stringify(miniGraph));
    return { dir, args: ['--graph', join(dir, 'graph.json'), '--profile', join(dir, 'profile.json')] };
  }
  const intro = '# Spec\n\nAuthor text.   \n\n<!-- semspec:section shape=traceability scope=area-core -->\n<!-- semspec:end -->\n\nMore author text.\n\n<!-- semspec:section shape=table kinds=item columns=id,title -->\n<!-- semspec:end -->\n';

  it('fills the templates in place and keeps the author text', async () => {
    const { dir, args } = project();
    const a = join(dir, 'a.md');
    const b = join(dir, 'b.md');
    writeFileSync(a, intro);
    writeFileSync(b, 'No marker here.\n');
    const r = await cli(['spec', ...args, a, b]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('wrote 1 file(s)');
    const text = readFileSync(a, 'utf8');
    expect(text.startsWith('# Spec\n\nAuthor text.   \n\n<!-- semspec:section shape=traceability scope=area-core -->\n<!-- generated by semspec; ')).toBe(true);
    expect(text).toContain('| Item | Step | State of work | Runs |');
    expect(text).toContain('<!-- semspec:end -->\n\nMore author text.\n');
    expect(readFileSync(b, 'utf8')).toBe('No marker here.\n');
    const again = await cli(['spec', ...args, a, b]);
    expect(again.out).toBe('No change in 2 file(s).');
    expect(readFileSync(a, 'utf8')).toBe(text);
  });
  it('fails a stale section, names the file and the section, and writes nothing', async () => {
    const { dir, args } = project();
    const a = join(dir, 'a.md');
    writeFileSync(a, intro);
    expect((await cli(['spec', ...args, a])).code).toBe(0);
    const graph = JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8'));
    graph.nodes.find((n: { id: string }) => n.id === 'item-b').title = 'Beta renamed';
    writeFileSync(join(dir, 'graph.json'), JSON.stringify(graph));
    const before = readFileSync(a, 'utf8');
    const r = await cli(['spec', ...args, a, '--check']);
    expect(r.code).toBe(1);
    expect(r.out.split('\n')).toEqual([
      `${a}:5: The section shape=traceability scope=area-core at line 5 differs from the graph. It is stale or an author changed it.`,
      `${a}:17: The section shape=table kinds=item columns=id,title at line 17 differs from the graph. It is stale or an author changed it.`,
    ]);
    expect(readFileSync(a, 'utf8')).toBe(before);
    expect((await cli(['spec', ...args, a])).code).toBe(0);
    expect((await cli(['spec', ...args, a, '--check'])).code).toBe(0);
  });
  it('fails a section that an author changed by hand', async () => {
    const { dir, args } = project();
    const a = join(dir, 'a.md');
    writeFileSync(a, intro);
    await cli(['spec', ...args, a]);
    writeFileSync(a, readFileSync(a, 'utf8').replace('| `s1` First step', '| `s1` First step, edited'));
    const r = await cli(['spec', ...args, a, '--check', '--json']);
    expect(r.code).toBe(1);
    const json = JSON.parse(r.out);
    expect(json.ok).toBe(false);
    expect(json.findings).toEqual([expect.objectContaining({ code: 'stale', file: a, line: 5, section: 'section shape=traceability scope=area-core' })]);
    expect(readFileSync(a, 'utf8')).toContain('First step, edited');
  });
  it('exits with 0 on up-to-date files and changes no file', async () => {
    const { dir, args } = project();
    const a = join(dir, 'a.md');
    writeFileSync(a, intro);
    await cli(['spec', ...args, a]);
    const before = { text: readFileSync(a, 'utf8'), time: statSync(a).mtimeMs };
    const r = await cli(['spec', ...args, a, '--check']);
    expect(r).toMatchObject({ code: 0, out: 'All 2 section(s) in 1 file(s) match the graph.' });
    expect({ text: readFileSync(a, 'utf8'), time: statSync(a).mtimeMs }).toEqual(before);
    const json = JSON.parse((await cli(['spec', ...args, a, '--check', '--json'])).out);
    expect(json).toEqual({ ok: true, findings: [], written: [], sections: 2 });
  });
  it('does not write a file on --check even when it is stale', async () => {
    const { dir, args } = project();
    const a = join(dir, 'a.md');
    writeFileSync(a, intro);
    const r = await cli(['spec', ...args, a, '--check']);
    expect(r.code).toBe(1);
    expect(readFileSync(a, 'utf8')).toBe(intro);
  });
  it('shows the usage on a wrong use and exits with 2', async () => {
    const { dir, args } = project();
    expect((await cli(['spec', ...args])).code).toBe(2);
    expect((await cli(['spec', ...args, '--out', dir, join(dir, 'a.md')])).code).toBe(2);
    expect((await cli(['spec', '--out', dir])).code).toBe(2);
    expect((await cli(['spec', ...args, '--colour', 'red', 'a.md'])).code).toBe(2);
    expect((await cli(['spec', ...args, '--roots', 'area', join(dir, 'a.md')])).code).toBe(2);
    const missing = await cli(['spec', ...args, join(dir, 'missing.md')]);
    expect(missing.code).toBe(1);
    expect(missing.out).toContain('missing.md:1: The file');
  });
});

describe('default documents', () => {
  const files = (dir: string) => readdirSync(dir).sort();

  it('writes 1 file for each root node of the kinds of the profile, with a tree and a traceability section', async () => {
    const dir = temp();
    writeFileSync(join(dir, 'profile.json'), JSON.stringify(miniProfile));
    writeFileSync(join(dir, 'graph.json'), JSON.stringify(miniGraph));
    const out = join(dir, 'out');
    const args = ['--graph', join(dir, 'graph.json'), '--profile', join(dir, 'profile.json'), '--out', out];
    const r = await cli(['spec', ...args]);
    expect(r.code).toBe(0);
    expect(files(out)).toEqual(['area-core.md', 'area-edge.md']);
    const text = readFileSync(join(out, 'area-core.md'), 'utf8');
    expect(text.startsWith('# Core\n\n_Write a short introduction here._\n\n<!-- semspec:section shape=tree scope=area-core self=no level=2 -->\n<!-- generated by semspec; ')).toBe(true);
    expect(text).toContain('## <a id="item-a"></a>Alpha');
    expect(text).not.toContain('<a id="area-core"></a>');
    expect(text).toContain('\n\n## Traceability\n\n<!-- semspec:section shape=traceability scope=area-core -->\n');
    expect(text).toContain('| <a id="item-b"></a>Beta | `s1` Only step | Done | Runs the only step |');
    const roots = join(dir, 'roots');
    expect((await cli(['spec', '--graph', join(dir, 'graph.json'), '--profile', join(dir, 'profile.json'), '--out', roots, '--roots', 'item'])).code).toBe(0);
    expect(files(roots)).toEqual(['item-a.md', 'item-b.md', 'item-c.md']);
    const none = await cli(['spec', ...args.slice(0, 4), '--out', join(dir, 'none'), '--roots', 'note']);
    expect(none.code).toBe(0);
    expect(files(join(dir, 'none'))).toEqual(['note-1.md']);
  });
  it('is a template with generated sections, so a second run and --check pass and the author text stays', async () => {
    const dir = temp();
    const out = join(dir, 'out');
    const args = ['spec', '--workspace', workspacePath, '--out', out, '--roots', 'product'];
    expect((await cli(args)).code).toBe(0);
    const file = join(out, 'prd-shop.md');
    const first = readFileSync(file, 'utf8');
    expect((await cli([...args, '--check'])).code).toBe(0);
    expect((await cli(args)).out).toBe('No change in 1 file(s).');
    expect(readFileSync(file, 'utf8')).toBe(first);
    writeFileSync(file, first.replace('_Write a short introduction here._', 'The shop, in my words.'));
    expect((await cli(args)).code).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(first.replace('_Write a short introduction here._', 'The shop, in my words.'));
    expect((await cli([...args, '--check'])).code).toBe(0);
  });
  it('writes a glossary document, and cross links from other documents point to its anchors', async () => {
    const dir = temp();
    const out = join(dir, 'out');
    const args = ['spec', '--workspace', workspacePath, '--out', out, '--roots', 'product', '--glossary', 'domain'];
    expect((await cli(args)).code).toBe(0);
    expect(files(out)).toEqual(['glossary-domain.md', 'prd-shop.md']);
    const glossary = readFileSync(join(out, 'glossary-domain.md'), 'utf8');
    expect(glossary.startsWith('# Glossary of Retail market\n\n_Write a short introduction here._\n\n<!-- semspec:section graph=domain shape=glossary level=2 -->\n')).toBe(true);
    expect(glossary).toContain('## <a id="pay-card"></a>Card payment\n\nThe buyer pays with a card at once.');
    const shopFile = join(out, 'prd-shop.md');
    writeFileSync(shopFile, readFileSync(shopFile, 'utf8').replace('shape=tree', 'shape=tree show=statement,crosslinks'));
    expect((await cli(args)).code).toBe(0);
    const text = readFileSync(shopFile, 'utf8');
    expect(text).toContain('- Concerns: [Card payment](glossary-domain.md#pay-card), [Payvale](glossary-domain.md#prov-payvale)');
    expect((await cli([...args, '--check'])).code).toBe(0);
    const stray = await cli(['spec', '--workspace', workspacePath, '--out', join(dir, 'x'), '--glossary', 'nope']);
    expect(stray.code).toBe(1);
    expect(stray.err).toContain('Unknown graph "nope"');
  });
  it('names the documents in a stable way, with the graph as a prefix on a clash', () => {
    const profile = { ...miniProfile, spec: { roots: ['area'] } };
    const g = (id: string) => ({ id, label: id.toUpperCase(), model: buildModel(miniGraph, profile as never) });
    const names = defaultDocuments(indexGraphs([g('one'), g('two')]), { glossary: 'two' }).map((d) => d.name);
    expect(names).toEqual(['area-core.md', 'area-edge.md', 'two-area-core.md', 'two-area-edge.md', 'glossary-two.md']);
    expect(defaultDocuments(mini).map((d) => d.name)).toEqual(['area-core.md', 'area-edge.md']);
    expect(() => defaultDocuments(mini, { glossary: 'zzz' })).toThrow('Unknown graph "zzz"');
  });
});

describe('the text of a section', () => {
  it('keeps the line breaks of a template with CRLF', () => {
    const crlf = template('shape=list kinds=area').replace(/\n/g, '\r\n');
    const first = fill(mini, crlf).files[0].text;
    expect(first.replace(/\r\n/g, '')).not.toContain('\n');
    expect(first).toContain('**Core**');
    expect(fill(mini, first).files[0].changed).toBe(false);
  });
  it('escapes Markdown characters and table pipes in values', () => {
    expect(escapeMd('a*b_c`d[e]f<g>h&i|j~k\\')).toBe('a\\*b\\_c\\`d\\[e\\]f&lt;g&gt;h&amp;i\\|j\\~k\\\\');
    const graph = { nodes: [{ id: 'area-x', kind: 'area', title: '# Head | pipe <b>', text: '1. one\n- two' }] };
    const odd = indexGraphs([{ id: 'graph', label: 'Mini', model: buildModel(graph, miniProfile as never) }]);
    expect(body(odd, 'shape=tree')).toBe('## <a id="area-x"></a># Head \\| pipe &lt;b&gt;\n\n\\1. one - two');
    expect(body(odd, 'shape=table columns=title,statement')).toContain('| <a id="area-x"></a># Head \\| pipe &lt;b&gt; | 1. one - two |');
  });
});

describe('the documents of this repository', () => {
  it('shows the spec check in the guide for gates and in the workflow of the repository', () => {
    const guide = readFileSync(`${repo}docs/guide/gates.md`, 'utf8');
    expect(guide).toContain('## Spec check in CI');
    expect(guide).toContain('semspec spec --graph requirements/graph --profile requirements/profile.yaml docs/requirements.md --check');
    const workflow = readFileSync(`${repo}.github/workflows/check.yml`, 'utf8');
    expect(workflow).toContain('node bin/semspec.js spec --graph requirements/graph --profile requirements/profile.yaml docs/reference/requirements.md --check');
  });
  it('keeps docs/reference/requirements.md in step with the requirements', () => {
    const path = `${repo}docs/reference/requirements.md`;
    const text = readFileSync(path, 'utf8');
    const r = fillSpecs(reqs, [{ path, text }]);
    expect(r.findings).toEqual([]);
    expect(r.sections).toBeGreaterThan(1);
  });
});
