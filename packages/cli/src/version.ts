// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The version, the commit and the dirty flag of the build. The CLI build (scripts/build-cli.mjs)
// replaces the 3 constants. Outside that build, the version comes from package.json and the commit is "unknown".
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

declare const __SEMSPEC_VERSION__: string | undefined;
declare const __SEMSPEC_COMMIT__: string | undefined;
declare const __SEMSPEC_DIRTY__: boolean | undefined;

export interface BuildInfo {
  name: 'semspec';
  version: string;
  commit: string;
  dirty: boolean;
}

function sourceVersion(): string {
  try {
    const file = fileURLToPath(new URL('../../package.json', import.meta.url));
    return JSON.parse(readFileSync(file, 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export const buildInfo = (): BuildInfo => ({
  name: 'semspec',
  version: typeof __SEMSPEC_VERSION__ === 'string' ? __SEMSPEC_VERSION__ : sourceVersion(),
  commit: typeof __SEMSPEC_COMMIT__ === 'string' ? __SEMSPEC_COMMIT__ : 'unknown',
  dirty: typeof __SEMSPEC_DIRTY__ === 'boolean' ? __SEMSPEC_DIRTY__ : false,
});

// The text of `--version`: `semspec <version> (<commit>)`, with " dirty" after the commit when the tree was dirty.
export function versionLine(info: BuildInfo = buildInfo()): string {
  return `semspec ${info.version} (${info.commit}${info.dirty ? ' dirty' : ''})`;
}

// The text of the generator meta tag of a page.
export const generatorLabel = (info: BuildInfo = buildInfo()): string => versionLine(info);
