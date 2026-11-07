// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the check command and its hooks: the exit codes, the findings, the gates of the profile, --changed, --json and --strict.
// The hook tests run the scripts of docs/guide/gates.md, so they need the built command line tool (npm run build).
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { cleanGitEnv } from './helpers/git-env';
import { stringify } from 'yaml';
import { GATE_KINDS, gateFindings, indexGraphs, buildModel, type Graph, type Profile } from '@semspec/core';
import { run } from '../packages/cli/src/index';
import { validateProfile } from '../packages/cli/src/validate';

const root = new URL('../', import.meta.url).pathname;
const fixture = (...p: string[]) => join(root, 'fixtures', ...p);
const made: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'chk-'));
  made.push(dir);
  return dir;
};
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

async function check(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const code = await run(['check', ...args]);
    return { code, out: log.mock.calls.map((c) => c.join(' ')).join('\n'), err: error.mock.calls.map((c) => c.join(' ')).join('\n') };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}
interface Json {
  ok: boolean;
  strict: boolean;
  errors: number;
  warnings: number;
  findings: { level: string; subject: string; message: string; gate?: string }[];
}
const checkJson = async (args: string[]) => {
  const r = await check([...args, '--json']);
  return { code: r.code, json: JSON.parse(r.out) as Json };
};

const productProfile = () => JSON.parse(readFileSync(fixture('product', 'profile.json'), 'utf8')) as Profile;
const productGraph = () => JSON.parse(readFileSync(fixture('product', 'graph.json'), 'utf8')) as Graph & { nodes: Record<string, unknown>[] };

// Writes a profile and a graph file in a new folder. `gates` goes into the profile.
function project(gates?: string[], graph: Graph = productGraph()): { dir: string; graph: string; profile: string } {
  const dir = tmp();
  const profile = { ...productProfile(), ...(gates ? { gates: { fail: gates } } : {}) };
  writeFileSync(join(dir, 'profile.json'), JSON.stringify(profile));
  writeFileSync(join(dir, 'graph.json'), JSON.stringify(graph));
  return { dir, graph: join(dir, 'graph.json'), profile: join(dir, 'profile.json') };
}

describe('the check command on valid inputs', () => {
  it('exits with 0 on each fixture and on the requirements of the repository', async () => {
    const runs: string[][] = [
      ['--graph', fixture('product', 'graph.json'), '--profile', fixture('product', 'profile.json')],
      ['--graph', fixture('safety', 'graph.json'), '--profile', fixture('safety', 'profile.json')],
      ['--graph', fixture('glossary', 'graph.json'), '--profile', fixture('glossary', 'profile.json')],
      ['--workspace', fixture('workspace', 'workspace.json')],
      ['--workspace', join(root, 'docs', 'workspace.yaml')],
      ['--graph', join(root, 'requirements', 'graph'), '--profile', join(root, 'requirements', 'profile.yaml')],
    ];
    for (const args of runs) {
      const r = await check(args);
      expect(r.code, `${args.join(' ')}\n${r.out}`).toBe(0);
      expect(r.out).toMatch(/check passed: 0 errors, \d+ warnings?$/);
    }
  });
  it('lets no gap fail the check when the profile has no gates', async () => {
    // The product fixture has a bad status, a part with no check and an unplaced node.
    const p = project();
    expect((await check(['--graph', p.graph, '--profile', p.profile])).code).toBe(0);
  });
  it('accepts the gates key in the profile schema and refuses an unknown gap kind', () => {
    expect(validateProfile({ ...productProfile(), gates: { fail: ['unplaced'] } })).toEqual([]);
    expect(validateProfile({ ...productProfile(), gates: { fail: ['nonsense'] } }).length).toBeGreaterThan(0);
    expect(validateProfile({ ...productProfile(), gates: { fail: [], other: 1 } }).length).toBeGreaterThan(0);
  });
});

