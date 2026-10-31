// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Integration tests of `semspec mcp`: the command starts as a child process and an SDK client talks to it over stdio.
// The tests need the built cli (`npm run build`).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('..', import.meta.url));
const bin = join(repo, 'bin', 'semspec.js');
const workspace = join(repo, 'fixtures', 'workspace', 'workspace.json');
const made: string[] = [];
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

async function connect(args: string[]): Promise<Client> {
  expect(existsSync(join(repo, 'packages', 'cli', 'dist', 'index.js')), 'run npm run build first').toBe(true);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [bin, 'mcp', ...args], stderr: 'pipe' }));
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
  expect(r.content[0].type).toBe('text');
  return { error: !!r.isError, text: r.content[0].text, json: r.isError ? undefined : JSON.parse(r.content[0].text) };
}

describe('semspec mcp --workspace', () => {
  it('lists the tools and the resources, and answers each tool', { timeout: 60000 }, async () => {
    const client = await connect(['--workspace', workspace]);
    try {
      expect(client.getServerVersion()?.name).toBe('semspec');
      expect(client.getInstructions()).toContain('schema');
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toEqual(['schema', 'search', 'get', 'trace', 'walk', 'impact', 'gaps', 'validate']);
      for (const t of tools.tools) expect(t.inputSchema.type).toBe('object');

      const resources = await client.listResources();
      expect(resources.resources.map((r) => r.uri)).toEqual(['semspec://req/profile', 'semspec://req/vocabularies', 'semspec://domain/profile', 'semspec://domain/vocabularies']);

      const schema = await call(client, 'schema', { graph: 'domain' });
      expect(schema.json.graph).toBe('domain');
      expect(schema.json.kinds.map((k: any) => k.id)).toContain('shop');
      expect(schema.json.vocabularies.map((v: any) => v.id)).toContain('segment');
      expect(schema.json.crossLinks).toEqual([{ field: 'area', graph: 'req', label: 'Area in the requirements' }]);
      expect((await call(client, 'schema', { kind: 'story' })).json.schema.title).toBe('Story');

      const found = await call(client, 'search', { query: 'prepaid code' });
      expect(found.json.hits[0]).toMatchObject({ graph: 'domain', id: 'pay-voucher', kind: 'method' });
      expect(found.json.hits[0].snippet).toContain('**prepaid**');
      expect(found.text).not.toContain('\n');
      const limited = await call(client, 'search', { query: 'buyer', graph: 'req', kinds: ['story'], limit: 2 });
      expect(limited.json.hits.length).toBe(2);
      expect(limited.json.hits.every((h: any) => h.graph === 'req' && h.kind === 'story')).toBe(true);
      expect(limited.json.truncated.hits).toBe(limited.json.total - 2);
      expect((await call(client, 'search', { query: 'zzqqxx' })).json).toMatchObject({ total: 0, hits: [] });

      const get = await call(client, 'get', { id: 'story-pay-by-card' });
      expect(get.json).toMatchObject({ graph: 'req', kind: 'story', title: 'Pay by card', status: { value: 'partial' } });
      expect(get.json.crossLinks.length).toBe(4);
      expect(get.text).not.toContain('\n');

      const up = await call(client, 'trace', { id: 'story-pay-by-card', direction: 'up' });
      expect(up.json.paths).toEqual([['story-pay-by-card', 'epic-checkout', 'prd-shop']]);
      const down = await call(client, 'trace', { id: 'epic-checkout', direction: 'down', depth: 1 });
      expect(down.json.tree.children.map((c: any) => c.id)).toEqual(['story-pay-by-card', 'story-save-card']);

      const walked = await call(client, 'walk', { id: 'story-pay-by-card', depth: 2, edges: ['concerns', 'offers'] });
      expect(walked.json.steps[0].groups[0]).toMatchObject({ edge: 'concerns', direction: 'out', cross: true });
      expect(walked.json.paths).toContain('story-pay-by-card =concerns=> domain:pay-card <-offers- domain:shop-brightcart');
      expect(walked.text).not.toContain('\n');
      const near = await call(client, 'walk', { id: 'story-pay-by-card', direction: 'in', kinds: ['scenario'], crossLinks: false, limit: 1 });
      expect(near.json.steps[0].groups[0]).toMatchObject({ edge: 'scenario', direction: 'in', label: 'Has scenario' });
      expect(near.json.truncated.nodes).toBe(1);

      const impact = await call(client, 'impact', { id: 'pay-card', graph: 'domain' });
      expect(impact.json.groups.map((g: any) => `${g.graph}:${g.kind}`)).toContain('req:story');

      const gaps = await call(client, 'gaps', { graph: 'req' });
      expect(gaps.json.counts).toMatchObject({ status: 2, uncheckedParts: 1, unplaced: 2 });
      expect((await call(client, 'gaps', { graph: 'req', scope: 'story-pay-by-card' })).json.scope).toBe('story-pay-by-card');

      const good = await call(client, 'validate', { node: 'id: story-new\nkind: story\nepics: [epic-checkout]\npriority: low\n' });
      expect(good.json).toEqual({ graph: 'req', valid: true, errors: [], warnings: [] });
      const bad = await call(client, 'validate', { node: JSON.stringify({ id: 'story-new', kind: 'story', epics: 'epic-checkout', result: 'maybe' }) });
      expect(bad.json.valid).toBe(false);
      expect(bad.json.errors.join()).toContain('epics');

      const profile = await client.readResource({ uri: 'semspec://domain/profile' });
      expect(JSON.parse((profile.contents[0] as { text: string }).text).project).toBe('Online retail market');
      const vocabularies = await client.readResource({ uri: 'semspec://domain/vocabularies' });
      const vocab = JSON.parse((vocabularies.contents[0] as { text: string }).text);
      expect(vocab.segment.concepts[0]).toMatchObject({ code: 'retail', label: 'Retail' });
      expect(Object.keys(vocab)).toContain('status');
    } finally {
      await client.close();
    }
  });

  it('returns an error that names an unknown id, graph, tool or resource', { timeout: 60000 }, async () => {
    const client = await connect(['--workspace', workspace]);
    try {
      for (const tool of ['get', 'trace', 'impact']) {
        const r = await call(client, tool, { id: 'nope', direction: 'up' });
        expect(r.error).toBe(true);
        expect(r.text).toContain('"nope"');
      }
      expect((await call(client, 'walk', { id: 'nope' })).text).toContain('"nope"');
      expect((await call(client, 'walk', { id: 'story-pay-by-card', depth: 4 })).error).toBe(true);
      expect((await call(client, 'walk', { id: 'story-pay-by-card', direction: 'up' })).text).toContain('"direction"');
      expect((await call(client, 'gaps', { scope: 'nope' })).text).toContain('"nope"');
      expect((await call(client, 'get', { id: 'x', graph: 'zzz' })).text).toContain('Unknown graph "zzz"');
      expect((await call(client, 'get', {})).text).toContain('"id" is required');
      expect((await call(client, 'search', {})).text).toContain('"query" is required');
      expect((await call(client, 'search', { query: 'shop', kinds: ['nope'] })).text).toContain('Unknown kind "nope"');
      expect((await call(client, 'search', { query: 'shop', kinds: 'shop' })).error).toBe(true);
      expect((await call(client, 'validate', { node: '[1, 2]' })).error).toBe(true);
      expect((await call(client, 'get', { id: 'x', limit: 0 })).error).toBe(true);
      await expect(client.readResource({ uri: 'semspec://req/other' })).rejects.toThrow();
    } finally {
      await client.close();
    }
  });

  it('reads the inputs again on each call', { timeout: 60000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'semspec-mcp-'));
    made.push(dir);
    cpSync(join(repo, 'fixtures', 'workspace'), dir, { recursive: true });
    const client = await connect(['--workspace', join(dir, 'workspace.json')]);
    try {
      expect((await call(client, 'get', { id: 'prd-shop' })).json.title).toBe('Shop');
      const file = join(dir, 'product', 'graph.json');
      const graph = JSON.parse(readFileSync(file, 'utf8'));
      graph.nodes.find((n: any) => n.id === 'prd-shop').name = 'Shop two';
      writeFileSync(file, JSON.stringify(graph));
      expect((await call(client, 'get', { id: 'prd-shop' })).json.title).toBe('Shop two');
      writeFileSync(file, '{ broken');
      const r = await call(client, 'get', { id: 'prd-shop' });
      expect(r.error).toBe(true);
      expect(r.text).toContain('Cannot read the graph');
    } finally {
      await client.close();
    }
  });
});

