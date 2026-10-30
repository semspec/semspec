// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Reads a JSON file or a YAML file.
import { readFileSync } from 'node:fs';
import { isYamlPath, readYaml } from './yaml';

export function readInput(path: string, what: string): unknown {
  if (isYamlPath(path)) return readYaml(path, what);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`Cannot read the ${what} "${path}": ${(e as Error).message}`);
  }
}
