// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Decides whether the Check workflow makes a release. It reads the version of package.json
// and looks for the tag v<version> in the local repository and on the remote origin.
//
// Usage: node scripts/release-plan.mjs [directory]
// Prints 2 lines in the format of $GITHUB_OUTPUT: `release=true|false` and `tag=v<version>`.
// Exit code 1 means the versions of semspec and @semspec/core differ or a version is missing.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

// Returns { release, tag, reason }. `release` is false when the tag exists locally or on origin.
export function releasePlan(dir = process.cwd()) {
  const read = (path) => JSON.parse(readFileSync(join(dir, path), 'utf8')).version;
  const version = read('package.json');
  if (typeof version !== 'string' || version === '') throw new Error('package.json has no version.');
  const corePath = 'packages/core/package.json';
  if (existsSync(join(dir, corePath)) && read(corePath) !== version) {
    throw new Error(`semspec ${version} and @semspec/core ${read(corePath)} differ.`);
  }
  const tag = `v${version}`;
  if (git(dir, ['rev-parse', '--quiet', '--verify', `refs/tags/${tag}`]).status === 0) {
    return { release: false, tag, reason: `The tag ${tag} exists in the local repository.` };
  }
  const remote = git(dir, ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`]);
  if (remote.status === 0) return { release: false, tag, reason: `The tag ${tag} exists on origin.` };
  // Exit code 2 means the remote works and has no such tag. Without a remote origin, only the local check counts.
  if (remote.status !== 2 && git(dir, ['remote', 'get-url', 'origin']).status === 0) {
    throw new Error(`Cannot read the tags of origin: ${remote.stderr.trim()}`);
  }
  return { release: true, tag, reason: `The tag ${tag} does not exist.` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const plan = releasePlan(process.argv[2] ? resolve(process.argv[2]) : process.cwd());
    console.error(plan.reason);
    console.log(`release=${plan.release}`);
    console.log(`tag=${plan.tag}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
