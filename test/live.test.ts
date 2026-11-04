// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the live mode of serve (req-serve-live) and of the Source section on the server side (req-node-source).
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { get, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import type { Model, WorkspaceData } from '@semspec/core';
import { pageFor, run, startServer, startWorkspaceServer, workspacePageFor } from '../packages/cli/src/index';

const made: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'live-'));
  made.push(dir);
  return realpathSync(dir);
};
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

const fixtures = new URL('../fixtures/workspace/', import.meta.url).pathname;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

// A copy of the domain fixture: a graph folder, a YAML profile and a vocabulary file.
function stage() {
  const dir = tmp();
  cpSync(join(fixtures, 'domain'), join(dir, 'domain'), { recursive: true });
  return { dir, graph: join(dir, 'domain/graph'), profile: join(dir, 'domain/profile.yaml'), keep: join(dir, 'domain/graph/article/art-data-keep.yaml') };
}

// A copy of the whole workspace fixture.
function stageWorkspace(edit?: (ws: Record<string, unknown>) => void) {
  const dir = tmp();
  cpSync(fixtures, dir, { recursive: true });
  const path = join(dir, 'workspace.json');
  if (edit) {
    const ws = JSON.parse(readFileSync(path, 'utf8'));
    edit(ws);
    writeFileSync(path, JSON.stringify(ws));
  }
  return { dir, path };
}

// An open page: a client of the event channel. `names` lists the events in the order of their arrival.
// On macOS, fs.watch uses FSEvents, and its stream starts a moment after watch() returns. A write in that
// moment gives no event, and Node has no signal for a started stream. So a test waits this long after the
// page connects, before its first write.
const WATCH_START_MS = 300;

function openEvents(url: string) {
  const names: string[] = [];
  const data: string[] = [];
  let res: IncomingMessage | undefined;
  let buffer = '';
  const connected = new Promise<void>((ok) => {
    get(new URL('/events', url), (r) => {
      res = r;
      r.setEncoding('utf8');
      r.on('data', (chunk: string) => {
        buffer += chunk;
        for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const name = /^event: (.*)$/m.exec(frame)?.[1];
          if (name) {
            names.push(name);
            data.push(/^data: (.*)$/m.exec(frame)?.[1] ?? '');
          }
        }
      });
      ok();
    });
  });
  const until = async (count: number, ms = 5000) => {
    for (let waited = 0; names.length < count && waited < ms; waited += 20) await sleep(20);
    return names.length >= count;
  };
  const ready = connected.then(() => sleep(WATCH_START_MS));
  return { ready, names, data, until, close: () => res?.destroy() };
}

const pageData = (html: string) => JSON.parse(/<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(html)![1]);
const sourceData = (html: string) => {
  const m = /<script type="application\/json" id="source-data">([\s\S]*?)<\/script>/.exec(html);
  return m ? JSON.parse(m[1]) : undefined;
};
const nodeCount = async (url: string) => pageData(await (await fetch(url)).text()).nodes.length;

