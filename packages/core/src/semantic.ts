// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The search with an optional model. This module reads no file and calls no server by itself. The caller
// gives each graph its index and its embedder. When the model does not answer, the search falls back to keywords.
import type { GraphIndex } from './agent.js';
import { indexMatches, nodeHashes, reduceVector, staleNodes, type Embedder, type VectorIndex } from './embed.js';
import { rankIndexOf } from './rank.js';
import { searchGraphs, type SearchOptions, type SearchResult, type SemanticInput } from './search.js';

export type SearchMode = 'keyword' | 'hybrid' | 'vector';
export const SEARCH_MODES: SearchMode[] = ['keyword', 'hybrid', 'vector'];

// What 1 graph has for the meaning search. `vectors` is missing when no index file exists. `problem` says why an index file cannot be used.
export interface SemanticSource {
  model: string;
  dimensions?: number;
  documentPrefix?: string;
  queryPrefix?: string;
  embed: Embedder;
  vectors?: VectorIndex;
  problem?: string;
}

export interface SemanticSearchOptions extends Omit<SearchOptions, 'semantic'> {
  // The default is hybrid when an index exists, and keyword when it does not.
  mode?: SearchMode;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0];

// Searches with the keyword ranking, and with the vector ranking when a graph has an index and the model answers.
// The result is not a promise when no graph has an index, so a search with no model stays synchronous.
// The notes of the result name the reasons for a fall back to keywords.
export function searchSemantic(graphs: GraphIndex[], sources: Map<string, SemanticSource> | undefined, query: string, options: SemanticSearchOptions = {}): SearchResult | Promise<SearchResult> {
  const { mode, ...rest } = options;
  const keyword = (notes: string[]): SearchResult => {
    const result = searchGraphs(graphs, query, rest);
    return notes.length ? { ...result, notes } : result;
  };
  if (mode === 'keyword') return keyword([]);
  const notes: string[] = [];
  const searched = options.graph === undefined ? graphs : graphs.filter((g) => g.id === options.graph);
  const usable: { g: GraphIndex; source: SemanticSource; vectors: VectorIndex }[] = [];
  for (const g of searched) {
    const source = sources?.get(g.id);
    if (!source) continue;
    if (source.problem) notes.push(`Graph "${g.id}": ${source.problem}`);
    else if (!source.vectors) {
      if (mode) notes.push(`Graph "${g.id}" has no index of vectors. Run semspec index.`);
    } else if (!indexMatches(source.vectors, source)) notes.push(`Graph "${g.id}": the index was built with other settings than the configuration. Run semspec index.`);
    else usable.push({ g, source, vectors: source.vectors });
  }
  if (!usable.length) {
    if (mode && !sources?.size) notes.push('No embedding model is configured, so the search uses keywords only.');
    return keyword(notes);
  }
  return (async () => {
    const graphsWithVectors: SemanticInput['graphs'] = new Map();
    const pending = new Map<string, Promise<number[]>>();
    await Promise.all(
      usable.map(async ({ g, source, vectors }) => {
        const key = `${source.model}\n${source.dimensions ?? ''}\n${source.queryPrefix ?? ''}`;
        let promise = pending.get(key);
        if (!promise) {
          promise = source.embed([(source.queryPrefix ?? '') + query]).then(([v]) => {
            if (!Array.isArray(v) || !v.length) throw new Error('The provider gave no vector for the query.');
            return reduceVector(v, source.dimensions);
          });
          pending.set(key, promise);
        }
        try {
          const vector = await promise;
          if (vector.length !== vectors.dimensions) throw new Error(`The query vector has ${vector.length} numbers and the index has ${vectors.dimensions}.`);
          graphsWithVectors.set(g.id, { vectors, query: vector });
          const stale = staleNodes(vectors, nodeHashes(rankIndexOf(g.index)));
          if (stale) notes.push(`Graph "${g.id}": ${stale} node(s) changed since the index was built. Run semspec index to include them.`);
        } catch (e) {
          notes.push(`Graph "${g.id}": the model did not answer (${messageOf(e)}). The ranking uses keywords only.`);
        }
      }),
    );
    if (!graphsWithVectors.size) return keyword(notes);
    const result = searchGraphs(graphs, query, { ...rest, semantic: { mode: mode === 'vector' ? 'vector' : 'hybrid', graphs: graphsWithVectors } });
    return notes.length ? { ...result, notes: notes.sort() } : result;
  })();
}
