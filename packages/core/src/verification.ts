// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Verification has no stored condition status. Every load evaluates the named tests again.
import type { Graph, Profile } from './types.js';
import { getPath } from './profile.js';

export type TestOutcome = 'passed' | 'failed' | 'not-run';
export interface TestCase { class: string; method: string; outcome: TestOutcome }

// JUnit writes the empty Java parameter list in a normal method name.
export const junitMethod = (name: string): string => name.replace(/\[\d+\]$/, '').replace(/\(\)$/, '');

export function conditionOutcome(tests: unknown, cases: TestCase[], classField: string, methodField: string): TestOutcome {
  if (!Array.isArray(tests) || !tests.length) return 'not-run';
  const outcomes = tests.map((test): TestOutcome => {
    const cls = getPath(test, classField);
    const method = getPath(test, methodField);
    if (typeof cls !== 'string' || !cls || typeof method !== 'string' || !method) return 'not-run';
    // A simple name is safe only when the whole record identifies exactly one full class.
    const classes = [...new Set(cases.filter((c) => c.class === cls || (!cls.includes('.') && c.class.split('.').at(-1) === cls)).map((c) => c.class))];
    if (classes.length !== 1) return 'not-run';
    const matches = cases.filter((c) => c.class === classes[0] && junitMethod(c.method) === junitMethod(method));
    if (matches.some((c) => c.outcome === 'failed')) return 'failed';
    return matches.length && matches.every((c) => c.outcome === 'passed') ? 'passed' : 'not-run';
  });
  return outcomes.includes('failed') ? 'failed' : outcomes.every((s) => s === 'passed') ? 'passed' : 'not-run';
}

// Work on a copy. The original graph and its authored status values stay untouched.
export function applyVerification(graph: Graph, profile: Profile, cases: TestCase[], stale: boolean): Graph {
  const spec = profile.verification;
  if (!spec) return graph;
  if (!profile.status) throw new Error('Verification requires profile.status.');
  const status = profile.status;
  const values = Object.fromEntries(status.values.map((v) => [v.tone, v.value]));
  const copy = { ...graph, [profile.source.nodes]: ((graph[profile.source.nodes] ?? []) as Record<string, any>[]).map((node) => ({ ...node })) };
  for (const node of (copy[profile.source.nodes] ?? []) as Record<string, any>[]) {
    // Authored ancestor statuses cannot override derived condition evidence.
    delete node[status.field];
    for (const part of profile.parts ?? []) {
      if ((node[profile.source.kind] ?? profile.source.defaultKind) !== part.owner) continue;
      node[part.field] = (node[part.field] ?? []).map((condition: Record<string, unknown>) => ({ ...condition }));
      for (const condition of node[part.field] ?? []) {
        const outcome = stale ? 'not-run' : conditionOutcome(condition[profile.checks?.field ?? ''], cases, spec.classField, spec.methodField);
        condition[status.field] = values[outcome === 'passed' ? 'good' : outcome === 'failed' ? 'bad' : 'warn'];
        condition.verification = { outcome, stale };
      }
    }
  }
  return copy;
}
