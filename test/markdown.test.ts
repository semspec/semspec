// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the Markdown pages in a graph folder. Each test runs for 2 profiles with other names.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import { buildModel, kindSchemas, type Profile } from '@core/index';
import { loadInputs, loadProfile, run } from '../src/cli/index';
import { validateProfile } from '../src/cli/validate';

const made: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-'));
  made.push(dir);
  return dir;
};
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

const fixture = (file: string) => new URL(`../fixtures/notes/${file}`, import.meta.url).pathname;

// The names that differ between the 2 profiles.
interface Names {
  label: string;
  profile: Profile;
  nodes: string;
  id: string;
  kind: string;
  body: string;
  guide: string;
  section: string;
  edge: string;
}

const fixtureProfile = JSON.parse(readFileSync(fixture('profile.json'), 'utf8')) as Profile;

// A second profile. It uses other names for the keys, the kinds and the body field.
const otherProfile = {
  project: 'Boat manual',
  source: { nodes: 'pages', id: 'slug', kind: 'type', defaultKind: 'article', markdown: { body: 'text' } },
  fields: { title: ['name'], statement: ['summary'] },
  lifecycle: { field: 'status', fallback: 'live' },
  kinds: [
    { id: 'chapter', label: 'Chapter', plural: 'chapters', role: 'hierarchy', color: { light: '#862e9c', dark: '#e599f7' }, chips: ['members'] },
    { id: 'article', label: 'Article', plural: 'articles', role: 'hierarchy', parents: [['partOf']], color: { light: '#d9480f', dark: '#ffa94d' }, chips: [] }
  ],
  edges: { partOf: { labels: ['Part of', 'Has part'], down: true, from: ['article'], to: ['chapter'] } },
  details: { textSections: [{ title: 'Text', field: 'text' }] }
} as unknown as Profile;

const NAMES: Names[] = [
  { label: 'the notes fixture profile', profile: fixtureProfile, nodes: 'nodes', id: 'id', kind: 'kind', body: 'body', guide: 'guide', section: 'section', edge: 'inSection' },
  { label: 'a profile with other names', profile: otherProfile, nodes: 'pages', id: 'slug', kind: 'type', body: 'text', guide: 'article', section: 'chapter', edge: 'partOf' }
];

// Writes a file below a folder and makes the sub-folders.
const put = (dir: string, rel: string, text: string) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const page = (front: unknown, body = '') => `---\n${typeof front === 'string' ? front : stringify(front)}---\n${body}`;
// Writes the profile to a file and returns its path.
const profileFile = (profile: unknown) => {
  const file = join(tmp(), 'profile.json');
  writeFileSync(file, JSON.stringify(profile));
  return file;
};
type Node = Record<string, unknown>;

