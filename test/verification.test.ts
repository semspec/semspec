// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyVerification, buildIndex, buildModel, conditionOutcome, nodeDetail, summaryOf, type Graph, type Profile, type TestCase } from '@semspec/core';
import { beginTestRecord, collectTestRecord, parseJUnit, sourceFingerprint, verifiedGraph } from '../packages/cli/src/test-record';
import { loadInputs } from '../packages/cli/src/inputs';
import { run } from '../packages/cli/src/index';
import { mcpLoader } from '../packages/cli/src/mcp';

const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })); });
const xml = (body: string) => `<testsuite>${body}</testsuite>`;
const testcase = (name: string, inner = '', cls = 'example.RulesTest') => `<testcase classname="${cls}" name="${name}">${inner}</testcase>`;

function fixture(variant = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'semspec-verification-'));
  dirs.push(dir);
  const words = variant ? ['items', 'key', 'category', 'rule', 'criterion', 'criteria', 'evidence', 'result', 'suite', 'operation'] : ['nodes', 'id', 'kind', 'requirement', 'condition', 'acceptance', 'tests', 'status', 'class', 'method'];
  const [nodes, id, kind, owner, partKind, parts, tests, status, classField, methodField] = words;
  const profile: Profile = {
    project: 'Example', source: { nodes, id, kind }, fields: { title: ['title'], statement: ['text'] }, lifecycle: { field: 'state', fallback: 'active' },
    kinds: [
      { id: owner, label: 'Rule', plural: 'rules', role: 'hierarchy', color: { light: '#000', dark: '#fff' }, chips: ['coverage'] },
      { id: partKind, label: 'Criterion', plural: 'criteria', role: 'part', color: { light: '#000', dark: '#fff' }, chips: ['verified'] },
      { id: 'test', label: 'Test', plural: 'tests', role: 'check', color: { light: '#000', dark: '#fff' } },
    ],
    edges: { belongs: { labels: ['Of', 'Has'], down: true }, checked: { labels: ['By', 'For'] } },
    parts: [{ kind: partKind, owner, field: parts, id: 'id', text: 'text', edge: 'belongs' }],
    checks: { kind: 'test', field: tests, edge: 'checked', typeField: 'type', types: { unit: { key: [classField, methodField], title: [methodField] } } },
    status: { label: 'Result', field: status, values: [{ value: 'verified', label: 'Verified', tone: 'good' }, { value: 'pending', label: 'Pending', tone: 'warn' }, { value: 'failed', label: 'Failed', tone: 'bad' }] },
    verification: { root: '.', record: 'evidence/record.json', inputs: ['src', 'graph.json'], classField, methodField },
  };
  const condition = { id: 'one', text: 'A condition.', [status]: 'verified', [tests]: [{ type: 'unit', [classField]: 'RulesTest', [methodField]: 'works' }] };
  const graph: Graph = { [nodes]: [{ [id]: 'r1', [kind]: owner, title: 'A rule', [status]: 'verified', [parts]: [condition] }] };
  const profilePath = join(dir, 'profile.json');
  const graphPath = join(dir, 'graph.json');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'Rule.java'), 'class Rule {}');
  writeFileSync(profilePath, JSON.stringify(profile));
  writeFileSync(graphPath, JSON.stringify(graph));
  const report = (body = testcase('works()')) => {
    mkdirSync(join(dir, 'reports'), { recursive: true });
    const path = join(dir, 'reports', 'TEST-Rules.xml');
    writeFileSync(path, xml(body));
    const now = new Date(Date.now() + 1000);
    utimesSync(path, now, now);
  };
  return { dir, profile, profilePath, graph, graphPath, report, status };
}

