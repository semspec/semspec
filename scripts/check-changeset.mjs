// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Fails when a pull request adds no changeset file against its base.
// `changeset status` ignores the private packages, so a change in app, cli or mcp would pass it.
// An empty changeset (`changeset add --empty`) counts.
//
// Usage: node scripts/check-changeset.mjs <base ref>, for example origin/master. Exit code 1 means no changeset.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Returns the changeset files that HEAD adds against the merge base with `base`.
export function addedChangesets(base, cwd = process.cwd()) {
  const r = spawnSync('git', ['diff', '--name-only', '--diff-filter=A', `${base}...HEAD`, '--', '.changeset'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr.trim() || `git diff failed for ${base}`);
  return r.stdout.split('\n').filter((f) => /^\.changeset\/[^/]+\.md$/.test(f) && f !== '.changeset/README.md');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2];
  if (!base) {
    console.error('Usage: node scripts/check-changeset.mjs <base ref>');
    process.exit(2);
  }
  let files;
  try {
    files = addedChangesets(base);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (files.length === 0) {
    console.error(`The pull request adds no changeset file against ${base}. Run "npx changeset", or "npx changeset add --empty" when the change has nothing for a user.`);
    process.exit(1);
  }
  console.log(`Changeset files: ${files.join(', ')}`);
}
