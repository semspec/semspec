// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of scripts/sync-version.mjs, scripts/release-notes.mjs and of a real `changeset` run in a small workspace.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error The scripts are plain ES modules without types.
import { releaseNotes } from '../scripts/release-notes.mjs';
// @ts-expect-error The scripts are plain ES modules without types.
import { syncVersion } from '../scripts/sync-version.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const changesetBin = join(repo, 'node_modules', '.bin', 'changeset');
const temps: string[] = [];
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

const write = (file: string, value: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
};
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const run = (cwd: string, cmd: string, args: string[]) => spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
const git = (cwd: string, ...args: string[]) => {
  const r = run(cwd, 'git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args]);
  expect(r.status, r.stderr).toBe(0);
};

// A workspace like Semspec: a root package, a public core and a private app that depends on core.
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'semspec-release-'));
  temps.push(dir);
  write(join(dir, 'package.json'), { name: 'root-pkg', version: '0.1.0', workspaces: ['packages/*'] });
  write(join(dir, 'packages/core/package.json'), { name: '@fake/core', version: '0.1.0' });
  write(join(dir, 'packages/app/package.json'), { name: '@fake/app', version: '0.1.0', private: true, dependencies: { '@fake/core': '0.1.0' } });
  write(join(dir, 'package-lock.json'), {
    name: 'root-pkg',
    version: '0.1.0',
    lockfileVersion: 3,
    packages: {
      '': { name: 'root-pkg', version: '0.1.0', workspaces: ['packages/*'] },
      'packages/app': { name: '@fake/app', version: '0.1.0', dependencies: { '@fake/core': '0.1.0' } },
      'packages/core': { name: '@fake/core', version: '0.1.0' },
    },
  });
  mkdirSync(join(dir, '.changeset'));
  writeFileSync(join(dir, '.changeset/config.json'), readFileSync(join(repo, '.changeset/config.json')));
  return dir;
}

