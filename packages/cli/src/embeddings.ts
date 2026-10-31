// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The providers of the meaning search and the index files. A provider turns texts into vectors.
// The user names the provider and the model. Semspec ships no model and has no default model.
// The API key comes only from an environment variable. No message holds it.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  DEFAULT_BATCH,
  DEFAULT_OLLAMA_ENDPOINT,
  embeddingTexts,
  parseVectorIndex,
  rankIndexOf,
  resolveEmbeddingConfig,
  updateVectorIndex,
  type Embedder,
  type EmbeddingConfig,
  type GraphIndex,
  type IndexUpdate,
  type SemanticSource,
  type VectorIndex,
} from '@semspec/core';

export const INDEX_SUFFIX = '.semspec-index.json';
// The time limit of 1 request. A search is short. An index build embeds many texts in each request.
export const SEARCH_TIMEOUT_MS = 15000;
export const INDEX_TIMEOUT_MS = 300000;

export interface ProviderOptions {
  env?: NodeJS.ProcessEnv;
  // The folder where a command runs.
  cwd?: string;
  timeoutMs?: number;
}

// The URL of a path on the server. A trailing slash of the endpoint goes. For the path /v1/embeddings, a trailing /v1 goes too.
const URL_OF = (endpoint: string, path: string) => {
  const base = endpoint.replace(/\/+$/, '');
  return `${path.startsWith('/v1/') ? base.replace(/\/v1$/, '') : base}${path}`;
};

// Removes the secrets from a message: the value of the key and any text that looks like a bearer token.
export function redact(message: string, secrets: string[]): string {
  let out = message.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***');
  for (const s of secrets) if (s) out = out.split(s).join('***');
  return out;
}

const shownUrl = (url: string) => {
  const u = new URL(url);
  return `${u.origin}${u.pathname}`;
};

