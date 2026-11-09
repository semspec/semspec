// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The environment for a git command in a temporary repository. Git exports the repository variables
// (GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE and others) to a hook. A test that inherits them would act on the repository of the contributor.
import { spawnSync } from 'node:child_process';

// The list that git itself reports, with a fixed list as the fallback.
const FALLBACK = ['GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_CONFIG', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_DIR', 'GIT_GRAFT_FILE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_INTERNAL_SUPER_PREFIX', 'GIT_NAMESPACE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_OBJECT_DIRECTORY', 'GIT_PREFIX', 'GIT_REPLACE_REF_BASE', 'GIT_SHALLOW_FILE', 'GIT_WORK_TREE'];

function localVariables(): string[] {
  const r = spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' });
  const listed = r.status === 0 ? r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  return [...new Set([...FALLBACK, ...listed])];
}

const LOCAL = localVariables();

// A copy of the variables with the repository variables of git removed. `extra` is added after the removal.
export function cleanGitEnv(extra: NodeJS.ProcessEnv = {}, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean = { ...base };
  for (const name of LOCAL) delete clean[name];
  for (const name of Object.keys(clean)) if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(name)) delete clean[name];
  return { ...clean, ...extra };
}
