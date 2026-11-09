// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Checks that CI runs on the Node versions that the package and its test tools need.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('../.github/workflows/check.yml', import.meta.url), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const jsdom = JSON.parse(readFileSync(new URL('../node_modules/jsdom/package.json', import.meta.url), 'utf8'));

type Step = { uses?: string; run?: string; with?: { 'node-version'?: number | string } };
const jobs = Object.values(workflow.jobs as Record<string, { steps: Step[] }>);
const nodeOf = (steps: Step[]) => Number(String(steps.find((s) => s.uses?.startsWith('actions/setup-node'))?.with?.['node-version']));
const runs = (steps: Step[]) => steps.map((s) => s.run ?? '').join('\n');
const lowest = Number(/>=\s*(\d+)/.exec(pkg.engines.node)![1]);
const runsNodeTests = (steps: Step[]) => /npm run test:evidence|npm test\b|vitest run --project node/.test(runs(steps));
// The lowest major version that the engines range of jsdom allows.
const toolMajor = Math.min(...[...String(jsdom.engines.node).matchAll(/(\d+)\.\d+\.\d+/g)].map((m) => Number(m[1])));

describe('the Node versions of CI', () => {
  it('runs the node tests on the lowest Node version of the engines field', () => {
    const job = jobs.find((j) => nodeOf(j.steps) === lowest);
    expect(job).toBeDefined();
    expect(runsNodeTests(job!.steps)).toBe(true);
  });

  it('runs all tests, the build and the site on a Node version that the test tools support', () => {
    const job = jobs.find((j) => /npm run test:evidence/.test(runs(j.steps)) && /npm ci --prefix site/.test(runs(j.steps)));
    expect(job).toBeDefined();
    expect(nodeOf(job!.steps)).toBeGreaterThanOrEqual(toolMajor);
    expect(runs(job!.steps)).toMatch(/npm run build/);
  });
});

describe('the pull request trigger of the check workflow', () => {
  const on = workflow.on as { pull_request: { types?: string[] } };
  const named = (workflow.jobs as Record<string, { if?: string; steps: Step[] }>);

  it('reruns the workflow when the body of a pull request is edited', () => {
    expect(on.pull_request.types).toEqual(['opened', 'synchronize', 'reopened', 'edited']);
  });

  it('skips the heavy job on an edit and keeps the job of the body gates', () => {
    expect(named.check.if).toBe("github.event.action != 'edited'");
    expect(named.changeset.if ?? '').not.toContain('edited');
    expect(named.changeset.steps.some((s) => /check-requirement-change\.mjs/.test(s.run ?? ''))).toBe(true);
  });

  it('keeps an edit from cancelling the run of the last push', () => {
    const concurrency = workflow.concurrency as { group: string };
    expect(concurrency.group).toContain("github.event.action == 'edited'");
  });
});