describe('JUnit verification', () => {
  it('aggregates named tests conservatively', () => {
    const tests = [{ class: 'RulesTest', method: 'works' }];
    const pass: TestCase = { class: 'example.RulesTest', method: 'works()', outcome: 'passed' };
    const outcome = (cases: TestCase[], links: unknown = tests) => conditionOutcome(links, cases, 'class', 'method');
    expect(outcome([pass])).toBe('passed');
    expect(outcome([])).toBe('not-run');
    expect(outcome([pass], [])).toBe('not-run');
    expect(outcome([pass], [...tests, { class: 'RulesTest', method: 'missing' }])).toBe('not-run');
    expect(outcome([pass, { ...pass, outcome: 'not-run' }])).toBe('not-run');
    expect(outcome([pass, { ...pass, outcome: 'failed' }])).toBe('failed');
    expect(outcome([pass, { ...pass, class: 'other.RulesTest' }])).toBe('not-run');
    expect(outcome([pass, { ...pass, class: 'other.RulesTest' }], [{ class: 'example.RulesTest', method: 'works' }])).toBe('passed');
    expect(outcome([{ ...pass, method: 'works()[1]' }, { ...pass, method: 'works()[2]', outcome: 'failed' }])).toBe('failed');
    expect(outcome([{ ...pass, method: 'works()[1]' }, { ...pass, method: 'works()[2]' }])).toBe('passed');
    expect(outcome([{ ...pass, method: 'A custom display name' }])).toBe('not-run');
  });

  it('validates report and record integrity', () => {
    expect(parseJUnit(xml(testcase('a') + testcase('b', '<skipped/>') + testcase('c', '<failure message="bad"/>') + testcase('d', '<error/>'))).map((c) => c.outcome)).toEqual(['passed', 'not-run', 'failed', 'failed']);
    expect(parseJUnit('<testsuite tests="0" failures="0" errors="0" skipped="0"/>')).toEqual([]);
    expect(parseJUnit(xml(testcase('name &amp; value')))[0].method).toBe('name & value');
    for (const bad of [xml(testcase('a')).slice(0, -1), '<!DOCTYPE testsuite><testsuite/>', '<testsuite><testcase name="a"/></testsuite>', '<testsuite></wrong>', '<testsuite/><testsuite/>', '<testsuite tests="2"/>', '<testsuite failures="1" errors="0"/>', xml(testcase('&unknown;'))]) expect(() => parseJUnit(bad)).toThrow();
    expect(() => parseJUnit(`<testsuites tests="1" failures="1">${xml(testcase('a'))}</testsuites>`)).toThrow(/failure count/);
    expect(() => parseJUnit(`<testsuites tests="2">${xml(testcase('a'))}</testsuites>`)).toThrow(/testcase count/);
    for (const marker of ['status="notrun"', 'status="disabled"', 'disabled="true"', 'result="suppressed"', 'skipped="true"']) expect(() => parseJUnit(`<testsuite><testcase classname="example.RulesTest" name="a" ${marker}/></testsuite>`)).toThrow(/status attributes/);
    expect(() => parseJUnit('<testsuite disabled="1"/>')).toThrow(/disabled/);
    const f = fixture();
    beginTestRecord(f.profile, f.profilePath, ['reports']);
    f.report();
    collectTestRecord(f.profile, f.profilePath);
    const recordPath = join(f.dir, 'evidence', 'record.json');
    const original = readFileSync(recordPath, 'utf8');
    writeFileSync(recordPath, original.replace('passed', 'failed'));
    expect(() => verifiedGraph(f.graph, f.profile, f.profilePath, f.graphPath)).toThrow(/integrity/);
    writeFileSync(recordPath, original);
    expect(verifiedGraph(f.graph, f.profile, f.profilePath, f.graphPath).warnings).toEqual([]);
  });

  it('starts the MCP server with a warning when the test evidence cannot load', async () => {
    const f = fixture();
    beginTestRecord(f.profile, f.profilePath, ['reports']);
    f.report();
    collectTestRecord(f.profile, f.profilePath);
    const recordPath = join(f.dir, 'evidence', 'record.json');
    writeFileSync(recordPath, readFileSync(recordPath, 'utf8').replace('passed', 'failed'));
    const loaded = mcpLoader({ graph: f.graphPath, profile: f.profilePath })();
    expect(loaded.warnings.join(' ')).toMatch(/The test evidence cannot load: .*integrity.* Every condition is not-run\./);
    expect(JSON.stringify(loaded.graphs[0].graph)).toContain('"outcome":"not-run"');
    expect(await run(['check', '--graph', f.graphPath, '--profile', f.profilePath])).not.toBe(0);
  });

  it('makes the evidence stale when a report changes or disappears after collection', () => {
    const f = fixture();
    beginTestRecord(f.profile, f.profilePath, ['reports']);
    f.report();
    collectTestRecord(f.profile, f.profilePath);
    const outcome = (g: Graph) => JSON.stringify(g).match(/"outcome":"([a-z-]+)"/)?.[1];
    expect(outcome(verifiedGraph(f.graph, f.profile, f.profilePath, f.graphPath).graph)).toBe('passed');
    f.report(testcase('works()', '<failure/>'));
    const changed = verifiedGraph(f.graph, f.profile, f.profilePath, f.graphPath);
    expect(changed.warnings.join(' ')).toMatch(/1 of 1 changed or missing/);
    expect(changed.warnings).toContain('Test verification is stale or absent. Every condition is not-run.');
    expect(outcome(changed.graph)).toBe('not-run');
    rmSync(join(f.dir, 'reports'), { recursive: true, force: true });
    const missing = verifiedGraph(f.graph, f.profile, f.profilePath, f.graphPath);
    expect(missing.warnings.join(' ')).toMatch(/1 of 1 changed or missing, and the report set changed/);
    expect(outcome(missing.graph)).toBe('not-run');
  });

  it('preserves sources and evidence when output preflight fails', () => {
    const f = fixture();
    const graphBefore = readFileSync(f.graphPath, 'utf8');
    const withRecord = (record: string): Profile => ({ ...f.profile, verification: { ...f.profile.verification!, record } });
    expect(() => beginTestRecord(withRecord('graph.json'), f.profilePath, ['reports'])).toThrow();
    expect(readFileSync(f.graphPath, 'utf8')).toBe(graphBefore);
    expect(() => beginTestRecord(withRecord('profile.json'), f.profilePath, ['reports'])).toThrow();
    expect(() => beginTestRecord(withRecord('src/new-record.json'), f.profilePath, ['reports'])).toThrow();
    mkdirSync(join(f.dir, 'evidence'));
    symlinkSync(f.graphPath, join(f.dir, 'evidence', 'record.json.pending'));
    expect(() => beginTestRecord(f.profile, f.profilePath, ['reports'])).toThrow(/Unsafe/);
    expect(readFileSync(f.graphPath, 'utf8')).toBe(graphBefore);
    rmSync(join(f.dir, 'evidence', 'record.json.pending'));
    symlinkSync(join(f.dir, 'src'), join(f.dir, 'alias'));
    expect(() => beginTestRecord(withRecord('alias/new-record.json'), f.profilePath, ['reports'])).toThrow(/Unsafe/);
    writeFileSync(join(f.dir, 'evidence', 'record.json'), 'unmanaged sentinel');
    expect(() => beginTestRecord(f.profile, f.profilePath, ['reports'])).toThrow();
    expect(readFileSync(join(f.dir, 'evidence', 'record.json'), 'utf8')).toBe('unmanaged sentinel');
    rmSync(join(f.dir, 'evidence', 'record.json'));
    beginTestRecord(f.profile, f.profilePath, ['reports']);
    f.report();
    collectTestRecord(f.profile, f.profilePath);
    const recordBefore = readFileSync(join(f.dir, 'evidence', 'record.json'), 'utf8');
    const invalidInput = { ...f.profile, verification: { ...f.profile.verification!, inputs: ['missing', 'graph.json'] } };
    expect(() => beginTestRecord(invalidInput, f.profilePath, ['reports'])).toThrow();
    expect(readFileSync(join(f.dir, 'evidence', 'record.json'), 'utf8')).toBe(recordBefore);
    expect(() => beginTestRecord(f.profile, f.profilePath, ['evidence'])).toThrow(/overlaps/);
    expect(readFileSync(join(f.dir, 'evidence', 'record.json'), 'utf8')).toBe(recordBefore);
    beginTestRecord(f.profile, f.profilePath, ['reports']);
    f.report(testcase('works()', '<system-out>second run</system-out>'));
    symlinkSync(f.graphPath, join(f.dir, 'evidence', 'record.json'));
    expect(() => collectTestRecord(f.profile, f.profilePath)).toThrow(/Unsafe/);
    expect(readFileSync(f.graphPath, 'utf8')).toBe(graphBefore);
  });

  it('uses derived failure evidence in the check command', async () => {
    const f = fixture();
    f.profile.gates = { fail: ['bad-status'] };
    writeFileSync(f.profilePath, JSON.stringify(f.profile));
    beginTestRecord(f.profile, f.profilePath, ['reports']);
    f.report(testcase('works()', '<failure/>'));
    collectTestRecord(f.profile, f.profilePath);
    expect(await run(['check', '--profile', f.profilePath, '--graph', f.graphPath, '--json'])).toBe(1);
    const loaded = loadInputs(f.graphPath, f.profilePath);
    expect(buildModel(loaded.graph, loaded.profile).nodes.find((n) => n.id === 'r1#one')!.d.verification).toEqual({ outcome: 'failed', stale: false });
  });

  it('excludes generated outputs while retaining source changes', () => {
    const f = fixture();
    mkdirSync(join(f.dir, 'module', 'src'), { recursive: true });
    mkdirSync(join(f.dir, 'module', 'build'), { recursive: true });
    mkdirSync(join(f.dir, 'module', '.gradle'), { recursive: true });
    writeFileSync(join(f.dir, 'module', 'build.gradle.kts'), 'plugins {}');
    const source = join(f.dir, 'module', 'src', 'Rule.java');
    writeFileSync(source, 'class Rule {}');
    f.profile.verification = { ...f.profile.verification!, record: 'module/build/verification.json', inputs: ['module', 'graph.json'], exclude: ['**/build/**', '**/.gradle/**'] };
    writeFileSync(f.profilePath, JSON.stringify(f.profile));
    const initial = sourceFingerprint(f.profile, f.profilePath);
    beginTestRecord(f.profile, f.profilePath, ['reports']);
    f.report();
    writeFileSync(join(f.dir, 'module', 'build', 'Rule.class'), 'compiled output');
    writeFileSync(join(f.dir, 'module', '.gradle', 'cache'), 'cache output');
    collectTestRecord(f.profile, f.profilePath);
    expect(sourceFingerprint(f.profile, f.profilePath)).toBe(initial);
    expect(verifiedGraph(f.graph, f.profile, f.profilePath, f.graphPath).warnings).toEqual([]);
    const addition = join(f.dir, 'module', 'src', 'Added.java');
    writeFileSync(addition, 'class Added {}');
    expect(sourceFingerprint(f.profile, f.profilePath)).not.toBe(initial);
    rmSync(addition);
    writeFileSync(source, 'class Rule { int value; }');
    expect(sourceFingerprint(f.profile, f.profilePath)).not.toBe(initial);
    expect(verifiedGraph(f.graph, f.profile, f.profilePath, f.graphPath).warnings).toHaveLength(1);
    rmSync(source);
    expect(sourceFingerprint(f.profile, f.profilePath)).not.toBe(initial);
    symlinkSync(join(f.dir, 'src'), join(f.dir, 'module', 'linked'));
    expect(() => sourceFingerprint(f.profile, f.profilePath)).toThrow(/symlink/);
    const viaLink = { ...f.profile, verification: { ...f.profile.verification!, inputs: ['module/linked/Rule.java', 'graph.json'] } };
    expect(() => sourceFingerprint(viaLink, f.profilePath)).toThrow(/symlink/);
    rmSync(join(f.dir, 'module', 'linked'));
    const hidingProfile = { ...f.profile, verification: { ...f.profile.verification!, exclude: ['profile.json'] } };
    expect(() => beginTestRecord(hidingProfile, f.profilePath, ['reports'])).toThrow(/hide the profile/);
    const hidingGraph = { ...f.profile, verification: { ...f.profile.verification!, exclude: ['graph.json'] } };
    expect(() => verifiedGraph(f.graph, hidingGraph, f.profilePath, f.graphPath)).toThrow(/hide graph/);
    const graphOutput = { ...f.profile, verification: { ...f.profile.verification!, record: 'graph.json', exclude: ['graph.json'] } };
    const before = readFileSync(f.graphPath, 'utf8');
    expect(() => beginTestRecord(graphOutput, f.profilePath, ['reports'])).toThrow(/overlaps/);
    expect(readFileSync(f.graphPath, 'utf8')).toBe(before);
    const hiddenEmpty = { ...f.profile, verification: { ...f.profile.verification!, inputs: ['module/build', 'graph.json'] } };
    expect(() => beginTestRecord(hiddenEmpty, f.profilePath, ['reports'])).toThrow(/no files/);
  });

  it('rejects report paths that contain authored inputs', () => {
    const f = fixture();
    f.profile.verification = { ...f.profile.verification!, inputs: ['.'], exclude: ['evidence/**', 'reports/**'] };
    writeFileSync(f.profilePath, JSON.stringify(f.profile));
    beginTestRecord(f.profile, f.profilePath, ['reports']);
    f.report();
    collectTestRecord(f.profile, f.profilePath);
    const recordPath = join(f.dir, 'evidence', 'record.json');
    const before = readFileSync(recordPath, 'utf8');
    for (const report of ['.', 'src', 'graph.json']) {
      expect(() => beginTestRecord(f.profile, f.profilePath, [report])).toThrow(/overlaps authored inputs/);
      expect(readFileSync(recordPath, 'utf8')).toBe(before);
    }
    expect(verifiedGraph(f.graph, f.profile, f.profilePath, f.graphPath).warnings).toEqual([]);
    const sourcePath = join(f.dir, 'src', 'Rule.java');
    const source = readFileSync(sourcePath, 'utf8');
    writeFileSync(sourcePath, 'class Rule { int changed; }');
    expect(verifiedGraph(f.graph, f.profile, f.profilePath, f.graphPath).warnings).toHaveLength(1);
    writeFileSync(sourcePath, source);
    writeFileSync(f.graphPath, readFileSync(f.graphPath, 'utf8').replace('works', 'differentConditionMethod'));
    const stale = verifiedGraph(f.graph, f.profile, f.profilePath, f.graphPath);
    expect(buildModel(stale.graph, f.profile).nodes.find((node) => node.id === 'r1#one')!.d.verification).toEqual({ outcome: 'not-run', stale: true });
  });

  it('rejects stale sources and old reports', () => {
    const f = fixture();
    f.report();
    beginTestRecord(f.profile, f.profilePath, ['reports']);
    expect(() => collectTestRecord(f.profile, f.profilePath)).toThrow(/not refreshed/);
    f.report(testcase('works()', '<system-out>new run</system-out>'));
    writeFileSync(join(f.dir, 'src', 'Rule.java'), 'class Rule { int changed; }');
    expect(() => collectTestRecord(f.profile, f.profilePath)).toThrow(/source changed/);
    beginTestRecord(f.profile, f.profilePath, ['reports']);
    f.report();
    collectTestRecord(f.profile, f.profilePath);
    expect(verifiedGraph(f.graph, f.profile, f.profilePath, f.graphPath).warnings).toEqual([]);
    writeFileSync(join(f.dir, 'src', 'Rule.java'), 'class Rule { int later; }');
    const stale = verifiedGraph(f.graph, f.profile, f.profilePath, f.graphPath);
    expect(stale.warnings).toHaveLength(1);
    const condition = buildModel(stale.graph, f.profile).nodes.find((n) => n.id === 'r1#one')!;
    expect(condition.d.verification).toEqual({ outcome: 'not-run', stale: true });
    expect(condition.status).toBe('pending');
    expect(() => sourceFingerprint({ ...f.profile, verification: { ...f.profile.verification!, inputs: ['missing'] } }, f.profilePath)).toThrow();
  });

  it('derives model status without editing the graph', async () => {
    for (const variant of [0, 1]) {
    const f = fixture(variant);
    const before = readFileSync(f.graphPath, 'utf8');
    expect(await run(['test-record', '--profile', f.profilePath, '--phase', 'begin', '--junit', 'reports'])).toBe(0);
    f.report();
    expect(await run(['test-record', '--profile', f.profilePath, '--phase', 'collect'])).toBe(0);
    const loaded = loadInputs(f.graphPath, f.profilePath);
    const model = buildModel(loaded.graph, loaded.profile);
    const index = buildIndex(model);
    const condition = index.byId.get('r1#one')!;
    expect(condition.status).toBe('verified');
    expect(condition.d.verification).toEqual({ outcome: 'passed', stale: false });
    expect(summaryOf(index, condition).chips.some((c) => c.text === 'passed')).toBe(true);
    expect(model.nodes.find((n) => n.id === 'r1')!.cov).toEqual({ parts: 1, verified: 1 });
    expect(nodeDetail([{ id: 'g', label: 'Graph', index }], 'g', condition.id).verification).toEqual({ outcome: 'passed', stale: false });
    expect(readFileSync(f.graphPath, 'utf8')).toBe(before);
    // Profile and condition mappings are part of the source snapshot too.
    writeFileSync(f.graphPath, before.replace('works', 'other'));
    expect(loadInputs(f.graphPath, f.profilePath).warnings).toContain('Test verification is stale or absent. Every condition is not-run.');
    const noVerification = { ...f.profile, verification: undefined };
    expect(applyVerification(f.graph, noVerification, [], true)).toBe(f.graph);
    }
  });
});