describe('the check command on broken inputs', () => {
  it('exits with 1 and names the profile file for a profile that breaks a rule', async () => {
    const p = project();
    const profile = productProfile();
    profile.kinds[2].placedUnder = 'nothing';
    writeFileSync(p.profile, JSON.stringify(profile));
    const r = await check(['--graph', p.graph, '--profile', p.profile]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`error ${p.profile}: profile kind story placedUnder names the unknown kind "nothing"`);
    expect(r.out).toMatch(/check failed: 1 error, 0 warnings$/);
  });
  it('exits with 1 for a graph file that does not exist', async () => {
    const p = project();
    const r = await check(['--graph', join(p.dir, 'none.json'), '--profile', p.profile]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^error .*none\.json: Cannot read the graph/);
  });
  it('exits with 1 for an unknown kind, a repeated id and a bad YAML file, and names the file', async () => {
    const dir = tmp();
    const profile = join(dir, 'profile.json');
    writeFileSync(profile, JSON.stringify(productProfile()));
    const graph = join(dir, 'graph');
    mkdirSync(graph);
    writeFileSync(join(graph, 'a.yaml'), stringify({ id: 'prd-shop', kind: 'product', name: 'Shop' }));
    writeFileSync(join(graph, 'b.yaml'), stringify({ id: 'prd-shop', kind: 'product', name: 'Again' }));
    writeFileSync(join(graph, 'c.yaml'), stringify({ id: 'x-1', kind: 'wizard' }));
    const r = await check(['--graph', graph, '--profile', profile]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`error ${join(graph, 'c.yaml')}: File "${join(graph, 'c.yaml')}" has the unknown kind "wizard"`);
    expect(r.out).toMatch(/The id "prd-shop" is not unique/);
    writeFileSync(join(graph, 'd.yaml'), 'id: [unclosed\n');
    const bad = await check(['--graph', graph, '--profile', profile]);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain(`error ${graph}: Cannot read the graph file "${join(graph, 'd.yaml')}"`);
  });
  it('exits with 1 for an edge property that the vocabulary does not hold', async () => {
    const graph = productGraph();
    const decision = graph.nodes.find((n) => Array.isArray(n.notes))!;
    (decision.notes as Record<string, unknown>[])[0].force = 'guessed';
    const p = project(undefined, graph);
    const r = await check(['--graph', p.graph, '--profile', p.profile]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^error .*graph\.json: .*"force"/m);
  });
  it('exits with 1 for a workspace file that names a graph that does not exist', async () => {
    const dir = tmp();
    cpSync(fixture('workspace'), dir, { recursive: true });
    const file = join(dir, 'workspace.json');
    const ws = JSON.parse(readFileSync(file, 'utf8'));
    ws.graphs[1].graph = 'domain/missing';
    writeFileSync(file, JSON.stringify(ws));
    const r = await check(['--workspace', file]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^error .*missing: /m);
  });
});