describe('req-serve-live: watch', () => {
  it('sends 1 event to each open page when a file of the graph folder or the profile changes', async () => {
    const s = stage();
    const server = await startServer(s.graph, s.profile, 0, '127.0.0.1');
    const a = openEvents(server.url);
    const b = openEvents(server.url);
    try {
      await Promise.all([a.ready, b.ready]);
      writeFileSync(s.keep, readFileSync(s.keep, 'utf8').replace('Time of keeping', 'Period of keeping'));
      expect(await a.until(1)).toBe(true);
      expect(await b.until(1)).toBe(true);
      expect(a.names).toEqual(['reload']);
      expect(b.names).toEqual(['reload']);
      // A new file in a sub folder.
      writeFileSync(join(s.graph, 'article', 'art-new.yaml'), stringify({ id: 'art-new', kind: 'article', name: 'New', text: 'A new article.', how: 'reported', source: 'src-authority-bulletin', retrieved: '2026-01-15', agent: 'analyst-a' }));
      expect(await a.until(2)).toBe(true);
      // The profile.
      writeFileSync(s.profile, `${readFileSync(s.profile, 'utf8')}\n# edit\n`);
      expect(await a.until(3)).toBe(true);
      // A vocabulary file of the profile.
      const vocabulary = join(s.dir, 'domain/vocabularies/status.yaml');
      writeFileSync(vocabulary, `${readFileSync(vocabulary, 'utf8')}\n# edit\n`);
      expect(await a.until(4)).toBe(true);
      await sleep(400);
      expect(a.names).toEqual(['reload', 'reload', 'reload', 'reload']);
      expect(b.names.length).toBe(4);
    } finally {
      a.close();
      b.close();
      await server.close();
    }
  });

  it('sends an event when the workspace file, a graph, a profile or a vocabulary of a workspace changes', async () => {
    const w = stageWorkspace();
    const server = await startWorkspaceServer(w.path, 0, '127.0.0.1');
    const page = openEvents(server.url);
    try {
      await page.ready;
      const edits: [string, (text: string) => string][] = [
        [w.path, (t) => t.replace('Shop workspace', 'Shop workspace 2')],
        [join(w.dir, 'domain/graph/article/art-data-keep.yaml'), (t) => t.replace('Time of keeping', 'Period of keeping')],
        [join(w.dir, 'product/graph.json'), (t) => t.replace('"Shop"', '"Our shop"')],
        [join(w.dir, 'domain/profile.yaml'), (t) => `${t}\n# edit\n`],
        [join(w.dir, 'domain/vocabularies/status.yaml'), (t) => `${t}\n# edit\n`],
      ];
      let count = 0;
      for (const [file, edit] of edits) {
        writeFileSync(file, edit(readFileSync(file, 'utf8')));
        expect(await page.until(++count), file).toBe(true);
        await sleep(150);
      }
      expect(page.names).toEqual(Array(edits.length).fill('reload'));
    } finally {
      page.close();
      await server.close();
    }
  });

  it('serves the new data on the request after the event', async () => {
    const s = stage();
    const server = await startServer(s.graph, s.profile, 0, '127.0.0.1');
    const page = openEvents(server.url);
    try {
      await page.ready;
      const before = await nodeCount(server.url);
      writeFileSync(join(s.graph, 'article', 'art-new.yaml'), stringify({ id: 'art-new', kind: 'article', name: 'New', text: 'A new article.', how: 'reported', source: 'src-authority-bulletin', retrieved: '2026-01-15', agent: 'analyst-a' }));
      expect(await page.until(1)).toBe(true);
      expect(await nodeCount(server.url)).toBe(before + 1);
    } finally {
      page.close();
      await server.close();
    }
  });
});

describe('req-serve-live: origin watch', () => {
  it('watches the new origin file of a node after the origin changes to another file outside the graph folder', async () => {
    const s = stageOrigin();
    const next = join(s.dir, 'domain/docs/next.md');
    writeFileSync(next, '# The next file\n');
    const server = await startServer(s.graph, s.profile, 0, '127.0.0.1');
    const page = openEvents(server.url);
    try {
      await page.ready;
      const node = parse(readFileSync(s.keep, 'utf8'));
      node.origin = 'docs/next.md';
      writeFileSync(s.keep, stringify(node));
      expect(await page.until(1)).toBe(true);
      await sleep(300);
      writeFileSync(next, '# The next file, edited\n');
      expect(await page.until(2)).toBe(true);
    } finally {
      page.close();
      await server.close();
    }
  });
});

describe('req-serve-live: burst', () => {
  it('gives 1 reload for several changes within a short time', async () => {
    const s = stage();
    const server = await startServer(s.graph, s.profile, 0, '127.0.0.1');
    const page = openEvents(server.url);
    try {
      await page.ready;
      for (let i = 0; i < 6; i++) writeFileSync(s.keep, `${readFileSync(s.keep, 'utf8')}# edit ${i}\n`);
      writeFileSync(s.profile, `${readFileSync(s.profile, 'utf8')}\n# edit\n`);
      expect(await page.until(1)).toBe(true);
      await sleep(600);
      expect(page.names).toEqual(['reload']);
    } finally {
      page.close();
      await server.close();
    }
  });
});

