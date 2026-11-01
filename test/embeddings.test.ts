// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the optional meaning search: the settings, the 3 providers against local fakes, the index file,
// the hybrid ranking, the fall back to keywords, the secret key and the rule that Semspec ships no model.
// No test uses a real model. The fakes give vectors from letter groups, so the code path runs and nothing more.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  embeddingConfigProblems,
  embeddingTexts,
  fuseRankings,
  indexGraphs,
  rankIndexOf,
  reduceVector,
  resolveEmbeddingConfig,
  searchGraphs,
  searchSemantic,
  textHash,
  updateVectorIndex,
  type Embedder,
  type GraphIndex,
  type SemanticSource,
} from '@semspec/core';
import { callTool } from '@semspec/mcp';
import { buildIndexFile, createEmbedder, isLoopback, readIndexFile, redact, refusal, semanticSourceOf, setPermissions } from '../packages/cli/src/embeddings';
import { run } from '../packages/cli/src/index';
import { loadWithTargets, mcpLoader } from '../packages/cli/src/mcp';
import { fakeEmbed, fakeVector } from './helpers/fake-embed';
import { validateProfile } from '../packages/cli/src/validate';
import { validateWorkspace } from '../packages/cli/src/workspace';

const repo = fileURLToPath(new URL('..', import.meta.url));
const fixtures = join(repo, 'fixtures', 'workspace');
const made: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'semspec-embed-'));
  made.push(d);
  return d;
};
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));
afterEach(() => {
  vi.restoreAllMocks();
  setPermissions({});
});

// ---------- fake servers ----------

interface Fake {
  url: string;
  texts: string[];
  auth: (string | undefined)[];
  close: () => Promise<void>;
}

