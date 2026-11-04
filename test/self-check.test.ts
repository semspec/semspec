// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of scripts/self-check.mjs on small invented fixtures: a tiny graph, a tiny profile and a tiny Vitest report.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
// @ts-expect-error The script is a plain ES module without types.
import { CHECKS, main } from '../scripts/self-check.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const temps: string[] = [];
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

const PROFILE = `project: Fixture
source: { nodes: nodes, id: id, kind: kind }
fields: { title: [title], statement: [statement] }
lifecycle: { field: state, fallback: active, states: { draft: {} } }
kinds:
  - { id: capability, label: Capability, plural: capabilities, prefix: cap-, role: hierarchy, color: { light: "#0b7285", dark: "#66d9e8" } }
  - { id: requirement, label: Requirement, plural: requirements, prefix: req-, role: hierarchy, parents: [[capabilities]], color: { light: "#d9480f", dark: "#ffa94d" } }
  - { id: condition, label: Condition, plural: conditions, role: part, color: { light: "#c2255c", dark: "#f783ac" } }
  - { id: test, label: Test, plural: tests, role: check, color: { light: "#2b8a3e", dark: "#69db7c" } }
edges:
  capabilities: { labels: [In capability, Contains], down: true }
  condition: { labels: [Condition of, Has condition], down: true }
  tested: { labels: [Tested by, Tests] }
parts:
  - { kind: condition, owner: requirement, field: acceptance, id: id, text: text, edge: condition }
checks:
  kind: test
  field: tests
  edge: tested
  typeField: type
  types:
    unit: { key: [file, name], title: [name] }
status:
  label: Status
  field: status
  values:
    - { value: verified, label: Verified, tone: good }
    - { value: partial, label: Partial, tone: warn }
    - { value: open, label: Open, tone: bad }
`;

type Condition = { id: string; status: string; derivedStatus?: string; note?: string; tests?: { file: string; name: string }[] };
type Requirement = { id: string; state?: string; priority?: string; conditions: Condition[] };
interface Fixture {
  requirements: Requirement[];
  capabilities?: { id: string; priority?: string }[];
  tests?: [string, string][];
  exemptions?: unknown;
  noReport?: boolean;
}

// Writes the files of a fixture and returns the arguments that point the script at them.
function fixture(f: Fixture): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'semspec-self-check-'));
  temps.push(dir);
  mkdirSync(join(dir, 'graph'));
  for (const c of f.capabilities ?? [{ id: 'cap-a' }]) writeFileSync(join(dir, 'graph', `${c.id}.yaml`), `id: ${c.id}\nkind: capability\ntitle: ${c.id}\n${c.priority ? `priority: ${c.priority}\n` : ''}`);
  for (const r of f.requirements) {
    const acceptance = r.conditions.map((c) => ({
      id: c.id,
      text: `Condition ${c.id}.`,
      status: c.status,
      ...(c.derivedStatus ? { derivedStatus: c.derivedStatus } : {}),
      ...(c.note ? { note: c.note } : {}),
      ...(c.tests ? { tests: c.tests.map((t) => ({ type: 'unit', ...t })) } : {}),
    }));
    const node = { id: r.id, kind: 'requirement', title: r.id, statement: 'S.', capabilities: ['cap-a'], ...(r.state ? { state: r.state } : {}), ...(r.priority ? { priority: r.priority } : {}), acceptance };
    writeFileSync(join(dir, 'graph', `${r.id}.yaml`), JSON.stringify(node));
  }
  writeFileSync(join(dir, 'profile.yaml'), PROFILE);
  const report = { testResults: [...new Set((f.tests ?? []).map(([file]) => file))].map((file) => ({ name: join(dir, file), assertionResults: (f.tests ?? []).filter(([x]) => x === file).map(([, title]) => ({ title, ancestorTitles: [], status: 'passed' })) })) };
  if (!f.noReport) writeFileSync(join(dir, 'vitest.json'), JSON.stringify(report));
  if (f.exemptions !== undefined) writeFileSync(join(dir, 'exemptions.yaml'), typeof f.exemptions === 'string' ? f.exemptions : JSON.stringify(f.exemptions));
  return ['--root', dir, '--graph', join(dir, 'graph'), '--profile', join(dir, 'profile.yaml'), '--report', join(dir, 'vitest.json'), '--exemptions', join(dir, 'exemptions.yaml'), '--only', 'tests,conditions'];
}

