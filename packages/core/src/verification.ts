// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The JUnit alias of the evidence port. The profile key `verification` is 1 JUnit adapter with the key rule class and method.
// These functions keep the old signatures. They call the join of the evidence port.
import type { Graph, Profile } from './types.js';
import { applyEvidence, conditionResult, type EvidenceOutcome, type EvidenceResult } from './evidence.js';

export type TestOutcome = EvidenceOutcome;
// A case of a JUnit report. The fields after `outcome` are set by the JUnit reader when the report has them.
export interface TestCase { class: string; method: string; outcome: TestOutcome; file?: string; name?: string; titlePath?: string[] }

// JUnit writes the empty Java parameter list in a normal method name. This normalisation belongs to the JUnit adapter.
export const junitMethod = (name: string): string => name.replace(/\[\d+\]$/, '').replace(/\(\)$/, '');

// The JUnit adapter changes the method of a key, for results and for checks alike.
export const junitKey = (key: Record<string, string>): Record<string, string> => (key.method === undefined ? key : { ...key, method: junitMethod(key.method) });

export const caseResult = (c: TestCase): EvidenceResult => ({ key: { class: c.class, method: c.method }, outcome: c.outcome });

export function conditionOutcome(tests: unknown, cases: TestCase[], classField: string, methodField: string): TestOutcome {
  const spec = { adapter: 'junit', key: { rule: 'class-method' as const, class: classField, method: methodField } };
  return conditionResult(tests, '\0', [{ spec, results: cases.map(caseResult), normalise: junitKey }]);
}

// Work on a copy. The original graph and its authored status values stay untouched.
export function applyVerification(graph: Graph, profile: Profile, cases: TestCase[], stale: boolean): Graph {
  const spec = profile.verification;
  if (!spec) return graph;
  const key = { rule: 'class-method' as const, class: spec.classField, method: spec.methodField };
  return applyEvidence(graph, profile, [{ spec: { adapter: 'junit', key }, results: cases.map(caseResult), normalise: junitKey }], stale);
}
