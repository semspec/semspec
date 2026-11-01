// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Runs the full test suite and prints the time of the run and of the 10 slowest test files.
// Usage: npm run test:time
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'semspec-time-'));
const out = join(dir, 'vitest.json');
const start = Date.now();
const run = spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${out}`], { stdio: ['ignore', 'ignore', 'inherit'] });
const wall = (Date.now() - start) / 1000;

let report;
try {
  report = JSON.parse(readFileSync(out, 'utf8'));
} catch {
  console.error('The run wrote no report.');
  process.exit(1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const files = report.testResults
  .map((f) => ({ name: f.name.replace(`${process.cwd()}/`, ''), seconds: (f.endTime - f.startTime) / 1000, tests: f.assertionResults.length }))
  .sort((a, b) => b.seconds - a.seconds);
const sum = files.reduce((s, f) => s + f.seconds, 0);

console.log(`Wall time: ${wall.toFixed(1)} s. Sum of the file times: ${sum.toFixed(1)} s. Tests: ${report.numTotalTests}, failed: ${report.numFailedTests}.`);
console.log('The 10 slowest files:');
for (const f of files.slice(0, 10)) console.log(`  ${f.seconds.toFixed(1).padStart(6)} s  ${String(f.tests).padStart(4)} tests  ${f.name}`);
process.exit(run.status ?? 1);