describe('sync-version', () => {
  it('writes the version of the core package into package.json and the root entries of package-lock.json', () => {
    const dir = workspace();
    write(join(dir, 'packages/core/package.json'), { name: '@fake/core', version: '0.3.0' });
    const result = syncVersion(dir);
    expect(result.version).toBe('0.3.0');
    expect(result.changed).toEqual(['package.json', 'package-lock.json']);
    expect(read(join(dir, 'package.json')).version).toBe('0.3.0');
    const lock = read(join(dir, 'package-lock.json'));
    expect(lock.version).toBe('0.3.0');
    expect(lock.packages[''].version).toBe('0.3.0');
    expect(lock.packages['packages/core'].version).toBe('0.3.0');
  });

  it('keeps the other fields and the version of a private package', () => {
    const dir = workspace();
    write(join(dir, 'packages/core/package.json'), { name: '@fake/core', version: '0.3.0' });
    syncVersion(dir);
    expect(read(join(dir, 'package.json')).workspaces).toEqual(['packages/*']);
    expect(read(join(dir, 'packages/app/package.json')).version).toBe('0.1.0');
    expect(read(join(dir, 'package-lock.json')).packages['packages/app'].version).toBe('0.1.0');
  });

  it('copies the range of a workspace dependency into the lock file', () => {
    const dir = workspace();
    write(join(dir, 'packages/app/package.json'), { name: '@semspec/app', version: '0.1.0', private: true, dependencies: { '@semspec/core': '0.3.0' } });
    const lock = read(join(dir, 'package-lock.json'));
    lock.packages['packages/app'].dependencies = { '@semspec/core': '0.1.0' };
    write(join(dir, 'package-lock.json'), lock);
    syncVersion(dir);
    expect(read(join(dir, 'package-lock.json')).packages['packages/app'].dependencies['@semspec/core']).toBe('0.3.0');
  });

  it('changes no file when the versions already match', () => {
    const dir = workspace();
    expect(syncVersion(dir).changed).toEqual([]);
  });

  it('works without a lock file', () => {
    const dir = workspace();
    rmSync(join(dir, 'package-lock.json'));
    write(join(dir, 'packages/core/package.json'), { name: '@fake/core', version: '1.0.0' });
    expect(syncVersion(dir).changed).toEqual(['package.json']);
  });

  it('prints the written version when run as a command', () => {
    const dir = workspace();
    write(join(dir, 'packages/core/package.json'), { name: '@fake/core', version: '0.4.0' });
    const r = run(repo, process.execPath, [join(repo, 'scripts/sync-version.mjs'), dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Version 0.4.0 written to package.json, package-lock.json.');
  });
});

const CHANGELOG = `# @semspec/core

## 0.2.0

### Minor Changes

- Adds the spec command.

  - A detail.

## 0.1.10

### Patch Changes

- Fixes a bug.

## 0.1.1

- Old.
`;

describe('release-notes', () => {
  it('returns the section of a version without its heading and up to the next version heading', () => {
    const notes = releaseNotes(CHANGELOG, '0.2.0');
    expect(notes.startsWith('### Minor Changes')).toBe(true);
    expect(notes).toContain('- A detail.');
    expect(notes).not.toContain('Fixes a bug');
    expect(notes).not.toContain('## 0.1.10');
  });

  it('returns the last section up to the end of the file', () => {
    expect(releaseNotes(CHANGELOG, '0.1.1')).toBe('- Old.');
  });

  it('does not match a version that only starts like another one', () => {
    expect(releaseNotes(CHANGELOG, '0.1.1')).toBe('- Old.');
    expect(releaseNotes(CHANGELOG, '0.1')).toBeUndefined();
    expect(releaseNotes(CHANGELOG, '0.2')).toBeUndefined();
  });

  it('returns nothing for a version without a section or with an empty section', () => {
    expect(releaseNotes(CHANGELOG, '9.9.9')).toBeUndefined();
    expect(releaseNotes('## 1.0.0\n\n## 0.9.0\n\n- x\n', '1.0.0')).toBeUndefined();
  });

  it('prints the section when run as a command and exits with 1 for a missing version', () => {
    const dir = workspace();
    const file = join(dir, 'CHANGELOG.md');
    writeFileSync(file, CHANGELOG);
    const script = join(repo, 'scripts/release-notes.mjs');
    const ok = run(repo, process.execPath, [script, '0.1.10', file]);
    expect(ok.status).toBe(0);
    expect(ok.stdout.trim()).toBe('### Patch Changes\n\n- Fixes a bug.');
    const missing = run(repo, process.execPath, [script, '3.0.0', file]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('no section for version 3.0.0');
  });
});

describe('changeset with the real config', () => {
  it('collects a minor changeset into the core version, writes the changelog, removes the file and gives the private package no version', () => {
    const dir = workspace();
    writeFileSync(join(dir, '.changeset/new-thing.md'), "---\n'@fake/core': minor\n---\n\nAdds a new thing.\n");
    const r = run(dir, changesetBin, ['version']);
    expect(r.status, r.stderr).toBe(0);
    expect(read(join(dir, 'packages/core/package.json')).version).toBe('0.2.0');
    expect(read(join(dir, 'packages/app/package.json')).version).toBe('0.1.0');
    expect(readFileSync(join(dir, 'packages/core/CHANGELOG.md'), 'utf8')).toContain('Adds a new thing.');
    expect(existsSync(join(dir, 'packages/app/CHANGELOG.md'))).toBe(false);
    expect(readdirSync(join(dir, '.changeset')).filter((f) => f.endsWith('.md') && f !== 'README.md')).toEqual([]);
  });

  it('gives the root package and the core package the same version after npm run version steps', () => {
    const dir = workspace();
    writeFileSync(join(dir, '.changeset/new-thing.md'), "---\n'@fake/core': minor\n---\n\nAdds a new thing.\n");
    expect(run(dir, changesetBin, ['version']).status).toBe(0);
    expect(read(join(dir, 'package.json')).version).toBe('0.1.0');
    syncVersion(dir);
    expect(read(join(dir, 'package.json')).version).toBe(read(join(dir, 'packages/core/package.json')).version);
    expect(read(join(dir, 'package-lock.json')).version).toBe('0.2.0');
  });

  it('fails the status without a changeset and passes it with an empty changeset', () => {
    const dir = workspace();
    git(dir, 'init', '-q', '-b', 'master');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'base');
    git(dir, 'checkout', '-q', '-b', 'topic');
    write(join(dir, 'packages/core/src.txt'), 'changed\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'change');
    const without = run(dir, changesetBin, ['status', '--since=master']);
    expect(without.status).toBe(1);
    writeFileSync(join(dir, '.changeset/empty-one.md'), '---\n---\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'empty changeset');
    const withEmpty = run(dir, changesetBin, ['status', '--since=master']);
    expect(withEmpty.status, withEmpty.stderr).toBe(0);
  });
});
