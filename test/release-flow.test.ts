// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the release files: the changeset config, the 3 workflows, the pull request template and the guide.
// A file cannot prove everything. The step that makes verified commits needs a real run (see req-release-version-pr).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Workflow = { on: Record<string, unknown>; permissions: Record<string, string>; concurrency: { group: string }; jobs: Record<string, { if?: string; steps: Step[] }> };
const workflow = (name: string) => parse(text(`.github/workflows/${name}.yml`)) as Workflow;
const steps = (w: Workflow) => Object.values(w.jobs).flatMap((j) => j.steps);
const stepNamed = (w: Workflow, name: string) => steps(w).find((s) => s.name === name)!;

const check = workflow('check');
const version = workflow('version');
const release = workflow('release');
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

  it('fetches the full history in the changeset job only', () => {
    for (const [name, j] of Object.entries(check.jobs)) {
      const depth = j.steps.find((s) => s.uses?.startsWith('actions/checkout'))?.with?.['fetch-depth'];
      expect(depth, name).toBe(name === 'changeset' ? 0 : undefined);
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

describe('the release workflow', () => {
  const tagStep = stepNamed(release, 'Check that the tag is annotated and signed');
  const versionStep = stepNamed(release, 'Check that the tag version is the package version');

  it('starts on the push of a tag v* with the permission contents write only', () => {
    expect(release.on).toEqual({ push: { tags: ['v*'] } });
    expect(release.permissions).toEqual({ contents: 'write' });
  });

  it('pins checkout and setup-node to the SHAs of the check workflow and checks out the tag with the full history', () => {
    expect(pins(release).map(sha)).toEqual([sha(CHECKOUT), sha(SETUP_NODE)]);
    const checkout = steps(release).find((s) => s.uses?.startsWith('actions/checkout'))!;
    expect(checkout.with).toEqual({ ref: '${{ github.ref }}', 'fetch-depth': 0 });
  });

  it('uses a concurrency group per tag', () => {
    expect(release.concurrency.group).toBe('release-${{ github.ref }}');
  });

  function gitRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'semspec-tag-'));
    temps.push(dir);
    const sh = (cmd: string[], env: Record<string, string> = {}) => {
      const r = spawnSync(cmd[0], cmd.slice(1), { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', ...env } });
      expect(r.status, `${cmd.join(' ')}: ${r.stderr}`).toBe(0);
    };
    sh(['git', 'init', '-q', '-b', 'master']);
    for (const [k, v] of [['user.name', 't'], ['user.email', 't@example.com'], ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false'], ['gpg.format', 'ssh'], ['user.signingkey', join(dir, 'key.pub')]]) sh(['git', 'config', k, v]);
    sh(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 't@example.com', '-f', join(dir, 'key')]);
    writeFileSync(join(dir, '.gitignore'), 'key\nkey.pub\n');
    sh(['git', 'add', '.']);
    sh(['git', 'commit', '-q', '-m', 'base']);
    sh(['git', 'tag', 'v-light']);
    sh(['git', 'tag', '-a', 'v-plain', '-m', 'plain']);
    sh(['git', 'tag', '-s', 'v-signed', '-m', 'signed']);
    return dir;
  }
  const bash = (dir: string, script: string, tag: string) => spawnSync('bash', ['-e', '-c', script], { cwd: dir, encoding: 'utf8', env: { ...process.env, TAG: tag } });

  it('stops when the tag is a lightweight tag or an annotated tag without a signature', () => {
    const dir = gitRepo();
    const light = bash(dir, tagStep.run!, 'v-light');
    expect(light.status).toBe(1);
    expect(light.stdout).toContain('is not an annotated tag');
    const plain = bash(dir, tagStep.run!, 'v-plain');
    expect(plain.status).toBe(1);
    expect(plain.stdout).toContain('has no signature');
  });

  it('passes a signed annotated tag', () => {
    const dir = gitRepo();
    expect(bash(dir, tagStep.run!, 'v-signed').status).toBe(0);
  });

  it('checks the key with git tag -v only when .github/allowed_signers exists', () => {
    const run = stepNamed(release, 'Check the signature key').run!;
    expect(run).toContain('if [ -f .github/allowed_signers ]');
    expect(run).toContain('gpg.ssh.allowedSignersFile=.github/allowed_signers tag -v "${TAG}"');
    const dir = gitRepo();
    const without = bash(dir, run, 'v-signed');
    expect(without.status).toBe(0);
    expect(without.stdout).toContain('the key is not checked');
    mkdirSync(join(dir, '.github'));
    const pub = readFileSync(join(dir, 'key.pub'), 'utf8').trim().split(' ');
    writeFileSync(join(dir, '.github/allowed_signers'), `t@example.com ${pub[0]} ${pub[1]}\n`);
    expect(bash(dir, run, 'v-signed').status).toBe(0);
    const other = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'o@example.com', '-f', join(dir, 'other')]);
    expect(other.status).toBe(0);
    const otherPub = readFileSync(join(dir, 'other.pub'), 'utf8').trim().split(' ');
    writeFileSync(join(dir, '.github/allowed_signers'), `o@example.com ${otherPub[0]} ${otherPub[1]}\n`);
    expect(bash(dir, run, 'v-signed').status).not.toBe(0);
  });

  it('stops when the tag version is not the version in package.json or the core version differs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'semspec-tagver-'));
    temps.push(dir);
    mkdirSync(join(dir, 'packages/core'), { recursive: true });
    const put = (root: string, core: string) => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: root }));
      writeFileSync(join(dir, 'packages/core/package.json'), JSON.stringify({ version: core }));
    };
    put('0.2.0', '0.2.0');
    expect(bash(dir, versionStep.run!, 'v0.2.0').status).toBe(0);
    const wrongTag = bash(dir, versionStep.run!, 'v0.2.1');
    expect(wrongTag.status).toBe(1);
    expect(wrongTag.stdout).toContain('is not v0.2.0');
    put('0.2.0', '0.1.0');
    const differ = bash(dir, versionStep.run!, 'v0.2.0');
    expect(differ.status).toBe(1);
    expect(differ.stdout).toContain('differ');
  });

  it('checks that the tagged commit is on master', () => {
    expect(stepNamed(release, 'Check that the tag is on master').run).toContain('git merge-base --is-ancestor');
  });

  it('runs every gate of the check workflow before it makes the release', () => {
    const gates = check.jobs.check.steps.map((s) => s.run).filter((r): r is string => !!r);
    const releaseRuns = release.jobs.release.steps.map((s) => s.run ?? '');
    const at = releaseRuns.findIndex((r) => r.startsWith('gh release create'));
    expect(at).toBeGreaterThan(0);
    let last = -1;
    for (const gate of gates) {
      const i = releaseRuns.indexOf(gate);
      expect(i, gate).toBeGreaterThan(last);
      expect(i, gate).toBeLessThan(at);
      last = i;
    }
    expect(gates).toEqual(
      expect.arrayContaining(['npm run licences', 'npm run typecheck', 'npm run build', 'npm test', 'npm ci --prefix site', 'npm test --prefix site']),
    );
  });

  it('uses Node 22 and the same cache paths as the check workflow', () => {
    const a = steps(check).find((s) => s.uses?.startsWith('actions/setup-node'))!.with;
    const b = steps(release).find((s) => s.uses?.startsWith('actions/setup-node'))!.with;
    expect(b).toEqual(a);
  });

  it('makes the GitHub Release with the changelog section of the version as its text', () => {
    const notes = stepNamed(release, 'Write the release notes').run!;
    expect(notes).toBe('node scripts/release-notes.mjs "${TAG#v}" > "${RUNNER_TEMP}/notes.md"');
    const make = stepNamed(release, 'Make the GitHub Release');
    expect(make.run).toBe('gh release create "${TAG}" --verify-tag --title "${TAG}" --notes-file "${RUNNER_TEMP}/notes.md"');
    expect(make.env!.GH_TOKEN).toBe('${{ secrets.GITHUB_TOKEN }}');
  });
});

describe('the release guide', () => {
  const guide = text('docs/guide/releasing.md');

  it('says each step of a release with its commands', () => {
    for (const part of ['npx changeset', 'npx changeset add --empty', 'npm run version', 'git pull', 'git tag -s v', 'git push origin v', 'gh release create']) {
      expect(guide, part).toContain(part);
    }
    expect(guide).toContain('Settings > Actions > General > "Allow GitHub Actions to create and approve pull requests"');
    expect(guide).toContain('.github/allowed_signers');
  });

  it('has the front matter of a guide that documents the release requirements', () => {
    const front = parse(/^---\n([\s\S]*?)\n---/.exec(guide)![1]);
    expect(front).toMatchObject({ id: 'releasing', kind: 'guide' });
    expect(front.documents).toEqual(['cap-release', 'req-release-changeset', 'req-release-version-pr', 'req-release-tag']);
  });
});