async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number, secrets: string[]): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    const why = err.name === 'TimeoutError' ? `no answer in ${Math.round(timeoutMs / 1000)} seconds` : (err.cause?.code ?? err.cause?.message ?? err.message);
    throw new Error(redact(`The request to ${shownUrl(url)} failed: ${why}`, secrets));
  }
  const text = await response.text();
  if (!response.ok) throw new Error(redact(`The server ${shownUrl(url)} answered ${response.status}: ${text.replace(/\s+/g, ' ').slice(0, 200)}`, secrets));
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The server ${shownUrl(url)} did not answer with JSON.`);
  }
}

function ollama(config: EmbeddingConfig, options: ProviderOptions): Embedder {
  const url = URL_OF(config.endpoint ?? DEFAULT_OLLAMA_ENDPOINT, '/api/embed');
  return async (texts) => {
    const answer = (await postJson(url, { model: config.model, input: texts }, {}, options.timeoutMs ?? SEARCH_TIMEOUT_MS, [])) as { embeddings?: number[][] };
    if (!Array.isArray(answer?.embeddings)) throw new Error('The answer of Ollama has no "embeddings" list.');
    return answer.embeddings;
  };
}

function openAiCompatible(config: EmbeddingConfig, options: ProviderOptions): Embedder {
  const url = URL_OF(config.endpoint!, '/v1/embeddings');
  const env = options.env ?? process.env;
  return async (texts) => {
    const key = config.apiKeyEnv ? env[config.apiKeyEnv] : undefined;
    if (config.apiKeyEnv && !key) throw new Error(`The environment variable ${config.apiKeyEnv} is not set.`);
    const headers: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {};
    const answer = (await postJson(url, { model: config.model, input: texts }, headers, options.timeoutMs ?? SEARCH_TIMEOUT_MS, key ? [key] : [])) as { data?: { index?: number; embedding?: number[] }[] };
    if (!Array.isArray(answer?.data)) throw new Error('The answer of the server has no "data" list.');
    return [...answer.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding as number[]);
  };
}

// Runs the program with the texts as JSON on stdin: {"model": "...", "texts": ["..."]}.
// The program writes the vectors as JSON on stdout: [[...], ...] or {"vectors": [[...], ...]}.
function command(config: EmbeddingConfig, options: ProviderOptions): Embedder {
  const [program, ...args] = config.command!;
  const timeoutMs = options.timeoutMs ?? SEARCH_TIMEOUT_MS;
  return (texts) =>
    new Promise((resolveVectors, reject) => {
      const child = spawn(program, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
      const out: Buffer[] = [];
      let err = '';
      let done = false;
      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(() => reject(new Error(`The command "${program}" gave no answer in ${Math.round(timeoutMs / 1000)} seconds.`)));
      }, timeoutMs);
      child.stdout.on('data', (d: Buffer) => out.push(d));
      child.stderr.on('data', (d: Buffer) => {
        if (err.length < 400) err += d.toString();
      });
      child.on('error', (e) => finish(() => reject(new Error(`The command "${program}" did not start: ${e.message}`))));
      child.on('close', (code) =>
        finish(() => {
          if (code !== 0) return reject(new Error(`The command "${program}" ended with code ${code}${err.trim() ? `: ${err.replace(/\s+/g, ' ').trim().slice(0, 200)}` : '.'}`));
          try {
            const parsed = JSON.parse(Buffer.concat(out).toString('utf8')) as unknown;
            const vectors = Array.isArray(parsed) ? parsed : (parsed as { vectors?: unknown })?.vectors;
            if (!Array.isArray(vectors)) throw new Error('no list');
            resolveVectors(vectors as number[][]);
          } catch {
            reject(new Error(`The command "${program}" did not write a JSON list of vectors on stdout.`));
          }
        }),
      );
      child.stdin.on('error', () => undefined);
      child.stdin.end(JSON.stringify({ model: config.model, texts }));
    });
}

// The opt-ins that the user gives outside the repository: the options --allow-command and --allow-remote, or the
// environment variables SEMSPEC_ALLOW_COMMAND=1 and SEMSPEC_ALLOW_REMOTE=1. A profile or a workspace file cannot give them.
const permissions = { command: false, remote: false };

export function setPermissions(p: { command?: boolean; remote?: boolean }): void {
  permissions.command = !!p.command;
  permissions.remote = !!p.remote;
}

export const isLoopback = (endpoint: string): boolean => {
  try {
    const host = new URL(endpoint).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host);
  } catch {
    return false;
  }
};

// The reason why a configuration may not run, or undefined when it may run.
export function refusal(config: EmbeddingConfig, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (config.provider === 'command' && !permissions.command && env.SEMSPEC_ALLOW_COMMAND !== '1') {
    return 'The setting runs a command. Semspec runs it only when you opt in: use --allow-command or set SEMSPEC_ALLOW_COMMAND=1. A file in a repository cannot opt in for you.';
  }
  const endpoint = config.endpoint ?? (config.provider === 'ollama' ? DEFAULT_OLLAMA_ENDPOINT : undefined);
  if (endpoint && !isLoopback(endpoint) && !permissions.remote && env.SEMSPEC_ALLOW_REMOTE !== '1') {
    return 'The setting sends the node texts to a host that is not on this machine. Semspec does it only when you opt in: use --allow-remote or set SEMSPEC_ALLOW_REMOTE=1.';
  }
  return undefined;
}

// Makes the embedder of a configuration. Without the opt-in that the configuration needs, the embedder runs nothing and fails with a message.
export function createEmbedder(config: EmbeddingConfig, options: ProviderOptions = {}): Embedder {
  const refused = refusal(config, options.env);
  if (refused) return async () => Promise.reject(new Error(refused));
  if (config.provider === 'ollama') return ollama(config, options);
  if (config.provider === 'openai-compatible') return openAiCompatible(config, options);
  return command(config, options);
}

// ---------- index files ----------

export interface EmbeddingTarget {
  graphId: string;
  config: EmbeddingConfig;
  // The folder that relative paths of the configuration start from.
  baseDir: string;
  indexPath: string;
}

// The setting of a graph and the path of its index. The workspace setting wins over the profile setting.
// `index` names 1 path. When the workspace setting serves several graphs, the graph id goes before ".json".
export function embeddingTarget(args: {
  graphId: string;
  graphPath: string;
  profile: { search?: { embeddings?: unknown } };
  profileDir: string;
  workspace?: { embeddings: unknown; dir: string; graphs: number };
}): EmbeddingTarget | undefined {
  const w = args.workspace?.embeddings !== undefined ? args.workspace : undefined;
  const resolved = resolveEmbeddingConfig(w?.embeddings, args.profile.search?.embeddings);
  if (!resolved) return undefined;
  const baseDir = resolved.from === 'workspace' ? w!.dir : args.profileDir;
  let indexPath: string;
  if (resolved.config.index) {
    indexPath = resolve(baseDir, resolved.config.index);
    if (resolved.from === 'workspace' && w!.graphs > 1) indexPath = indexPath.replace(/(\.json)?$/, `.${args.graphId}.json`);
  } else indexPath = `${args.graphPath.replace(/[/\\]+$/, '')}${INDEX_SUFFIX}`;
  return { graphId: args.graphId, config: resolved.config, baseDir, indexPath };
}

// Reads an index file. It returns undefined when the file does not exist. It throws when the file is not valid.
export function readIndexFile(path: string): VectorIndex | undefined {
  if (!existsSync(path)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('The index file is not valid JSON. Run semspec index to build it again.');
  }
  return parseVectorIndex(value);
}

export function writeIndexFile(path: string, index: VectorIndex): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, JSON.stringify(index));
  renameSync(temp, path);
}

// The source for the search: the settings, the embedder and the index of the file. A broken index file gives a problem text.
export function semanticSourceOf(target: EmbeddingTarget, options: ProviderOptions = {}): SemanticSource {
  const { config } = target;
  const source: SemanticSource = {
    model: config.model,
    dimensions: config.dimensions,
    documentPrefix: config.documentPrefix,
    queryPrefix: config.queryPrefix,
    embed: createEmbedder(config, { cwd: target.baseDir, ...options }),
  };
  try {
    source.vectors = readIndexFile(target.indexPath);
  } catch (e) {
    source.problem = (e as Error).message;
  }
  return source;
}

// Builds or updates the index file of 1 graph. A node text goes to the provider only when its hash is new.
export async function buildIndexFile(target: EmbeddingTarget, graph: GraphIndex, options: ProviderOptions = {}): Promise<IndexUpdate> {
  const embed = createEmbedder(target.config, { cwd: target.baseDir, timeoutMs: INDEX_TIMEOUT_MS, ...options });
  let existing: VectorIndex | undefined;
  try {
    existing = readIndexFile(target.indexPath);
  } catch {
    existing = undefined;
  }
  const update = await updateVectorIndex(existing, embeddingTexts(rankIndexOf(graph.index)), target.config, embed, target.config.batch ?? DEFAULT_BATCH);
  writeIndexFile(target.indexPath, update.index);
  return update;
}