describe('req-serve-live: error', () => {
  it('keeps the last valid page and sends the error with the file, and the next valid save clears it', async () => {
    const s = stage();
    const server = await startServer(s.graph, s.profile, 0, '127.0.0.1');
    const page = openEvents(server.url);
    try {
      await page.ready;
      const before = await nodeCount(server.url);
      const valid = readFileSync(s.keep, 'utf8');
      writeFileSync(s.keep, 'id: [broken');
      expect(await page.until(1)).toBe(true);
      expect(page.names).toEqual(['invalid']);
      const message = JSON.parse(page.data[0]).message as string;
      expect(message).toContain('art-data-keep.yaml');
      // The page data stays the last valid data.
      const res = await fetch(server.url);
      expect(res.status).toBe(200);
      expect(pageData(await res.text()).nodes.length).toBe(before);
      // A page that opens now gets the error at once.
      const late = openEvents(server.url);
      await late.ready;
      expect(await late.until(1)).toBe(true);
      expect(late.names).toEqual(['invalid']);
      late.close();
      // The next valid save sends a reload, and a page that opens after it gets no error.
      writeFileSync(s.keep, valid);
      expect(await page.until(2)).toBe(true);
      expect(page.names).toEqual(['invalid', 'reload']);
      const after = openEvents(server.url);
      await after.ready;
      await sleep(200);
      expect(after.names).toEqual([]);
      after.close();
    } finally {
      page.close();
      await server.close();
    }
  });

  it('shows the error of a workspace that is not valid and recovers on the next valid save', async () => {
    const w = stageWorkspace();
    const server = await startWorkspaceServer(w.path, 0, '127.0.0.1');
    const page = openEvents(server.url);
    try {
      await page.ready;
      const valid = readFileSync(w.path, 'utf8');
      writeFileSync(w.path, '{"title": ');
      expect(await page.until(1)).toBe(true);
      expect(page.names[0]).toBe('invalid');
      expect(JSON.parse(page.data[0]).message).toContain('workspace.json');
      expect(((await (await fetch(server.url)).text()).match(/id="graph-data"/g) ?? []).length).toBe(1);
      writeFileSync(w.path, valid);
      expect(await page.until(2)).toBe(true);
      expect(page.names.at(-1)).toBe('reload');
    } finally {
      page.close();
      await server.close();
    }
  });
});

describe('req-serve-live: built-page', () => {
  it('writes no live marker into a built page', async () => {
    const s = stage();
    const built = await pageFor(s.graph, s.profile);
    expect(built.html).not.toContain('<meta name="semspec-live"');
    const out = join(s.dir, 'out.html');
    expect(await run(['build', '--graph', s.graph, '--profile', s.profile, '--out', out])).toBe(0);
    expect(readFileSync(out, 'utf8')).not.toContain('<meta name="semspec-live"');
    const withSources = join(s.dir, 'sources.html');
    expect(await run(['build', '--graph', s.graph, '--profile', s.profile, '--out', withSources, '--sources'])).toBe(0);
    expect(readFileSync(withSources, 'utf8')).not.toContain('<meta name="semspec-live"');
    const ws = await workspacePageFor(join(fixtures, 'workspace.json'));
    expect(ws.html).not.toContain('<meta name="semspec-live"');
    expect((await pageFor(s.graph, s.profile, [], { live: true })).html).toContain('<meta name="semspec-live" content="1">');
  });

  it('gives the page that serve sends the live marker', async () => {
    const s = stage();
    const server = await startServer(s.graph, s.profile, 0, '127.0.0.1');
    try {
      expect(await (await fetch(server.url)).text()).toContain('<meta name="semspec-live" content="1">');
    } finally {
      await server.close();
    }
  });
});

