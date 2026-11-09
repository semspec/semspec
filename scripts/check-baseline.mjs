// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Fails when a pull request adds a key to the baseline of the self-check against its base.
// The baseline only shrinks. A key that the pull request removes is a finding that it fixed.
// A base with no baseline file passes: the pull request introduces the baseline.
//
// Usage: node scripts/check-baseline.mjs <base ref>, for example origin/master. Exit code 1 means an added key.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE_FILE = 'requirements/self-check-baseline.json';

// The keys of a parsed baseline: `{ <check id>: [keys] }`. `name` names the file in the error messages.
export function baselineKeys(data, name = BASELINE_FILE) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`The baseline "${name}" must be an object of lists of keys.`);
  const keys = [];
  for (const [id, list] of Object.entries(data)) {
    if (!Array.isArray(list) || list.some((k) => typeof k !== 'string')) throw new Error(`The baseline "${name}" must hold a list of text keys for the check "${id}".`);
    keys.push(...list);
  }
  return keys;
}

const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });

// The text of the baseline at a commit, or null when the file does not exist there.
function baselineAt(commit, cwd) {
  const r = git(['show', `${commit}:${BASELINE_FILE}`], cwd);
  return r.status === 0 ? r.stdout : null;
}

// Returns `{ added, removed, base }`: the keys that HEAD adds against the merge base with `base`, and the keys that it removes.
// `base` is false when the merge base has no baseline file.
export function baselineChange(base, cwd = process.cwd()) {
  const merge = git(['merge-base', base, 'HEAD'], cwd);
  if (merge.status !== 0) throw new Error(merge.stderr.trim() || `git merge-base failed for ${base}`);
  const before = baselineAt(merge.stdout.trim(), cwd);
  const after = baselineAt('HEAD', cwd);
  if (before === null) return { added: [], removed: [], base: false };
  if (after === null) throw new Error(`The pull request removes ${BASELINE_FILE}, which the base has.`);
  const parse = (text, name) => {
    try {
      return new Set(baselineKeys(JSON.parse(text), name));
    } catch (e) {
      throw new Error(e instanceof SyntaxError ? `The baseline "${name}" is not valid JSON.` : e.message);
    }
  };
  const old = parse(before, `${base}:${BASELINE_FILE}`);
  const now = parse(after, `HEAD:${BASELINE_FILE}`);
  return { added: [...now].filter((k) => !old.has(k)).sort(), removed: [...old].filter((k) => !now.has(k)).sort(), base: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2];
  if (!base) {
    console.error('Usage: node scripts/check-baseline.mjs <base ref>');
    process.exit(2);
  }
  let change;
  try {
    change = baselineChange(base);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (change.added.length) {
    console.error(`The pull request adds ${change.added.length} key${change.added.length === 1 ? '' : 's'} to ${BASELINE_FILE} against ${base}. The baseline only shrinks. Fix the finding, or name the requirement it needs:`);
    for (const k of change.added) console.error(`- ${k}`);
    process.exit(1);
  }
  console.log(change.base ? `The baseline adds no key against ${base}. Keys removed: ${change.removed.length}.` : `${base} has no baseline. The pull request introduces it.`);
}
