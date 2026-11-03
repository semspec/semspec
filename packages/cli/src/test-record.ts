// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Local evidence collection. No test command runs inside Semspec.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { applyVerification, type Graph, type Profile, type TestCase } from '@semspec/core';
import { excludeMatcher } from './yaml';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const digest = (value: unknown) => hash(JSON.stringify(value));
interface Report { path: string; hash: string }
interface Snapshot { version: 1; fingerprint: string; started: number; reports: Report[]; locations: string[] }
interface RecordData { version: 1; fingerprint: string; started: number; reports: Report[]; locations: string[]; cases: TestCase[] }
type Sealed<T> = T & { integrity: string };

function locations(profile: Profile, profilePath: string) {
  if (!profile.verification) throw new Error('The profile has no verification setting.');
  const spec = profile.verification;
  const declaredRoot = resolve(dirname(profilePath), spec.root);
  const root = realpathSync(declaredRoot);
  const declaredRecord = resolve(dirname(profilePath), spec.record);
  const inside = relative(declaredRoot, declaredRecord);
  if (!inside || inside === '..' || inside.startsWith('../') || isAbsolute(inside)) throw new Error('The test record must be inside verification.root.');
  const record = resolve(root, inside);
  return { spec, root, record, pending: `${record}.pending` };
}

function files(path: string, missing = false, skip: (path: string) => boolean = () => false): string[] {
  if (skip(path)) return [];
  if (missing && !existsSync(path)) return [];
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`A test record input cannot be a symlink: ${path}`);
  }
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) throw new Error(`Not a regular input: ${path}`);
  return readdirSync(path).sort().flatMap((name) => files(resolve(path, name), false, skip));
}

function exclusions(profile: Profile, profilePath: string): (path: string) => boolean {
  const { root, spec } = locations(profile, profilePath);
  const matchers = (spec.exclude ?? []).map(excludeMatcher);
  const excluded = (path: string) => {
    const parts = relative(root, path).split('/');
    return parts.some((_, index) => matchers.some((match) => match(parts.slice(0, index + 1).join('/'))));
  };
  if (excluded(realpathSync(profilePath))) throw new Error('Fingerprint exclusions cannot hide the profile.');
  return excluded;
}

// An explicit input below root cannot bypass traversal through a directory symlink.
function inputPath(root: string, input: string): string {
  const path = resolve(root, input);
  const parts = relative(root, path);
  if (parts !== '..' && !parts.startsWith('../') && !isAbsolute(parts)) {
    let current = root;
    for (const part of parts.split('/').filter(Boolean)) {
      current = resolve(current, part);
      if (lstatSync(current).isSymbolicLink()) throw new Error(`A fingerprint input cannot follow a symlink: ${current}`);
    }
  } else if (lstatSync(path).isSymbolicLink()) throw new Error(`A fingerprint input cannot be a symlink: ${path}`);
  return path;
}

function reportsAt(root: string, paths: string[]): Report[] {
  return [...new Set(paths.flatMap((p) => files(resolve(root, p), true)).filter((p) => p.endsWith('.xml')))].sort().map((p) => ({ path: relative(root, p), hash: hash(readFileSync(p)) }));
}

export function sourceFingerprint(profile: Profile, profilePath: string): string {
  const { spec, root, record, pending } = locations(profile, profilePath);
  const configuredExclusion = exclusions(profile, profilePath);
  const excluded = (path: string) => configuredExclusion(path) || path === record || path === pending;
  const entries = new Map<string, string>();
  for (const input of spec.inputs) {
    const path = inputPath(root, input);
    const found = files(path, false, excluded);
    if (!found.length) throw new Error(`The fingerprint input has no files: ${input}`);
    for (const file of found) entries.set(relative(root, file), hash(readFileSync(file)));
  }
  // Include profile configuration even when it is outside the source roots.
  entries.set('@profile', hash(readFileSync(profilePath)));
  return digest([...entries].sort(([a], [b]) => a.localeCompare(b)));
}

