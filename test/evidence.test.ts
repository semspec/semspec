// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the evidence port: the authored and the derived status, the join in the core, the key rules,
// the alias of verification, the JUnit and Vitest JSON adapters, the self check and the coverage of both statuses.
// The fixtures in fixtures/evidence are invented. Two come from real runs of node test and Vitest. See the notes in each test.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aggregate, applyEvidence, buildIndex, buildModel, checkOutcome, conditionResult, coverage, coverageMarkdown, evidenceOf, indexGraphs, joinCheck, nodeDetail,
  type EvidenceResult, type Graph, type Profile,
} from '@semspec/core';
import { callTool } from '@semspec/mcp';
import { junitAdapter, readJUnit } from '../packages/cli/src/evidence-junit';
import { vitestAdapter } from '../packages/cli/src/evidence-vitest';
import { loadInputs, loadProfile } from '../packages/cli/src/inputs';
import { run } from '../packages/cli/src/index';
import { mcpLoader } from '../packages/cli/src/mcp';
import { beginTestRecord, collectTestRecord, sourceFingerprint, verifiedGraph } from '../packages/cli/src/test-record';

const repo = new URL('../', import.meta.url).pathname;
const fixtureFile = (name: string) => readFileSync(join(repo, 'fixtures', 'evidence', name), 'utf8');
const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })); });

const result = (key: Record<string, string>, outcome: EvidenceResult['outcome'] = 'passed'): EvidenceResult => ({ key, outcome });
const options = (source: string, separator = ' > ') => ({ root: '/work/cart', separator, source });

// A project with 5 conditions. The words differ between the 2 variants, so no word is fixed in the code.
function project(variant = 0) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'semspec-evidence-')));
  dirs.push(dir);
  const words = variant ? ['items', 'key', 'category', 'rule', 'criterion', 'criteria', 'evidence', 'result', 'src', 'tests'] : ['nodes', 'id', 'kind', 'requirement', 'condition', 'acceptance', 'tests', 'status', 'src', 'tests'];
  const [nodes, id, kind, owner, partKind, parts, tests, status] = words;
  const unit = (name: string, file = 'tests/shapes.test.ts') => ({ type: 'unit', file, name });
  const profile: Profile = {
    project: 'Example', source: { nodes, id, kind }, fields: { title: ['title'], statement: ['text'] }, lifecycle: { field: 'state', fallback: 'active' },
    kinds: [
      { id: owner, label: 'Rule', plural: 'rules', role: 'hierarchy', color: { light: '#000', dark: '#fff' }, chips: ['coverage'] },
      { id: partKind, label: 'Criterion', plural: 'criteria', role: 'part', color: { light: '#000', dark: '#fff' }, chips: ['verified'] },
      { id: 'test', label: 'Test', plural: 'tests', role: 'check', color: { light: '#000', dark: '#fff' } },
    ],
    edges: { belongs: { labels: ['Of', 'Has'], down: true }, checked: { labels: ['By', 'For'] } },
    parts: [{ kind: partKind, owner, field: parts, id: 'id', text: 'text', edge: 'belongs' }],
    checks: { kind: 'test', field: tests, edge: 'checked', typeField: 'type', types: { unit: { key: ['file', 'name'], title: ['name'] }, manual: { key: ['name'], title: ['name'] } } },
    status: { label: 'Result', field: status, values: [{ value: 'verified', label: 'Verified', tone: 'good' }, { value: 'pending', label: 'Pending', tone: 'warn' }, { value: 'failed', label: 'Failed', tone: 'bad' }] },
    evidence: { root: '.', record: 'evidence/record.json', inputs: ['src', 'graph.json'], adapters: [{ adapter: 'vitest-json', reports: ['reports'], checkTypes: ['unit'], key: { rule: 'file-name' } }] },
  };
  const condition = (cid: string, authored: string | undefined, links: unknown[]) => ({ id: cid, text: `The condition ${cid}.`, ...(authored ? { [status]: authored } : {}), [tests]: links });
  const graph: Graph = {
    [nodes]: [{
      [id]: 'r1', [kind]: owner, title: 'A rule', [status]: 'pending',
      [parts]: [
        condition('passes', 'verified', [unit('adds an item'), unit('lowers the total')]),
        condition('fails', 'verified', [unit('rejects an old coupon')]),
        condition('skips', 'verified', [unit('keeps a skipped case')]),
        condition('top', 'pending', [unit('runs at the top level')]),
        condition('none', undefined, []),
      ],
    }],
  };
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'cart.ts'), 'export const total = 0;');
  const profilePath = join(dir, 'profile.json');
  const graphPath = join(dir, 'graph.json');
  writeFileSync(profilePath, JSON.stringify(profile));
  writeFileSync(graphPath, JSON.stringify(graph));
  // The report is a real run of Vitest on an invented spec. Its paths point to the project.
  const report = () => {
    mkdirSync(join(dir, 'reports'), { recursive: true });
    const path = join(dir, 'reports', 'vitest.json');
    writeFileSync(path, fixtureFile('vitest-cart.json').replaceAll('/work/cart', join(dir, 'tests')));
    const later = new Date(Date.now() + 1000);
    utimesSync(path, later, later);
  };
  const collect = () => { beginTestRecord(profile, profilePath); report(); collectTestRecord(profile, profilePath); };
  return { dir, profile, profilePath, graph, graphPath, status, collect, report };
}

