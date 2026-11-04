// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of scripts/check-requirement-change.mjs on small git repositories, and of its place in the CI workflow and the template.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
// @ts-expect-error The script is a plain ES module without types.
import { exemptionReason, unexplainedShippedFiles } from '../scripts/check-requirement-change.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const script = join(repoRoot, 'scripts/check-requirement-change.mjs');
const temps: string[] = [];
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.org', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
};

// A repository with a branch `master` and a branch `topic` that changes the given files.
function topic(changed: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'semspec-requirement-change-'));
  temps.push(dir);
  git(dir, 'init', '-q', '-b', 'master');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'topic');
  for (const f of changed) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), 'changed\n');
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'topic');
  return dir;
}
const run = (dir: string, body?: string, base = 'master') => {
  const env = { ...process.env };
  delete env.PR_BODY;
  if (body !== undefined) env.PR_BODY = body;
  return spawnSync(process.execPath, [script, base], { cwd: dir, encoding: 'utf8', env });
};

describe('check-requirement-change', () => {
  it('fails for a change of packages, bin or package.json with no change of the graph, and names each changed file', () => {
    const r = run(topic(['packages/core/src/a.ts', 'bin/semspec.js', 'package.json', 'docs/a.md']));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('- packages/core/src/a.ts');
    expect(r.stderr).toContain('- bin/semspec.js');
    expect(r.stderr).toContain('- package.json');
    expect(r.stderr).not.toContain('docs/a.md');
    expect(r.stderr).toContain('Requirement exemption: <reason>');
  });

  it('passes when the change of a shipped file comes with a change of a file of requirements/graph', () => {
    const r = run(topic(['packages/core/src/a.ts', 'requirements/graph/requirement/req-x.yaml']));
    expect(r.status, r.stderr).toBe(0);
  });

  it('passes for a change with no shipped file, such as the docs, the tests, the scripts and the requirements outside the graph', () => {
    expect(run(topic(['docs/a.md', 'test/a.test.ts', 'scripts/a.mjs', 'requirements/profile.yaml', 'packages-notes.md', 'package-lock.json'])).status).toBe(0);
  });

  it('passes with a line Requirement exemption and a reason in the body, and prints the reason', () => {
    const r = run(topic(['packages/core/src/a.ts']), 'Fix a typo.\n\nRequirement exemption: A typo in a comment changes no behaviour.\n');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('Requirement exemption: A typo in a comment changes no behaviour.');
  });

  it('fails for an exemption with an empty reason, a missing body and a line that is only a comment', () => {
    const dir = topic(['packages/core/src/a.ts']);
    expect(run(dir, 'Requirement exemption:').status).toBe(1);
    expect(run(dir, 'Requirement exemption:   \n').status).toBe(1);
    expect(run(dir).status).toBe(1);
    expect(run(dir, '<!-- Requirement exemption: <reason> -->').status).toBe(1);
  });

  it('exits with 2 for an unknown base ref and for no base ref', () => {
    expect(run(topic(['packages/a.ts']), '', 'nowhere').status).toBe(2);
    expect(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status).toBe(2);
  });

  it('finds the reason on any line of the body, and ignores the case of the label', () => {
    expect(exemptionReason('a\nrequirement exemption: because\nb')).toBe('because');
    expect(exemptionReason('  Requirement exemption:   spaced  ')).toBe('spaced');
    expect(exemptionReason('Requirement exemption: \nRequirement exemption: second')).toBe('second');
    expect(exemptionReason('see Requirement exemption: not at the start')).toBeNull();
    expect(exemptionReason(undefined)).toBeNull();
  });

  it('lists the shipped files of a change only when it changes no file of requirements/graph', () => {
    expect(unexplainedShippedFiles(['packages/a.ts', 'bin/b.js', 'package.json'])).toEqual(['packages/a.ts', 'bin/b.js', 'package.json']);
    expect(unexplainedShippedFiles(['packages/a.ts', 'requirements/graph/node.yaml'])).toEqual([]);
    expect(unexplainedShippedFiles(['requirements/profile.yaml', 'site/a.ts'])).toEqual([]);
  });
});

describe('the requirement change rule in CI and in the template', () => {
  const workflow = parse(readFileSync(join(repoRoot, '.github/workflows/check.yml'), 'utf8')) as { jobs: Record<string, { steps: { run?: string; env?: Record<string, string> }[] }> };

  it('runs the rule on pull requests with the body of the pull request in PR_BODY', () => {
    const step = workflow.jobs.changeset.steps.find((s) => s.run === 'node scripts/check-requirement-change.mjs origin/${{ github.base_ref }}')!;
    expect(step).toBeDefined();
    expect(step.env).toEqual({ PR_BODY: '${{ github.event.pull_request.body }}' });
  });

  it('names the exemption line in the template as an optional section', () => {
    const template = readFileSync(join(repoRoot, '.github/pull_request_template.md'), 'utf8');
    expect(template).toContain('## Requirement exemption');
    expect(template).toMatch(/Optional\./);
    expect(template).toContain('Requirement exemption: <reason>');
  });
});

describe('the baseline rule in CI', () => {
  it('runs the check of the baseline against the base branch in the pull request job', () => {
    const workflow = parse(readFileSync(join(repoRoot, '.github/workflows/check.yml'), 'utf8')) as { jobs: Record<string, { steps: { run?: string }[] }> };
    expect(workflow.jobs.changeset.steps.some((s) => s.run === 'node scripts/check-baseline.mjs origin/${{ github.base_ref }}')).toBe(true);
  });
});