describe.each(NAMES)('Markdown pages in a graph folder with $label', (n) => {
  const profilePath = profileFile(n.profile);
  const load = (dir: string, exclude: string[] = []) => loadInputs(dir, profilePath, exclude);
  const nodesOf = (dir: string, exclude: string[] = []) => load(dir, exclude).graph[n.nodes] as Node[];
  // A folder with 1 section and 1 guide that links to the section.
  const sample = () => {
    const dir = tmp();
    put(dir, 'sec.md', page({ [n.id]: 'sec-1', [n.kind]: n.section, title: 'Section 1' }));
    put(dir, 'a.md', page({ [n.id]: 'a-1', [n.kind]: n.guide, title: 'Page A', [n.edge]: ['sec-1'], order: 2 }, '\n\nFirst line.\n\nSecond line.\n\n'));
    return dir;
  };

  it('has a profile that passes the checks', () => {
    expect(validateProfile(n.profile)).toEqual([]);
  });

  it('reads a Markdown page with front matter as 1 node', () => {
    const list = nodesOf(sample());
    expect(list).toHaveLength(2);
    expect(list.find((x) => x[n.id] === 'a-1')).toMatchObject({ [n.id]: 'a-1', [n.kind]: n.guide, title: 'Page A', order: 2, [n.edge]: ['sec-1'] });
  });

  it('puts the trimmed text after the front matter in the body field', () => {
    const node = nodesOf(sample()).find((x) => x[n.id] === 'a-1')!;
    expect(node[n.body]).toBe('First line.\n\nSecond line.');
  });

  it('adds no body field for an empty body', () => {
    const node = nodesOf(sample()).find((x) => x[n.id] === 'sec-1')!;
    expect(n.body in node).toBe(false);
  });

  it('takes the id from the file name when the front matter has no id', () => {
    const dir = tmp();
    put(dir, 'deep/my-page.md', page({ [n.kind]: n.guide, title: 'My page' }, 'Text.'));
    expect(nodesOf(dir)[0]).toMatchObject({ [n.id]: 'my-page', title: 'My page', [n.body]: 'Text.' });
  });

  it('keeps the id of the front matter over the file name', () => {
    const dir = tmp();
    put(dir, 'file-name.md', page({ [n.id]: 'own-id', [n.kind]: n.guide }, 'Text.'));
    expect(nodesOf(dir)[0][n.id]).toBe('own-id');
  });

  it('reads Markdown files and YAML files together in sorted path order', () => {
    const dir = tmp();
    put(dir, 'b.md', page({ [n.id]: 'b' }));
    put(dir, 'a.yaml', stringify({ [n.id]: 'a' }));
    put(dir, 'c/d.md', page({ [n.id]: 'd' }));
    put(dir, 'c/c.yml', stringify({ [n.id]: 'c' }));
    expect(nodesOf(dir).map((x) => x[n.id])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('builds the edges of the model from the front matter', () => {
    const { graph, profile } = load(sample());
    const model = buildModel(graph, profile);
    expect(model.nodes.map((x) => x.id).sort()).toEqual(['a-1', 'sec-1']);
    expect(model.edges.map((e) => `${e.s}|${e.t}|${e.k}`)).toEqual([`a-1|sec-1|${n.edge}`]);
  });

  it('warns with the file name for a Markdown file with no front matter', () => {
    const dir = sample();
    put(dir, 'notes/README.md', '# Title\n\nJust text.\n');
    const { warnings, graph } = load(dir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(join(dir, 'notes/README.md'));
    expect(graph[n.nodes] as Node[]).toHaveLength(2);
  });

  it('fails with the file name for front matter that is not valid YAML', () => {
    const dir = tmp();
    put(dir, 'bad.md', page('title: [unclosed\n  other: : :\n', 'Text.'));
    expect(() => load(dir)).toThrow(new RegExp(`${join(dir, 'bad.md').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });

  it('fails with the file name for front matter that is not a mapping', () => {
    const dir = tmp();
    put(dir, 'list.md', page('- one\n- two\n', 'Text.'));
    expect(() => load(dir)).toThrow(/list\.md.*must be a mapping/);
    put(dir, 'list.md', '---\n---\nText.\n');
    expect(() => load(dir)).toThrow(/list\.md.*must be a mapping/);
  });

  it('fails with the file name for a key that is the body field', () => {
    const dir = tmp();
    put(dir, 'clash.md', page({ [n.id]: 'x', [n.body]: 'Text in the front matter.' }, 'Text.'));
    expect(() => load(dir)).toThrow(new RegExp(`clash\\.md.*"${n.body}"`));
  });

  it('skips a Markdown file that --exclude matches', () => {
    const dir = sample();
    put(dir, 'drafts/x.md', page('title: [unclosed\n'));
    put(dir, 'other.md', '# no front matter\n');
    expect(() => load(dir)).toThrow(/drafts/);
    const { warnings, graph } = load(dir, ['drafts', 'other.md']);
    expect(warnings).toEqual([]);
    expect(graph[n.nodes] as Node[]).toHaveLength(2);
  });

  it('reads the Markdown file again on each load', () => {
    const dir = sample();
    expect(nodesOf(dir)).toHaveLength(2);
    put(dir, 'new.md', page({ [n.id]: 'new' }));
    expect(nodesOf(dir)).toHaveLength(3);
  });

  it('types the body field as a string in the schema output', () => {
    const schemas = kindSchemas(loadProfile(profileFile(n.profile)));
    for (const kind of [n.guide, n.section]) expect((schemas[kind].properties as Record<string, unknown>)[n.body]).toEqual({ type: 'string' });
  });

  it('ignores Markdown files when the profile has no source.markdown', () => {
    const plain = structuredClone(n.profile) as Profile;
    delete plain.source.markdown;
    const path = profileFile(plain);
    const dir = tmp();
    put(dir, 'a.yaml', stringify({ [n.id]: 'a', [n.kind]: n.section }));
    put(dir, 'sub/b.yml', stringify({ [n.id]: 'b', [n.kind]: n.guide, [n.edge]: ['a'] }));
    const before = loadInputs(dir, path);
    put(dir, 'README.md', page({ [n.id]: 'readme', [n.kind]: n.guide, title: 'Readme' }, 'Text.'));
    put(dir, 'sub/NOTES.md', '# Notes\n');
    const after = loadInputs(dir, path);
    expect(after.graph).toEqual(before.graph);
    expect(after.warnings).toEqual([]);
    expect(after.warnings).toEqual(before.warnings);
  });
});

describe('the profile key source.markdown', () => {
  it('needs a body field', () => {
    const profile = structuredClone(fixtureProfile) as Profile;
    (profile.source as Record<string, unknown>).markdown = {};
    expect(validateProfile(profile).join('\n')).toMatch(/body/);
  });
  it('rejects the id key as the body field', () => {
    const profile = structuredClone(fixtureProfile) as Profile;
    profile.source.markdown = { body: 'id' };
    expect(validateProfile(profile).join('\n')).toMatch(/body "id"/);
  });
});

describe('the notes fixture folder', () => {
  it('reads the pages and warns about the README', () => {
    const { graph, profile, warnings } = loadInputs(fixture('pages'), fixture('profile.json'));
    const model = buildModel(graph, profile);
    expect(model.nodes.map((x) => x.id).sort()).toEqual(['basics', 'soil', 'watering-plan']);
    expect(model.edges).toHaveLength(2);
    expect((graph.nodes as Node[]).find((x) => x.id === 'soil')!.body).toBe('Dig 1 spade deep.\n\nMix in compost when the soil is poor.');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('README.md');
  });
});

describe('the command line with Markdown pages', () => {
  it('builds a page from a Markdown folder and prints 1 warning for a file with no front matter', async () => {
    const out = join(tmp(), 'explorer.html');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const code = await run(['build', '--graph', fixture('pages'), '--profile', fixture('profile.json'), '--out', out]);
      expect(code).toBe(0);
      const lines = warn.mock.calls.map((c) => c.join(' '));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('README.md');
      expect(readFileSync(out, 'utf8')).toContain('Dig 1 spade deep.');
      warn.mockClear();
      expect(await run(['build', '--graph', fixture('pages'), '--profile', fixture('profile.json'), '--out', out, '--exclude', 'README.md'])).toBe(0);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });
});