async function fakeServer(mode: 'ok' | 'echo-auth' | 'wrong-count' = 'ok', requireKey?: string): Promise<Fake> {
  const fake: Fake = { url: '', texts: [], auth: [], close: async () => undefined };
  const body = (req: IncomingMessage) =>
    new Promise<any>((done) => {
      let s = '';
      req.on('data', (d) => (s += d));
      req.on('end', () => done(JSON.parse(s)));
    });
  const server: Server = createServer(async (req, res) => {
    const input = await body(req);
    const texts: string[] = input.input;
    fake.auth.push(req.headers.authorization);
    const send = (code: number, value: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(typeof value === 'string' ? value : JSON.stringify(value));
    };
    if (mode === 'echo-auth') return send(500, `internal error, request had authorization: ${req.headers.authorization}`);
    if (requireKey && req.headers.authorization !== `Bearer ${requireKey}`) return send(401, { error: 'bad key' });
    fake.texts.push(...texts);
    const vectors = texts.map((t) => fakeVector(t)).slice(0, mode === 'wrong-count' ? 1 : undefined);
    if (req.url === '/api/embed') return send(200, { model: input.model, embeddings: vectors });
    if (req.url === '/v1/embeddings') return send(200, { data: vectors.map((embedding, index) => ({ index, embedding })).reverse() });
    return send(404, {});
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  fake.url = `http://127.0.0.1:${port}`;
  fake.close = () => new Promise((done) => server.close(() => done()));
  return fake;
}

// ---------- workspaces ----------

const workspaceJson = (search?: object) => ({
  title: 'Shop workspace',
  ...(search ? { search } : {}),
  graphs: [
    { id: 'req', label: 'Requirements', graph: join(fixtures, 'product/graph.json'), profile: join(fixtures, 'product/profile.json') },
    { id: 'domain', label: 'Retail market', graph: join(fixtures, 'domain/graph'), profile: join(fixtures, 'domain/profile.yaml') },
  ],
});

function workspaceFile(embeddings?: object, dir = temp()): { file: string; dir: string } {
  const file = join(dir, 'workspace.json');
  writeFileSync(file, JSON.stringify(workspaceJson(embeddings ? { embeddings: { index: join(dir, 'ix.json'), ...embeddings } } : undefined)));
  return { file, dir };
}

const graphsOf = (file: string): GraphIndex[] => indexGraphs(loadWithTargets({ workspace: file }).graphs.map((g) => ({ id: g.id, label: g.label, model: g.model })));
const ids = (r: { hits: { id: string }[] }) => r.hits.map((h) => h.id);

// ---------- settings ----------

describe('the embedding settings', () => {
  const ok = { provider: 'ollama', model: 'm' };

  it('accept the 3 providers', () => {
    expect(embeddingConfigProblems(ok)).toEqual([]);
    expect(embeddingConfigProblems({ provider: 'openai-compatible', model: 'm', endpoint: 'http://localhost:8080', apiKeyEnv: 'MY_KEY', dimensions: 256, batch: 8 })).toEqual([]);
    expect(embeddingConfigProblems({ provider: 'command', model: 'm', command: ['node', 'embed.mjs'] })).toEqual([]);
  });

  it('have no default model and name each problem', () => {
    expect(embeddingConfigProblems({ provider: 'ollama' }).join()).toContain('no default model');
    expect(embeddingConfigProblems({ provider: 'x', model: 'm' }).join()).toContain('provider must be one of');
    expect(embeddingConfigProblems({ ...ok, dimensions: 0 }).join()).toContain('dimensions');
    expect(embeddingConfigProblems({ ...ok, batch: 1.5 }).join()).toContain('batch');
    expect(embeddingConfigProblems({ ...ok, endpoint: 'ftp://x' }).join()).toContain('endpoint');
    expect(embeddingConfigProblems({ ...ok, endpoint: 'http://user:pass@host' }).join()).toContain('password');
    expect(embeddingConfigProblems({ provider: 'openai-compatible', model: 'm' }).join()).toContain('endpoint is required');
    expect(embeddingConfigProblems({ provider: 'command', model: 'm' }).join()).toContain('command is required');
    expect(embeddingConfigProblems({ ...ok, command: ['a'] }).join()).toContain('only for the provider "command"');
    expect(embeddingConfigProblems({ ...ok, apiKeyEnv: 'K' }).join()).toContain('only for the provider "openai-compatible"');
    expect(embeddingConfigProblems({ provider: 'openai-compatible', model: 'm', endpoint: 'http://h', apiKeyEnv: 'sk-abc 123' }).join()).toContain('Do not put the key itself');
    expect(embeddingConfigProblems({ ...ok, apiKey: 'secret' }).join()).toContain('not a known setting');
    expect(embeddingConfigProblems('x')).toEqual(['search.embeddings must be an object.']);
  });

  it('are checked in a profile and in a workspace file', () => {
    const profile = JSON.parse(readFileSync(join(fixtures, 'product/profile.json'), 'utf8'));
    expect(validateProfile({ ...profile, search: { embeddings: ok } })).toEqual([]);
    expect(validateProfile({ ...profile, search: { embeddings: { provider: 'ollama' } } }).length).toBeGreaterThan(0);
    expect(validateProfile({ ...profile, search: { embeddings: { provider: 'command', model: 'm' } } }).join()).toContain('command is required');
    expect(validateWorkspace(workspaceJson({ embeddings: ok }))).toEqual([]);
    expect(validateWorkspace(workspaceJson({ embeddings: { provider: 'nope', model: 'm' } })).length).toBeGreaterThan(0);
    expect(validateWorkspace(workspaceJson({ other: 1 })).length).toBeGreaterThan(0);
  });

  it('let the workspace win over the profile, and give no setting when none is named', () => {
    const w = { provider: 'ollama', model: 'from-workspace' };
    const p = { provider: 'ollama', model: 'from-profile' };
    expect(resolveEmbeddingConfig(w, p)).toEqual({ config: w, from: 'workspace' });
    expect(resolveEmbeddingConfig(undefined, p)).toEqual({ config: p, from: 'profile' });
    expect(resolveEmbeddingConfig(undefined, undefined)).toBeUndefined();
    expect(() => resolveEmbeddingConfig({ provider: 'ollama' }, p)).toThrow('no default model');
  });

  it('give no target and no source for a workspace without a setting', () => {
    const { file } = workspaceFile();
    expect(loadWithTargets({ workspace: file }).targets.size).toBe(0);
    expect(mcpLoader({ workspace: file })().graphs.every((g) => g.embedding === undefined)).toBe(true);
  });

  it('take the setting of a profile when the workspace has none, with paths from the profile folder', () => {
    const dir = temp();
    cpSync(fixtures, dir, { recursive: true });
    const path = join(dir, 'domain/profile.yaml');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\nsearch:\n  embeddings: { provider: ollama, model: from-profile }\n`);
    const { targets } = loadWithTargets({ workspace: join(dir, 'workspace.json') });
    expect([...targets.keys()]).toEqual(['domain']);
    expect(targets.get('domain')!.indexPath).toBe(`${join(dir, 'domain/graph')}.semspec-index.json`);
  });
});

// ---------- vectors ----------

describe('the vectors', () => {
  it('are cut to the size and scaled to length 1', () => {
    expect(reduceVector([3, 4, 12], 2)).toEqual([0.6, 0.8]);
    expect(reduceVector([3, 4])).toEqual([0.6, 0.8]);
    expect(reduceVector([1 / 3, 1 / 3, 1 / 3, 0.5])[0]).toBe(0.4364);
    expect(() => reduceVector([1, 2], 3)).toThrow('which is more');
  });

  it('merge by reciprocal rank fusion with k = 60', () => {
    const fused = fuseRankings([
      [{ id: 'a', score: 9 }, { id: 'b', score: 8 }, { id: 'c', score: 7 }],
      [{ id: 'c', score: 0.9 }, { id: 'a', score: 0.5 }],
    ]);
    expect(fused.map((h) => h.id)).toEqual(['a', 'c', 'b']);
    expect(fused[0].score).toBeCloseTo(1 / 61 + 1 / 62, 10);
    expect(fused[1].score).toBeCloseTo(1 / 63 + 1 / 61, 10);
    expect(textHash('abc')).toBe(textHash('abc'));
    expect(textHash('abc')).not.toBe(textHash('abd'));
  });
});

// ---------- providers ----------

describe('the providers', () => {
  it('ollama posts to /api/embed', async () => {
    const fake = await fakeServer();
    try {
      const vectors = await createEmbedder({ provider: 'ollama', model: 'm', endpoint: `${fake.url}/` })(['alpha', 'beta']);
      expect(vectors).toEqual([fakeVector('alpha'), fakeVector('beta')]);
      expect(fake.texts).toEqual(['alpha', 'beta']);
    } finally {
      await fake.close();
    }
  });

  it('openai-compatible posts to /v1/embeddings, orders by index and sends the key from the environment', async () => {
    const fake = await fakeServer('ok', 'sk-test-123');
    try {
      const config = { provider: 'openai-compatible' as const, model: 'm', endpoint: `${fake.url}/v1`, apiKeyEnv: 'SEMSPEC_TEST_KEY' };
      const vectors = await createEmbedder(config, { env: { SEMSPEC_TEST_KEY: 'sk-test-123' } })(['alpha', 'beta']);
      expect(vectors).toEqual([fakeVector('alpha'), fakeVector('beta')]);
      await expect(createEmbedder(config, { env: {} })(['x'])).rejects.toThrow('The environment variable SEMSPEC_TEST_KEY is not set.');
      await expect(createEmbedder(config, { env: { SEMSPEC_TEST_KEY: 'wrong' } })(['x'])).rejects.toThrow('401');
    } finally {
      await fake.close();
    }
  });

  it('command writes the texts on stdin and reads the vectors from stdout', async () => {
    setPermissions({ command: true });
    const dir = temp();
    writeFileSync(
      join(dir, 'embed.mjs'),
      `let s = '';
process.stdin.on('data', (d) => (s += d));
process.stdin.on('end', () => {
  const { model, texts } = JSON.parse(s);
  process.stdout.write(JSON.stringify({ vectors: texts.map((t) => [t.length, model.length, 1]) }));
});`,
    );
    const embed = createEmbedder({ provider: 'command', model: 'abc', command: [process.execPath, 'embed.mjs'] }, { cwd: dir });
    expect(await embed(['hello', 'hi'])).toEqual([[5, 3, 1], [2, 3, 1]]);
    writeFileSync(join(dir, 'bad.mjs'), `process.stderr.write('boom'); process.exit(3);`);
    await expect(createEmbedder({ provider: 'command', model: 'm', command: [process.execPath, 'bad.mjs'] }, { cwd: dir })(['x'])).rejects.toThrow('ended with code 3: boom');
    await expect(createEmbedder({ provider: 'command', model: 'm', command: ['semspec-no-such-program'] })(['x'])).rejects.toThrow('did not start');
  });

  it('stop a command that does not answer', async () => {
    setPermissions({ command: true });
    const dir = temp();
    writeFileSync(join(dir, 'slow.mjs'), `setTimeout(() => {}, 60000);`);
    await expect(createEmbedder({ provider: 'command', model: 'm', command: [process.execPath, 'slow.mjs'] }, { cwd: dir, timeoutMs: 100 })(['x'])).rejects.toThrow('no answer');
  });

  it('never put the API key in an error', async () => {
    const key = 'sk-secret-ABC123xyz';
    const fake = await fakeServer('echo-auth');
    try {
      const config = { provider: 'openai-compatible' as const, model: 'm', endpoint: fake.url, apiKeyEnv: 'SEMSPEC_TEST_KEY' };
      const error = await createEmbedder(config, { env: { SEMSPEC_TEST_KEY: key } })(['x']).catch((e: Error) => e);
      expect((error as Error).message).toContain('500');
      expect((error as Error).message).not.toContain(key);
      expect(fake.auth).toEqual([`Bearer ${key}`]);
      // Through the search: the note holds no key.
      const { file } = workspaceFile({ provider: 'openai-compatible', model: 'm', endpoint: fake.url, apiKeyEnv: 'SEMSPEC_TEST_KEY' });
      const target = loadWithTargets({ workspace: file }).targets.get('req')!;
      process.env.SEMSPEC_TEST_KEY = key;
      try {
        await expect(buildIndexFile(target, graphsOf(file)[0])).rejects.not.toThrow(key);
        const logs: string[] = [];
        vi.spyOn(console, 'error').mockImplementation((...a) => void logs.push(a.join(' ')));
        vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.join(' ')));
        expect(await run(['index', '--workspace', file])).toBe(1);
        expect(logs.join('\n')).not.toContain(key);
      } finally {
        delete process.env.SEMSPEC_TEST_KEY;
      }
    } finally {
      await fake.close();
    }
    expect(redact(`x Bearer ${key} y ${key}`, [key])).toBe('x Bearer *** y ***');
  });

  it('reject a wrong number of vectors', async () => {
    const fake = await fakeServer('wrong-count');
    try {
      const { file } = workspaceFile({ provider: 'ollama', model: 'm', endpoint: fake.url });
      const target = loadWithTargets({ workspace: file }).targets.get('req')!;
      await expect(buildIndexFile(target, graphsOf(file)[0])).rejects.toThrow('vectors for');
    } finally {
      await fake.close();
    }
  });
});

describe('the opt-ins', () => {
  const cmd = { provider: 'command' as const, model: 'm', command: [process.execPath, '-e', 'process.stdout.write("[[1]]")'] };
  const remote = { provider: 'ollama' as const, model: 'm', endpoint: 'http://embeddings.example.org:11434' };
  const none: Record<string, string> = {};

  it('refuse a command and run nothing without the opt-in, and run it with the option or the variable', async () => {
    const dir = temp();
    const marker = join(dir, 'ran');
    const config = { ...cmd, command: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, '1'); process.stdout.write('[[1]]')`] };
    await expect(createEmbedder(config, { env: none })(['x'])).rejects.toThrow('--allow-command');
    expect(existsSync(marker)).toBe(false);
    expect(await createEmbedder(config, { env: { SEMSPEC_ALLOW_COMMAND: '1' } })(['x'])).toEqual([[1]]);
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);
    setPermissions({ command: true });
    expect(await createEmbedder(config, { env: none })(['x'])).toEqual([[1]]);
    expect(refusal(cmd, none)).toBeUndefined();
  });

  it('refuse a remote endpoint without the opt-in, and accept loopback addresses', async () => {
    expect(refusal(remote, none)).toContain('--allow-remote');
    expect(refusal(remote, { SEMSPEC_ALLOW_REMOTE: '1' })).toBeUndefined();
    setPermissions({ remote: true });
    expect(refusal(remote, none)).toBeUndefined();
    setPermissions({});
    for (const e of ['http://127.0.0.1:1', 'http://localhost:11434', 'http://[::1]:8080', 'http://127.0.0.2']) expect(isLoopback(e)).toBe(true);
    for (const e of ['http://example.org', 'http://127.0.0.1.example.org', 'http://10.0.0.1']) expect(isLoopback(e)).toBe(false);
    expect(refusal({ provider: 'ollama', model: 'm' }, none)).toBeUndefined();
    await expect(createEmbedder(remote, { env: none })(['x'])).rejects.toThrow('not on this machine');
  });

  it('make search fall back with a note, and index exit with an error, until the user opts in', async () => {
    const { file } = workspaceFile(cmd);
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...a) => void err.push(a.join(' ')));
    expect(await run(['index', '--workspace', file])).toBe(1);
    expect(err.join()).toContain('--allow-command');
    // An index from an earlier run exists, so the search tries the model.
    const g = graphsOf(file);
    const u = await updateVectorIndex(undefined, embeddingTexts(rankIndexOf(g[0].index)), { model: 'm' }, fakeEmbed);
    const target = loadWithTargets({ workspace: file }).targets.get('req')!;
    writeFileSync(target.indexPath, JSON.stringify(u.index));
    expect(await run(['search', '--workspace', file, '--json', 'refund time'])).toBe(0);
    const result = JSON.parse(out.pop()!);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.notes.join()).toContain('--allow-command');
  });
});

