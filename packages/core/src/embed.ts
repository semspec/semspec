// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Optional meaning-based search. This module holds the pure part: the settings, the vectors, the
// index of vectors and the ranking by cosine. A provider turns texts into vectors. The providers
// run in the cli package. Semspec ships no model and has no default model.
import type { RankedNode, RankIndex } from './rank.js';

// ---------- settings ----------

export const EMBEDDING_PROVIDERS = ['ollama', 'openai-compatible', 'command'] as const;
export type EmbeddingProviderName = (typeof EMBEDDING_PROVIDERS)[number];

export interface EmbeddingConfig {
  provider: EmbeddingProviderName;
  // The base URL of the server. A provider `ollama` has the default http://127.0.0.1:11434. A provider `openai-compatible` needs it.
  endpoint?: string;
  // The name of the model. The provider passes it on. The index stores it.
  model: string;
  // The size of the stored vectors. A longer vector is cut to this size and scaled to length 1.
  dimensions?: number;
  // The most texts in 1 request. The default is 32.
  batch?: number;
  // The name of the environment variable that holds the API key. A provider `openai-compatible` only. The key never sits in a file.
  apiKeyEnv?: string;
  // The program and its arguments. A provider `command` only. No shell reads them.
  command?: string[];
  // A text that goes before each node text, and before the query. Some models need it.
  documentPrefix?: string;
  queryPrefix?: string;
  // The path of the index file. The default is the graph path with `.semspec-index.json` added.
  index?: string;
}

export const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434';
export const DEFAULT_BATCH = 32;
const KEYS = ['provider', 'endpoint', 'model', 'dimensions', 'batch', 'apiKeyEnv', 'command', 'documentPrefix', 'queryPrefix', 'index'];

// The problems of a `search.embeddings` value. An empty list means the value is valid.
export function embeddingConfigProblems(value: unknown, where = 'search.embeddings'): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${where} must be an object.`];
  const v = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of Object.keys(v)) if (!KEYS.includes(k)) errors.push(`${where}.${k} is not a known setting. The settings are: ${KEYS.join(', ')}.`);
  const provider = v.provider;
  if (!EMBEDDING_PROVIDERS.includes(provider as EmbeddingProviderName)) errors.push(`${where}.provider must be one of: ${EMBEDDING_PROVIDERS.join(', ')}.`);
  if (typeof v.model !== 'string' || !v.model.trim()) errors.push(`${where}.model must be a name that is not empty. Semspec has no default model.`);
  if (v.endpoint !== undefined) {
    if (typeof v.endpoint !== 'string' || !/^https?:\/\/[^\s/]+/.test(v.endpoint)) errors.push(`${where}.endpoint must be a URL that starts with http:// or https://.`);
    else if (provider === 'command') errors.push(`${where}.endpoint is not for the provider "command".`);
    else if (/^https?:\/\/[^/]*@/.test(v.endpoint)) errors.push(`${where}.endpoint must not hold a user name or a password.`);
  } else if (provider === 'openai-compatible') errors.push(`${where}.endpoint is required for the provider "openai-compatible".`);
  const whole = (name: string, max: number) => {
    const n = v[name];
    if (n !== undefined && (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > max)) errors.push(`${where}.${name} must be a whole number from 1 to ${max}.`);
  };
  whole('dimensions', 65536);
  whole('batch', 1024);
  if (v.apiKeyEnv !== undefined) {
    if (typeof v.apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.apiKeyEnv)) errors.push(`${where}.apiKeyEnv must be the name of an environment variable. Do not put the key itself in the file.`);
    else if (provider !== 'openai-compatible') errors.push(`${where}.apiKeyEnv is only for the provider "openai-compatible".`);
  }
  if (v.command !== undefined) {
    if (!Array.isArray(v.command) || !v.command.length || v.command.some((x) => typeof x !== 'string' || !x)) errors.push(`${where}.command must be a list of texts: the program and its arguments.`);
    else if (provider !== 'command') errors.push(`${where}.command is only for the provider "command".`);
  } else if (provider === 'command') errors.push(`${where}.command is required for the provider "command".`);
  for (const k of ['documentPrefix', 'queryPrefix']) if (v[k] !== undefined && typeof v[k] !== 'string') errors.push(`${where}.${k} must be a text.`);
  if (v.index !== undefined && (typeof v.index !== 'string' || !v.index)) errors.push(`${where}.index must be a path that is not empty.`);
  return errors;
}

