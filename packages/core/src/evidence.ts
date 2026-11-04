// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The evidence port. An adapter reads 1 report format and gives results. The core joins the results to the checks of the conditions.
// This module does no I/O. The adapters live in the command line package.
import type { EvidenceAdapterSpec, EvidenceKeyRule, EvidenceSpec, Graph, Profile } from './types.js';
import { getPath } from './profile.js';

export type EvidenceOutcome = 'passed' | 'failed' | 'not-run';

// The result of 1 test. The key holds the parts that the key rules read: class, method, file, name, titlePath.
export interface EvidenceResult {
  key: Record<string, string>;
  outcome: EvidenceOutcome;
  // The number of invocations that the result stands for. A missing value means 1.
  invocations?: number;
}

// One run of a test tool. The run record of a later release will keep it.
export interface EvidenceRun {
  id?: string;
  at?: string;
  tool: string;
  source: string;
}

export interface AdapterResult {
  results: EvidenceResult[];
  run: EvidenceRun;
  warnings: string[];
}

export interface AdapterOptions {
  // The absolute root. An adapter makes the file paths of a report relative to it.
  root: string;
  // Joins the titles of a title path.
  separator: string;
  // The report path, relative to root.
  source: string;
}

// An adapter reads the text of 1 report. It throws an error with a message when the report is not valid.
export interface EvidenceAdapter {
  id: string;
  read(text: string, options: AdapterOptions): AdapterResult;
  // Changes a key before the join, for results and for checks alike.
  normalise?(key: Record<string, string>): Record<string, string>;
}

export type KeyNormaliser = (key: Record<string, string>) => Record<string, string>;

export const DEFAULT_SEPARATOR = ' > ';

// The 2 parts of the key that each rule reads.
export const KEY_PARTS: Record<EvidenceKeyRule['rule'], [string, string]> = {
  'class-method': ['class', 'method'],
  'file-name': ['file', 'name'],
  'file-titlepath': ['file', 'titlePath'],
};

// The evidence settings of a profile. The key `verification` is the alias with 1 JUnit adapter and the key rule class and method.
export function evidenceOf(profile: Profile): EvidenceSpec | undefined {
  if (profile.evidence) return profile.evidence;
  const v = profile.verification;
  if (!v) return undefined;
  return { record: v.record, root: v.root, inputs: v.inputs, exclude: v.exclude, adapters: [{ adapter: 'junit', key: { rule: 'class-method', class: v.classField, method: v.methodField } }] };
}

// The check field that holds each part of the key. A rule that leaves a field out reads the field with the name of the part.
export function keyFields(rule: EvidenceKeyRule): [string, string] {
  if (rule.rule === 'class-method') return [rule.class ?? 'class', rule.method ?? 'method'];
  return [rule.file ?? 'file', rule.name ?? 'name'];
}

const plain = (path: string) => path.replace(/^(\.\/)+/, '');
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

// A first part matches when it is equal. A simple class name also matches the last segment of a full class name.
// A file also matches when the path of the result ends with the path of the check after a slash.
function firstMatches(rule: EvidenceKeyRule['rule'], wanted: string, found: string): boolean {
  if (found === wanted) return true;
  if (rule === 'class-method') return !wanted.includes('.') && found.split('.').at(-1) === wanted;
  return plain(found) === plain(wanted) || found.endsWith(`/${plain(wanted)}`);
}

// 'none' means that no result has the first part of the check.
export type Vote = EvidenceOutcome | 'none';