// ---------- index ----------

describe('the index', () => {
  const items = [
    { id: 'a', text: 'alpha text' },
    { id: 'b', text: 'beta text' },
    { id: 'c', text: 'gamma text' },
  ];

  it('embeds only new and changed nodes and drops removed nodes', async () => {
    const seen: string[] = [];
    const embed: Embedder = async (texts) => (seen.push(...texts), texts.map((t) => fakeVector(t)));
    const first = await updateVectorIndex(undefined, items, { model: 'm' }, embed);
    expect([first.embedded, first.kept, first.removed, first.rebuilt]).toEqual([3, 0, 0, false]);
    expect(first.index.nodes.a.hash).toBe(textHash('alpha text'));
    seen.length = 0;
    const again = await updateVectorIndex(first.index, items, { model: 'm' }, embed);
    expect([again.embedded, again.kept]).toEqual([0, 3]);
    expect(seen).toEqual([]);
    const next = await updateVectorIndex(again.index, [items[0], { id: 'b', text: 'beta changed' }, { id: 'd', text: 'delta text' }], { model: 'm' }, embed);
    expect([next.embedded, next.kept, next.removed]).toEqual([2, 1, 1]);
    expect(seen).toEqual(['beta changed', 'delta text']);
    expect(Object.keys(next.index.nodes).sort()).toEqual(['a', 'b', 'd']);
  });

  it('embeds all nodes again when the model, the size or the prefix changes', async () => {
    const base = await updateVectorIndex(undefined, items, { model: 'm', dimensions: 16 }, fakeEmbed);
    for (const settings of [{ model: 'other', dimensions: 16 }, { model: 'm', dimensions: 8 }, { model: 'm' }, { model: 'm', dimensions: 16, documentPrefix: 'doc: ' }]) {
      const u = await updateVectorIndex(base.index, items, settings, fakeEmbed);
      expect([u.embedded, u.rebuilt]).toEqual([3, true]);
    }
  });

  it('cuts the vectors to the size, scales them and rounds them to 4 decimals', async () => {
    const u = await updateVectorIndex(undefined, items, { model: 'm', dimensions: 10 }, fakeEmbed);
    expect(u.index.dimensions).toBe(10);
    for (const n of Object.values(u.index.nodes)) {
      expect(n.vector).toHaveLength(10);
      expect(Math.hypot(...n.vector)).toBeCloseTo(1, 2);
      expect(n.vector.every((x) => Math.abs(x * 1e4 - Math.round(x * 1e4)) < 1e-6)).toBe(true);
    }
  });

  it('writes the file next to the graph, with the model, the size and the hash and vector of each node', async () => {
    const fake = await fakeServer();
    try {
      const dir = temp();
      cpSync(fixtures, dir, { recursive: true });
      const file = join(dir, 'workspace.json');
      const ws = JSON.parse(readFileSync(file, 'utf8'));
      writeFileSync(file, JSON.stringify({ ...ws, search: { embeddings: { provider: 'ollama', model: 'fake-model', endpoint: fake.url, dimensions: 24, batch: 10 } } }));
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.join(' ')));
      expect(await run(['index', '--workspace', file])).toBe(0);
      const path = join(dir, 'product/graph.json.semspec-index.json');
      expect(existsSync(path)).toBe(true);
      expect(existsSync(join(dir, 'domain/graph.semspec-index.json'))).toBe(true);
      const index = readIndexFile(path)!;
      expect([index.model, index.dimensions, index.requested]).toEqual(['fake-model', 24, 24]);
      const graph = graphsOf(file).find((g) => g.id === 'req')!;
      const texts = embeddingTexts(rankIndexOf(graph.index));
      expect(Object.keys(index.nodes).sort()).toEqual(texts.map((t) => t.id).sort());
      expect(index.nodes[texts[0].id].hash).toBe(textHash(texts[0].text));
      expect(logs.join('\n')).toMatch(/req: \d+ embedded, 0 kept, 0 removed/);
      // A rerun sends nothing.
      const sent = fake.texts.length;
      expect(await run(['index', '--workspace', file])).toBe(0);
      expect(fake.texts.length).toBe(sent);
      expect(logs.at(-1)).toMatch(/req: 0 embedded, \d+ kept/);
      // A new model embeds all nodes again.
      writeFileSync(file, JSON.stringify({ ...ws, search: { embeddings: { provider: 'ollama', model: 'other-model', endpoint: fake.url, dimensions: 24 } } }));
      expect(await run(['index', '--workspace', file])).toBe(0);
      expect(fake.texts.length).toBe(sent * 2);
      expect(readIndexFile(path)!.model).toBe('other-model');
    } finally {
      await fake.close();
    }
  });

  it('reports an error for a command index with no setting', async () => {
    const { file } = workspaceFile();
    const err: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => void err.push(a.join(' ')));
    expect(await run(['index', '--workspace', file])).toBe(1);
    expect(err.join()).toContain('No embedding model is configured');
  });
});