// Runs the command in this process, so the tests stay fast. A shell runs the same code.
async function check(args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  const out: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((m) => void out.push(String(m)));
  try {
    return { status: await main(args), stdout: out.join('\n'), stderr: '' };
  } catch (e) {
    return { status: 2, stdout: out.join('\n'), stderr: (e as Error).message };
  } finally {
    log.mockRestore();
  }
}
interface Finding { key: string; message: string }
interface Result { evidence: string; total: number; checks: { id: string; findings: Finding[] }[]; gate?: { new: Finding[]; fixed: string[] } }
async function findings(args: string[]): Promise<Record<string, string[]>> {
  const r = await check([...args, '--json']);
  expect(r.status, r.stderr).toBe(0);
  const out = JSON.parse(r.stdout) as Result;
  return Object.fromEntries(out.checks.map((c) => [c.id, c.findings.map((f) => f.message)]));
}

const ok = (id: string, extra: Partial<Condition> = {}): Condition => ({ id, status: 'verified', derivedStatus: 'verified', ...extra });

describe('the check tests of the self-check', () => {
  it('reports a test with no link and no exemption, and accepts a linked test and an exempt test', async () => {
    const args = fixture({
      requirements: [{ id: 'req-1', conditions: [ok('c1', { tests: [{ file: 'test/a.test.ts', name: 'linked test' }] })] }],
      tests: [['test/a.test.ts', 'linked test'], ['test/a.test.ts', 'loose test'], ['test/b.test.ts', 'exempt test'], ['test/c.test.ts', 'file exempt test']],
      exemptions: { exemptions: [{ file: 'test/b.test.ts', name: 'exempt test', reason: 'It checks a helper.' }, { file: 'test/c.test.ts', reason: 'The whole file is a helper.' }] },
    });
    expect((await findings(args)).tests).toEqual(['The test has no link and no exemption: test/a.test.ts: loose test']);
  });

  it('reports an exemption with no reason or a blank reason, and does not let it exempt the test', async () => {
    const args = fixture({
      requirements: [{ id: 'req-1', conditions: [ok('c1')] }],
      tests: [['test/a.test.ts', 'one'], ['test/a.test.ts', 'two']],
      exemptions: { exemptions: [{ file: 'test/a.test.ts', name: 'one' }, { file: 'test/a.test.ts', name: 'two', reason: '  ' }] },
    });
    const found = (await findings(args)).tests;
    expect(found.filter((f) => f.includes('has no reason'))).toHaveLength(2);
    expect(found.filter((f) => f.startsWith('The test has no link'))).toHaveLength(2);
  });

  it('reports a link to a test file that does not exist, and ignores a link to a file of another suite', async () => {
    const args = fixture({
      requirements: [{ id: 'req-1', conditions: [ok('c1', { tests: [{ file: 'test/gone.test.ts', name: 'a test' }, { file: 'site/test/other.test.ts', name: 'a site test' }] })] }],
      tests: [],
    });
    mkdirSync(join(args[1], 'site/test'), { recursive: true });
    writeFileSync(join(args[1], 'site/test/other.test.ts'), '');
    expect((await findings(args)).tests).toEqual(['The link of req-1#c1 names a test file that does not exist: test/gone.test.ts']);
  });

  it('reports a linked test name that no test of the report has', async () => {
    const args = fixture({
      requirements: [{ id: 'req-1', conditions: [ok('c1', { tests: [{ file: 'test/a.test.ts', name: 'gone test' }] })] }],
      tests: [['test/a.test.ts', 'other test']],
      exemptions: { exemptions: [{ file: 'test/a.test.ts', reason: 'A helper.' }] },
    });
    expect((await findings(args)).tests).toEqual(['The link of req-1#c1 has no test in the report: test/a.test.ts: gone test']);
  });

  it('reports an exemption that matches no test, and a missing report', async () => {
    const args = fixture({ requirements: [{ id: 'req-1', conditions: [ok('c1')] }], tests: [['test/a.test.ts', 'one']], exemptions: { exemptions: [{ file: 'test/a.test.ts', name: 'one', reason: 'A helper.' }, { file: 'test/z.test.ts', reason: 'Gone.' }] } });
    expect((await findings(args)).tests).toEqual(['The exemption test/z.test.ts: (every test) of "' + args[args.indexOf('--exemptions') + 1] + '" matches no test of the report.']);
    const none = fixture({ requirements: [{ id: 'req-1', conditions: [ok('c1')] }], noReport: true });
    expect((await findings(none)).tests[0]).toMatch(/does not exist\. Run `npm run test:evidence`/);
  });
});