describe('the gates of the profile', () => {
  const findingsOf = async (gate: string, graph?: Graph) => {
    const p = project([gate], graph);
    return { p, ...(await checkJson(['--graph', p.graph, '--profile', p.profile])) };
  };
  it('fails on a node whose status has the tone bad with bad-status', async () => {
    const { code, json } = await findingsOf('bad-status');
    expect(code).toBe(1);
    expect(json.findings.length).toBeGreaterThan(0);
    expect(json.findings.every((f) => f.gate === 'bad-status' && f.level === 'error')).toBe(true);
    expect(json.findings.map((f) => f.subject)).toContain('story-pay-by-card#charged');
  });
  it('fails on a part with no check with no-check', async () => {
    const { code, json } = await findingsOf('no-check');
    expect(code).toBe(1);
    expect(json.findings.map((f) => f.subject)).toContain('story-pay-by-card#charged');
    expect(json.findings.every((f) => f.gate === 'no-check')).toBe(true);
  });
  it('fails on a node that needs a source with no-source', async () => {
    const { code, json } = await findingsOf('no-source');
    expect(code).toBe(1);
    expect(json.findings.map((f) => f.subject)).toContain('prd-shop');
    expect(json.findings.every((f) => f.gate === 'no-source')).toBe(true);
  });
  it('fails on a node that is not placed with unplaced', async () => {
    const { code, json } = await findingsOf('unplaced');
    expect(code).toBe(1);
    expect(json.findings.map((f) => f.subject)).toContain('story-loose');
    expect(json.findings.every((f) => f.gate === 'unplaced')).toBe(true);
  });
  it('fails on a link to a missing node with unresolved-link, and only warns without the gate', async () => {
    const graph = productGraph();
    graph.nodes.find((n) => n.id === 'story-pay-by-card')!.epics = ['epic-checkout', 'epic-missing'];
    const { code, json } = await findingsOf('unresolved-link', graph);
    expect(code).toBe(1);
    expect(json.findings.filter((f) => f.gate === 'unresolved-link').map((f) => [f.subject, f.message])).toEqual([['story-pay-by-card', 'The edge "epics" names the node "epic-missing", which is not in the graph.']]);
    const plain = project(undefined, graph);
    const r = await checkJson(['--graph', plain.graph, '--profile', plain.profile]);
    expect(r.code).toBe(0);
    expect(r.json.warnings).toBe(1);
  });
  it('fails on a cross link to a missing node with broken-cross-link', async () => {
    const dir = tmp();
    cpSync(fixture('workspace'), dir, { recursive: true });
    const graphFile = join(dir, 'product', 'graph.json');
    const graph = JSON.parse(readFileSync(graphFile, 'utf8'));
    graph.nodes.find((n: { id: string }) => n.id === 'epic-checkout').concerns = ['pay-card', 'missing-term'];
    writeFileSync(graphFile, JSON.stringify(graph));
    const profileFile = join(dir, 'product', 'profile.json');
    const profile = JSON.parse(readFileSync(profileFile, 'utf8'));
    writeFileSync(profileFile, JSON.stringify({ ...profile, gates: { fail: ['broken-cross-link'] } }));
    const ws = join(dir, 'workspace.json');
    const r = await checkJson(['--workspace', ws]);
    expect(r.code).toBe(1);
    expect(r.json.findings.filter((f) => f.gate === 'broken-cross-link').map((f) => f.subject)).toEqual(['req:epic-checkout']);
    // Without the gate, the cross link is a warning.
    writeFileSync(profileFile, JSON.stringify(profile));
    const warned = await checkJson(['--workspace', ws]);
    expect(warned.code).toBe(0);
    expect(warned.json.warnings).toBe(1);
  });
  it('names every gap kind in the profile schema and in the core', () => {
    const schema = JSON.parse(readFileSync(join(root, 'schema', 'profile.schema.json'), 'utf8'));
    expect(schema.properties.gates.properties.fail.items.enum).toEqual([...GATE_KINDS]);
  });
  it('returns no gate finding in the core for a profile with no gates', () => {
    const model = buildModel(productGraph(), productProfile());
    expect(gateFindings(indexGraphs([{ id: 'g', label: 'g', model }]))).toEqual([]);
    const gated = buildModel(productGraph(), { ...productProfile(), gates: { fail: [...GATE_KINDS] } });
    expect(gateFindings(indexGraphs([{ id: 'g', label: 'g', model: gated }])).length).toBeGreaterThan(0);
  });
});

