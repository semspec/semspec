// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Helpers for the scripts of the site.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const siteDir = fileURLToPath(new URL('../', import.meta.url));
export const rootDir = fileURLToPath(new URL('../../', import.meta.url));

// Runs a command and shows its output. The script stops when the command fails.
export function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`The command failed: ${command} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

// The CLI and the app need the dependencies of the repository root.
export function requireRootModules() {
  if (!existsSync(`${rootDir}node_modules`)) {
    console.error('The repository root has no node_modules folder. Run "npm ci" at the repository root first.');
    process.exit(1);
  }
}

export function requireSiteModules() {
  if (!existsSync(`${siteDir}node_modules`)) {
    console.error('The site has no node_modules folder. Run "npm ci" in the site folder first.');
    process.exit(1);
  }
}

// Builds the CLI and the app of the repository root, so both match the current commit.
export function buildRoot() {
  requireRootModules();
  run('npm', ['run', 'build'], rootDir);
}
