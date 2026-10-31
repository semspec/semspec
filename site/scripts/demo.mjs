// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Writes the 3 demo pages with the real CLI of this repository. The pages go to public/demo/.
// The root build runs only when the CLI is not built yet.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { buildRoot, requireRootModules, rootDir, run, siteDir } from './lib.mjs';

if (!existsSync(`${rootDir}packages/cli/dist/index.js`)) buildRoot();
requireRootModules();

const out = `${siteDir}public/demo/`;
mkdirSync(out, { recursive: true });

const cli = (args) => run('node', ['bin/semspec.js', 'build', ...args], rootDir);
cli(['--workspace', 'fixtures/workspace/workspace.json', '--out', `${out}shop.html`]);
cli(['--graph', 'requirements/graph', '--profile', 'requirements/profile.yaml', '--out', `${out}requirements.html`]);

// The tool only warns about an unknown id in the `documents` field of a page. The site must not ship such a page.
const docs = spawnSync('node', ['bin/semspec.js', 'build', '--workspace', 'docs/workspace.yaml', '--out', `${out}docs.html`], { cwd: rootDir, encoding: 'utf8' });
process.stdout.write(docs.stdout);
process.stderr.write(docs.stderr);
if (docs.status !== 0 || /^warning:/m.test(docs.stderr)) {
  console.error(docs.status === 0 ? 'The build of the docs workspace printed a warning.' : 'The build of the docs workspace failed.');
  process.exit(docs.status || 1);
}