describe('the options of the check command', () => {
  // A folder with 2 unplaced stories in 2 files, and a profile that fails on unplaced nodes.
  function folder() {
    const dir = tmp();
    const profile = join(dir, 'profile.json');
    writeFileSync(profile, JSON.stringify({ ...productProfile(), gates: { fail: ['unplaced'] } }));
    const graph = join(dir, 'graph');
    mkdirSync(graph);
    const put = (file: string, node: object) => writeFileSync(join(graph, file), stringify(node));
    put('prd.yaml', { id: 'prd-shop', kind: 'product', name: 'Shop' });
    put('epic.yaml', { id: 'epic-a', kind: 'epic', name: 'A', products: ['prd-shop'] });
    put('story-one.yaml', { id: 'story-one', kind: 'story', summary: 'One.', epics: ['epic-a'] });
    put('story-x.yaml', { id: 'story-x', kind: 'story', summary: 'X.' });
    put('story-y.yaml', { id: 'story-y', kind: 'story', summary: 'Y.' });
    return { dir, profile, graph, put, args: ['--graph', graph, '--profile', profile] };
  }
  it('limits the gate findings to the nodes of the changed files with --changed', async () => {
    const f = folder();
    expect((await checkJson(f.args)).json.findings.map((x) => x.subject)).toEqual(['story-x', 'story-y']);
    expect((await checkJson([...f.args, '--changed', join(f.graph, 'story-x.yaml')])).json.findings.map((x) => x.subject)).toEqual(['story-x']);
    const two = await checkJson([...f.args, '--changed', join(f.graph, 'story-y.yaml'), join(f.graph, 'story-one.yaml')]);
    expect(two.json.findings.map((x) => x.subject)).toEqual(['story-y']);
    const none = await check([...f.args, '--changed', join(f.graph, 'story-one.yaml')]);
    expect(none.code).toBe(0);
    const empty = await check([...f.args, '--changed']);
    expect(empty.code).toBe(0);
    expect(empty.out).toBe('check passed: 0 errors, 0 warnings');
  });
  it('counts all gate findings with --changed when the profile file changed', async () => {
    const f = folder();
    const r = await checkJson([...f.args, '--changed', f.profile]);
    expect(r.json.findings.map((x) => x.subject)).toEqual(['story-x', 'story-y']);
  });
  it('counts a rule error with --changed even when its file did not change', async () => {
    const f = folder();
    f.put('bad.yaml', { id: 'x-1', kind: 'wizard' });
    const r = await check([...f.args, '--changed', join(f.graph, 'story-one.yaml')]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`error ${join(f.graph, 'bad.yaml')}`);
  });
  it('gives a part the file of its owner with --changed', async () => {
    const dir = tmp();
    const graph = productGraph();
    const profile = join(dir, 'profile.json');
    writeFileSync(profile, JSON.stringify({ ...productProfile(), gates: { fail: ['no-check'] } }));
    const folderPath = join(dir, 'graph');
    mkdirSync(folderPath);
    graph.nodes.forEach((n, i) => writeFileSync(join(folderPath, `${String(i).padStart(2, '0')}-${String(n.id)}.yaml`), stringify(n)));
    const args = ['--graph', folderPath, '--profile', profile];
    const all = await checkJson(args);
    expect(all.json.findings.map((x) => x.subject)).toContain('story-pay-by-card#charged');
    const owner = graph.nodes.findIndex((n) => n.id === 'story-pay-by-card');
    const own = await checkJson([...args, '--changed', join(folderPath, `${String(owner).padStart(2, '0')}-story-pay-by-card.yaml`)]);
    expect(own.json.findings.map((x) => x.subject)).toEqual(['story-pay-by-card#charged']);
    expect((await checkJson([...args, '--changed', join(folderPath, '00-prd-shop.yaml')])).json.findings).toEqual([]);
  });
  it('prints 1 sorted line for each finding and a summary line', async () => {
    const f = folder();
    const r = await check(f.args);
    expect(r.out.split('\n')).toEqual([
      'error story-x: The story "X" is not placed in the hierarchy.',
      'error story-y: The story "Y" is not placed in the hierarchy.',
      'check failed: 2 errors, 0 warnings',
    ]);
  });
  it('prints the findings as JSON with --json', async () => {
    const f = folder();
    const r = await check([...f.args, '--json']);
    expect(r.out.split('\n').length).toBe(1);
    expect(JSON.parse(r.out)).toEqual({
      ok: false,
      strict: false,
      errors: 2,
      warnings: 0,
      findings: [
        { level: 'error', subject: 'story-x', message: 'The story "X" is not placed in the hierarchy.', gate: 'unplaced' },
        { level: 'error', subject: 'story-y', message: 'The story "Y" is not placed in the hierarchy.', gate: 'unplaced' },
      ],
    });
  });
  it('fails on a warning only with --strict', async () => {
    const graph = productGraph();
    graph.nodes.find((n) => n.id === 'story-pay-by-card')!.epics = ['epic-checkout', 'epic-missing'];
    const p = project(undefined, graph);
    const args = ['--graph', p.graph, '--profile', p.profile];
    const lax = await check(args);
    expect(lax.code).toBe(0);
    expect(lax.out).toMatch(/^warning .*graph\.json: 1 link\(s\) name a node that is not in the graph/);
    expect(lax.out).toMatch(/check passed: 0 errors, 1 warning$/);
    const strict = await check([...args, '--strict']);
    expect(strict.code).toBe(1);
    expect(strict.out).toMatch(/check failed: 0 errors, 1 warning$/);
    expect((await checkJson([...args, '--strict'])).json).toMatchObject({ ok: false, strict: true, errors: 0, warnings: 1 });
  });
  it('exits with 2 for a wrong use of the command', async () => {
    const f = folder();
    for (const args of [[], ['--graph', f.graph], ['--profile', f.profile], [...f.args, '--bogus'], [...f.args, 'extra'], ['--workspace', 'w.json', ...f.args], ['--graph'], ['--workspace', 'w.json', '--exclude', 'x']]) {
      const r = await check(args);
      expect(r.code, args.join(' ')).toBe(2);
      expect(r.out).toBe('');
      expect(r.err).toContain('Usage:');
    }
  });
});