describe('the check conditions of the self-check', () => {
  const base = (conditions: Condition[], extra: Partial<Requirement> = {}, capability: { id: string; priority?: string } = { id: 'cap-a' }) =>
    fixture({ requirements: [{ id: 'req-1', conditions, ...extra }], capabilities: [capability], tests: [] });

  it('reports a condition whose authored status differs from its derived status, and names both', async () => {
    const found = (await findings(base([{ id: 'c1', status: 'verified', derivedStatus: 'open' }, ok('c2')]))).conditions;
    expect(found).toEqual(['The condition req-1#c1 is authored verified and derived open.']);
  });

  it('does not compare the derived status when the evidence is stale or absent, and uses the authored status', async () => {
    const args = base([{ id: 'c1', status: 'verified' }], { state: 'draft' });
    const out = JSON.parse((await check([...args, '--json'])).stdout) as Result;
    expect(out.evidence).toBe('stale or absent');
    expect(out.checks.find((c) => c.id === 'conditions')!.findings.map((f) => f.message)).toEqual(['The requirement req-1 has state draft and all its conditions are verified.']);
    expect((await check(args)).stdout).toMatch(/Evidence: stale or absent\./);
  });

  it('reports a condition authored partial that has no note, and accepts one with a note', async () => {
    const found = (await findings(base([{ id: 'c1', status: 'partial', derivedStatus: 'partial' }, { id: 'c2', status: 'partial', derivedStatus: 'partial', note: 'A browser test is missing.' }]))).conditions;
    expect(found).toEqual(['The condition req-1#c1 is authored partial and has no note.']);
  });

  it('reports a draft requirement whose conditions are all verified, and accepts one with an open condition', async () => {
    expect((await findings(base([ok('c1'), ok('c2')], { state: 'draft' }))).conditions).toEqual(['The requirement req-1 has state draft and all its conditions are verified.']);
    expect((await findings(base([ok('c1'), { id: 'c2', status: 'open', derivedStatus: 'open' }], { state: 'draft' }))).conditions).toEqual([]);
  });

  it('reports a requirement and a capability whose conditions are all verified and that still have a priority', async () => {
    const found = (await findings(base([ok('c1')], { priority: 'now' }, { id: 'cap-a', priority: 'next' }))).conditions;
    expect(found).toEqual(['The requirement req-1 has all conditions verified and still has a priority.', 'The capability cap-a has all conditions verified and still has a priority.']);
    expect((await findings(base([ok('c1'), { id: 'c2', status: 'open', derivedStatus: 'open' }], { priority: 'now' }, { id: 'cap-a', priority: 'next' }))).conditions).toEqual([]);
  });
});