// ---------- search ----------

// A set of graphs, with an index built by the fake embedder. `meaning` maps a query word to the node whose text it stands for.
async function setup(meaning: Record<string, string> = {}) {
  const { file } = workspaceFile({ provider: 'ollama', model: 'fake', endpoint: 'http://127.0.0.1:1' });
  const graphs = graphsOf(file);
  const textOf = (id: string) => graphs.flatMap((g) => embeddingTexts(rankIndexOf(g.index))).find((t) => t.id === id)!.text;
  const embed: Embedder = async (texts) => texts.map((t) => fakeVector(meaning[t] ? textOf(meaning[t]) : t));
  const sources = new Map<string, SemanticSource>();
  for (const g of graphs) {
    const u = await updateVectorIndex(undefined, embeddingTexts(rankIndexOf(g.index)), { model: 'fake' }, embed);
    sources.set(g.id, { model: 'fake', embed, vectors: u.index });
  }
  return { graphs, sources, embed };
}

describe('the hybrid search', () => {
  it('finds a node by meaning that no keyword matches, and keeps an exact id first', async () => {
    const { graphs, sources } = await setup({ zzmeaning: 'pay-voucher' });
    expect(ids(searchGraphs(graphs, 'zzmeaning'))).toEqual([]);
    const hybrid = await searchSemantic(graphs, sources, 'zzmeaning', { mode: 'hybrid' });
    expect(ids(hybrid)[0]).toBe('pay-voucher');
    expect(hybrid.notes).toBeUndefined();
    expect(ids(await searchSemantic(graphs, sources, 'zzmeaning', { mode: 'vector' }))[0]).toBe('pay-voucher');
    expect(ids(await searchSemantic(graphs, sources, 'shop-orbit'))[0]).toBe('shop-orbit');
    expect(ids(await searchSemantic(graphs, sources, 'Voucher payment'))).toContain('pay-voucher');
  });

  it('merges both rankings over all graphs: the first keyword hit stays near the top and the vector hits add nodes', async () => {
    const { graphs, sources } = await setup();
    const keyword = ids(searchGraphs(graphs, 'refund time'));
    const hybrid = ids(await searchSemantic(graphs, sources, 'refund time'));
    expect(keyword.length).toBeGreaterThan(0);
    expect(hybrid.slice(0, 3)).toContain(keyword[0]);
    expect(hybrid.length).toBeGreaterThanOrEqual(keyword.length);
    expect(hybrid.length).toBeLessThanOrEqual(keyword.length + 50);
  });

  it('applies the filters and the limit to the merged list', async () => {
    const { graphs, sources } = await setup({ zzmeaning: 'pay-voucher' });
    const only = await searchSemantic(graphs, sources, 'zzmeaning', { mode: 'vector', graph: 'domain' });
    expect(only.hits.every((h) => h.graph === 'domain')).toBe(true);
    const kinds = await searchSemantic(graphs, sources, 'payment', { kinds: ['shop'] });
    expect(new Set(kinds.hits.map((h) => h.kind))).toEqual(new Set(['shop']));
    const cut = await searchSemantic(graphs, sources, 'payment', { limit: 2 });
    expect(cut.hits).toHaveLength(2);
    expect(cut.omitted).toBe(cut.total - 2);
  });

  it('is the keyword search with mode keyword, and with no index and no mode, with no note', async () => {
    const { graphs, sources } = await setup();
    const keyword = searchGraphs(graphs, 'refund time');
    expect(await searchSemantic(graphs, sources, 'refund time', { mode: 'keyword' })).toEqual(keyword);
    const none = searchSemantic(graphs, undefined, 'refund time');
    expect(none).not.toBeInstanceOf(Promise);
    expect(none).toEqual(keyword);
    const noIndex = new Map([...sources].map(([id, s]) => [id, { ...s, vectors: undefined }]));
    expect(await searchSemantic(graphs, noIndex, 'refund time')).toEqual(keyword);
    const explicit = await searchSemantic(graphs, noIndex, 'refund time', { mode: 'hybrid' });
    expect(ids(explicit)).toEqual(ids(keyword));
    expect(explicit.notes?.join()).toContain('no index');
    expect((await searchSemantic(graphs, undefined, 'refund time', { mode: 'vector' })).notes?.join()).toContain('No embedding model is configured');
  });

  it('falls back to keywords with a note when the model fails', async () => {
    const { graphs, sources } = await setup();
    const failing = new Map([...sources].map(([id, s]) => [id, { ...s, embed: async () => Promise.reject(new Error('connection refused')) }]));
    const keyword = searchGraphs(graphs, 'refund time');
    const result = await searchSemantic(graphs, failing, 'refund time');
    expect(ids(result)).toEqual(ids(keyword));
    expect(result.notes).toHaveLength(2);
    expect(result.notes![0]).toContain('connection refused');
    expect(result.notes![0]).toContain('keywords only');
  });

  it('falls back when the index was built with another model or the query vector has another size', async () => {
    const { graphs, sources } = await setup();
    const other = new Map([...sources].map(([id, s]) => [id, { ...s, model: 'changed' }]));
    const a = await searchSemantic(graphs, other, 'refund time');
    expect(ids(a)).toEqual(ids(searchGraphs(graphs, 'refund time')));
    expect(a.notes?.join()).toContain('other settings');
    const short = new Map([...sources].map(([id, s]) => [id, { ...s, embed: async (t: string[]) => t.map(() => [1, 2, 3]) }]));
    expect((await searchSemantic(graphs, short, 'refund time')).notes?.join()).toContain('query vector has 3 numbers');
    const broken = new Map([...sources].map(([id, s]) => [id, { ...s, vectors: undefined, problem: 'The index file is not valid JSON.' }]));
    expect((await searchSemantic(graphs, broken, 'refund time')).notes?.join()).toContain('not valid JSON');
  });

  it('skips a node whose text changed since the index build and says so', async () => {
    const { graphs, sources } = await setup({ zzmeaning: 'pay-voucher' });
    const s = sources.get('domain')!;
    s.vectors!.nodes['pay-voucher'].hash = 'old';
    const r = await searchSemantic(graphs, sources, 'zzmeaning', { mode: 'vector' });
    expect(ids(r)).not.toContain('pay-voucher');
    expect(r.notes?.join()).toContain('changed since the index was built');
  });
});

