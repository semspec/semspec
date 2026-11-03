// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The evaluation of the search. Each set lists questions with the node ids that the top 5 should hold.
// The test prints recall at 5 and the mean reciprocal rank (MRR), and fails when a number falls below its floor.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildModel, embeddingTexts, indexGraphs, rankIndexOf, searchSemantic, updateVectorIndex, type GraphIndex, type SemanticSource } from '@semspec/core';
import { EVAL_RANK, formatScore, scoreQuestions } from '../packages/cli/src/eval';
import { fakeEmbed } from './helpers/fake-embed';
import { loadInputs } from '../packages/cli/src/inputs';
import { loadWorkspace } from '../packages/cli/src/workspace';

interface EvalSet {
  graph?: string;
  profile?: string;
  workspace?: string;
  questions: { q: string; expect: string[] }[];
}

const root = fileURLToPath(new URL('..', import.meta.url));

function graphsOf(file: string, set: EvalSet): GraphIndex[] {
  const base = dirname(file);
  if (set.workspace) return indexGraphs(loadWorkspace(resolve(base, set.workspace)).data.graphs);
  const { graph, profile } = loadInputs(resolve(base, set.graph!), resolve(base, set.profile!));
  return indexGraphs([{ id: 'graph', label: profile.project, model: buildModel(graph, profile) }]);
}

// The keyword ranking, and the hybrid ranking with a fake provider. The fake has no model: it measures the code path.
async function evaluate(graphs: GraphIndex[], set: EvalSet, mode: 'keyword' | 'hybrid') {
  const sources = new Map<string, SemanticSource>();
  for (const g of graphs) {
    const { index } = await updateVectorIndex(undefined, embeddingTexts(rankIndexOf(g.index)), { model: 'fake' }, fakeEmbed);
    sources.set(g.id, { model: 'fake', embed: fakeEmbed, vectors: index });
  }
  return scoreQuestions(set.questions, async (q) => {
    const result = await searchSemantic(graphs, sources, q, { mode, limit: EVAL_RANK });
    return { ids: result.hits.map((h) => h.id), fellBack: !!result.notes?.length };
  });
}

const sets = {
  requirements: { name: 'requirements of Semspec', file: resolve(root, 'requirements/search-eval.yaml'), minQuestions: 30, floor: { recall: 0.5, mrr: 0.45 } },
  workspace: { name: 'workspace fixture', file: resolve(root, 'fixtures/workspace/search-eval.yaml'), minQuestions: 10, floor: { recall: 0.6, mrr: 0.5 } },
};

async function check(s: (typeof sets)[keyof typeof sets]) {
  const set = parse(readFileSync(s.file, 'utf8')) as EvalSet;
  expect(set.questions.length).toBeGreaterThanOrEqual(s.minQuestions);
  const graphs = graphsOf(s.file, set);
  for (const { expect: wanted } of set.questions) for (const id of wanted) expect(graphs.some((g) => g.index.byId.has(id)), `unknown id ${id}`).toBe(true);
  const keyword = await evaluate(graphs, set, 'keyword');
  const hybrid = await evaluate(graphs, set, 'hybrid');
  console.log(`${s.name}\n  ${formatScore('keyword', keyword)}${keyword.misses.length ? `, no hit: ${keyword.misses.join(' | ')}` : ''}\n  ${formatScore('hybrid (fake provider, code path only)', hybrid)}`);
  // A sum of fractions can land just below an exact floor, so the check allows a rounding error.
  const EPSILON = 1e-9;
  expect(keyword.recall).toBeGreaterThanOrEqual(s.floor.recall - EPSILON);
  expect(keyword.mrr).toBeGreaterThanOrEqual(s.floor.mrr - EPSILON);
  // The hybrid ranking runs with no fall back. Its floor is the keyword floor less a margin, because the fake vectors carry no meaning. A new node moves the number by chance, so the margin is 0.15.
  expect(hybrid.fallbacks).toBe(0);
  expect(hybrid.recall).toBeGreaterThanOrEqual(s.floor.recall - 0.15);
  expect(hybrid.mrr).toBeGreaterThanOrEqual(s.floor.mrr - 0.15);
}

describe('search evaluation', () => {
  it('meets the floor on the requirements of Semspec', { timeout: 60000 }, () => check(sets.requirements));
  it('meets the floor on the workspace fixture', { timeout: 60000 }, () => check(sets.workspace));
});
