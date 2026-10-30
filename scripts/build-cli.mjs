// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Bundles the command line tool into dist/cli/index.js. The tool needs the app assets in
// dist/app, which `npm run build:app` writes.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

// Runs git and returns the output. Returns undefined when git is missing or the folder is no repository.
function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const commit = git('rev-parse', 'HEAD') || 'unknown';
const status = git('status', '--porcelain');
const dirty = status !== undefined && status !== '';

await build({
  entryPoints: ['src/cli/index.ts'],
  outfile: 'dist/cli/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['vite', 'ajv', 'ajv/dist/2020.js', 'yaml'],
  define: {
    __SEMSPEC_VERSION__: JSON.stringify(version),
    __SEMSPEC_COMMIT__: JSON.stringify(commit),
    __SEMSPEC_DIRTY__: JSON.stringify(dirty),
  },
  banner: { js: '#!/usr/bin/env node' },
});
console.log('wrote dist/cli/index.js');
