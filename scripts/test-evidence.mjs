// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Runs the tests of Semspec and records the evidence: begin, the Vitest run with the JSON reporter, then collect.
// Collect runs also when a test fails, so the record holds the failure. The script exits with the code of the test run.
import { spawnSync } from 'node:child_process';

const run = (command, args) => spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1;
const record = (phase) => run(process.execPath, ['bin/semspec.js', 'test-record', '--profile', 'requirements/profile.yaml', '--phase', phase]);

if (record('begin') !== 0) process.exit(1);
const tests = run('npx', ['vitest', 'run', '--reporter=json', '--outputFile=dist/vitest.json']);
const collected = record('collect');
process.exit(tests !== 0 ? tests : collected);
