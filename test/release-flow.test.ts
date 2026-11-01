// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the release files: the changeset config, the 2 workflows, the pull request template and the guide.
// A file cannot prove everything. The step that makes verified commits needs a real run (see req-release-version-pr).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repo = fileURLToPath(new URL('..', import.meta.url));
const text = (path: string) => readFileSync(join(repo, path), 'utf8');
const json = (path: string) => JSON.parse(text(path));
const temps: string[] = [];
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

type Step = { name?: string; if?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Workflow = { on: Record<string, unknown>; permissions: Record<string, string>; concurrency: { group: string }; jobs: Record<string, { if?: string; steps: Step[] }> };
const workflow = (name: string) => parse(text(`.github/workflows/${name}.yml`)) as Workflow;
const steps = (w: Workflow) => Object.values(w.jobs).flatMap((j) => j.steps);

const check = workflow('check');
const version = workflow('version');
const pins = (w: Workflow) => steps(w).filter((s) => s.uses).map((s) => s.uses!);
const CHECKOUT = 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2';
const SETUP_NODE = 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0';
// parse() drops the comment, so compare the SHA part.
const sha = (uses: string) => uses.split('#')[0].trim();

describe('the changeset config', () => {
  const config = json('.changeset/config.json');

  it('names the base branch master, public access and no commit', () => {
    expect(config.baseBranch).toBe('master');
    expect(config.access).toBe('public');
    expect(config.commit).toBe(false);
  });

  it('gives private packages no version and no tag', () => {
    expect(config.privatePackages).toEqual({ version: false, tag: false });
    const privateNames = readdirSync(join(repo, 'packages'))
      .map((d) => json(`packages/${d}/package.json`))
      .filter((p) => p.private === true)
      .map((p) => p.name);
    expect(privateNames.sort()).toEqual(['@semspec/app', '@semspec/cli', '@semspec/mcp']);
    expect(config.ignore ?? []).toEqual([]);
  });

  it('keeps @semspec/core public', () => {
    expect(json('packages/core/package.json').private).not.toBe(true);
    expect(json('package.json').private).not.toBe(true);
  });

  it('uses the default changelog, which needs no token', () => {
    expect(config.changelog).toBe('@changesets/cli/changelog');
  });

  it('has exact versions for the changesets package', () => {
    expect(json('package.json').devDependencies['@changesets/cli']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // The changesets action v2 refuses a changesets CLI of a major version other than 3.
  it('installs the major version of the changesets CLI that the pinned action accepts', () => {
    expect(text('.github/workflows/version.yml')).toMatch(/changesets\/action@[0-9a-f]{40} # v2\./);
    expect(json('package.json').devDependencies['@changesets/cli']).toMatch(/^3\./);
  });
});

describe('the changeset files', () => {
  const files = readdirSync(join(repo, '.changeset')).filter((f) => f.endsWith('.md') && f !== 'README.md');

  it('names a bump of a public package and a release note of 1 line or more in each changeset file', () => {
    for (const file of files) {
      const m = /^---\n([\s\S]*?)---\n([\s\S]*)$/.exec(text(`.changeset/${file}`));
      expect(m, file).not.toBeNull();
      const header = m![1].trim();
      if (header === '') continue; // An empty changeset has no package and no note.
      for (const line of header.split('\n')) {
        const entry = /^'?"?([^'":]+)'?"?:\s*(patch|minor|major)$/.exec(line.trim());
        expect(entry, `${file}: ${line}`).not.toBeNull();
        expect(['@semspec/core']).toContain(entry![1]);
      }
      expect(m![2].trim().length, file).toBeGreaterThan(0);
    }
  });
});

describe('the sync of the version', () => {
  it('runs changeset version and then the sync script in npm run version', () => {
    expect(json('package.json').scripts.version).toBe('changeset version && node scripts/sync-version.mjs');
  });

  it('keeps the root package and @semspec/core at the same version', () => {
    expect(json('package.json').version).toBe(json('packages/core/package.json').version);
    const lock = json('package-lock.json');
    expect(lock.version).toBe(json('package.json').version);
    expect(lock.packages[''].version).toBe(json('package.json').version);
    expect(lock.packages['packages/core'].version).toBe(json('packages/core/package.json').version);
  });
});

describe('the check workflow', () => {
  const job = check.jobs.changeset;

  it('runs changeset status against the base branch of a pull request with the full history', () => {
    const status = job.steps.find((s) => s.run?.includes('changeset status'))!;
    expect(status.run).toBe('npx changeset status --since=origin/${{ github.base_ref }}');
    expect(job.steps.find((s) => s.uses?.startsWith('actions/checkout'))!.with).toEqual({ 'fetch-depth': 0 });
    expect(job.if).toContain("github.event_name == 'pull_request'");
  });

  it('runs the changeset file check of the pull request before the status check', () => {
    const runs = job.steps.map((s) => s.run ?? '');
    const file = runs.indexOf('node scripts/check-changeset.mjs origin/${{ github.base_ref }}');
    expect(file).toBeGreaterThan(-1);
    expect(file).toBeLessThan(runs.findIndex((r) => r.includes('changeset status')));
  });

  it('skips the changeset job for the version pull request only', () => {
    expect(job.if).toContain("github.head_ref != 'changeset-release/master'");
  });

  it('fetches the full history in the changeset job and the release job only', () => {
    for (const [name, j] of Object.entries(check.jobs)) {
      const depth = j.steps.find((s) => s.uses?.startsWith('actions/checkout'))?.with?.['fetch-depth'];
      expect(depth, name).toBe(name === 'changeset' || name === 'release' ? 0 : undefined);
    }
  });

  it('installs without scripts in the changeset job, so it needs no build', () => {
    expect(job.steps.some((s) => s.run === 'npm ci --ignore-scripts')).toBe(true);
  });
});

describe('the pull request template', () => {
  it('has a Release section after Breaking changes that names the changeset file and its bump', () => {
    const t = text('.github/pull_request_template.md');
    const at = (h: string) => t.indexOf(`\n## ${h}\n`);
    expect(at('Breaking changes')).toBeGreaterThan(0);
    expect(at('Release')).toBeGreaterThan(at('Breaking changes'));
    expect(at('Gates')).toBeGreaterThan(at('Release'));
    const section = t.slice(at('Release'), at('Gates'));
    expect(section).toContain('changeset file');
    expect(section).toContain('bump');
    expect(section).toContain('empty changeset: <reason>');
  });
});

describe('the version workflow', () => {
  const action = steps(version).find((s) => s.uses?.startsWith('changesets/action'))!;

  it('runs on a push to master', () => {
    expect(version.on).toEqual({ push: { branches: ['master'] } });
  });

  it('pins the changesets action by SHA and runs npm run version', () => {
    expect(action.uses).toBe('changesets/action@ae32849d5ba541f9ae29e40e22a623bc13562f51');
    expect(text('.github/workflows/version.yml')).toContain('changesets/action@ae32849d5ba541f9ae29e40e22a623bc13562f51 # v2.1.2');
    expect(action.with!['version-script']).toBe('npm run version');
    expect(action.with!['commit-message']).toBe('Version Packages');
    expect(action.with!['pr-title']).toBe('Version Packages');
  });

  it('has no publish input, so it never publishes or makes a tag', () => {
    expect(Object.keys(action.with!).filter((k) => /publish/i.test(k))).toEqual([]);
    expect(action.with!['create-github-releases']).toBe(false);
    expect(action.with!['push-git-tags']).toBe(false);
  });

  it('commits through the GitHub API', () => {
    expect(action.with!['push-with-git-cli']).toBe(false);
  });

  it('runs no git push and no git tag', () => {
    const runs = steps(version).map((s) => s.run ?? '').join('\n');
    expect(runs).not.toMatch(/git\s+(push|tag)/);
  });

  it('has the permissions contents write and pull-requests write only', () => {
    expect(version.permissions).toEqual({ contents: 'write', 'pull-requests': 'write' });
  });

  it('pins checkout and setup-node to the SHAs of the check workflow', () => {
    expect(pins(version).map(sha)).toEqual([sha(CHECKOUT), sha(SETUP_NODE), 'changesets/action@ae32849d5ba541f9ae29e40e22a623bc13562f51']);
    expect(pins(check).map(sha)).toContain(sha(CHECKOUT));
    expect(pins(check).map(sha)).toContain(sha(SETUP_NODE));
  });

  it('has a concurrency group', () => {
    expect(version.concurrency.group).toBe('version');
  });
});

describe('the release job of the check workflow', () => {
  const job = check.jobs.release as unknown as { if: string; needs: string[]; permissions: Record<string, string>; steps: Step[] };
  const named = (name: string) => job.steps.find((s) => s.name === name)!;

  it('runs on a push to master only', () => {
    expect(job.if).toContain("github.event_name == 'push'");
    expect(job.if).toContain("github.ref == 'refs/heads/master'");
    expect(check.on).toHaveProperty('push');
  });

  it('needs every other job of the workflow and runs only when each gate passed or was skipped', () => {
    const others = Object.keys(check.jobs).filter((n) => n !== 'release').sort();
    expect([...job.needs].sort()).toEqual(others);
    expect(job.if).toContain('always()');
    expect(job.if).toContain("needs.check.result == 'success'");
    // The changeset job is skipped on a push. A skip passes, a failure or a cancel does not.
    expect(job.if).toContain("needs.changeset.result == 'success' || needs.changeset.result == 'skipped'");
    for (const n of others) expect(job.if, n).toContain(`needs.${n}.result`);
  });

  it('has the permission contents write on this job only, and read as the default', () => {
    expect(check.permissions).toEqual({ contents: 'read' });
    expect(job.permissions).toEqual({ contents: 'write' });
    for (const [name, j] of Object.entries(check.jobs)) {
      if (name !== 'release') expect((j as { permissions?: unknown }).permissions, name).toBeUndefined();
    }
  });

  it('checks out the full history with the tags and pins the actions by SHA', () => {
    const checkout = job.steps.find((s) => s.uses?.startsWith('actions/checkout'))!;
    expect(checkout.with).toEqual({ 'fetch-depth': 0, 'fetch-tags': true });
    for (const s of job.steps.filter((x) => x.uses)) expect(s.uses, s.uses).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/);
    expect(sha(checkout.uses!)).toBe(sha(CHECKOUT));
  });

  it('decides with scripts/release-plan.mjs and makes the release only when the plan says so', () => {
    expect(named('Decide whether the version has a release').run).toBe('node scripts/release-plan.mjs >> "${GITHUB_OUTPUT}"');
    expect(named('Write the release notes').if).toBe("steps.plan.outputs.release == 'true'");
    expect(named('Make the tag and the GitHub Release').if).toBe("steps.plan.outputs.release == 'true'");
    expect(named('Stop when the tag exists').if).toBe("steps.plan.outputs.release != 'true'");
  });

  it('writes the release notes before it makes the release, with the changelog section of the version as the text', () => {
    const runs = job.steps.map((s) => s.run ?? '');
    const notes = runs.findIndex((r) => r.startsWith('node scripts/release-notes.mjs'));
    const make = runs.findIndex((r) => r.startsWith('gh release create'));
    expect(notes).toBeGreaterThan(-1);
    expect(notes).toBeLessThan(make);
    expect(named('Write the release notes').run).toBe('node scripts/release-notes.mjs "${TAG#v}" > "${RUNNER_TEMP}/notes.md"');
    const gh = named('Make the tag and the GitHub Release');
    expect(gh.run).toBe('gh release create "${TAG}" --target "${{ github.sha }}" --title "${TAG}" --notes-file "${RUNNER_TEMP}/notes.md"');
    expect(gh.env!.GH_TOKEN).toBe('${{ github.token }}');
  });

  it('is the only way to release: no workflow runs on a tag push and none makes a tag by git', () => {
    const dir = join(repo, '.github/workflows');
    const files = readdirSync(dir).sort();
    expect(files).toEqual(['check.yml', 'version.yml']);
    for (const f of files) {
      const w = parse(readFileSync(join(dir, f), 'utf8')) as Workflow;
      expect(JSON.stringify(w.on), f).not.toContain('tags');
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/git\s+(push|tag)/);
    }
    expect(existsSync(join(repo, '.github/workflows/release.yml'))).toBe(false);
  });
});

describe('release-plan', () => {
  const script = join(repo, 'scripts/release-plan.mjs');
  function project(version: string, core = version): string {
    const dir = mkdtempSync(join(tmpdir(), 'semspec-plan-'));
    temps.push(dir);
    mkdirSync(join(dir, 'packages/core'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }));
    writeFileSync(join(dir, 'packages/core/package.json'), JSON.stringify({ version: core }));
    const sh = (...args: string[]) => {
      const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
      expect(r.status, r.stderr).toBe(0);
    };
    sh('init', '-q', '-b', 'master');
    sh('add', '.');
    sh('commit', '-q', '-m', 'base');
    return dir;
  }
  const plan = (dir: string) => spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });

  it('prints release=true and the tag when the version has no tag', () => {
    const r = plan(project('1.2.3'));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('release=true\ntag=v1.2.3\n');
  });

  it('prints release=false when the tag exists locally, as a lightweight or an annotated tag', () => {
    for (const args of [['tag', 'v1.2.3'], ['tag', '-a', 'v1.2.3', '-m', 'x']]) {
      const dir = project('1.2.3');
      const r0 = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
      expect(r0.status, r0.stderr).toBe(0);
      const r = plan(dir);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toBe('release=false\ntag=v1.2.3\n');
    }
  });

  it('prints release=false when only origin has the tag, and release=true when origin has not', () => {
    const origin = project('1.2.3');
    const tagged = spawnSync('git', ['tag', 'v1.2.3'], { cwd: origin });
    expect(tagged.status).toBe(0);
    const clone = mkdtempSync(join(tmpdir(), 'semspec-plan-clone-'));
    temps.push(clone);
    // A clone without tags has the tag only on origin.
    const c = spawnSync('git', ['clone', '-q', '--no-tags', origin, join(clone, 'w')], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
    expect(c.status, c.stderr).toBe(0);
    expect(plan(join(clone, 'w')).stdout).toBe('release=false\ntag=v1.2.3\n');
    spawnSync('git', ['tag', '-d', 'v1.2.3'], { cwd: origin });
    expect(plan(join(clone, 'w')).stdout).toBe('release=true\ntag=v1.2.3\n');
  });

  it('exits with 1 when semspec and @semspec/core have different versions', () => {
    const r = plan(project('1.2.3', '1.2.2'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('differ');
  });
});

describe('the dependabot rule', () => {
  it('skips the changeset job for a pull request whose author is dependabot[bot]', () => {
    expect(check.jobs.changeset.if).toContain("github.event.pull_request.user.login != 'dependabot[bot]'");
    expect(check.jobs.changeset.if).toContain("github.event_name == 'pull_request'");
  });

  it('keeps the other jobs independent of the changeset job, so a skip does not skip them', () => {
    for (const [name, j] of Object.entries(check.jobs)) {
      if (name === 'release') continue;
      expect((j as { needs?: unknown }).needs, name).toBeUndefined();
    }
    const release = check.jobs.release as unknown as { if: string };
    expect(release.if).toContain('always()');
    expect(release.if).toContain("needs.changeset.result == 'skipped'");
  });
});

describe('the release guide', () => {
  const guide = text('docs/guide/releasing.md');

  it('says each step of a release with its commands and that the merge of the version pull request is the last step', () => {
    for (const part of ['npx changeset', 'npx changeset add --empty', 'npm run version', 'Merge the Version Packages pull request', 'no person makes a tag']) {
      expect(guide, part).toContain(part);
    }
    expect(guide).toContain('Settings > Actions > General > "Allow GitHub Actions to create and approve pull requests"');
    expect(guide).not.toMatch(/git tag|git push|allowed_signers|signed tag/i);
  });

  it('has the front matter of a guide that documents the release requirements', () => {
    const front = parse(/^---\n([\s\S]*?)\n---/.exec(guide)![1]);
    expect(front).toMatchObject({ id: 'releasing', kind: 'guide' });
    expect(front.documents).toEqual(['cap-release', 'req-release-changeset', 'req-release-version-pr', 'req-release-tag']);
  });
});

describe('the concurrency of the Check workflow', () => {
  it('never cancels the run of a push to master and cancels an older run of the same pull request', () => {
    const workflow = parse(text('.github/workflows/check.yml'));
    expect(workflow.concurrency.group).toBe("check-${{ github.event_name == 'push' && github.sha || github.ref }}");
    expect(workflow.concurrency['cancel-in-progress']).toBe("${{ github.event_name == 'pull_request' }}");
  });
});
