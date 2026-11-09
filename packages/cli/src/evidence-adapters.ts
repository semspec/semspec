// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The adapters of the evidence port, by name. Each adapter reads the files with 1 extension.
import type { EvidenceAdapter } from '@semspec/core';
import { junitAdapter } from './evidence-junit';
import { vitestAdapter } from './evidence-vitest';

export interface RegisteredAdapter { adapter: EvidenceAdapter; extension: string }

export const ADAPTERS: Record<string, RegisteredAdapter> = {
  junit: { adapter: junitAdapter, extension: '.xml' },
  'vitest-json': { adapter: vitestAdapter, extension: '.json' },
};

export function adapterFor(name: string): RegisteredAdapter {
  const found = ADAPTERS[name];
  if (!found) throw new Error(`Unknown evidence adapter "${name}". The adapters are: ${Object.keys(ADAPTERS).join(', ')}.`);
  return found;
}