// ---------- command line and MCP, end to end against a fake server ----------

describe('the command line and the MCP search', () => {
  it('search with --mode uses the index and the fake server, and falls back when the server is gone', async () => {
    const fake = await fakeServer();
    const { file } = workspaceFile({ provider: 'ollama', model: 'fake', endpoint: fake.url });
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...a) => void err.push(a.join(' ')));
    try {
      // No index yet: the default search is the keyword search with no note.
      expect(await run(['search', '--workspace', file, '--json', 'refund time'])).toBe(0);
      expect(JSON.parse(out.pop()!).notes).toBeUndefined();
      expect(await run(['index', '--workspace', file])).toBe(0);
      expect(await run(['search', '--workspace', file, '--json', '--mode', 'hybrid', 'refund time'])).toBe(0);
      const hybrid = JSON.parse(out.pop()!);
      expect(hybrid.hits.length).toBeGreaterThan(0);
      expect(hybrid.notes).toBeUndefined();
      expect(await run(['search', '--workspace', file, '--mode', 'bogus', 'x'])).toBe(1);
      expect(err.join()).toContain('--mode must be one of');
      // The MCP tool answers with a promise when an index exists.
      const viaMcp = callTool(mcpLoader({ workspace: file }), 'search', { query: 'refund time', mode: 'vector' }) as Promise<{ hits: unknown[] }>;
      expect(viaMcp).toBeInstanceOf(Promise);
      expect((await viaMcp).hits.length).toBeGreaterThan(0);
      expect(() => callTool(mcpLoader({ workspace: file }), 'search', { query: 'x', mode: 'bogus' })).toThrow('"mode" must be one of');
    } finally {
      await fake.close();
    }
    // The server is gone: the search still works on keywords and carries a note.
    expect(await run(['search', '--workspace', file, '--json', 'refund time'])).toBe(0);
    const down = JSON.parse(out.pop()!);
    expect(down.hits.length).toBeGreaterThan(0);
    expect(down.notes[0]).toContain('keywords only');
    const viaMcp = (await callTool(mcpLoader({ workspace: file }), 'search', { query: 'refund time' })) as { notes: string[] };
    expect(viaMcp.notes[0]).toContain('keywords only');
    expect(await run(['search', '--workspace', file, 'refund time'])).toBe(0);
    expect(out.pop()).toContain('note: ');
  });

  it('keeps the search of a workspace without a setting synchronous and unchanged', () => {
    const { file } = workspaceFile();
    const result = callTool(mcpLoader({ workspace: file }), 'search', { query: 'refund time' });
    expect(result).not.toBeInstanceOf(Promise);
    expect((result as { notes?: unknown }).notes).toBeUndefined();
  });
});