describe('semspec mcp --graph', () => {
  it('serves 1 graph with the id "graph"', { timeout: 60000 }, async () => {
    const client = await connect(['--graph', join(repo, 'requirements', 'graph'), '--profile', join(repo, 'requirements', 'profile.yaml')]);
    try {
      expect((await client.listResources()).resources.map((r) => r.uri)).toEqual(['semspec://graph/profile', 'semspec://graph/vocabularies']);
      const g = await call(client, 'get', { id: 'req-mcp-serve' });
      expect(g.json).toMatchObject({ graph: 'graph', kind: 'requirement' });
      expect(g.json.fields.area).toEqual(['cli']);
    } finally {
      await client.close();
    }
  });
});

describe('semspec mcp with a wrong input', () => {
  const run = (args: string[]) => spawnSync(process.execPath, [bin, 'mcp', ...args], { encoding: 'utf8', timeout: 30000 });

  it('exits with a message on stderr and writes nothing to stdout', () => {
    const r = run(['--workspace', join(repo, 'fixtures', 'workspace', 'missing.json')]);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('Cannot read the workspace');
  });
  it('lists mcp in the help text', () => {
    const r = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8', timeout: 30000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('semspec mcp --graph <file> --profile <file>');
    expect(r.stdout).toContain('semspec mcp --workspace <file>');
  });
  it('refuses a missing option and a mix of options', () => {
    const none = run([]);
    expect(none.status).toBe(1);
    expect(none.stdout).toBe('');
    expect(none.stderr).toContain('--graph and --profile are required');
    const mix = run(['--workspace', workspace, '--graph', 'x']);
    expect(mix.status).toBe(1);
    expect(mix.stderr).toContain('cannot combine');
  });
});