// The setting for 1 graph. The setting of the workspace wins over the setting of the profile. No setting means keywords only.
export function resolveEmbeddingConfig(workspace: unknown, profile: unknown): { config: EmbeddingConfig; from: 'workspace' | 'profile' } | undefined {
  const from = workspace !== undefined ? 'workspace' : profile !== undefined ? 'profile' : undefined;
  if (!from) return undefined;
  const value = from === 'workspace' ? workspace : profile;
  const problems = embeddingConfigProblems(value, `${from === 'workspace' ? 'workspace ' : 'profile '}search.embeddings`);
  if (problems.length) throw new Error(problems.join('\n'));
  return { config: value as EmbeddingConfig, from };
}

// ---------- vectors ----------

// A provider turns a list of texts into a list of vectors, 1 for each text.
export type Embedder = (texts: string[]) => Promise<number[][]>;

export const roundVector = (v: number[]): number[] => v.map((x) => Math.round(x * 1e4) / 1e4);

// Cuts a vector to `dimensions` (when set), scales it to length 1 and rounds it to 4 decimals.
// Cutting then scaling is how a Matryoshka model gives a shorter vector.
export function reduceVector(vector: number[], dimensions?: number): number[] {
  if (dimensions !== undefined && dimensions > vector.length) throw new Error(`The model gives vectors of ${vector.length} numbers. The setting dimensions is ${dimensions}, which is more.`);
  const cut = dimensions !== undefined ? vector.slice(0, dimensions) : vector;
  const length = Math.sqrt(cut.reduce((s, x) => s + x * x, 0));
  return roundVector(length > 0 ? cut.map((x) => x / length) : cut);
}

// The cosine of 2 vectors. The vectors in an index have length 1, so this is almost the dot product.
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// A 53 bit hash of a text, as 14 hex digits. It is a key to find a changed text, not a security feature.
export function textHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

// ---------- node texts ----------

const MAX_TEXT = 2000;

// The text of a node for the model: the id and the same text pieces that the keyword index reads.
export function embeddingTexts(ix: RankIndex): { id: string; text: string }[] {
  return ix.ids.map((id, i) => ({ id, text: [id, ...new Set(ix.texts[i])].join('\n').slice(0, MAX_TEXT) }));
}

const hashCache = new WeakMap<RankIndex, Map<string, string>>();

// The hash of the text of each node, by node id.
export function nodeHashes(ix: RankIndex): Map<string, string> {
  let found = hashCache.get(ix);
  if (!found) {
    found = new Map(embeddingTexts(ix).map(({ id, text }) => [id, textHash(text)]));
    hashCache.set(ix, found);
  }
  return found;
}

// ---------- index ----------

export const INDEX_VERSION = 1;

export interface VectorIndex {
  version: number;
  model: string;
  // The size of each stored vector.
  dimensions: number;
  // The setting `dimensions` when the index was built. null when the setting was missing.
  requested: number | null;
  documentPrefix: string;
  nodes: Record<string, { hash: string; vector: number[] }>;
}

export interface IndexSettings {
  model: string;
  dimensions?: number;
  documentPrefix?: string;
}

// Reads the parsed JSON of an index file. It throws when the shape is wrong.
export function parseVectorIndex(value: unknown): VectorIndex {
  const v = value as Partial<VectorIndex> | null;
  const bad = (why: string) => new Error(`The index file is not valid: ${why}. Run semspec index to build it again.`);
  if (!v || typeof v !== 'object' || v.version !== INDEX_VERSION) throw bad('the version is not supported');
  if (typeof v.model !== 'string' || !Number.isInteger(v.dimensions) || typeof v.nodes !== 'object' || !v.nodes) throw bad('a field is missing');
  for (const [id, n] of Object.entries(v.nodes)) {
    if (typeof n?.hash !== 'string' || !Array.isArray(n.vector) || n.vector.length !== v.dimensions || n.vector.some((x) => typeof x !== 'number' || !Number.isFinite(x))) throw bad(`the entry "${id}" is wrong`);
  }
  return { version: v.version, model: v.model, dimensions: v.dimensions!, requested: v.requested ?? null, documentPrefix: v.documentPrefix ?? '', nodes: v.nodes };
}

// True when an index built with these settings can serve a query with the settings given.
export function indexMatches(index: VectorIndex, settings: IndexSettings): boolean {
  return index.model === settings.model && index.requested === (settings.dimensions ?? null) && index.documentPrefix === (settings.documentPrefix ?? '');
}

export interface IndexUpdate {
  index: VectorIndex;
  embedded: number;
  kept: number;
  removed: number;
  // True when the settings changed and all nodes were embedded again.
  rebuilt: boolean;
}