// ---------- no model ----------

describe('the rule that Semspec ships no model', () => {
  const manifests = ['package.json', ...readdirSync(join(repo, 'packages')).map((n) => `packages/${n}/package.json`)];
  // Names of model runtimes, model hubs and model files, as a part of a package name.
  const BANNED = /onnx|transformers|llama|ggml|gguf|tensorflow|tfjs|torch|fastembed|sentence-transformers|gpt4all|web-llm|mlc-|huggingface|xenova|openvino|candle|embedding|ollama|openai|bge|e5-|nomic|gemma/i;

  it('has no model and no model runtime in the root dependencies and in the package dependencies', () => {
    for (const m of manifests) {
      const json = JSON.parse(readFileSync(join(repo, m), 'utf8'));
      for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        for (const name of Object.keys(json[section] ?? {})) expect(name, `${m} ${section}`).not.toMatch(BANNED);
      }
    }
  });

  it('has no model and no model runtime anywhere in the package lock', () => {
    const lock = JSON.parse(readFileSync(join(repo, 'package-lock.json'), 'utf8'));
    const names = Object.keys(lock.packages).map((p) => p.split('node_modules/').pop()!).filter(Boolean);
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((n) => BANNED.test(n))).toEqual([]);
  });

  it('puts no model file in the files of the package and in the build output', () => {
    const root = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
    const files = (p: string): string[] => (statSync(p).isDirectory() ? readdirSync(p).flatMap((n) => files(join(p, n))) : [p]);
    const MODEL_FILE = /\.(onnx|gguf|ggml|safetensors|pt|pth|ckpt|tflite|mlmodel|npz|h5)$/i;
    for (const entry of root.files as string[]) {
      const path = join(repo, entry);
      if (!existsSync(path)) continue;
      for (const f of files(path)) {
        expect(f, `a model file in ${entry}`).not.toMatch(MODEL_FILE);
        expect(statSync(f).size, `${f} is larger than a source file`).toBeLessThan(20 * 1024 * 1024);
      }
    }
  });

  it('never downloads a model: no source names a model hub or starts a model download', () => {
    const sources = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? sources(join(dir, n)) : [join(dir, n)]));
    for (const pkg of readdirSync(join(repo, 'packages'))) {
      for (const f of sources(join(repo, 'packages', pkg, 'src')).filter((x) => /\.tsx?$/.test(x))) {
        const text = readFileSync(f, 'utf8');
        expect(text, f).not.toMatch(/huggingface\.co|hf\.co\/|ollama pull|api\/pull/i);
      }
    }
  });

  it('lists the example models with their licences in the guide', () => {
    const guide = readFileSync(join(repo, 'docs/guide/meaning-search.md'), 'utf8');
    for (const [model, licence] of [['EmbeddingGemma', 'Gemma Terms of Use'], ['bge-small-en-v1.5', 'MIT'], ['multilingual-e5-small', 'MIT'], ['nomic-embed-text', 'Apache 2.0']]) {
      expect(guide).toContain(model);
      expect(guide.split('\n').find((l) => l.includes(model) && l.includes(licence)), `${model} with ${licence}`).toBeDefined();
    }
    expect(guide).toContain('accept the licence of the model');
    expect(guide).toContain('Semspec ships no model');
  });
});
