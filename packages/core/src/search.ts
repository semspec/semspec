// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The search over the graphs of a workspace. The ranking is in rank.ts. This module adds the filters,
// the context of each hit (kind, parent, status) and a snippet with the matched words marked.
import { DEFAULT_LIMIT, QueryError, graphById, type GraphIndex } from './agent.js';
import { computeScope, statusOf } from './explore.js';
import { rankIndexOf, rankQuery, stem } from './rank.js';
import type { VNode } from './types.js';

export interface SearchHit {
  graph: string;
  id: string;
  kind: string;
  title: string;
  score: number;
  // The first parent in the tree, or null.
  parent: { id: string; title: string } | null;
  // The own status value of the node, or the roll-up of the nodes below it. null when the profile has no status.
  status: string | null;
  // A part of the text of the node. The matched words are in `**` marks.
  snippet: string;
}

export interface SearchOptions {
  // The id of 1 graph. The default is all graphs.
  graph?: string;
  kinds?: string[];
  lifecycles?: string[];
  statuses?: string[];
  // The id of a node. Only the nodes in the scope of this node can be hits. See computeScope.
  scope?: string;
  limit?: number;
}

export interface SearchResult {
  query: string;
  // The number of nodes that match and pass the filters.
  total: number;
  hits: SearchHit[];
  // The number of matching nodes that the limit cuts.
  omitted: number;
}

const SNIPPET_LENGTH = 140;
const WORD = /[\p{L}\p{N}]+/gu;

// Cuts a window of the text around the first matched word and marks each matched word.
export function snippetOf(text: string, terms: Set<string>): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const words = [...flat.matchAll(WORD)];
  const first = words.find((m) => terms.has(stem(m[0].toLowerCase())));
  let start = 0;
  if (first && first.index! > 50) {
    start = flat.lastIndexOf(' ', first.index! - 40) + 1;
    if (start <= 0) start = Math.max(0, first.index! - 40);
  }
  let end = Math.min(flat.length, start + SNIPPET_LENGTH);
  if (end < flat.length) {
    const space = flat.lastIndexOf(' ', end);
    if (space > start + SNIPPET_LENGTH / 2) end = space;
  }
  const window = flat.slice(start, end);
  const marked = window.replace(WORD, (w) => (terms.has(stem(w.toLowerCase())) ? `**${w}**` : w));
  return `${start > 0 ? '…' : ''}${marked}${end < flat.length ? '…' : ''}`;
}

// Searches 1 graph or all graphs. The hits of all graphs sort by score. An exact id or title comes first.
export function searchGraphs(graphs: GraphIndex[], query: string, options: SearchOptions = {}): SearchResult {
  const searched = options.graph === undefined ? graphs : [graphById(graphs, options.graph)];
  const limit = options.limit ?? DEFAULT_LIMIT;
  for (const kind of options.kinds ?? []) {
    if (!searched.some((g) => g.index.profile.kinds.some((k) => k.id === kind))) {
      const known = [...new Set(searched.flatMap((g) => g.index.profile.kinds.map((k) => k.id)))];
      throw new QueryError(`Unknown kind "${kind}". The kinds are: ${known.join(', ')}.`);
    }
  }
  let scopes: Map<string, Set<string>> | undefined;
  if (options.scope !== undefined) {
    scopes = new Map();
    for (const g of searched) if (g.index.byId.has(options.scope)) scopes.set(g.id, computeScope(g.index, { id: options.scope }).ids);
    if (!scopes.size) throw new QueryError(`Unknown node id "${options.scope}" for the scope.`);
  }
  const found: { g: GraphIndex; node: VNode; score: number; terms: Set<string>; text: string[] }[] = [];
  for (const g of searched) {
    const allow = scopes?.get(g.id);
    if (scopes && !allow) continue;
    const ix = rankIndexOf(g.index);
    const { hits, terms } = rankQuery(ix, query, allow);
    for (const hit of hits) {
      const node = g.index.byId.get(hit.id)!;
      if (options.kinds?.length && !options.kinds.includes(node.kind)) continue;
      if (options.lifecycles?.length && !options.lifecycles.includes(node.lifecycle)) continue;
      if (options.statuses?.length && !options.statuses.includes(statusOf(g.index, node.id).value ?? '')) continue;
      found.push({ g, node, score: hit.score, terms, text: ix.texts[ix.position.get(node.id.toLowerCase())!] });
    }
  }
  found.sort((a, b) => b.score - a.score);
  const hits = found.slice(0, limit).map(({ g, node, score, terms, text }): SearchHit => {
    const parent = node.parents.length ? g.index.byId.get(node.parents[0]) : undefined;
    const pick = text.find((t) => tokensIn(t).some((w) => terms.has(w))) ?? text[0] ?? node.title;
    return {
      graph: g.id,
      id: node.id,
      kind: node.kind,
      title: node.title,
      score: Math.round(score * 1000) / 1000,
      parent: parent ? { id: parent.id, title: parent.title } : null,
      status: g.index.profile.status ? statusOf(g.index, node.id).value : null,
      snippet: snippetOf(pick, terms),
    };
  });
  return { query, total: found.length, hits, omitted: found.length - hits.length };
}

const tokensIn = (text: string): string[] => [...text.matchAll(WORD)].map((m) => stem(m[0].toLowerCase()));
