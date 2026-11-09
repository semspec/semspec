// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Local evidence collection. No test command runs inside Semspec.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { parseJUnit } from './evidence-junit';
import { DEFAULT_SEPARATOR, applyEvidence, evidenceOf, type AdapterSet, type EvidenceOutcome, type EvidenceResult, type EvidenceRun, type Graph, type Profile, type TestCase } from '@semspec/core';
import { excludeMatcher } from './yaml';
import { adapterFor } from './evidence-adapters';
export { parseJUnit } from './evidence-junit';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const digest = (value: unknown) => hash(JSON.stringify(value));
// A record of version 1 holds JUnit cases. A record of version 2 holds the results of each adapter.
// A report of version 1 has no adapter, and the JUnit adapter reads it.
interface Report { path: string; hash: string; adapter?: number }
interface Snapshot { version: 2; fingerprint: string; started: number; reports: Report[]; locations: string[]; sources: string[][] }
interface RecordV1 { version: 1; fingerprint: string; started: number; reports: Report[]; locations: string[]; cases: TestCase[] }
interface RecordV2 { version: 2; fingerprint: string; started: number; reports: Report[]; locations: string[]; sources: string[][]; results: EvidenceResult[][]; runs: EvidenceRun[] }
type RecordData = RecordV1 | RecordV2;
type Sealed<T> = T & { integrity: string };
const VERSIONS = [1, 2];

// The record has a version that this release does not know. The evidence is stale, and it is no error.
class UnknownVersion extends Error {}