describe('Evidence port', () => {
  it('keeps the authored status next to the derived status', () => {
    for (const variant of [0, 1]) {
      const f = project(variant);
      f.collect();
      const before = readFileSync(f.graphPath, 'utf8');
      const loaded = loadInputs(f.graphPath, f.profilePath);
      const model = buildModel(loaded.graph, loaded.profile);
      const index = buildIndex(model);
      const view = (id: string) => ({ status: index.byId.get(`r1#${id}`)!.status, authored: index.byId.get(`r1#${id}`)!.authoredStatus, derived: index.byId.get(`r1#${id}`)!.derivedStatus });
      expect(view('passes')).toEqual({ status: 'verified', authored: 'verified', derived: 'verified' });
      expect(view('fails')).toEqual({ status: 'failed', authored: 'verified', derived: 'failed' });
      expect(view('skips')).toEqual({ status: 'pending', authored: 'verified', derived: 'pending' });
      expect(view('top')).toEqual({ status: 'verified', authored: 'pending', derived: 'verified' });
      expect(view('none')).toEqual({ status: 'pending', authored: undefined, derived: 'pending' });
      // The roll-up and the count of verified parts use the derived status. The authored status of the owner stays visible.
      expect(index.byId.get('r1')).toMatchObject({ status: undefined, authoredStatus: 'pending', cov: { parts: 5, verified: 2 } });
      expect(model.derived).toBe(true);
      expect(nodeDetail([{ id: 'g', label: 'G', index }], 'g', 'r1#fails')).toMatchObject({ authoredStatus: 'verified', derivedStatus: 'failed', verification: { outcome: 'failed', stale: false } });
      // The graph file keeps its authored values, and the derived graph keeps them in the status field.
      expect(readFileSync(f.graphPath, 'utf8')).toBe(before);
      expect(JSON.stringify(loaded.graph)).toContain(`"${f.status}":"verified"`);
      // Without evidence, the model has no derived field and nothing changes.
      const plain = buildModel(f.graph, { ...f.profile, evidence: undefined });
      expect(plain.derived).toBeUndefined();
      expect(plain.nodes.find((n) => n.id === 'r1#fails')).toMatchObject({ status: 'verified' });
      expect(plain.nodes.find((n) => n.id === 'r1#fails')!.derivedStatus).toBeUndefined();
      expect(plain.nodes.find((n) => n.id === 'r1')).toMatchObject({ status: 'pending' });
      // A load of the raw file with an evidence profile stays authored.
      const raw = buildModel(f.graph, f.profile);
      expect(raw.derived).toBeUndefined();
      expect(raw.nodes.find((n) => n.id === 'r1#fails')).toMatchObject({ status: 'verified' });
    }
  });

  it('joins results to checks in the core without reading any file', () => {
    const results = [result({ class: 'cart.Totals', method: 'adds()' }), result({ class: 'cart.Totals', method: 'rejects()' }, 'failed')];
    const rule = { rule: 'class-method' as const };
    expect(joinCheck({ class: 'cart.Totals', method: 'adds()' }, results, rule)).toBe('passed');
    expect(joinCheck({ class: 'cart.Totals', method: 'rejects()' }, results, rule)).toBe('failed');
    expect(joinCheck({ class: 'cart.Totals', method: 'missing()' }, results, rule)).toBe('not-run');
    expect(joinCheck({ class: 'cart.Other', method: 'adds()' }, results, rule)).toBe('none');
    expect(joinCheck({ class: 'cart.Totals' }, results, rule)).toBe('not-run');
    expect(aggregate([])).toBe('not-run');
    expect(aggregate(['passed', 'passed'])).toBe('passed');
    expect(aggregate(['passed', 'not-run'])).toBe('not-run');
    expect(aggregate(['passed', 'failed', 'not-run'])).toBe('failed');
    // A repeated case counts with the others.
    const again = [result({ file: 'a.test.ts', name: 'x' }), result({ file: 'a.test.ts', name: 'x' }, 'failed')];
    expect(joinCheck({ file: 'a.test.ts', name: 'x' }, again, { rule: 'file-name' })).toBe('failed');
    // An adapter answers only its check types. A type with no adapter is not-run.
    const spec = { adapter: 'vitest-json', checkTypes: ['unit'], key: { rule: 'file-name' as const } };
    const sets = [{ spec, results: [result({ file: 'a.test.ts', name: 'x' })] }];
    expect(checkOutcome({ file: 'a.test.ts', name: 'x' }, 'unit', sets)).toBe('passed');
    expect(checkOutcome({ file: 'a.test.ts', name: 'x' }, 'e2e', sets)).toBe('not-run');
    // 2 adapters for 1 type: a failure wins, and a pass needs no other vote.
    const other = { spec: { adapter: 'junit', key: { rule: 'class-method' as const } }, results: [result({ class: 'k', method: 'm' }, 'failed')] };
    expect(checkOutcome({ file: 'a.test.ts', name: 'x', class: 'k', method: 'm' }, 'unit', [...sets, other])).toBe('failed');
    expect(checkOutcome({ file: 'a.test.ts', name: 'x', class: 'z', method: 'm' }, 'unit', [...sets, other])).toBe('passed');
  });

  it('ignores a check of a type that no adapter answers, and keeps a condition with no answered check not-run', () => {
    const spec = { adapter: 'vitest-json', checkTypes: ['unit'], key: { rule: 'file-name' as const } };
    const sets = [{ spec, results: [result({ file: 'a.test.ts', name: 'x' }), result({ file: 'b.test.ts', name: 'z' }, 'failed')] }];
    const unit = { type: 'unit', file: 'a.test.ts', name: 'x' };
    const gate = { type: 'gate', command: 'node check.mjs' };
    expect(conditionResult([unit, gate], 'type', sets)).toBe('passed');
    expect(conditionResult([gate], 'type', sets)).toBe('not-run');
    expect(conditionResult([], 'type', sets)).toBe('not-run');
    // A failed answered check still fails the condition.
    expect(conditionResult([unit, gate, { type: 'unit', file: 'b.test.ts', name: 'z' }], 'type', sets)).toBe('failed');
    // An adapter with no check types answers every type.
    expect(conditionResult([gate], 'type', [{ spec: { ...spec, checkTypes: undefined }, results: [] }])).toBe('not-run');
  });

  it('joins a check with each of the 3 key rules', () => {
    const results = [
      result({ class: 'cart.Totals', method: 'adds', file: 'tests/cart.test.ts', name: 'adds', titlePath: 'Cart > adds' }),
      result({ class: 'cart.Totals', method: 'rejects', file: 'tests/cart.test.ts', name: 'rejects', titlePath: 'Cart > coupon > rejects' }, 'failed'),
      result({ class: 'cart.Totals', method: 'rejects', file: 'tests/other/cart.test.ts', name: 'rejects', titlePath: 'Cart > coupon > rejects' }),
    ];
    // class and method, with a simple class name and a field name from the profile
    expect(joinCheck({ suite: 'Totals', test: 'adds' }, results, { rule: 'class-method', class: 'suite', method: 'test' })).toBe('passed');
    // file and name: a path matches by its end, and 2 files with the same end are ambiguous
    expect(joinCheck({ file: 'tests/cart.test.ts', name: 'adds' }, results, { rule: 'file-name' })).toBe('passed');
    expect(joinCheck({ file: 'cart.test.ts', name: 'adds' }, results.slice(0, 2), { rule: 'file-name' })).toBe('passed');
    expect(joinCheck({ file: 'cart.test.ts', name: 'adds' }, results, { rule: 'file-name' })).toBe('not-run');
    expect(joinCheck({ file: 'cart.test.ts', name: 'rejects' }, results, { rule: 'file-name' })).toBe('not-run');
    expect(joinCheck({ file: './tests/cart.test.ts', name: 'rejects' }, results, { rule: 'file-name' })).toBe('failed');
    // file and title path: the name field of the check holds the whole path
    expect(joinCheck({ file: 'tests/cart.test.ts', name: 'Cart > coupon > rejects' }, results, { rule: 'file-titlepath' })).toBe('failed');
    expect(joinCheck({ file: 'tests/cart.test.ts', name: 'rejects' }, results, { rule: 'file-titlepath' })).toBe('not-run');
    expect(joinCheck({ path: 'tests/cart.test.ts', title: 'Cart > adds' }, results, { rule: 'file-titlepath', file: 'path', name: 'title' })).toBe('passed');
    // the separator is a setting of the rule: the adapter joins the titles with it
    const report = JSON.parse(fixtureFile('vitest-cart.json'));
    const read = vitestAdapter.read(JSON.stringify(report), options('r.json', ' / '));
    expect(joinCheck({ file: 'shapes.test.ts', name: 'Cart / with a coupon / lowers the total' }, read.results, { rule: 'file-titlepath', separator: ' / ' })).toBe('passed');
    expect(joinCheck({ file: 'shapes.test.ts', name: 'Cart > with a coupon > lowers the total' }, read.results, { rule: 'file-titlepath' })).toBe('not-run');
  });

  it('loads a record of version 1 and makes a record of an unknown version stale', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'semspec-alias-')));
    dirs.push(dir);
    const profile: Profile = {
      project: 'Example', source: { nodes: 'nodes', id: 'id', kind: 'kind' }, fields: { title: ['title'], statement: ['text'] }, lifecycle: { field: 'state', fallback: 'active' },
      kinds: [
        { id: 'rule', label: 'Rule', plural: 'rules', role: 'hierarchy', color: { light: '#000', dark: '#fff' }, chips: ['coverage'] },
        { id: 'item', label: 'Item', plural: 'items', role: 'part', color: { light: '#000', dark: '#fff' }, chips: ['verified'] },
        { id: 'test', label: 'Test', plural: 'tests', role: 'check', color: { light: '#000', dark: '#fff' } },
      ],
      edges: { belongs: { labels: ['Of', 'Has'], down: true }, checked: { labels: ['By', 'For'] } },
      parts: [{ kind: 'item', owner: 'rule', field: 'items', id: 'id', text: 'text', edge: 'belongs' }],
      checks: { kind: 'test', field: 'tests', edge: 'checked', typeField: 'type', types: { unit: { key: ['class', 'method'], title: ['method'] } } },
      status: { label: 'Result', field: 'status', values: [{ value: 'verified', label: 'Verified', tone: 'good' }, { value: 'pending', label: 'Pending', tone: 'warn' }, { value: 'failed', label: 'Failed', tone: 'bad' }] },
      verification: { root: '.', record: 'evidence/record.json', inputs: ['src', 'graph.json'], classField: 'class', methodField: 'method' },
    };
    const graph: Graph = { nodes: [{ id: 'r1', kind: 'rule', title: 'A rule', items: [{ id: 'one', text: 'One.', status: 'pending', tests: [{ type: 'unit', class: 'RulesTest', method: 'works' }] }] }] };
    const profilePath = join(dir, 'profile.json');
    const graphPath = join(dir, 'graph.json');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'Rule.java'), 'class Rule {}');
    writeFileSync(profilePath, JSON.stringify(profile));
    writeFileSync(graphPath, JSON.stringify(graph));
    const xml = '<testsuite><testcase classname="example.RulesTest" name="works()"/></testsuite>';
    mkdirSync(join(dir, 'reports'));
    writeFileSync(join(dir, 'reports', 'TEST-Rules.xml'), xml);
    // The alias is 1 JUnit adapter with the key rule class and method.
    expect(evidenceOf(profile)!.adapters).toEqual([{ adapter: 'junit', key: { rule: 'class-method', class: 'class', method: 'method' } }]);
    // A record of version 1, as the first release wrote it.
    const body = {
      version: 1, fingerprint: sourceFingerprint(profile, profilePath), started: 1,
      reports: [{ path: 'reports/TEST-Rules.xml', hash: createHash('sha256').update(xml).digest('hex') }], locations: ['reports'],
      cases: [{ class: 'example.RulesTest', method: 'works()', outcome: 'passed' }],
    };
    const seal = (value: object) => JSON.stringify({ ...value, integrity: createHash('sha256').update(JSON.stringify(value)).digest('hex') });
    mkdirSync(join(dir, 'evidence'));
    writeFileSync(join(dir, 'evidence', 'record.json'), seal(body));
    const old = verifiedGraph(graph, profile, profilePath, graphPath);
    expect(old.warnings).toEqual([]);
    expect(buildModel(old.graph, profile).nodes.find((n) => n.id === 'r1#one')).toMatchObject({ status: 'verified', authoredStatus: 'pending', derivedStatus: 'verified' });
    // The same profile written as evidence gives the same answer.
    const asEvidence: Profile = { ...profile, verification: undefined, evidence: evidenceOf(profile) };
    expect(JSON.stringify(verifiedGraph(graph, asEvidence, profilePath, graphPath).graph)).toBe(JSON.stringify(old.graph));
    // A record of an unknown version is stale with a warning. It is no error.
    writeFileSync(join(dir, 'evidence', 'record.json'), seal({ ...body, version: 9 }));
    const unknown = verifiedGraph(graph, profile, profilePath, graphPath);
    expect(unknown.warnings.join(' ')).toMatch(/unknown version 9/);
    expect(unknown.warnings).toContain('Test verification is stale or absent. Every condition is not-run.');
    expect(buildModel(unknown.graph, profile).nodes.find((n) => n.id === 'r1#one')).toMatchObject({ derivedStatus: 'pending' });
    expect(await run(['check', '--graph', graphPath, '--profile', profilePath])).toBe(0);
  });

  it('reads the reports of node test and cargo nextest and Playwright with each key rule', () => {
    // node-test.xml is a real run of node --test --test-reporter=junit. nextest.xml and playwright.xml are written by hand.
    const node = junitAdapter.read(fixtureFile('node-test.xml'), options('node-test.xml'));
    const join1 = (c: Record<string, string>, r: EvidenceResult[], rule: Parameters<typeof joinCheck>[2]) => joinCheck(c, r, rule, junitAdapter.normalise);
    expect(node.results.map((r) => r.key.file)).toEqual(['sample.test.js', 'sample.test.js', 'sample.test.js', 'sample.test.js']);
    expect(node.run).toMatchObject({ tool: 'junit', source: 'node-test.xml', at: '2026-11-03T23:47:47.469Z' });
    expect(join1({ file: 'sample.test.js', name: 'reads a number' }, node.results, { rule: 'file-name' })).toBe('passed');
    expect(join1({ file: 'sample.test.js', name: 'reports a failure' }, node.results, { rule: 'file-name' })).toBe('failed');
    expect(join1({ file: 'sample.test.js', name: 'skips this case' }, node.results, { rule: 'file-name' })).toBe('not-run');
    expect(join1({ file: 'sample.test.js', name: 'Parser > with errors > reports a failure' }, node.results, { rule: 'file-titlepath' })).toBe('failed');
    expect(join1({ file: 'sample.test.js', name: 'runs at the top level' }, node.results, { rule: 'file-titlepath' })).toBe('passed');
    expect(join1({ class: 'Parser.with errors', method: 'reports a failure' }, node.results, { rule: 'class-method' })).toBe('failed');
    // A case of the top level is a child of testsuites.
    expect(readJUnit(fixtureFile('node-test.xml')).cases.map((c) => c.class)).toContain('test');

    const nextest = junitAdapter.read(fixtureFile('nextest.xml'), options('nextest.xml'));
    expect(join1({ class: 'cart-core', method: 'totals::adds_an_item' }, nextest.results, { rule: 'class-method' })).toBe('passed');
    expect(join1({ class: 'cart-core', method: 'totals::rejects_an_old_coupon' }, nextest.results, { rule: 'class-method' })).toBe('failed');
    expect(join1({ class: 'cart-core', method: 'totals::keeps_a_skipped_case' }, nextest.results, { rule: 'class-method' })).toBe('not-run');
    expect(join1({ file: 'cart-core', name: 'totals::adds_an_item' }, nextest.results, { rule: 'file-name' })).toBe('none');

    const playwright = junitAdapter.read(fixtureFile('playwright.xml'), options('playwright.xml', ' › '));
    expect(playwright.results[0].key).toMatchObject({ file: 'cart.spec.ts', name: 'Cart › adds an item', titlePath: 'Cart › adds an item' });
    expect(join1({ file: 'cart.spec.ts', name: 'Cart › adds an item' }, playwright.results, { rule: 'file-name' })).toBe('passed');
    expect(join1({ file: 'cart.spec.ts', name: 'Cart › with a coupon › rejects an old coupon' }, playwright.results, { rule: 'file-titlepath', separator: ' › ' })).toBe('failed');
    expect(join1({ file: 'cart.spec.ts', name: 'Cart › keeps a skipped case' }, playwright.results, { rule: 'file-titlepath', separator: ' › ' })).toBe('not-run');
    expect(playwright.run.at).toBe('2026-11-03T10:00:00.000Z');

    // The JUnit reporter of Vitest writes the file as classname and joins the titles with " > ".
    const vitestXml = '<testsuites><testsuite name="test/cart.test.ts" tests="2" failures="0" errors="0" skipped="0"><testcase classname="test/cart.test.ts" name="Cart &gt; adds an item"/><testcase classname="test/cart.test.ts" name="runs at the top level"/></testsuite></testsuites>';
    const viaVitest = junitAdapter.read(vitestXml, options('v.xml'));
    expect(join1({ file: 'test/cart.test.ts', name: 'Cart > adds an item' }, viaVitest.results, { rule: 'file-titlepath' })).toBe('passed');
    expect(join1({ file: 'test/cart.test.ts', name: 'runs at the top level' }, viaVitest.results, { rule: 'file-name' })).toBe('passed');
    // The class and method rule still reads Java names.
    const java = junitAdapter.read('<testsuite><testcase classname="example.RulesTest" name="works()"/></testsuite>', options('j.xml'));
    expect(join1({ class: 'RulesTest', method: 'works' }, java.results, { rule: 'class-method' })).toBe('passed');
  });

  it('reads a Vitest JSON report with the title array in the key', () => {
    // vitest-cart.json is a real run of Vitest on an invented spec. vitest-semspec-cut.json is a cut copy of a real run of this repository.
    const cart = vitestAdapter.read(fixtureFile('vitest-cart.json'), { root: '/work/cart', separator: ' > ', source: 'vitest.json' });
    expect(cart.run).toEqual({ tool: 'vitest', source: 'vitest.json', at: '2026-11-03T23:57:33.950Z' });
    expect(cart.results.map((r) => `${r.outcome} ${r.key.titlePath}`)).toEqual([
      'passed Cart > adds an item', 'passed Cart > with a coupon > lowers the total', 'failed Cart > with a coupon > rejects an old coupon',
      'not-run Cart > keeps a skipped case', 'not-run Cart > handles gift cards', 'passed runs at the top level',
    ]);
    expect(cart.results[1].key).toEqual({ file: 'shapes.test.ts', name: 'lowers the total', titlePath: 'Cart > with a coupon > lowers the total' });
    // A title with the separator inside it is no problem, because the key holds the title itself.
    const odd = JSON.stringify({ testResults: [{ name: '/work/cart/a.test.ts', status: 'passed', assertionResults: [{ ancestorTitles: ['a > b'], title: 'c', status: 'passed' }] }] });
    expect(vitestAdapter.read(odd, options('o.json')).results[0].key).toMatchObject({ name: 'c', titlePath: 'a > b > c' });
    const cut = vitestAdapter.read(fixtureFile('vitest-semspec-cut.json'), { root: '/work/semspec', separator: ' > ', source: 'cut.json' });
    expect(cut.results).toHaveLength(4);
    expect(cut.results.every((r) => r.outcome === 'passed' && r.key.file === 'test/core.test.ts' && r.key.titlePath.startsWith('titles > '))).toBe(true);
    expect(joinCheck({ type: 'unit', file: 'test/core.test.ts', name: 'derives a sentence from an id' }, cut.results, { rule: 'file-name' })).toBe('passed');
    for (const bad of ['not json', '[]', '{"testResults":[{"name":"a.ts"}]}', '{"testResults":[{"name":"a.ts","assertionResults":[{"title":"x","ancestorTitles":[1],"status":"passed"}]}]}']) expect(() => vitestAdapter.read(bad, options('b.json'))).toThrow(/Vitest report/);
    const failedLoad = vitestAdapter.read(JSON.stringify({ testResults: [{ name: '/work/cart/b.test.ts', status: 'failed', assertionResults: [] }] }), options('f.json'));
    expect(failedLoad.warnings).toEqual(['The Vitest file failed to load: b.test.ts']);
  });

  it('counts the authored and derived status and the conditions where they differ', async () => {
    for (const variant of [0, 1]) {
      const f = project(variant);
      f.collect();
      const loader = mcpLoader({ graph: f.graphPath, profile: f.profilePath });
      const graphs = indexGraphs(loader().graphs.map((g) => ({ id: g.id, label: g.label, model: g.model })));
      const r = coverage(graphs, { list: ['differ'] });
      const by = (side: { statuses: { value: string; count: number }[]; noStatus: { count: number } }) => ({ ...Object.fromEntries(side.statuses.map((s) => [s.value, s.count])), none: side.noStatus.count });
      expect(r.evidence).toMatchObject({ conditions: 5, differ: { count: 4, percent: 80 }, stale: { count: 0, percent: 0 } });
      expect(by(r.evidence!.authored)).toEqual({ verified: 3, pending: 1, failed: 0, none: 1 });
      expect(by(r.evidence!.derived)).toEqual({ verified: 2, pending: 2, failed: 1, none: 0 });
      expect(r.list!.items.map((i) => `${i.id} ${i.authoredStatus} ${i.derivedStatus}`)).toEqual(['r1#fails verified failed', 'r1#skips verified pending', 'r1#top pending verified', 'r1#none null pending']);
      expect(coverageMarkdown(r)).toContain('Derived status differs from authored status: 4 (80%). Stale: 0 (0%).');
      expect(coverageMarkdown(r)).toContain('(authored verified, derived failed)');
      // Stale evidence counts apart, and the derived status of every condition is the not-run value.
      writeFileSync(join(f.dir, 'src', 'cart.ts'), 'export const total = 1;');
      const stale = coverage(indexGraphs(loader().graphs.map((g) => ({ id: g.id, label: g.label, model: g.model }))), { list: ['stale'] });
      expect(stale.evidence).toMatchObject({ conditions: 5, stale: { count: 5, percent: 100 } });
      expect(by(stale.evidence!.derived)).toEqual({ verified: 0, pending: 5, failed: 0, none: 0 });
      expect(stale.list!.items.every((i) => i.stale === true)).toBe(true);
    }
    // A graph with no evidence has no evidence block.
    const f = project();
    const plain = indexGraphs([{ id: 'g', label: 'G', model: buildModel(f.graph, { ...f.profile, evidence: undefined }) }]);
    expect(coverage(plain, {}).evidence).toBeUndefined();
    expect(coverage(plain, { statusSource: 'authored' }).total.statuses.find((s) => s.value === 'verified')!.count).toBe(3);
  });

  it('starts a workspace in the MCP server with a warning when the test evidence cannot load', () => {
    const f = project();
    f.collect();
    const recordPath = join(f.dir, 'evidence', 'record.json');
    writeFileSync(recordPath, readFileSync(recordPath, 'utf8').replace('passed', 'failed'));
    const workspace = join(f.dir, 'workspace.json');
    writeFileSync(workspace, JSON.stringify({ title: 'Cart', graphs: [{ id: 'cart', label: 'Cart', graph: 'graph.json', profile: 'profile.json' }] }));
    const loaded = mcpLoader({ workspace })();
    expect(loaded.warnings.join(' ')).toMatch(/The test evidence cannot load/);
    expect(loaded.graphs.map((g) => g.id)).toEqual(['cart']);
  });

  it('selects the status source for the filters and the groups and the gate', async () => {
    const f = project();
    f.collect();
    const loader = mcpLoader({ graph: f.graphPath, profile: f.profilePath });
    const graphs = indexGraphs(loader().graphs.map((g) => ({ id: g.id, label: g.label, model: g.model })));
    const verified = (q: Parameters<typeof coverage>[1]) => coverage(graphs, { list: ['verified', 'failed'], ...q });
    expect(verified({}).total.statuses.find((s) => s.value === 'verified')!.count).toBe(2);
    expect(verified({ statusSource: 'derived' }).total.statuses.find((s) => s.value === 'verified')!.count).toBe(2);
    expect(verified({ statusSource: 'authored' }).total.statuses.find((s) => s.value === 'verified')!.count).toBe(3);
    expect(verified({ statuses: ['verified'], statusSource: 'authored' }).total.conditions).toBe(3);
    expect(verified({ statuses: ['verified'], statusSource: 'derived' }).list!.items.map((i) => i.id)).toEqual(['r1#passes', 'r1#top']);
    expect(verified({ statuses: ['verified'], statusSource: 'authored' }).list!.items.map((i) => i.id)).toEqual(['r1#passes', 'r1#fails', 'r1#skips']);
    // A group by the status field reads the selected status, as the counts do.
    const groupOf = (source: 'authored' | 'derived', key: string) => verified({ statusSource: source, group: 'status' }).graphs[0].groups!.find((g) => g.key === key);
    expect(groupOf('authored', 'verified')!.conditions).toBe(3);
    expect(groupOf('derived', 'verified')!.conditions).toBe(2);
    expect(groupOf('derived', 'verified')!.statuses.find((s) => s.value === 'verified')!.count).toBe(2);
    expect(coverage(graphs, { gate: ['bad'], statusSource: 'authored' }).gate!.pass).toBe(true);
    expect(coverage(graphs, { gate: ['bad'], statusSource: 'derived' }).gate!.failing.map((i) => i.id)).toEqual(['r1#fails']);
    expect(coverage(graphs, { gate: ['bad'] }).gate!.pass).toBe(false);
    expect(() => coverage(graphs, { statusSource: 'both' as never })).toThrow(/Unknown status source/);

    // The MCP tool takes statusSource.
    const viaTool = callTool(loader, 'coverage', { statusSource: 'authored', format: 'json' }) as any;
    expect(viaTool.statusSource).toBe('authored');
    expect(viaTool.total.statuses.find((s: any) => s.value === 'verified').count).toBe(3);
    expect(() => callTool(loader, 'coverage', { statusSource: 'both' })).toThrow(/Unknown status source/);

    // The command takes --status-source and the list words differ and stale.
    const out: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((m) => void out.push(String(m)));
    try {
      const base = ['coverage', '--graph', f.graphPath, '--profile', f.profilePath, '--json'];
      expect(await run([...base, '--status-source', 'authored', '--gate', 'bad'])).toBe(0);
      expect(await run([...base, '--status-source', 'derived', '--gate', 'bad'])).toBe(1);
      expect(await run([...base, '--list', 'differ'])).toBe(0);
      expect(JSON.parse(out.at(-1)!).list.total).toBe(4);
      expect(await run([...base, '--status-source', 'both'])).toBe(2);
    } finally { log.mockRestore(); }
  });

  it('derives the status of the conditions of Semspec from its own Vitest report', async () => {
    const profilePath = join(repo, 'requirements', 'profile.yaml');
    const profile = loadProfile(profilePath);
    const spec = evidenceOf(profile)!;
    expect(spec.adapters).toEqual([{ adapter: 'vitest-json', reports: ['dist/vitest.json', 'dist/vitest-site.json'], checkTypes: ['unit'], key: { rule: 'file-name' } }]);
    expect(spec.record.startsWith('../dist/') || spec.record.includes('dist/')).toBe(true);
    // The test names of the graph are the bare titles of the tests, so they join the report by file and name.
    const graphPath = join(repo, 'requirements', 'graph');
    const cut = vitestAdapter.read(fixtureFile('vitest-semspec-cut.json'), { root: '/work/semspec', separator: ' > ', source: 'cut.json' });
    expect(joinCheck({ type: 'unit', file: 'test/core.test.ts', name: 'derives a sentence from an id' }, cut.results, spec.adapters[0].key)).toBe('passed');
    // A report that lists every test of the graph joins every condition that has a test. One failed test fails its conditions.
    const raw = buildModel(loadInputs(graphPath, profilePath).graph, profile);
    const checks = raw.nodes.filter((n) => n.kind === profile.checks!.kind && n.d.type === 'unit');
    expect(checks.length).toBeGreaterThan(50);
    const failing = checks[0].d.name as string;
    const report = { startTime: 1, testResults: [...new Set(checks.map((c) => c.d.file as string))].map((file) => ({ name: join(repo, file), status: 'passed', assertionResults: checks.filter((c) => c.d.file === file).map((c) => ({ ancestorTitles: ['group'], title: c.d.name, status: c.d.name === failing ? 'failed' : 'passed' })) })) };
    const read = vitestAdapter.read(JSON.stringify(report), { root: repo, separator: ' > ', source: 'dist/vitest.json' });
    const derived = buildModel(applyEvidence(loadInputs(graphPath, profilePath).graph, profile, [{ spec: spec.adapters[0], results: read.results }], false), profile);
    const parts = derived.nodes.filter((n) => n.derivedStatus !== undefined);
    const withTests = parts.filter((n) => (n.d.checks as unknown[]).length > 0);
    expect(withTests.length).toBeGreaterThan(40);
    const hasFailing = (n: (typeof parts)[number]) => (n.d.checks as { name: string }[]).some((c) => c.name === failing);
    expect(withTests.filter((n) => n.derivedStatus === 'verified').length).toBe(withTests.filter((n) => !hasFailing(n)).length);
    expect(withTests.filter(hasFailing).every((n) => n.derivedStatus === 'open')).toBe(true);
    expect(withTests.filter(hasFailing).length).toBeGreaterThan(0);
    expect(spec.fallback).toBe('authored');
    // With the fallback authored, a load without a record keeps the authored status and writes a warning.
    const f = project();
    const fallback = { ...f.profile, evidence: { ...f.profile.evidence!, fallback: 'authored' as const } };
    const absent = verifiedGraph(f.graph, fallback, f.profilePath, f.graphPath);
    expect(absent.warnings).toEqual(['Test evidence is stale or absent. The statuses stay authored.']);
    expect(absent.graph).toBe(f.graph);
    expect(buildModel(absent.graph, fallback).derived).toBeUndefined();
    // The default fallback makes every condition not-run.
    expect(buildModel(verifiedGraph(f.graph, f.profile, f.profilePath, f.graphPath).graph, f.profile).nodes.find((n) => n.id === 'r1#passes')).toMatchObject({ status: 'pending', authoredStatus: 'verified' });
    // The check passes for the repository, with or without a report.
    expect(await run(['check', '--graph', graphPath, '--profile', profilePath])).toBe(0);
  });
});
