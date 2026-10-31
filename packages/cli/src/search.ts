// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The command `semspec search`: finds nodes by words and prints the ranked hits.
import { indexGraphs, searchGraphs, DEFAULT_LIMIT, type SearchResult } from '@semspec/core';
import { mcpLoader } from './mcp';

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
export function searchInputs(args: SearchArgs): { result: SearchResult; warnings: string[] } {
  const { flags } = args;
  if (!args.query) throw new Error('Give the words to search for.');
  if (flags.workspace !== undefined ? flags.graph !== undefined || flags.profile !== undefined || args.exclude.length : !flags.graph || !flags.profile) {
    throw new Error('Use --workspace alone, or use --graph and --profile.');
  }
  const limit = flags.limit === undefined ? DEFAULT_LIMIT : Number(flags.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('The option --limit must be a whole number from 1.');
  const loaded = mcpLoader(flags, args.exclude)();
  const result = searchGraphs(indexGraphs(loaded.graphs.map((g) => ({ id: g.id, label: g.label, model: g.model }))), args.query, {
    graph: flags.in,
    kinds: args.kinds,
    scope: flags.scope,
    limit,
  });
  return { result, warnings: loaded.warnings };
}

// The hits as lines of text for a person.
export function formatHits(result: SearchResult, withGraph: boolean): string {
  if (!result.hits.length) return `No node matches "${result.query}".`;
  const lines = result.hits.flatMap((h, i) => {
    const name = withGraph ? `${h.graph}:${h.id}` : h.id;
    const context = [h.parent ? `in ${h.parent.id}` : '', h.status ? `status ${h.status}` : ''].filter(Boolean).join(', ');
    return [`${i + 1}. ${name}  [${h.kind}]  ${h.title}${context ? `  (${context})` : ''}`, `   ${h.snippet}`];
  });
  if (result.omitted) lines.push(`${result.omitted} more not shown. Use --limit to see more.`);
  return lines.join('\n');
}