// The nodes of the domain fixture that the tests use.
const KEEP = 'art-data-keep';
const PURPOSE = 'art-data-purpose';
const source = (url: string, graph: string, node: string) => fetch(new URL(`/source?${new URLSearchParams({ graph, node })}`, url));

describe('req-node-source: section', () => {
  it('names the file of each node in the page data with a relative path', async () => {
    const s = stage();
    const { html } = await pageFor(s.graph, s.profile);
    const model = pageData(html) as Model;
    expect(model.files![KEEP]).toBe('graph/article/art-data-keep.yaml');
    // A node that the profile embeds in another node has no file of its own.
    const ids = new Set(model.nodes.map((n) => n.id));
    expect(Object.keys(model.files!).every((id) => ids.has(id))).toBe(true);
    expect(Object.keys(model.files!).length).toBeGreaterThan(70);
    expect(html).not.toContain(s.dir);
    const ws = pageData((await workspacePageFor(join(fixtures, 'workspace.json'))).html) as WorkspaceData;
    expect(ws.graphs[1].model.files![KEEP]).toBe('domain/graph/article/art-data-keep.yaml');
    expect(ws.graphs[0].model.files!['prd-shop']).toBe('product/graph.json');
  });

  it('gives the whole text of a file that holds several nodes', async () => {
    const s = stage();
    const a = parse(readFileSync(s.keep, 'utf8'));
    const bFile = join(s.graph, 'article', 'art-data-purpose.yaml');
    const b = parse(readFileSync(bFile, 'utf8'));
    unlinkSync(s.keep);
    unlinkSync(bFile);
    const pair = join(s.graph, 'article', 'pair.yaml');
    writeFileSync(pair, stringify([a, b]));
    const server = await startServer(s.graph, s.profile, 0, '127.0.0.1');
    try {
      const text = readFileSync(pair, 'utf8');
      for (const node of [KEEP, PURPOSE]) {
        const res = await source(server.url, 'main', node);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(text);
      }
      expect(pageData(await (await fetch(server.url)).text()).files[PURPOSE]).toBe('graph/article/pair.yaml');
    } finally {
      await server.close();
    }
  });
});

// A profile with the key source.origin and a node that names a file.
function stageOrigin() {
  const s = stage();
  const profile = parse(readFileSync(s.profile, 'utf8'));
  profile.source.origin = 'origin';
  writeFileSync(s.profile, stringify(profile));
  mkdirSync(join(s.dir, 'domain/docs'));
  writeFileSync(join(s.dir, 'domain/docs/draft.md'), '# The draft\n\nThe text of the draft.\n');
  const node = parse(readFileSync(s.keep, 'utf8'));
  node.origin = 'docs/draft.md';
  writeFileSync(s.keep, stringify(node));
  return s;
}

describe('req-node-source: origin', () => {
  it('shows the origin file of a node, relative to the profile, when the field has a value', async () => {
    const s = stageOrigin();
    const { html } = await pageFor(s.graph, s.profile);
    const model = pageData(html) as Model;
    expect(model.files![KEEP]).toBe('docs/draft.md');
    // A node with no value in the field keeps its own file.
    expect(model.files![PURPOSE]).toBe('graph/article/art-data-purpose.yaml');
    const server = await startServer(s.graph, s.profile, 0, '127.0.0.1');
    try {
      const res = await source(server.url, 'main', KEEP);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('# The draft\n\nThe text of the draft.\n');
    } finally {
      await server.close();
    }
  });

  it('reads the origin path relative to the workspace file in a workspace', async () => {
    const w = stageWorkspace();
    const profilePath = join(w.dir, 'domain/profile.yaml');
    const profile = parse(readFileSync(profilePath, 'utf8'));
    profile.source.origin = 'origin';
    writeFileSync(profilePath, stringify(profile));
    mkdirSync(join(w.dir, 'docs'));
    writeFileSync(join(w.dir, 'docs/draft.md'), 'The workspace draft.\n');
    const keep = join(w.dir, 'domain/graph/article/art-data-keep.yaml');
    writeFileSync(keep, `${readFileSync(keep, 'utf8')}origin: docs/draft.md\n`);
    const server = await startWorkspaceServer(w.path, 0, '127.0.0.1');
    try {
      const res = await source(server.url, 'domain', KEEP);
      expect(await res.text()).toBe('The workspace draft.\n');
      expect((pageData(await (await fetch(server.url)).text()) as WorkspaceData).graphs[1].model.files![KEEP]).toBe('docs/draft.md');
    } finally {
      await server.close();
    }
  });

  it('refuses a profile where source.origin is not a text', async () => {
    const s = stage();
    const profile = parse(readFileSync(s.profile, 'utf8'));
    profile.source.origin = 5;
    writeFileSync(s.profile, stringify(profile));
    await expect(pageFor(s.graph, s.profile)).rejects.toThrow(/origin/);
  });
});

