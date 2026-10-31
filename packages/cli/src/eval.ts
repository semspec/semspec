// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The evaluation of the search. A set lists questions with the node ids that the top 5 should hold.
// The command `semspec eval-search` prints recall at 5 and the mean reciprocal rank (MRR) for the keyword
// ranking and for the hybrid ranking, with the model that the user configured.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { indexGraphs, searchSemantic, type GraphIndex, type SearchMode } from '@semspec/core';
import { semanticSourceOf } from './embeddings';
import { loadInputs } from './inputs';
import { loadWithTargets } from './mcp';

export const EVAL_RANK = 5;

export interface EvalQuestion {
  q: string;
  expect: string[];
}

export interface EvalSet {
  graph?: string;
  profile?: string;
  workspace?: string;
  questions: EvalQuestion[];
}

export interface EvalScore {
  questions: number;
  recall: number;
  mrr: number;
  // The questions with no expected id in the top 5.
  misses: string[];
  // The number of questions where the ranking fell back to keywords.
  fallbacks: number;
}

// Recall at 5 is the share of the expected ids in the top 5, averaged over the questions.
// The reciprocal rank is 1 over the rank of the first expected id, or 0 when none is in the top 5.
export async function scoreQuestions(questions: EvalQuestion[], rank: (q: string) => Promise<{ ids: string[]; fellBack?: boolean }>): Promise<EvalScore> {
  const misses: string[] = [];
  let recall = 0;
  let rr = 0;
  let fallbacks = 0;
  for (const { q, expect: wanted } of questions) {
    const { ids, fellBack } = await rank(q);
    if (fellBack) fallbacks++;
    const top = ids.slice(0, EVAL_RANK);
    const found = wanted.filter((id) => top.includes(id));
    recall += found.length / wanted.length;
    const first = top.findIndex((id) => wanted.includes(id));
    rr += first < 0 ? 0 : 1 / (first + 1);
    if (!found.length) misses.push(q);
  }
  const n = questions.length;
  return { questions: n, recall: recall / n, mrr: rr / n, misses, fallbacks };
}

export const formatScore = (name: string, s: EvalScore) =>
  `${name}: ${s.questions} questions, recall@${EVAL_RANK} ${s.recall.toFixed(3)}, MRR ${s.mrr.toFixed(3)}${s.fallbacks ? `, ${s.fallbacks} questions fell back to keywords` : ''}`;

export interface EvalArgs {
  flags: Record<string, string>;
}

export function parseEvalArgs(argv: string[]): EvalArgs {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected "${argv[i]}". The options are --set, --workspace, --graph, --profile and --mode.`);
    flags[argv[i].slice(2)] = argv[i + 1] ?? '';
  }
  return { flags };
}

// Runs the set against the graphs and the model of the configuration. The modes are keyword and hybrid,
// or the modes that --mode names. It throws when no model is configured or an index is missing.
export async function evalSearch(args: EvalArgs): Promise<{ lines: string[]; warnings: string[] }> {
  const { flags } = args;
  const setPath = resolve(flags.set ?? 'requirements/search-eval.yaml');
  const set = parse(readFileSync(setPath, 'utf8')) as EvalSet;
  if (!Array.isArray(set?.questions) || !set.questions.length) throw new Error(`The set "${setPath}" has no questions.`);
  const base = dirname(setPath);
  const source: Record<string, string> =
    flags.workspace !== undefined
      ? { workspace: flags.workspace }
      : flags.graph !== undefined && flags.profile !== undefined
        ? { graph: flags.graph, profile: flags.profile }
        : set.workspace
          ? { workspace: resolve(base, set.workspace) }
          : { graph: resolve(base, set.graph!), profile: resolve(base, set.profile!) };
  const loaded = loadWithTargets(source);
  if (!loaded.targets.size) throw new Error('No embedding model is configured. Set search.embeddings in the workspace file or in the profile. See docs/guide/meaning-search.md.');
  const sources = new Map([...loaded.targets].map(([id, t]) => [id, semanticSourceOf(t)]));
  const graphs: GraphIndex[] = indexGraphs(loaded.graphs.map((g) => ({ id: g.id, label: g.label, model: g.model })));
  for (const [id, s] of sources) {
    if (s.problem) throw new Error(`Graph "${id}": ${s.problem}`);
    if (!s.vectors) throw new Error(`Graph "${id}" has no index of vectors. Run semspec index first.`);
  }
  const modes: SearchMode[] = flags.mode ? [flags.mode as SearchMode] : ['keyword', 'hybrid'];
  const lines: string[] = [];
  for (const mode of modes) {
    const score = await scoreQuestions(set.questions, async (q) => {
      const result = await searchSemantic(graphs, sources, q, { mode, limit: EVAL_RANK });
      return { ids: result.hits.map((h) => h.id), fellBack: mode !== 'keyword' && !!result.notes?.length };
    });
    lines.push(formatScore(mode, score));
  }
  return { lines, warnings: loaded.warnings };
}