// The vote of 1 adapter for 1 check. A missing or ambiguous first part gives not-run.
// A failure wins over a pass. A case that did not run prevents a pass. Repeated cases count together.
export function joinCheck(check: unknown, results: EvidenceResult[], rule: EvidenceKeyRule, normalise: KeyNormaliser = (k) => k): Vote {
  const [firstPart, secondPart] = KEY_PARTS[rule.rule];
  const [firstField, secondField] = keyFields(rule);
  const first = getPath(check, firstField);
  const second = getPath(check, secondField);
  if (!nonEmpty(first) || !nonEmpty(second)) return 'not-run';
  const wanted = normalise({ [firstPart]: first, [secondPart]: second });
  const candidates = results.map((r) => ({ r, key: normalise(r.key) })).filter(({ key }) => nonEmpty(key[firstPart]) && firstMatches(rule.rule, wanted[firstPart], key[firstPart]));
  if (!candidates.length) return 'none';
  // A simple name is safe only when exactly 1 full class or 1 file path has it.
  if (new Set(candidates.map(({ key }) => key[firstPart])).size > 1) return 'not-run';
  return aggregate(candidates.filter(({ key }) => key[secondPart] === wanted[secondPart]).map(({ r }) => r.outcome));
}

// Any failed gives failed. All passed gives passed. Everything else, and an empty list, gives not-run.
export function aggregate(outcomes: EvidenceOutcome[]): EvidenceOutcome {
  if (outcomes.includes('failed')) return 'failed';
  return outcomes.length && outcomes.every((o) => o === 'passed') ? 'passed' : 'not-run';
}

export interface AdapterSet {
  spec: EvidenceAdapterSpec;
  results: EvidenceResult[];
  normalise?: KeyNormaliser;
}

// The outcome of 1 check. Each adapter that answers its type gives a vote. A failure wins.
// A pass needs at least 1 pass and no vote that is not-run.
export function checkOutcome(check: unknown, type: unknown, sets: AdapterSet[]): EvidenceOutcome {
  const answering = sets.filter((s) => !s.spec.checkTypes || (typeof type === 'string' && s.spec.checkTypes.includes(type)));
  const votes = answering.map((s) => joinCheck(check, s.results, s.spec.key, s.normalise));
  if (votes.includes('failed')) return 'failed';
  const real = votes.filter((v) => v !== 'none');
  return real.length && real.every((v) => v === 'passed') ? 'passed' : 'not-run';
}

const answered = (type: unknown, sets: AdapterSet[]): boolean => sets.some((s) => !s.spec.checkTypes || (typeof type === 'string' && s.spec.checkTypes.includes(type)));

// The outcome of the checks of 1 condition. A check of a type that no adapter answers gives no vote.
// A condition with no check that an adapter answers is not-run.
export function conditionResult(checks: unknown, typeField: string, sets: AdapterSet[]): EvidenceOutcome {
  if (!Array.isArray(checks)) return 'not-run';
  const voting = checks.filter((c) => answered(getPath(c, typeField), sets));
  if (!voting.length) return 'not-run';
  return aggregate(voting.map((c) => checkOutcome(c, getPath(c, typeField), sets)));
}

// Adds the derived status to a copy of the graph. The authored status stays in its field.
// Each condition gets `verification` (the outcome and the stale flag) and `derivedStatus`.
// Stale evidence gives not-run for every condition.
export function applyEvidence(graph: Graph, profile: Profile, sets: AdapterSet[], stale: boolean): Graph {
  if (!evidenceOf(profile)) return graph;
  if (!profile.status) throw new Error('Evidence requires profile.status.');
  const values = Object.fromEntries(profile.status.values.map((v) => [v.tone, v.value]));
  const copy = { ...graph, [profile.source.nodes]: ((graph[profile.source.nodes] ?? []) as Record<string, any>[]).map((node) => ({ ...node })) };
  for (const node of (copy[profile.source.nodes] ?? []) as Record<string, any>[]) {
    for (const part of profile.parts ?? []) {
      if ((node[profile.source.kind] ?? profile.source.defaultKind) !== part.owner) continue;
      node[part.field] = (node[part.field] ?? []).map((condition: Record<string, unknown>) => ({ ...condition }));
      for (const condition of node[part.field] ?? []) {
        const outcome = stale ? 'not-run' : conditionResult(condition[profile.checks?.field ?? ''], profile.checks?.typeField ?? 'type', sets);
        condition.derivedStatus = values[outcome === 'passed' ? 'good' : outcome === 'failed' ? 'bad' : 'warn'];
        condition.verification = { outcome, stale };
      }
    }
  }
  return copy;
}
