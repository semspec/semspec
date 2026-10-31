// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The ranking of nodes for a text query: a word index over the nodes of 1 graph and BM25.
// The index reads the id, the title, the statement, the text of the parts, the labels and the definitions
// of the coded fields, and the fields that the profile names under `search.fields`.
// The query widens with synonyms. A synonym is not in the index. It is a word of the query with a lower weight.
// The synonyms are the alt labels of a concept and the synonym fields of a node.
import { getPath, kindOf } from './profile.js';
import type { Index, Profile, VNode } from './types.js';

// ---------- words ----------

// The words that a query drops. A query that has only these words keeps them.
const STOP_WORDS = new Set(
  'a an the of to in on at by for from with and or is are was were be been do does did how what which who whom when where why can could should would will shall it its this that these those i we you they me my our your their as if than then there into about over under not no'.split(' '),
);

// Cuts a plural ending from a word. A word with a digit and a short word stay as they are.
export function stem(word: string): string {
  if (word.length < 4 || /\d/.test(word)) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(word)) return word;
  if (/(sses|xes|zes|ches|shes|tuses)$/.test(word)) return word.slice(0, -2);
  return word.endsWith('s') ? word.slice(0, -1) : word;
}

// Splits a text into lower case words. A word keeps its letters and digits, so an acronym and a code stay whole.
export function tokenise(text: string): string[] {
  return text
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(stem);
}