function checkVectors(vectors: unknown, count: number): number[][] {
  if (!Array.isArray(vectors) || vectors.length !== count) throw new Error(`The provider gave ${Array.isArray(vectors) ? vectors.length : 'no list of'} vectors for ${count} texts.`);
  const size = (vectors[0] as number[] | undefined)?.length;
  for (const v of vectors) {
    if (!Array.isArray(v) || !v.length || v.length !== size || v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) throw new Error('The provider gave a vector that is empty, has other numbers than finite numbers or has another size than the others.');
  }
  return vectors as number[][];
}

// Embeds the texts in batches. Each vector is cut, scaled and rounded as the settings say.
export async function embedTexts(embed: Embedder, texts: string[], dimensions: number | undefined, batch = DEFAULT_BATCH): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batch) {
    const part = texts.slice(i, i + batch);
    for (const v of checkVectors(await embed(part), part.length)) out.push(reduceVector(v, dimensions));
  }
  return out;
}

// Builds or updates an index. A node whose hash is the same keeps its vector. A new or changed node is embedded.
// A node that is no longer in `items` is dropped. A change of the model, the size or the prefix embeds all nodes again.
export async function updateVectorIndex(
  existing: VectorIndex | undefined,
  items: { id: string; text: string }[],
  settings: IndexSettings,
  embed: Embedder,
  batch = DEFAULT_BATCH,
): Promise<IndexUpdate> {
  const prefix = settings.documentPrefix ?? '';
  const reuse = existing && indexMatches(existing, settings) ? existing : undefined;
  const nodes: VectorIndex['nodes'] = {};
  const todo: { id: string; hash: string; text: string }[] = [];
  let kept = 0;
  for (const { id, text } of items) {
    const hash = textHash(text);
    const old = reuse?.nodes[id];
    if (old && old.hash === hash) {
      nodes[id] = old;
      kept++;
    } else todo.push({ id, hash, text });
  }
  const vectors = await embedTexts(embed, todo.map((t) => prefix + t.text), settings.dimensions, batch);
  todo.forEach((t, i) => {
    nodes[t.id] = { hash: t.hash, vector: vectors[i] };
  });
  const sizes = new Set(Object.values(nodes).map((n) => n.vector.length));
  if (sizes.size > 1) throw new Error('The vectors of the index have different sizes.');
  const dimensions = [...sizes][0] ?? reuse?.dimensions ?? 0;
  const removed = reuse ? Object.keys(reuse.nodes).filter((id) => !(id in nodes)).length : 0;
  return {
    index: { version: INDEX_VERSION, model: settings.model, dimensions, requested: settings.dimensions ?? null, documentPrefix: prefix, nodes },
    embedded: todo.length,
    kept,
    removed,
    rebuilt: !!existing && !reuse,
  };
}

// ---------- ranking ----------

export const RRF_K = 60;
// The most nodes that the vector ranking gives. A longer list would make every query fill the result.
export const VECTOR_CANDIDATES = 50;
// A node with a cosine below this is not a hit.
const MIN_COSINE = 0.05;

// Ranks the nodes of an index by cosine to the query vector. A node whose text changed since the index build is skipped.
export function rankVectors(index: VectorIndex, query: number[], hashes: Map<string, string>, allow?: Set<string>, limit = VECTOR_CANDIDATES): RankedNode[] {
  const scored: RankedNode[] = [];
  for (const [id, entry] of Object.entries(index.nodes)) {
    if (hashes.get(id) !== entry.hash || (allow && !allow.has(id))) continue;
    const score = cosine(query, entry.vector);
    if (score >= MIN_COSINE) scored.push({ id, score });
  }
  return scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)).slice(0, limit);
}

// The number of nodes of the index that no longer match the text of the graph, or are missing.
export function staleNodes(index: VectorIndex, hashes: Map<string, string>): number {
  let n = 0;
  for (const [id, hash] of hashes) if (index.nodes[id]?.hash !== hash) n++;
  return n;
}

// Merges rankings by reciprocal rank fusion: a node scores the sum of 1 / (k + rank) over the lists, with rank from 1.
export function fuseRankings(lists: RankedNode[][], k = RRF_K): RankedNode[] {
  const score = new Map<string, number>();
  for (const list of lists) list.forEach((hit, i) => score.set(hit.id, (score.get(hit.id) ?? 0) + 1 / (k + i + 1)));
  return [...score].map(([id, s]) => ({ id, score: s })).sort((a, b) => b.score - a.score);
}
