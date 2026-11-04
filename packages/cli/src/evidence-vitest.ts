// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The Vitest JSON adapter of the evidence port. It reads the report of `vitest --reporter=json`.
// A test has a file, the titles of its groups (`ancestorTitles`) and its own title. The key holds all of them.
import { isAbsolute, relative } from 'node:path';
import type { AdapterResult, EvidenceAdapter, EvidenceOutcome, EvidenceResult } from '@semspec/core';

const OUTCOMES: Record<string, EvidenceOutcome> = { passed: 'passed', failed: 'failed' };

const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

export const vitestAdapter: EvidenceAdapter = {
  id: 'vitest-json',
  read(text, options): AdapterResult {
    let report: unknown;
    try { report = JSON.parse(text); } catch { throw new Error('The Vitest report is not valid JSON.'); }
    if (!isObject(report) || !Array.isArray(report.testResults)) throw new Error('The Vitest report has no testResults list.');
    const results: EvidenceResult[] = [];
    const warnings: string[] = [];
    for (const file of report.testResults) {
      if (!isObject(file) || typeof file.name !== 'string' || !file.name || !Array.isArray(file.assertionResults)) throw new Error('The Vitest report has a file with no name or no assertionResults list.');
      const inside = isAbsolute(file.name) ? relative(options.root, file.name) : file.name;
      const name = !inside.startsWith('..') && !isAbsolute(inside) ? inside.split('\\').join('/') : file.name;
      // A file that failed to load has no cases. Its conditions stay not-run.
      if (file.status === 'failed' && !file.assertionResults.length) warnings.push(`The Vitest file failed to load: ${name}`);
      for (const t of file.assertionResults) {
        if (!isObject(t) || typeof t.title !== 'string' || !Array.isArray(t.ancestorTitles) || t.ancestorTitles.some((x: unknown) => typeof x !== 'string') || typeof t.status !== 'string') throw new Error('The Vitest report has a test with no title, ancestorTitles or status.');
        const titles = [...(t.ancestorTitles as string[]), t.title];
        results.push({ key: { file: name, name: t.title, titlePath: titles.join(options.separator) }, outcome: OUTCOMES[t.status] ?? 'not-run' });
      }
    }
    const at = typeof report.startTime === 'number' && Number.isFinite(report.startTime) ? new Date(report.startTime).toISOString() : undefined;
    return { results, run: { tool: 'vitest', source: options.source, ...(at ? { at } : {}) }, warnings };
  },
};