describe('the strict mode of the self-check', () => {
  const loose = () => fixture({ requirements: [{ id: 'req-1', conditions: [ok('c1')] }], tests: [['test/a.test.ts', 'loose test']] });
  const clean = () => fixture({ requirements: [{ id: 'req-1', conditions: [ok('c1', { tests: [{ file: 'test/a.test.ts', name: 'linked test' }] })] }], tests: [['test/a.test.ts', 'linked test']] });

  it('exits 1 with --strict when there is a finding, and 0 without --strict', async () => {
    const args = loose();
    expect((await check([...args, '--strict'])).status).toBe(1);
    expect((await check(args)).status).toBe(0);
  });

  it('exits 0 with --strict when there is no finding', async () => {
    const r = await check([...clean(), '--strict']);
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toMatch(/Findings: 0\./);
  });

  it('prints the findings as Markdown grouped by check, and as JSON with --json', async () => {
    const args = loose();
    const md = (await check(args)).stdout;
    expect(md).toMatch(/^# Self-check/);
    expect(md).toMatch(/## tests: .* \(1\)/);
    expect(md).toMatch(/## conditions: .* \(0\)/);
    const json = JSON.parse((await check([...args, '--json'])).stdout) as Result;
    expect(json.total).toBe(1);
    expect(json.checks.map((c) => c.id)).toEqual(['tests', 'conditions']);
  });

  it('exits 2 for an unknown argument', async () => {
    expect((await check(['--nope'])).status).toBe(2);
  });
});

describe('the stable keys of the self-check', () => {
  const keys = async (args: string[]) => {
    const out = JSON.parse((await check([...args, '--json'])).stdout) as Result;
    return out.checks.flatMap((c) => c.findings.map((f) => f.key));
  };

  it('gives each finding a stable key of its check and its subject', async () => {
    const args = fixture({
      requirements: [{ id: 'req-1', state: 'draft', conditions: [ok('c1', { tests: [{ file: 'test/gone.test.ts', name: 'a test' }] }), { id: 'c2', status: 'partial', derivedStatus: 'partial' }] }],
      tests: [['test/a.test.ts', 'loose test']],
      exemptions: { exemptions: [{ file: 'test/a.test.ts', name: 'loose test' }] },
    });
    expect(await keys(args)).toEqual([
      'tests:exemption-no-reason:test/a.test.ts:loose test',
      'tests:test/a.test.ts:loose test',
      'tests:link-no-file:req-1#c1:test/gone.test.ts',
      'conditions:req-1#c2:partial-no-note',
    ]);
  });

  it('keeps the keys when an unrelated part of the repository changes', async () => {
    const make = (extra: [string, string][]) =>
      fixture({ requirements: [{ id: 'req-1', conditions: [{ id: 'c1', status: 'partial', derivedStatus: 'partial' }] }], tests: [['test/a.test.ts', 'loose test'], ...extra] });
    const before = await keys(make([]));
    const after = await keys(make([['test/b.test.ts', 'other test']]));
    expect(after.filter((k) => !k.includes('other test'))).toEqual(before);
    for (const key of after) expect(key).not.toMatch(/\d+ (tests|findings|conditions)|:\d+$/);
  });

  it('gives each finding of the surface check a key of its kind and its name', () => {
    const found = (CHECKS as { id: string; run: (ctx: unknown) => Finding[] }[]).find((c) => c.id === 'surface')!.run({ root: repo });
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) expect(f.key).toMatch(/^surface:[a-z-]+:\S.*/);
    expect(new Set(found.map((f) => f.key)).size).toBe(found.length);
  });
});

describe('the baseline of the self-check', () => {
  const loose = () => fixture({ requirements: [{ id: 'req-1', conditions: [ok('c1')] }], tests: [['test/a.test.ts', 'loose test'], ['test/a.test.ts', 'second loose test']] });
  const withBaseline = (args: string[], baseline: unknown) => {
    const file = join(args[1], 'baseline.json');
    writeFileSync(file, JSON.stringify(baseline));
    return [...args, '--baseline', file];
  };
  const both = { tests: ['tests:test/a.test.ts:loose test', 'tests:test/a.test.ts:second loose test'], conditions: [] };

  it('writes the baseline with the sorted keys of the findings by check, and prints the size of each check', async () => {
    const args = loose();
    const file = join(args[1], 'written.json');
    const r = await check([...args, '--write-baseline', '--baseline', file]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/tests 2, conditions 0/);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ tests: [...both.tests].sort(), conditions: [] });
  });

  it('writes the baseline to the default file of the root', async () => {
    const args = loose();
    expect((await check([...args, '--write-baseline'])).status).toBe(0);
    expect(existsSync(join(args[1], 'requirements/self-check-baseline.json'))).toBe(true);
  });

  it('keeps the keys of the checks that did not run when it writes the baseline with --only', async () => {
    const args = loose();
    const file = join(args[1], 'written.json');
    writeFileSync(file, JSON.stringify({ tests: ['tests:test/old.test.ts:old'], surface: ['surface:cli-flag:--kept'] }));
    expect((await check([...args, '--write-baseline', '--baseline', file])).status).toBe(0);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ tests: [...both.tests].sort(), surface: ['surface:cli-flag:--kept'], conditions: [] });
  });

  it('exits 1 for a finding that is not in the baseline, and names it and its key', async () => {
    const args = withBaseline(loose(), { tests: [both.tests[0]], conditions: [] });
    const r = await check(args);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('New finding, not in the baseline: The test has no link and no exemption: test/a.test.ts: second loose test (tests:test/a.test.ts:second loose test)');
    const json = JSON.parse((await check([...args, '--json'])).stdout) as Result;
    expect(json.gate!.new.map((f) => f.key)).toEqual(['tests:test/a.test.ts:second loose test']);
  });

  it('exits 0 when every finding is in the baseline', async () => {
    const r = await check(withBaseline(loose(), both));
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toMatch(/Gate: 0 new, 0 fixed/);
  });

  it('reports a baseline key that is no longer a finding as fixed, and exits 0', async () => {
    const r = await check(withBaseline(loose(), { tests: [...both.tests, 'tests:test/a.test.ts:gone test'], conditions: ['conditions:req-9#c1:partial-no-note'] }));
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toContain('Fixed, no longer a finding: tests:test/a.test.ts:gone test');
    expect(r.stdout).toContain('Fixed, no longer a finding: conditions:req-9#c1:partial-no-note');
    expect(r.stdout).toMatch(/Gate: 0 new, 2 fixed/);
  });

  it('does not report the keys of a check that did not run as fixed', async () => {
    const r = await check([...withBaseline(loose(), { ...both, surface: ['surface:cli-flag:--gone'] }), '--json']);
    expect((JSON.parse(r.stdout) as Result).gate!.fixed).toEqual([]);
  });

  it('exits 2 for an unreadable baseline or a baseline that is not an object of lists of keys', async () => {
    const args = loose();
    expect((await check([...args, '--baseline', join(args[1], 'missing.json')])).status).toBe(2);
    expect((await check(withBaseline(args, ['a']))).status).toBe(2);
    expect((await check(withBaseline(loose(), { tests: [1] }))).status).toBe(2);
  });

  it('gates on the default baseline file of the root when it exists, and runs in report mode when it does not', async () => {
    const args = loose();
    expect((await check(args)).status).toBe(0);
    mkdirSync(join(args[1], 'requirements'));
    writeFileSync(join(args[1], 'requirements/self-check-baseline.json'), JSON.stringify({ tests: [], conditions: [] }));
    expect((await check(args)).status).toBe(1);
  });
});

