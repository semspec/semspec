// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of scripts/check-baseline.mjs on small git repositories with an invented baseline file.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanGitEnv } from './helpers/git-env';
// @ts-expect-error The script is a plain ES module without types.
import { baselineKeys } from '../scripts/check-baseline.mjs';

const script = fileURLToPath(new URL('../scripts/check-baseline.mjs', import.meta.url));
const FILE = 'requirements/self-check-baseline.json';
const temps: string[] = [];
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.org', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', env: cleanGitEnv() });
  expect(r.status, r.stderr).toBe(0);
};
const put = (dir: string, file: string, text: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
};
const baseline = (tests: string[]) => `${JSON.stringify({ tests, conditions: [] }, null, 2)}\n`;

// A repository with a branch `master` that holds `before`, and a branch `topic` that holds `after`. A null baseline means no file.
function repo(before: string[] | null, after: string[] | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'semspec-baseline-'));
  temps.push(dir);
  git(dir, 'init', '-q', '-b', 'master');
  put(dir, 'README.md', 'x\n');
  if (before) put(dir, FILE, baseline(before));
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'topic');
  if (after) put(dir, FILE, baseline(after));
  else if (before) rmSync(join(dir, FILE));
  put(dir, 'other.txt', 'y\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'topic');
  return dir;
}
const run = (dir: string, base = 'master') => spawnSync(process.execPath, [script, base], { cwd: dir, encoding: 'utf8', env: cleanGitEnv() });

describe('check-baseline', () => {
  it('fails when the pull request adds a key to the baseline, and names each added key', () => {
    const r = run(repo(['tests:a:one'], ['tests:a:one', 'tests:a:two', 'tests:b:three']));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('adds 2 keys');
    expect(r.stderr).toContain('- tests:a:two');
    expect(r.stderr).toContain('- tests:b:three');
    expect(r.stderr).not.toContain('- tests:a:one');
  });

  it('passes when the pull request removes a key, and says how many', () => {
    const r = run(repo(['tests:a:one', 'tests:a:two'], ['tests:a:one']));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('adds no key');
    expect(r.stdout).toContain('Keys removed: 1');
  });

  it('passes when the baseline does not change', () => {
    expect(run(repo(['tests:a:one'], ['tests:a:one'])).status).toBe(0);
  });

  it('fails for a key that moves to another check, because the key is new there', () => {
    const dir = repo(['tests:a:one'], ['tests:a:one']);
    put(dir, FILE, `${JSON.stringify({ tests: ['tests:a:one'], conditions: ['conditions:r#c:partial-no-note'] })}\n`);
    git(dir, 'commit', '-q', '-a', '-m', 'more');
    expect(run(dir).status).toBe(1);
  });

  it('passes when the base has no baseline file, because the pull request introduces it', () => {
    const r = run(repo(null, ['tests:a:one']));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('has no baseline');
  });

  it('fails when the pull request deletes the baseline file that the base has', () => {
    const r = run(repo(['tests:a:one'], null));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('removes requirements/self-check-baseline.json');
  });

  it('exits with 2 for an unknown base ref, no base ref and a baseline that is not valid', () => {
    expect(run(repo(['tests:a:one'], ['tests:a:one']), 'nowhere').status).toBe(2);
    expect(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status).toBe(2);
    const dir = repo(['tests:a:one'], ['tests:a:one']);
    put(dir, FILE, '{ not json');
    git(dir, 'commit', '-q', '-a', '-m', 'broken');
    expect(run(dir).stderr).toContain('not valid JSON');
    expect(run(dir).status).toBe(2);
  });

  it('reads the keys of an object of lists of text keys, and rejects any other shape', () => {
    expect(baselineKeys({ tests: ['a'], conditions: ['b', 'c'] })).toEqual(['a', 'b', 'c']);
    expect(() => baselineKeys(['a'])).toThrow(/must be an object/);
    expect(() => baselineKeys({ tests: 'a' })).toThrow(/list of text keys for the check "tests"/);
    expect(() => baselineKeys({ tests: [1] })).toThrow(/list of text keys/);
  });
});

describe('the git environment of the test helpers', () => {
  it('does not touch the repository that GIT_DIR names in the environment', () => {
    const decoy = mkdtempSync(join(tmpdir(), 'semspec-decoy-'));
    temps.push(decoy);
    const init = spawnSync('git', ['init', '-q', '-b', 'master', decoy], { encoding: 'utf8', env: cleanGitEnv() });
    expect(init.status, init.stderr).toBe(0);
    const headOf = () => spawnSync('git', ['-C', decoy, 'symbolic-ref', 'HEAD'], { encoding: 'utf8', env: cleanGitEnv() }).stdout.trim();
    expect(headOf()).toBe('refs/heads/master');
    const inherited = { GIT_DIR: join(decoy, '.git'), GIT_WORK_TREE: decoy, GIT_INDEX_FILE: join(decoy, '.git/index') };
    const saved = Object.fromEntries(Object.keys(inherited).map((k) => [k, process.env[k]]));
    Object.assign(process.env, inherited);
    try {
      const dir = repo(['a'], ['a', 'b']);
      expect(spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', env: cleanGitEnv() }).stdout.trim()).not.toBe(decoy);
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    expect(headOf()).toBe('refs/heads/master');
    const count = spawnSync('git', ['-C', decoy, 'rev-list', '--all', '--count'], { encoding: 'utf8', env: cleanGitEnv() });
    expect(count.stdout.trim()).toBe('0');
    expect(Object.keys(cleanGitEnv({}, inherited))).not.toContain('GIT_DIR');
  });
});
