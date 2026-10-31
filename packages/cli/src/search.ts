// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The command `semspec search`: finds nodes by words and prints the ranked hits.
import { indexGraphs, searchSemantic, DEFAULT_LIMIT, SEARCH_MODES, type SearchMode, type SearchResult } from '@semspec/core';
import { semanticSourceOf } from './embeddings';
import { loadWithTargets } from './mcp';

export interface SearchArgs {
  query: string;
  flags: Record<string, string>;
  kinds: string[];
  exclude: string[];
  json: boolean;
}

// Reads the arguments after the command name. A word with no option is part of the query.
export function parseSearchArgs(argv: string[]): SearchArgs {
  const flags: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  const words: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a.startsWith('--')) {
      const value = argv[++i] ?? '';
      flags[a.slice(2)] = value;
      (lists[a.slice(2)] ??= []).push(value);
    } else words.push(a);
  }
  const kinds = (lists.kind ?? []).flatMap((k) => k.split(',')).filter(Boolean);
  return { query: words.join(' ').trim(), flags, kinds, exclude: lists.exclude ?? [], json };
}

// Runs the search. It throws an error with a message for the user.
export async function searchInputs(args: SearchArgs): Promise<{ result: SearchResult; warnings: string[] }> {
  const { flags } = args;
  if (!args.query) throw new Error('Give the words to search for.');
  if (flags.workspace !== undefined ? flags.graph !== undefined || flags.profile !== undefined || args.exclude.length : !flags.graph || !flags.profile) {
    throw new Error('Use --workspace alone, or use --graph and --profile.');
  }
  const limit = flags.limit === undefined ? DEFAULT_LIMIT : Number(flags.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('The option --limit must be a whole number from 1.');
  if (flags.mode !== undefined && !SEARCH_MODES.includes(flags.mode as SearchMode)) throw new Error(`The option --mode must be one of: ${SEARCH_MODES.join(', ')}.`);
  const loaded = loadWithTargets(flags, args.exclude);
  const sources = new Map([...loaded.targets].map(([id, t]) => [id, semanticSourceOf(t)]));
  const result = await searchSemantic(indexGraphs(loaded.graphs.map((g) => ({ id: g.id, label: g.label, model: g.model }))), sources, args.query, {
    mode: flags.mode as SearchMode | undefined,
    graph: flags.in,
    kinds: args.kinds,
    scope: flags.scope,
    limit,
  });
  return { result, warnings: loaded.warnings };
}

// The hits as lines of text for a person.
export function formatHits(result: SearchResult, withGraph: boolean): string {
  const notes = (result.notes ?? []).map((n) => `note: ${n}`);
  if (!result.hits.length) return [`No node matches "${result.query}".`, ...notes].join('\n');
  const lines = result.hits.flatMap((h, i) => {
    const name = withGraph ? `${h.graph}:${h.id}` : h.id;
    const context = [h.parent ? `in ${h.parent.id}` : '', h.status ? `status ${h.status}` : ''].filter(Boolean).join(', ');
    return [`${i + 1}. ${name}  [${h.kind}]  ${h.title}${context ? `  (${context})` : ''}`, `   ${h.snippet}`];
  });
  if (result.omitted) lines.push(`${result.omitted} more not shown. Use --limit to see more.`);
  return [...lines, ...notes].join('\n');
}
