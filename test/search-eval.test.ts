// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The evaluation of the search. Each set lists questions with the node ids that the top 5 should hold.
// The test prints recall at 5 and the mean reciprocal rank (MRR), and fails when a number falls below its floor.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildModel, indexGraphs, searchGraphs, type GraphIndex } from '@semspec/core';
import { loadInputs } from '../packages/cli/src/inputs';
import { loadWorkspace } from '../packages/cli/src/workspace';

interface EvalSet {
  graph?: string;
  profile?: string;
  workspace?: string;
  questions: { q: string; expect: string[] }[];
}

const RANK = 5;
const root = fileURLToPath(new URL('..', import.meta.url));

function graphsOf(file: string, set: EvalSet): GraphIndex[] {
  const base = dirname(file);
  if (set.workspace) return indexGraphs(loadWorkspace(resolve(base, set.workspace)).data.graphs);
  const { graph, profile } = loadInputs(resolve(base, set.graph!), resolve(base, set.profile!));
  return indexGraphs([{ id: 'graph', label: profile.project, model: buildModel(graph, profile) }]);
}

// Recall at 5 is the share of the expected ids in the top 5, averaged over the questions.
// The reciprocal rank is 1 over the rank of the first expected id, or 0 when none is in the top 5.
function evaluate(graphs: GraphIndex[], set: EvalSet) {
  const misses: string[] = [];
  let recall = 0;
  let rr = 0;
  for (const { q, expect: wanted } of set.questions) {
    const ids = searchGraphs(graphs, q, { limit: RANK }).hits.map((h) => h.id);
    const found = wanted.filter((id) => ids.includes(id));
    recall += found.length / wanted.length;
    const first = ids.findIndex((id) => wanted.includes(id));
    rr += first < 0 ? 0 : 1 / (first + 1);
    if (!found.length) misses.push(q);
  }
  const n = set.questions.length;
  return { questions: n, recall: recall / n, mrr: rr / n, misses };
}

const sets = {
  requirements: { name: 'requirements of Semspec', file: resolve(root, 'requirements/search-eval.yaml'), minQuestions: 30, floor: { recall: 0.5, mrr: 0.45 } },
  workspace: { name: 'workspace fixture', file: resolve(root, 'fixtures/workspace/search-eval.yaml'), minQuestions: 10, floor: { recall: 0.6, mrr: 0.5 } },
};

function check(s: (typeof sets)[keyof typeof sets]) {
  const set = parse(readFileSync(s.file, 'utf8')) as EvalSet;
  expect(set.questions.length).toBeGreaterThanOrEqual(s.minQuestions);
  const graphs = graphsOf(s.file, set);
  for (const { expect: wanted } of set.questions) for (const id of wanted) expect(graphs.some((g) => g.index.byId.has(id)), `unknown id ${id}`).toBe(true);
  const r = evaluate(graphs, set);
  console.log(`${s.name}: ${r.questions} questions, recall@${RANK} ${r.recall.toFixed(3)}, MRR ${r.mrr.toFixed(3)}${r.misses.length ? `, no hit: ${r.misses.join(' | ')}` : ''}`);
  expect(r.recall).toBeGreaterThanOrEqual(s.floor.recall);
  expect(r.mrr).toBeGreaterThanOrEqual(s.floor.mrr);
}

describe('search evaluation', () => {
  it('meets the floor on the requirements of Semspec', { timeout: 60000 }, () => check(sets.requirements));
  it('meets the floor on the workspace fixture', { timeout: 60000 }, () => check(sets.workspace));
});
