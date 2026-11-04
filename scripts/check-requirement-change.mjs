// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Fails when a pull request changes a shipped file and changes no file of the requirement graph.
// A shipped file is a file of packages/, of bin/ or package.json. The graph is requirements/graph/.
// The body of the pull request can name an exemption with a line "Requirement exemption: <reason>".
// CI passes the body in the environment variable PR_BODY.
//
// Usage: node scripts/check-requirement-change.mjs <base ref>, for example origin/master. Exit code 1 means no requirement change.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GRAPH_FOLDER = 'requirements/graph/';
const isShipped = (file) => file.startsWith('packages/') || file.startsWith('bin/') || file === 'package.json';

// Returns the files that HEAD changes against the merge base with `base`.
export function changedFiles(base, cwd = process.cwd()) {
  const r = spawnSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr.trim() || `git diff failed for ${base}`);
  return r.stdout.split('\n').filter(Boolean);
}

// The reason of the first line "Requirement exemption: <reason>" of a body, or null when there is none or the reason is empty.
export function exemptionReason(body) {
  for (const line of (body ?? '').split(/\r?\n/)) {
    const m = /^\s*Requirement exemption:(.*)$/i.exec(line);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

// The shipped files of a change that has no file of the graph, or an empty list when the change is fine.
export function unexplainedShippedFiles(files) {
  return files.some((f) => f.startsWith(GRAPH_FOLDER)) ? [] : files.filter(isShipped);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2];
  if (!base) {
    console.error('Usage: node scripts/check-requirement-change.mjs <base ref>');
    process.exit(2);
  }
  let shipped;
  try {
    shipped = unexplainedShippedFiles(changedFiles(base));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (shipped.length === 0) {
    console.log('The pull request changes no shipped file, or it changes a file of requirements/graph.');
  } else {
    const reason = exemptionReason(process.env.PR_BODY);
    if (reason === null) {
      console.error(`The pull request changes shipped files and no file of ${GRAPH_FOLDER}:`);
      for (const f of shipped) console.error(`- ${f}`);
      console.error('Change the requirement nodes, or add the line "Requirement exemption: <reason>" to the body of the pull request.');
      process.exit(1);
    }
    console.log(`Requirement exemption: ${reason}`);
  }
}