describe('req-node-source: root', () => {
  it('returns no text for an origin path that leaves the source root, a link out of the root or an unknown node', async () => {
    const outside = tmp();
    writeFileSync(join(outside, 'secret.txt'), 'SECRET');
    const s = stageOrigin();
    // The origin of KEEP leaves the root with "..".
    const keep = parse(readFileSync(s.keep, 'utf8'));
    keep.origin = `../../${outside.split('/').pop()}/secret.txt`;
    writeFileSync(s.keep, stringify(keep));
    // The origin of PURPOSE is a link inside the root that leads out of it.
    symlinkSync(join(outside, 'secret.txt'), join(s.dir, 'domain/docs/link.md'));
    const purposeFile = join(s.graph, 'article', 'art-data-purpose.yaml');
    const purpose = parse(readFileSync(purposeFile, 'utf8'));
    purpose.origin = 'docs/link.md';
    writeFileSync(purposeFile, stringify(purpose));
    // An absolute origin path.
    const delivery = join(s.graph, 'article', 'art-delivery-date.yaml');
    const node = parse(readFileSync(delivery, 'utf8'));
    node.origin = join(outside, 'secret.txt');
    writeFileSync(delivery, stringify(node));
    const server = await startServer(s.graph, s.profile, 0, '127.0.0.1');
    try {
      for (const id of [KEEP, PURPOSE, 'art-delivery-date']) {
        const res = await source(server.url, 'main', id);
        expect(res.status, id).toBe(404);
        expect(await res.text()).not.toContain('SECRET');
      }
      expect((await source(server.url, 'main', 'no-such-node')).status).toBe(404);
      expect((await source(server.url, 'other', KEEP)).status).toBe(404);
      // The endpoint takes no path. A path in the query changes nothing.
      const res = await fetch(new URL(`/source?${new URLSearchParams({ graph: 'main', node: KEEP, path: join(outside, 'secret.txt'), file: '/etc/passwd' })}`, server.url));
      expect(res.status).toBe(404);
      expect((await fetch(new URL('/source', server.url))).status).toBe(404);
      expect((await fetch(new URL(`/source?node=${encodeURIComponent('../../etc/passwd')}&graph=main`, server.url))).status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('uses the key sourceRoot of the workspace, and the folder of the workspace file when the key is missing', async () => {
    const w = stageWorkspace((ws) => (ws.sourceRoot = 'domain'));
    // The product graph file lies outside the root "domain". Its nodes get no text.
    const server = await startWorkspaceServer(w.path, 0, '127.0.0.1');
    try {
      expect((await source(server.url, 'req', 'prd-shop')).status).toBe(404);
      const inside = await source(server.url, 'domain', KEEP);
      expect(inside.status).toBe(200);
      expect(await inside.text()).toBe(readFileSync(join(w.dir, 'domain/graph/article/art-data-keep.yaml'), 'utf8'));
    } finally {
      await server.close();
    }
    // Without the key, the root is the folder of the workspace file and both graphs give text.
    const open = stageWorkspace();
    const second = await startWorkspaceServer(open.path, 0, '127.0.0.1');
    try {
      expect((await source(second.url, 'req', 'prd-shop')).status).toBe(200);
      expect((await source(second.url, 'domain', KEEP)).status).toBe(200);
    } finally {
      await second.close();
    }
  });

  it('refuses a sourceRoot that is not a text', async () => {
    const w = stageWorkspace((ws) => (ws.sourceRoot = 5));
    await expect(workspacePageFor(w.path)).rejects.toThrow(/sourceRoot/);
  });

  it('gives no text of a link that leads to a folder or to a missing file', async () => {
    const s = stageOrigin();
    const keep = parse(readFileSync(s.keep, 'utf8'));
    keep.origin = 'docs';
    writeFileSync(s.keep, stringify(keep));
    const purposeFile = join(s.graph, 'article', 'art-data-purpose.yaml');
    const purpose = parse(readFileSync(purposeFile, 'utf8'));
    purpose.origin = 'docs/missing.md';
    writeFileSync(purposeFile, stringify(purpose));
    const server = await startServer(s.graph, s.profile, 0, '127.0.0.1');
    try {
      expect((await source(server.url, 'main', KEEP)).status).toBe(404);
      expect((await source(server.url, 'main', PURPOSE)).status).toBe(404);
    } finally {
      await server.close();
    }
    expect(existsSync(join(s.dir, 'domain/docs'))).toBe(true);
  });
});

describe('req-node-source: on-demand', () => {
  it('keeps the texts out of the page data of serve and out of a built page without --sources', async () => {
    const s = stageOrigin();
    const served = (await pageFor(s.graph, s.profile, [], { live: true })).html;
    expect(served).not.toContain('The text of the draft');
    expect(served).not.toContain('id="source-data"');
    const built = (await pageFor(s.graph, s.profile)).html;
    expect(built).not.toContain('The text of the draft');
    expect(built).not.toContain('id="source-data"');
  });

  it('puts the texts into a built page with --sources, by relative path', async () => {
    const s = stageOrigin();
    const out = join(s.dir, 'out.html');
    expect(await run(['build', '--graph', s.graph, '--profile', s.profile, '--out', out, '--sources'])).toBe(0);
    const html = readFileSync(out, 'utf8');
    const texts = sourceData(html);
    expect(texts.main['docs/draft.md']).toBe('# The draft\n\nThe text of the draft.\n');
    expect(texts.main['graph/article/art-data-purpose.yaml']).toBe(readFileSync(join(s.graph, 'article/art-data-purpose.yaml'), 'utf8'));
    // No absolute path of the machine in the page.
    expect(html).not.toContain(s.dir);
    // A workspace page holds the texts by graph id.
    const w = stageWorkspace();
    const wsOut = join(w.dir, 'out.html');
    expect(await run(['build', '--workspace', w.path, '--out', wsOut, '--sources'])).toBe(0);
    const wsHtml = readFileSync(wsOut, 'utf8');
    expect(Object.keys(sourceData(wsHtml))).toEqual(['req', 'domain']);
    expect(sourceData(wsHtml).domain['domain/graph/article/art-data-keep.yaml']).toContain('Time of keeping');
    expect(wsHtml).not.toContain(w.dir);
  });

  it('leaves out of --sources a file outside the source root', async () => {
    const s = stageOrigin();
    const outside = tmp();
    writeFileSync(join(outside, 'secret.txt'), 'SECRET');
    const keep = parse(readFileSync(s.keep, 'utf8'));
    keep.origin = join(outside, 'secret.txt');
    writeFileSync(s.keep, stringify(keep));
    const out = join(s.dir, 'out.html');
    expect(await run(['build', '--graph', s.graph, '--profile', s.profile, '--out', out, '--sources'])).toBe(0);
    expect(readFileSync(out, 'utf8')).not.toContain('SECRET');
  });
});