// The text values of a value: a string, or the strings in a list or an object.
export function textsOf(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  if (typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(textsOf);
  if (value && typeof value === 'object') return Object.values(value).flatMap(textsOf);
  return [];
}

// ---------- index ----------

export const SYNONYM_WEIGHT = 0.6;
const PREFIX_WEIGHT = 0.4;
const MAX_PREFIX_TERMS = 20;
const K1 = 1.2;
const B = 0.75;
const EXACT_ID = 1e6;
const EXACT_TITLE = 1e5;
const DEFAULT_WEIGHT = { id: 2, title: 3, sub: 1, statement: 1, parts: 1, definition: 0.5 };

interface Doc {
  tf: Map<string, number>;
  len: number;
}

export interface RankIndex {
  ids: string[];
  docs: Doc[];
  // The text pieces of each node, the most telling first. A snippet takes its text from them.
  texts: string[][];
  postings: Map<string, number[]>;
  avgLen: number;
  // Groups of phrases that mean the same. A phrase is a list of words.
  groups: string[][][];
  position: Map<string, number>;
  titleKeys: Map<string, number[]>;
}

// 1 text with a weight.
type Piece = [text: string, weight: number];

function pieces(index: Index, n: VNode): Piece[] {
  const P: Profile = index.profile;
  const boost = P.search?.boost ?? {};
  const weight = (field: string, fallback: number) => boost[field] ?? fallback;
  const out: Piece[] = [];
  const titleWeight = weight('title', DEFAULT_WEIGHT.title);
  const statementWeight = weight('statement', DEFAULT_WEIGHT.statement);
  out.push([n.statement, statementWeight]);
  for (const f of P.fields.statement) for (const t of textsOf(n.d[f])) out.push([t, weight(f, statementWeight)]);
  out.push([n.title, titleWeight]);
  for (const f of P.fields.title) for (const t of textsOf(n.d[f])) out.push([t, weight(f, titleWeight)]);
  out.push([n.sub, weight('sub', DEFAULT_WEIGHT.sub)]);
  const partWeight = weight('parts', DEFAULT_WEIGHT.parts);
  for (const c of index.children.get(n.id) ?? []) {
    const part = index.byId.get(c);
    if (part && kindOf(P, part.kind)?.role === 'part') out.push([part.statement, partWeight]);
  }
  for (const f of new Set(P.search?.fields ?? [])) for (const t of textsOf(getPath(n.d, f))) out.push([t, weight(f, 1)]);
  for (const [field, id] of Object.entries(P.fieldVocabularies ?? {})) {
    const scheme = P.vocabularies?.[id];
    if (!scheme) continue;
    const w = weight(field, 1);
    for (const code of textsOf(getPath(n.d, field))) {
      const concept = scheme.concepts.find((c) => c.code === code);
      if (!concept) continue;
      out.push([concept.label, w]);
      if (concept.definition) out.push([concept.definition, w * DEFAULT_WEIGHT.definition]);
    }
  }
  return out.filter(([t]) => t);
}

function synonymGroups(index: Index): string[][][] {
  const P = index.profile;
  const groups: string[][][] = [];
  const add = (phrases: string[]) => {
    const words = phrases.map(tokenise).filter((p) => p.length && !p.every((w) => STOP_WORDS.has(w)));
    if (words.length > 1) groups.push(words);
  };
  for (const scheme of Object.values(P.vocabularies ?? {})) {
    for (const c of scheme.concepts) add([c.label, c.code, ...(c.altLabels ?? [])]);
  }
  const fields = P.search?.synonymFields ?? [];
  if (fields.length) {
    for (const n of index.model.nodes) add([n.title, ...fields.flatMap((f) => textsOf(getPath(n.d, f)))]);
  }
  return groups;
}

export function buildRankIndex(index: Index): RankIndex {
  const P = index.profile;
  const boost = P.search?.boost ?? {};
  // A check node repeats the name of a test. It is not searched.
  const nodes = index.model.nodes.filter((n) => kindOf(P, n.kind)?.role !== 'check');
  const ids: string[] = [];
  const docs: Doc[] = [];
  const texts: string[][] = [];
  const postings = new Map<string, number[]>();
  const position = new Map<string, number>();
  const titleKeys = new Map<string, number[]>();
  let total = 0;
  nodes.forEach((n, i) => {
    const tf = new Map<string, number>();
    let len = 0;
    const count = (text: string, weight: number) => {
      for (const w of tokenise(text)) {
        tf.set(w, (tf.get(w) ?? 0) + weight);
        len += weight;
      }
    };
    count(n.id, boost.id ?? DEFAULT_WEIGHT.id);
    const all = pieces(index, n);
    for (const [t, w] of all) count(t, w);
    for (const w of tf.keys()) {
      const list = postings.get(w);
      if (list) list.push(i);
      else postings.set(w, [i]);
    }
    ids.push(n.id);
    docs.push({ tf, len });
    texts.push(all.map(([t]) => t));
    position.set(n.id.toLowerCase(), i);
    const key = tokenise(n.title).join(' ');
    if (key) titleKeys.set(key, [...(titleKeys.get(key) ?? []), i]);
    total += len;
  });
  return { ids, docs, texts, postings, avgLen: nodes.length ? total / nodes.length || 1 : 1, groups: synonymGroups(index), position, titleKeys };
}

const cache = new WeakMap<Index, RankIndex>();

// The word index of a graph index. It is built once for each graph index.
export function rankIndexOf(index: Index): RankIndex {
  let found = cache.get(index);
  if (!found) {
    found = buildRankIndex(index);
    cache.set(index, found);
  }
  return found;
}

// ---------- query ----------

export interface RankedNode {
  id: string;
  score: number;
}

export interface Ranking {
  hits: RankedNode[];
  // The index words that the query, its synonyms and its prefixes matched.
  terms: Set<string>;
}

function includesRun(words: string[], run: string[]): boolean {
  for (let i = 0; i + run.length <= words.length; i++) if (run.every((w, j) => words[i + j] === w)) return true;
  return false;
}

// The words of a query with their weights: the words of the query count 1, a synonym counts less and a prefix counts less.
export function queryTerms(ix: RankIndex, query: string): Map<string, number> {
  const all = tokenise(query);
  const kept = all.filter((w) => !STOP_WORDS.has(w));
  const words = kept.length ? kept : all;
  const weights = new Map<string, number>();
  const put = (w: string, weight: number) => weights.set(w, Math.max(weights.get(w) ?? 0, weight));
  for (const w of words) put(w, 1);
  for (const group of ix.groups) {
    if (!group.some((phrase) => includesRun(all, phrase))) continue;
    for (const phrase of group) for (const w of phrase) if (!STOP_WORDS.has(w)) put(w, SYNONYM_WEIGHT);
  }
  for (const w of words) {
    if (w.length < 3 || ix.postings.has(w)) continue;
    let added = 0;
    for (const term of ix.postings.keys()) {
      if (term.startsWith(w) && added++ < MAX_PREFIX_TERMS) put(term, PREFIX_WEIGHT);
    }
  }
  return weights;
}

// Ranks the nodes for a query with BM25. A node with the query as its id comes first, then a node with the query as its title.
// `allow` limits the nodes that can appear. A node with no match has no hit.
export function rankQuery(ix: RankIndex, query: string, allow?: Set<string>): Ranking {
  const weights = queryTerms(ix, query);
  const n = ix.docs.length;
  const score = new Map<number, number>();
  for (const [term, weight] of weights) {
    const list = ix.postings.get(term);
    if (!list) continue;
    const idf = Math.log(1 + (n - list.length + 0.5) / (list.length + 0.5));
    for (const d of list) {
      const doc = ix.docs[d];
      const tf = doc.tf.get(term)!;
      const part = (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.len) / ix.avgLen));
      score.set(d, (score.get(d) ?? 0) + weight * idf * part);
    }
  }
  const trimmed = query.trim().toLowerCase();
  for (const word of new Set([trimmed, ...trimmed.split(/\s+/)])) {
    const d = ix.position.get(word);
    if (d !== undefined) score.set(d, (score.get(d) ?? 0) + EXACT_ID);
  }
  for (const d of ix.titleKeys.get(tokenise(query).join(' ')) ?? []) score.set(d, (score.get(d) ?? 0) + EXACT_TITLE);
  const hits = [...score]
    .filter(([d, s]) => s > 0 && (!allow || allow.has(ix.ids[d])))
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([d, s]) => ({ id: ix.ids[d], score: s }));
  return { hits, terms: new Set(weights.keys()) };
}
