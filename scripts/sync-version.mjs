// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Sets the version of the root package `semspec` to the version of `@semspec/core`.
// Changesets does not version the root package of a workspace, so `npm run version` runs this script after `changeset version`.
//
// It writes the version into package.json and into the root entries of package-lock.json.
// It also copies the versions of the workspace packages into the lock file, because `changeset version`
// updates the ranges of internal dependencies in package.json and `npm ci` needs a lock file in step with them.
// Usage: node scripts/sync-version.mjs [root]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
// Keeps the indent and the final newline of the file.
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

// The folder names below packages/ that hold a package.json.
const workspaceDirs = (root) =>
  readdirSync(join(root, 'packages'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(root, 'packages', e.name, 'package.json')))
    .map((e) => e.name);

// Returns the version that it wrote and the files that changed.
export function syncVersion(root) {
  const version = readJson(join(root, 'packages', 'core', 'package.json')).version;
  if (typeof version !== 'string' || version === '') throw new Error('packages/core/package.json has no version.');
  const changed = [];

  const pkgFile = join(root, 'package.json');
  const pkg = readJson(pkgFile);
  if (pkg.version !== version) {
    pkg.version = version;
    writeJson(pkgFile, pkg);
    changed.push('package.json');
  }

  const lockFile = join(root, 'package-lock.json');
  if (existsSync(lockFile)) {
    const lock = readJson(lockFile);
    let dirty = false;
    const set = (holder, to = version) => {
      if (holder && holder.version !== to) {
        holder.version = to;
        dirty = true;
      }
    };
    set(lock);
    set(lock.packages?.['']);
    set(lock.packages?.['packages/core']);
    for (const dir of workspaceDirs(root)) {
      const entry = lock.packages?.[`packages/${dir}`];
      const manifest = readJson(join(root, 'packages', dir, 'package.json'));
      if (!entry) continue;
      set(entry, manifest.version);
      for (const field of DEPENDENCY_FIELDS) {
        for (const [name, range] of Object.entries(manifest[field] ?? {})) {
          if (name.startsWith('@semspec/') && entry[field]?.[name] !== undefined && entry[field][name] !== range) {
            entry[field][name] = range;
            dirty = true;
          }
        }
      }
    }
    if (dirty) {
      writeJson(lockFile, lock);
      changed.push('package-lock.json');
    }
  }
  return { version, changed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
  const { version, changed } = syncVersion(root);
  console.log(changed.length > 0 ? `Version ${version} written to ${changed.join(', ')}.` : `Version ${version} is already in place.`);
}