function seal<T extends object>(value: T): Sealed<T> { return { ...value, integrity: digest(value) }; }
function readSealed(path: string): any {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid test record.');
  const { integrity, ...body } = value;
  if (body.version !== 1 || typeof body.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.fingerprint) || !Number.isFinite(body.started) || body.started <= 0 || integrity !== digest(body)) throw new Error('Invalid test record integrity.');
  if (!Array.isArray(body.reports) || body.reports.some((r: any) => !r || typeof r.path !== 'string' || !r.path || typeof r.hash !== 'string' || !/^[a-f0-9]{64}$/.test(r.hash))) throw new Error('Invalid test record reports.');
  return body;
}

const contains = (parent: string, child: string) => { const path = relative(parent, child); return path === '' || path !== '..' && !path.startsWith('../') && !isAbsolute(path); };
const overlaps = (a: string, b: string) => contains(a, b) || contains(b, a);

// Reject links below the canonical root. A normal /tmp alias above the root is harmless.
function plainOutput(root: string, path: string): void {
  const segments = relative(root, path).split('/');
  let current = root;
  segments.forEach((segment, index) => {
    current = resolve(current, segment);
    let stat;
    try { stat = lstatSync(current); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
    if (stat.isSymbolicLink() || (index === segments.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw new Error(`Unsafe test record output: ${current}`);
  });
}

function preflightOutputs(profile: Profile, profilePath: string, junitPaths: string[]): void {
  const { root, record, pending, spec } = locations(profile, profilePath);
  if (overlaps(record, pending)) throw new Error('Test record outputs overlap.');
  const profileFile = realpathSync(profilePath);
  const inputs = spec.inputs.map((p) => realpathSync(inputPath(root, p)));
  const excluded = exclusions(profile, profilePath);
  const authored = inputs.flatMap((input) => files(input, false, excluded));
  for (const report of junitPaths.map((path) => resolve(root, path))) {
    if (contains(report, profileFile) || authored.some((input) => contains(report, input))) throw new Error(`The JUnit report path overlaps authored inputs: ${report}`);
  }
  for (const output of [record, pending]) {
    plainOutput(root, output);
    if (overlaps(output, profileFile) || inputs.some((input) => input === output || contains(output, input) || contains(input, output) && !excluded(output)) || junitPaths.some((p) => overlaps(resolve(root, p), output))) throw new Error(`Test record output overlaps an input: ${output}`);
    if (existsSync(output)) {
      const owned = readSealed(output);
      if (!Array.isArray(owned.locations) || !owned.locations.length || owned.locations.some((p: unknown) => typeof p !== 'string' || !p) || (output === record ? !Array.isArray(owned.cases) : owned.cases !== undefined)) throw new Error(`Unmanaged test record output: ${output}`);
    }
  }
}

function writeEvidence(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = mkdtempSync(resolve(dirname(path), '.semspec-record-'));
  try {
    const file = resolve(temp, 'record');
    writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    renameSync(file, path);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

// A small strict XML reader for JUnit reports. DTDs and custom entities are forbidden.
export function parseJUnit(xml: string): TestCase[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('JUnit entity declarations are forbidden.');
  const cases: TestCase[] = [];
  const stack: string[] = [];
  const suites: { start: number; attrs: Record<string, string> }[] = [];
  let current: TestCase | undefined;
  let roots = 0;
  const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (entity in named) return named[entity];
    const code = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (code < 1 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) throw new Error('Invalid XML character.');
    return String.fromCodePoint(code);
  });
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_][\w:.-]*(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>|[^<]+/g;
  const finishSuite = () => {
    const suite = suites.pop()!;
    const members = cases.slice(suite.start);
    for (const key of ['tests', 'failures', 'errors', 'skipped']) if (suite.attrs[key] !== undefined && !/^\d+$/.test(suite.attrs[key])) throw new Error('Invalid JUnit suite count.');
    if (suite.attrs.tests !== undefined && Number(suite.attrs.tests) !== members.length) throw new Error('JUnit testcase count does not match its suite.');
    if ((suite.attrs.failures !== undefined || suite.attrs.errors !== undefined) && Number(suite.attrs.failures ?? 0) + Number(suite.attrs.errors ?? 0) !== members.filter((c) => c.outcome === 'failed').length) throw new Error('JUnit failure count does not match its cases.');
    if (suite.attrs.skipped !== undefined && Number(suite.attrs.skipped) !== members.filter((c) => c.outcome === 'not-run').length) throw new Error('JUnit skip count does not match its cases.');
  };
  let end = 0;
  for (const match of xml.matchAll(tokens)) {
    if (match.index !== end) throw new Error('Malformed JUnit XML.');
    end = match.index + match[0].length;
    const token = match[0];
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (!token.startsWith('<') || token.startsWith('<![CDATA[')) {
      if (!stack.length && token.trim()) throw new Error('Text outside the XML root.');
      if (!token.startsWith('<![CDATA[') && /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(token)) throw new Error('Unknown XML entity.');
      continue;
    }
    const name = /^<\/?([\w:.-]+)/.exec(token)![1];
    if (token.startsWith('</')) {
      if (!/^<\/[\w:.-]+\s*>$/.test(token) || stack.pop() !== name) throw new Error('Unbalanced JUnit XML.');
      if (name === 'testcase') { cases.push(current!); current = undefined; }
      if (name === 'testsuite' || name === 'testsuites') finishSuite();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of token.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/g)) {
      if (a[1] in attrs) throw new Error('Duplicate XML attribute.');
      const raw = a[2] ?? a[3];
      if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(raw)) throw new Error('Unknown XML entity.');
      attrs[a[1]] = decode(raw);
    }
    if (!stack.length) {
      roots++;
      if (roots !== 1 || !['testsuite', 'testsuites'].includes(name)) throw new Error('Invalid JUnit root.');
    }
    if (name === 'testcase') {
      if (current || stack.at(-1) !== 'testsuite' || !attrs.classname || !attrs.name) throw new Error('Invalid JUnit testcase.');
      current = { class: attrs.classname, method: attrs.name, outcome: 'passed' };
      if (['status', 'disabled', 'skipped', 'result'].some((key) => attrs[key] !== undefined)) throw new Error('JUnit testcase status attributes are not supported.');
    }
    if (name === 'testsuite' || name === 'testsuites') {
      if (attrs.disabled !== undefined && attrs.disabled !== '0') throw new Error('JUnit disabled cases are not supported.');
      suites.push({ start: cases.length, attrs });
    }
    if (!current && ['failure', 'error', 'skipped'].includes(name)) throw new Error('JUnit outcome has no testcase.');
    if (current && ['failure', 'error'].includes(name)) current.outcome = 'failed';
    if (current && name === 'skipped' && current.outcome !== 'failed') current.outcome = 'not-run';
    if (token.endsWith('/>')) {
      if (name === 'testcase') { cases.push(current!); current = undefined; }
      if (name === 'testsuite' || name === 'testsuites') finishSuite();
    } else stack.push(name);
  }
  if (end !== xml.length || stack.length || roots !== 1) throw new Error('Incomplete JUnit XML.');
  return cases;
}

export function beginTestRecord(profile: Profile, profilePath: string, junitPaths: string[]): void {
  if (!junitPaths.length) throw new Error('At least one --junit report path is required at begin.');
  const { root, record, pending } = locations(profile, profilePath);
  preflightOutputs(profile, profilePath, junitPaths);
  const snapshot: Snapshot = { version: 1, fingerprint: sourceFingerprint(profile, profilePath), started: Date.now(), reports: reportsAt(root, junitPaths), locations: junitPaths };
  writeEvidence(pending, seal(snapshot));
  // Invalidate prior evidence only after the complete new snapshot is safe on disk.
  if (existsSync(record)) unlinkSync(record);
}

export function collectTestRecord(profile: Profile, profilePath: string): RecordData {
  const { root, record, pending } = locations(profile, profilePath);
  plainOutput(root, pending);
  const snapshot = readSealed(pending) as Snapshot;
  if (!Array.isArray(snapshot.locations) || !snapshot.locations.length || snapshot.locations.some((p) => typeof p !== 'string' || !p)) throw new Error('Invalid snapshot report locations.');
  preflightOutputs(profile, profilePath, snapshot.locations);
  if (sourceFingerprint(profile, profilePath) !== snapshot.fingerprint) throw new Error('The source changed during the test run.');
  const reports = reportsAt(root, snapshot.locations);
  if (!reports.length) throw new Error('No JUnit reports found.');
  for (const report of reports) {
    if (snapshot.reports.some((old) => old.path === report.path && old.hash === report.hash) || statSync(resolve(root, report.path)).mtimeMs < snapshot.started) throw new Error(`The JUnit report was not refreshed: ${report.path}`);
  }
  const data: RecordData = { version: 1, fingerprint: snapshot.fingerprint, started: snapshot.started, reports, locations: snapshot.locations, cases: reports.flatMap((r) => parseJUnit(readFileSync(resolve(root, r.path), 'utf8'))) };
  if (sourceFingerprint(profile, profilePath) !== snapshot.fingerprint) throw new Error('The source changed during collection.');
  preflightOutputs(profile, profilePath, snapshot.locations);
  writeEvidence(record, seal(data));
  unlinkSync(pending);
  return data;
}

export function verifiedGraph(graph: Graph, profile: Profile, profilePath: string, graphPath: string): { graph: Graph; warnings: string[] } {
  if (!profile.verification) return { graph, warnings: [] };
  const { root, record, spec } = locations(profile, profilePath);
  const absoluteGraph = realpathSync(graphPath);
  const excluded = exclusions(profile, profilePath);
  if (excluded(absoluteGraph) || files(absoluteGraph).some(excluded)) throw new Error('Fingerprint exclusions cannot hide graph inputs.');
  if (!spec.inputs.some((p) => { const path = resolve(root, p); if (!existsSync(path)) return false; const input = realpathSync(path); return input === absoluteGraph || statSync(input).isDirectory() && !relative(input, absoluteGraph).startsWith('..') && !isAbsolute(relative(input, absoluteGraph)); })) throw new Error('The fingerprint inputs must include the graph.');
  let cases: TestCase[] = [];
  let stale = true;
  const warnings: string[] = [];
  if (existsSync(record)) {
    const data = readSealed(record) as RecordData;
    if (!Array.isArray(data.cases) || data.cases.some((c) => !c || typeof c.class !== 'string' || !c.class || typeof c.method !== 'string' || !c.method || !['passed', 'failed', 'not-run'].includes(c.outcome))) throw new Error('Invalid test record cases.');
    if (!Array.isArray(data.locations) || !data.locations.length || data.locations.some((p) => typeof p !== 'string' || !p)) throw new Error('Invalid test record report locations.');
    // Reparse original reports. The normalized cases must agree with them exactly.
    for (const report of data.reports) if (hash(readFileSync(resolve(root, report.path))) !== report.hash) throw new Error('The JUnit report bytes changed.');
    const actualCases = data.reports.flatMap((r) => parseJUnit(readFileSync(resolve(root, r.path), 'utf8')));
    if (digest(actualCases) !== digest(data.cases)) throw new Error('The test record cases do not match the JUnit reports.');
    if (digest(reportsAt(root, data.locations)) !== digest(data.reports)) throw new Error('The JUnit report set changed.');
    try { stale = sourceFingerprint(profile, profilePath) !== data.fingerprint; }
    catch { stale = true; }
    cases = data.cases;
  }
  if (stale) warnings.push('Test verification is stale or absent. Every condition is not-run.');
  return { graph: applyVerification(graph, profile, cases, stale), warnings };
}