// The code block of a section of the gates guide.
function guideBlock(heading: string, lang: string): string {
  const text = readFileSync(join(root, 'docs', 'guide', 'gates.md'), 'utf8');
  const section = text.slice(text.indexOf(`\n## ${heading}\n`) + 1);
  const next = section.indexOf('\n## ', 3);
  const body = next < 0 ? section : section.slice(0, next);
  const match = new RegExp('```' + lang + '\\n([\\s\\S]*?)```').exec(body);
  if (!match) throw new Error(`The section "${heading}" has no ${lang} block.`);
  return match[1];
}

describe('the hooks of the gates guide', () => {
  const bin = join(root, 'bin', 'semspec.js');
  // A folder with a `semspec` command in a bin folder, a graph folder and a profile that fails on unplaced nodes.
  function repo(withBadNode: boolean) {
    const dir = tmp();
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'semspec'), `#!/bin/sh\nexec "${process.execPath}" "${bin}" "$@"\n`);
    chmodSync(join(dir, 'bin', 'semspec'), 0o755);
    mkdirSync(join(dir, 'requirements', 'graph'), { recursive: true });
    writeFileSync(join(dir, 'requirements', 'profile.yaml'), stringify({ ...productProfile(), gates: { fail: ['unplaced'] } }));
    const put = (file: string, node: object) => writeFileSync(join(dir, 'requirements', 'graph', file), stringify(node));
    put('prd.yaml', { id: 'prd-shop', kind: 'product', name: 'Shop' });
    put('epic.yaml', { id: 'epic-a', kind: 'epic', name: 'A', products: ['prd-shop'] });
    if (withBadNode) put('story.yaml', { id: 'story-x', kind: 'story', summary: 'X.' });
    return { dir, env: { ...cleanGitEnv(), PATH: `${join(dir, 'bin')}${delimiter}${process.env.PATH}` } };
  }
  const sh = (cwd: string, env: NodeJS.ProcessEnv, cmd: string, args: string[], input?: string) => spawnSync(cmd, args, { cwd, env, input, encoding: 'utf8', timeout: 60000 });
  const git = (dir: string, env: NodeJS.ProcessEnv, ...args: string[]) => sh(dir, { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }, 'git', ['-c', 'user.name=t', '-c', 'user.email=t@example.org', ...args]);

  it('runs the pre-commit script of the guide against a git repository and blocks a broken commit', () => {
    expect(existsSync(bin) && existsSync(join(root, 'packages', 'cli', 'dist', 'index.js')), 'run npm run build first').toBe(true);
    const { dir, env } = repo(true);
    mkdirSync(join(dir, '.githooks'));
    writeFileSync(join(dir, '.githooks', 'pre-commit'), guideBlock('Pre-commit hook', 'sh'));
    chmodSync(join(dir, '.githooks', 'pre-commit'), 0o755);
    expect(git(dir, env, 'init', '-q').status).toBe(0);
    expect(git(dir, env, 'config', 'core.hooksPath', '.githooks').status).toBe(0);
    // The commit of a clean change passes, although a node that is not in the staged files is unplaced.
    git(dir, env, 'add', 'requirements/graph/prd.yaml');
    const clean = git(dir, env, 'commit', '-q', '-m', 'product');
    expect(clean.status, clean.stdout + clean.stderr).toBe(0);
    // The commit of the file with the unplaced node fails and names the node.
    git(dir, env, 'add', 'requirements/graph/story.yaml');
    const blocked = git(dir, env, 'commit', '-q', '-m', 'story');
    expect(blocked.status).not.toBe(0);
    // Git sends the output of a hook to stderr.
    expect(blocked.stderr).toContain('error story-x: The story "X" is not placed in the hierarchy.');
    expect(git(dir, env, 'rev-list', '--count', 'HEAD').stdout.trim()).toBe('1');
  });
  it('runs the agent hook script of the guide for a file inside and a file outside the graph folder', () => {
    const { dir, env } = repo(true);
    const script = join(dir, 'semspec-check.sh');
    writeFileSync(script, guideBlock('Agent hook', 'sh'));
    chmodSync(script, 0o755);
    const hookEnv = { ...env, CLAUDE_PROJECT_DIR: dir };
    const call = (file: string) => sh(dir, hookEnv, script, [], JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file } }));
    const bad = call(join(dir, 'requirements', 'graph', 'story.yaml'));
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('error story-x: The story "X" is not placed in the hierarchy.');
    const good = call(join(dir, 'requirements', 'graph', 'prd.yaml'));
    expect(good.status).toBe(0);
    const outside = call(join(dir, 'README.md'));
    expect(outside.status).toBe(0);
    expect(outside.stderr).toBe('');
  });
  it('has a settings example of the guide that runs the script after Write and Edit', () => {
    const settings = JSON.parse(guideBlock('Agent hook', 'json'));
    const entry = settings.hooks.PostToolUse[0];
    expect(entry.matcher).toBe('Write|Edit');
    expect(entry.hooks[0]).toMatchObject({ type: 'command' });
    expect(entry.hooks[0].command).toContain('semspec-check.sh');
  });
  it('has a workflow for this repository that runs the check on the requirements with pinned actions', () => {
    const file = join(root, '.github', 'workflows', 'check.yml');
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, 'utf8');
    expect(text).toMatch(/run: .*semspec(\.js)? check --graph requirements\/graph --profile requirements\/profile\.yaml/);
    for (const step of ['npm ci', 'npm run typecheck', 'npm run test:evidence', 'npm run build']) expect(text).toContain(`run: ${step}`);
    const lowest = /\d+/.exec(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).engines.node)![0];
    expect(text).toMatch(new RegExp(`node-version: ${lowest}\\b`));
    const uses = [...text.matchAll(/uses: (\S+)(.*)/g)];
    expect(uses.length).toBeGreaterThan(0);
    for (const [, action, rest] of uses) {
      expect(action, action).toMatch(/@[0-9a-f]{40}$/);
      expect(rest, action).toMatch(/# v\d/);
    }
  });
});
