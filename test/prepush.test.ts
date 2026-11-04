// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the pre-push hook in .githooks: its checks, its block and its install script. The hook runs with stub commands.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('..', import.meta.url));
const hookPath = join(repo, '.githooks/pre-push');
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { scripts: Record<string, string>; files: string[] };
const temps: string[] = [];
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

// A copy of the hook in a folder with stub `npm` and `node` commands. A stub logs its arguments and fails when they contain $FAIL.
function sandbox(): { hook: string; log: string; stubs: string } {
  const dir = mkdtempSync(join(tmpdir(), 'semspec-hook-'));
  temps.push(dir);
  mkdirSync(join(dir, '.githooks'));
  mkdirSync(join(dir, 'stubs'));
  copyFileSync(hookPath, join(dir, '.githooks/pre-push'));
  chmodSync(join(dir, '.githooks/pre-push'), 0o755);
  for (const name of ['npm', 'node']) {
    writeFileSync(join(dir, 'stubs', name), `#!/bin/sh\necho "${name} $*" >> "$STUB_LOG"\nif [ -n "$STUB_FAIL" ]; then case "$*" in *"$STUB_FAIL"*) exit 1 ;; esac; fi\nexit 0\n`);
    chmodSync(join(dir, 'stubs', name), 0o755);
  }
  return { hook: join(dir, '.githooks/pre-push'), log: join(dir, 'log'), stubs: join(dir, 'stubs') };
}

function runHook(fail = '') {
  const s = sandbox();
  const r = spawnSync('/bin/sh', [s.hook], { encoding: 'utf8', env: { ...process.env, PATH: `${s.stubs}:${process.env.PATH}`, STUB_LOG: s.log, STUB_FAIL: fail } });
  let calls: string[] = [];
  try {
    calls = readFileSync(s.log, 'utf8').trim().split('\n');
  } catch {
    // The hook ran no command.
  }
  return { status: r.status, calls, stderr: r.stderr };
}

describe('the pre-push hook', () => {
  it('is an executable POSIX shell script', () => {
    expect(readFileSync(hookPath, 'utf8').startsWith('#!/bin/sh\n')).toBe(true);
    expect(statSync(hookPath).mode & 0o111).toBeGreaterThan(0);
  });

  it('runs the typecheck, the tests, semspec check, semspec spec --check and the licence check, then the self-check', () => {
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([
      'npm run typecheck',
      'npm run test:evidence',
      'node bin/semspec.js check --graph requirements/graph --profile requirements/profile.yaml',
      'node bin/semspec.js spec --graph requirements/graph --profile requirements/profile.yaml docs/reference/requirements.md --check',
      'npm run licences',
      'node scripts/self-check.mjs --baseline requirements/self-check-baseline.json',
    ]);
  });

  it('runs the self-check as a gate against the baseline, not in report mode', () => {
    const hook = readFileSync(hookPath, 'utf8');
    expect(hook).toMatch(/^step node scripts\/self-check\.mjs --baseline requirements\/self-check-baseline\.json$/m);
    expect(hook).not.toMatch(/report mode|--strict/);
  });

  it('blocks the push when the self-check finds a finding that is not in the baseline', () => {
    const r = runHook('self-check.mjs');
    expect(r.status).toBe(1);
    expect(r.calls.at(-1)).toContain('self-check.mjs');
    expect(r.stderr).toMatch(/blocked.*self-check/);
  });

  it('blocks the push and stops at the first failed step', () => {
    for (const [i, step] of ['typecheck', 'test:evidence', 'semspec.js check', 'semspec.js spec', 'licences'].entries()) {
      const r = runHook(step);
      expect(r.status, step).toBe(1);
      expect(r.calls, step).toHaveLength(i + 1);
      expect(r.calls.at(-1), step).toContain(step);
      expect(r.stderr, step).toMatch(/blocked/);
    }
  });
});

describe('the install of the hook', () => {
  it('installs the hook with 1 npm script that sets the hooks path', () => {
    expect(pkg.scripts['hooks:install']).toBe('git config core.hooksPath .githooks');
  });

  it('keeps the hook out of every lifecycle script and out of the published files', () => {
    const manifests = ['package.json', 'packages/core/package.json', 'packages/cli/package.json', 'packages/app/package.json', 'packages/mcp/package.json'];
    const lifecycle = ['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare', 'prepublishOnly', 'prepack', 'postpack'];
    for (const m of manifests) {
      const manifest = JSON.parse(readFileSync(join(repo, m), 'utf8')) as { scripts?: Record<string, string>; files?: string[] };
      for (const name of lifecycle) expect(manifest.scripts?.[name] ?? '', `${m} ${name}`).not.toMatch(/githooks|hooks:install|hooksPath/);
      for (const f of manifest.files ?? []) expect(f, m).not.toMatch(/githooks/);
    }
    expect(pkg.files.some((f) => f.includes('githooks'))).toBe(false);
  });
});