function locations(profile: Profile, profilePath: string) {
  const spec = evidenceOf(profile);
  if (!spec) throw new Error('The profile has no evidence setting.');
  const declaredRoot = resolve(dirname(profilePath), spec.root);
  const root = realpathSync(declaredRoot);
  const declaredRecord = resolve(dirname(profilePath), spec.record);
  const inside = relative(declaredRoot, declaredRecord);
  if (!inside || inside === '..' || inside.startsWith('../') || isAbsolute(inside)) throw new Error('The test record must be inside the evidence root.');
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

// The report paths of each adapter. The paths of --junit at begin go to the first JUnit adapter.
function sourcesOf(spec: NonNullable<ReturnType<typeof evidenceOf>>, extra: string[]): string[][] {
  const firstJunit = spec.adapters.findIndex((a) => a.adapter === 'junit');
  return spec.adapters.map((a, i) => [...new Set([...(a.reports ?? []), ...(i === firstJunit ? extra : [])])]);
}

function reportsAt(root: string, spec: NonNullable<ReturnType<typeof evidenceOf>>, sources: string[][], versioned = true): Report[] {
  return spec.adapters.flatMap((a, adapter) => {
    const extension = adapterFor(a.adapter).extension;
    return [...new Set(sources[adapter].flatMap((p) => files(resolve(root, p), true)).filter((p) => p.endsWith(extension)))].sort().map((p) => ({ path: relative(root, p), hash: hash(readFileSync(p)), ...(versioned ? { adapter } : {}) }));
  });
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
  if (Number.isInteger(body.version) && !VERSIONS.includes(body.version)) throw new UnknownVersion(`The test record has the unknown version ${body.version}.`);
  if (!VERSIONS.includes(body.version) || typeof body.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.fingerprint) || !Number.isFinite(body.started) || body.started <= 0 || integrity !== digest(body)) throw new Error('Invalid test record integrity.');
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
    if (contains(report, profileFile) || authored.some((input) => contains(report, input))) throw new Error(`The report path overlaps authored inputs: ${report}`);
  }
  for (const output of [record, pending]) {
    plainOutput(root, output);
    if (overlaps(output, profileFile) || inputs.some((input) => input === output || contains(output, input) || contains(input, output) && !excluded(output)) || junitPaths.some((p) => overlaps(resolve(root, p), output))) throw new Error(`Test record output overlaps an input: ${output}`);
    if (existsSync(output)) {
      const owned = readSealed(output);
      if (!Array.isArray(owned.locations) || !owned.locations.length || owned.locations.some((p: unknown) => typeof p !== 'string' || !p) || (output === record ? !Array.isArray(owned.cases) && !Array.isArray(owned.results) : owned.cases !== undefined || owned.results !== undefined)) throw new Error(`Unmanaged test record output: ${output}`);
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

export function beginTestRecord(profile: Profile, profilePath: string, extraPaths: string[] = []): void {
  const { root, record, pending, spec } = locations(profile, profilePath);
  const sources = sourcesOf(spec, extraPaths);
  const paths = [...new Set(sources.flat())];
  if (!paths.length) throw new Error('At least one report path is required at begin. Set reports on an evidence adapter, or pass --junit.');
  preflightOutputs(profile, profilePath, paths);
  const snapshot: Snapshot = { version: 2, fingerprint: sourceFingerprint(profile, profilePath), started: Date.now(), reports: reportsAt(root, spec, sources), locations: paths, sources };
  writeEvidence(pending, seal(snapshot));
  // Invalidate prior evidence only after the complete new snapshot is safe on disk.
  if (existsSync(record)) unlinkSync(record);
}

// Reads every report with the adapter of its group. The results are in the order of the adapters.
function readReports(root: string, spec: NonNullable<ReturnType<typeof evidenceOf>>, reports: Report[]): { results: EvidenceResult[][]; runs: EvidenceRun[]; warnings: string[] } {
  const results: EvidenceResult[][] = spec.adapters.map(() => []);
  const runs: EvidenceRun[] = [];
  const warnings: string[] = [];
  for (const r of reports) {
    const index = r.adapter ?? 0;
    const entry = spec.adapters[index];
    if (!entry) throw new Error(`The report ${r.path} names an adapter that the profile does not have.`);
    const read = adapterFor(entry.adapter).adapter.read(readFileSync(resolve(root, r.path), 'utf8'), { root, separator: entry.key.separator ?? DEFAULT_SEPARATOR, source: r.path });
    results[index].push(...read.results);
    runs.push(read.run);
    warnings.push(...read.warnings);
  }
  return { results, runs, warnings };
}

export function collectTestRecord(profile: Profile, profilePath: string): RecordV2 {
  const { root, record, pending, spec } = locations(profile, profilePath);
  plainOutput(root, pending);
  const snapshot = readSealed(pending) as Snapshot;
  if (snapshot.version !== 2 || !Array.isArray(snapshot.sources) || snapshot.sources.length !== spec.adapters.length || snapshot.sources.some((s) => !Array.isArray(s) || s.some((p) => typeof p !== 'string' || !p))) throw new Error('Invalid snapshot report locations.');
  if (!Array.isArray(snapshot.locations) || !snapshot.locations.length || snapshot.locations.some((p) => typeof p !== 'string' || !p)) throw new Error('Invalid snapshot report locations.');
  preflightOutputs(profile, profilePath, snapshot.locations);
  if (sourceFingerprint(profile, profilePath) !== snapshot.fingerprint) throw new Error('The source changed during the test run.');
  const reports = reportsAt(root, spec, snapshot.sources);
  if (!reports.length) throw new Error('No test reports found.');
  for (const report of reports) {
    if (snapshot.reports.some((old) => old.path === report.path && old.hash === report.hash && old.adapter === report.adapter) || statSync(resolve(root, report.path)).mtimeMs < snapshot.started) throw new Error(`The test report was not refreshed: ${report.path}`);
  }
  const read = readReports(root, spec, reports);
  const data: RecordV2 = { version: 2, fingerprint: snapshot.fingerprint, started: snapshot.started, reports, locations: snapshot.locations, sources: snapshot.sources, results: read.results, runs: read.runs };
  if (sourceFingerprint(profile, profilePath) !== snapshot.fingerprint) throw new Error('The source changed during collection.');
  preflightOutputs(profile, profilePath, snapshot.locations);
  writeEvidence(record, seal(data));
  unlinkSync(pending);
  return data;
}

const OUTCOMES = ['passed', 'failed', 'not-run'];
const validResult = (r: any) => r && typeof r === 'object' && r.key && typeof r.key === 'object' && !Array.isArray(r.key) && Object.values(r.key).every((v) => typeof v === 'string') && OUTCOMES.includes(r.outcome) && (r.invocations === undefined || Number.isInteger(r.invocations) && r.invocations > 0);

// The adapters with their results, for the join of the core.
function setsOf(profile: Profile, results: EvidenceResult[][]): AdapterSet[] {
  return evidenceOf(profile)!.adapters.map((spec, i) => ({ spec, results: results[i] ?? [], normalise: adapterFor(spec.adapter).adapter.normalise }));
}

// The graph with stale evidence: every condition is not-run.
export function staleGraph(graph: Graph, profile: Profile): Graph {
  return applyEvidence(graph, profile, setsOf(profile, []), true);
}

export function verifiedGraph(graph: Graph, profile: Profile, profilePath: string, graphPath: string): { graph: Graph; warnings: string[] } {
  if (!evidenceOf(profile)) return { graph, warnings: [] };
  const { root, record, spec } = locations(profile, profilePath);
  const absoluteGraph = realpathSync(graphPath);
  const excluded = exclusions(profile, profilePath);
  if (excluded(absoluteGraph) || files(absoluteGraph).some(excluded)) throw new Error('Fingerprint exclusions cannot hide graph inputs.');
  if (!spec.inputs.some((p) => { const path = resolve(root, p); if (!existsSync(path)) return false; const input = realpathSync(path); return input === absoluteGraph || statSync(input).isDirectory() && !relative(input, absoluteGraph).startsWith('..') && !isAbsolute(relative(input, absoluteGraph)); })) throw new Error('The fingerprint inputs must include the graph.');
  let results: EvidenceResult[][] = [];
  let stale = true;
  const warnings: string[] = [];
  if (existsSync(record)) {
    let data: RecordData | undefined;
    try { data = readSealed(record) as RecordData; }
    catch (e) { if (!(e instanceof UnknownVersion)) throw e; warnings.push(`${e.message} Run the tests and collect again.`); }
    if (data) {
      if (data.version === 1 ? !Array.isArray(data.cases) || data.cases.some((c) => !c || typeof c.class !== 'string' || !c.class || typeof c.method !== 'string' || !c.method || !OUTCOMES.includes(c.outcome)) : !Array.isArray(data.results) || data.results.some((set) => !Array.isArray(set) || !set.every(validResult)) || !Array.isArray(data.runs) || !Array.isArray(data.sources)) throw new Error(data.version === 1 ? 'Invalid test record cases.' : 'Invalid test record results.');
      if (!Array.isArray(data.locations) || !data.locations.length || data.locations.some((p) => typeof p !== 'string' || !p)) throw new Error('Invalid test record report locations.');
      // A test run or a clean after collection changes or removes reports. That makes the evidence stale, and it is no error.
      const changed = data.reports.filter((r) => { const path = resolve(root, r.path); return !existsSync(path) || hash(readFileSync(path)) !== r.hash; }).length;
      const sources = data.version === 1 ? [data.locations, ...spec.adapters.slice(1).map(() => [] as string[])] : data.sources;
      let setChanged: boolean;
      try { setChanged = sources.length !== spec.adapters.length || digest(reportsAt(root, spec, sources, data.version !== 1)) !== digest(data.reports); }
      catch { setChanged = true; }
      if (changed || setChanged) {
        warnings.push(`The test reports changed after collection: ${changed} of ${data.reports.length} changed or missing${setChanged ? ', and the report set changed' : ''}. Run the tests and collect again.`);
      } else {
        // The reports are the ones the record sealed, so the results must agree with them exactly.
        const actual = readReports(root, spec, data.reports);
        if (data.version === 1) {
          const cases = data.reports.flatMap((r) => parseJUnit(readFileSync(resolve(root, r.path), 'utf8'))).map((c) => ({ class: c.class, method: c.method, outcome: c.outcome as EvidenceOutcome }));
          if (digest(cases) !== digest(data.cases)) throw new Error('The test record cases do not match the JUnit reports.');
        } else if (digest(actual.results) !== digest(data.results)) throw new Error('The test record results do not match the reports.');
        try { stale = sourceFingerprint(profile, profilePath) !== data.fingerprint; }
        catch { stale = true; }
        results = actual.results;
        warnings.push(...actual.warnings);
      }
    }
  }
  if (stale && spec.fallback === 'authored') return { graph, warnings: [...warnings, 'Test evidence is stale or absent. The statuses stay authored.'] };
  if (stale) warnings.push('Test verification is stale or absent. Every condition is not-run.');
  return { graph: applyEvidence(graph, profile, setsOf(profile, stale ? [] : results), stale), warnings };
}
