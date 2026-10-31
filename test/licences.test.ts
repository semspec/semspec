// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of scripts/check-licences.mjs on the real tree and on small fake trees.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('..', import.meta.url));
const script = join(repo, 'scripts', 'check-licences.mjs');
const temps: string[] = [];
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: r.stdout + r.stderr };
}

type Fake = { name: string; licence?: string; deps?: string[] };
// Writes a root package and a node_modules folder with the given packages.
function fakeTree(rootDeps: string[], rootDev: string[], packages: Fake[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'semspec-licences-'));
  temps.push(dir);
  const dep = (names: string[]) => Object.fromEntries(names.map((n) => [n, '1.0.0']));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fake-root', version: '1.0.0', license: 'Apache-2.0', dependencies: dep(rootDeps), devDependencies: dep(rootDev) }));
  for (const p of packages) {
    const at = join(dir, 'node_modules', p.name);
    mkdirSync(at, { recursive: true });
    const manifest: Record<string, unknown> = { name: p.name, version: '1.0.0', dependencies: dep(p.deps ?? []) };
    if (p.licence) manifest.license = p.licence;
    writeFileSync(join(at, 'package.json'), JSON.stringify(manifest));
  }
  return dir;
}

describe('check-licences', () => {
  it('passes on the real tree and counts the bundled packages as shipped', { timeout: 120_000 }, () => {
    const r = run('--json');
    expect(r.status).toBe(0);
    const json = JSON.parse(r.out) as { shipped: { name: string }[] };
    const shipped = new Set(json.shipped.map((p) => p.name));
    for (const name of ['react', 'react-dom', '@xyflow/react', '@base-ui/react', '@dagrejs/dagre', 'd3-force', '@tanstack/react-table', 'lucide-react', 'yaml', 'ajv']) {
      expect(shipped.has(name), name).toBe(true);
    }
    expect(shipped.has('vitest')).toBe(false);
  });

  it('fails on a GPL package in the shipped set and names the path', () => {
    const dir = fakeTree(['a'], [], [{ name: 'a', licence: 'MIT', deps: ['b'] }, { name: 'b', licence: 'GPL-3.0-only' }]);
    const r = run('--root', dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain('VIOLATION: b@1.0.0 has the licence GPL-3.0-only');
    expect(r.out).toContain('fake-root@1.0.0 > a@1.0.0 > b@1.0.0');
  });

  it('fails on a shipped package with no licence field and on an MPL package in the shipped set', () => {
    expect(run('--root', fakeTree(['a'], [], [{ name: 'a' }])).status).toBe(1);
    expect(run('--root', fakeTree(['a'], [], [{ name: 'a', licence: 'MPL-2.0' }])).status).toBe(1);
  });

  it('passes on an MPL package in the tools set, and warns about a tool with no licence', () => {
    const dir = fakeTree(['a'], ['t', 'u'], [{ name: 'a', licence: 'ISC' }, { name: 't', licence: 'MPL-2.0' }, { name: 'u' }]);
    const r = run('--root', dir);
    expect(r.status).toBe(0);
    expect(r.out).toContain('warning: u@1.0.0 has no licence field');
  });

  it('fails on a GPL package in the tools set', () => {
    expect(run('--root', fakeTree(['a'], ['t'], [{ name: 'a', licence: 'MIT' }, { name: 't', licence: 'LGPL-2.1' }])).status).toBe(1);
  });

  it('accepts an OR expression with 1 allowed option and rejects an AND with a forbidden one', () => {
    expect(run('--root', fakeTree(['a'], [], [{ name: 'a', licence: '(MIT OR GPL-3.0-only)' }])).status).toBe(0);
    expect(run('--root', fakeTree(['a'], [], [{ name: 'a', licence: '(MIT AND GPL-3.0-only)' }])).status).toBe(1);
  });

  it('runs in CI through the licences script', () => {
    const workflow = readFileSync(join(repo, '.github', 'workflows', 'check.yml'), 'utf8');
    expect(workflow).toContain('npm run licences');
    expect(JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).scripts.licences).toBe('node scripts/check-licences.mjs');
  });
});