describe('the CI wiring of the self-check', () => {
  const workflow = readFileSync(join(repo, '.github/workflows/check.yml'), 'utf8');
  const steps = (parse(workflow) as { jobs: Record<string, { steps: { run?: string }[] }> }).jobs.check.steps;

  it('runs the self-check as a gate against the baseline in the CI workflow, after the test evidence', () => {
    const runs = steps.map((s) => s.run ?? '');
    const at = runs.findIndex((r) => r.trim() === 'node scripts/self-check.mjs --baseline requirements/self-check-baseline.json');
    expect(at).toBeGreaterThan(-1);
    expect(runs.slice(0, at).some((r) => r.trim() === 'npm run test:evidence')).toBe(true);
    expect(runs.join('\n')).not.toMatch(/self-check\.mjs.*--strict/);
    expect(workflow).not.toMatch(/report mode|Add --strict/);
  });

  it('fails the gate of the CI step with exit code 1 for a finding that is not in the baseline', async () => {
    const args = fixture({ requirements: [{ id: 'req-1', conditions: [ok('c1')] }], tests: [['test/a.test.ts', 'loose test']] });
    const file = join(args[1], 'baseline.json');
    writeFileSync(file, JSON.stringify({ tests: [], conditions: [] }));
    const r = await check([...args, '--baseline', file]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/New finding, not in the baseline: .*loose test/);
  });
});

describe('the gate checks of the self-check requirements', () => {
  const graph = join(repo, 'requirements/graph/requirement');
  const ids = ['req-self-tests', 'req-self-conditions', 'req-self-surface', 'req-self-strict', 'req-self-prepush'];

  it('links a check of the type gate with a command to each condition of the self-check requirements, next to its unit tests', () => {
    for (const id of ids) {
      const node = parse(readFileSync(join(graph, `${id}.yaml`), 'utf8')) as { acceptance: { id: string; tests?: { type: string; command?: string }[] }[] };
      for (const c of node.acceptance) {
        const types = (c.tests ?? []).map((t) => t.type);
        expect(types, `${id}#${c.id}`).toContain('unit');
        const gates = (c.tests ?? []).filter((t) => t.type === 'gate');
        expect(gates.length, `${id}#${c.id}`).toBeGreaterThan(0);
        for (const g of gates) expect(g.command, `${id}#${c.id}`).toMatch(/^(node|sh) \S+/);
      }
    }
  });
});
