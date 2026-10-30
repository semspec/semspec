// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildIndex, buildModel } from '../../src/core/index';
import type { ProfileInput } from '../../src/core/index';
import { BRANCH, buildDocsIndex, docSources, docsPaths, editUrl, graphPath, groupPages, htmlToText, neighbours, pagePath, relatedPages, rewriteLink, slugger, slugify } from '../src/lib/docs';
import type { DocsIndex, LinkContext, RenderedBody } from '../src/lib/docs';
import { loadDocs } from '../src/lib/docs-load';
import { renderBody } from '../src/lib/docs-markdown';

// 2 sets of names show that the module reads the kind names and the field names from the profile.
interface Names {
  kinds: [string, string, string];
  plurals: [string, string, string];
  related: string;
  documents: string;
  order: string;
  body: string;
}
const WIKI: Names = { kinds: ['guide', 'concept', 'reference'], plurals: ['guides', 'concepts', 'references'], related: 'related', documents: 'documents', order: 'order', body: 'body' };
const MANUAL: Names = { kinds: ['tutorial', 'topic', 'lookup'], plurals: ['tutorials', 'topics', 'lookups'], related: 'seeAlso', documents: 'covers', order: 'position', body: 'text' };

function docsProfile(n: Names): ProfileInput {
  return {
    project: 'Test docs',
    source: { nodes: 'nodes', id: 'id', kind: 'kind', markdown: { body: n.body } },
    fields: { title: ['title'], statement: ['description'] },
    lifecycle: { field: 'state', fallback: 'current' },
    kinds: n.kinds.map((id, i) => ({ id, label: id, plural: n.plurals[i], role: 'hierarchy', color: { light: '#111111', dark: '#eeeeee' } })),
    edges: { [n.related]: { labels: ['Related to', 'Related from'] } },
    links: [n.related],
    crossLinks: [{ field: n.documents, graph: 'req', label: 'Documents' }],
  } as unknown as ProfileInput;
}

function docsGraph(n: Names) {
  const page = (id: string, kind: number, order: number | undefined, related: string[], documents: string[] = []) => ({
    id, kind: n.kinds[kind], title: id.toUpperCase(), description: `About ${id}.`, ...(order === undefined ? {} : { [n.order]: order }), [n.related]: related, [n.documents]: documents, [n.body]: `Body of ${id}.`,
  });
  return {
    nodes: [
      page('ref-b', 2, 2, ['guide-a']),
      page('guide-b', 0, 2, ['guide-a', 'missing-page']),
      page('concept-a', 1, 1, ['guide-b']),
      page('guide-a', 0, 1, ['concept-a'], ['req-1', 'req-2', 'req-3']),
      page('ref-a', 2, 1, []),
      // A page with no order sorts last in its kind, by title.
      page('guide-z', 0, undefined, []),
      page('guide-y', 0, undefined, []),
    ],
  };
}

function requirementsProfile(): ProfileInput {
  return {
    project: 'Test requirements',
    source: { nodes: 'nodes', id: 'id', kind: 'kind' },
    fields: { title: ['title'], statement: ['statement'] },
    lifecycle: { field: 'state', fallback: 'active' },
    kinds: [
      { id: 'requirement', label: 'Requirement', plural: 'requirements', role: 'hierarchy', color: { light: '#111111', dark: '#eeeeee' } },
      { id: 'condition', label: 'Condition', plural: 'conditions', role: 'part', color: { light: '#222222', dark: '#dddddd' } },
    ],
    edges: { condition: { labels: ['Condition of', 'Has condition'], down: true } },
    parts: [{ kind: 'condition', owner: 'requirement', field: 'acceptance', id: 'id', text: 'text', edge: 'condition' }],
    status: {
      label: 'Status',
      field: 'status',
      values: [
        { value: 'verified', label: 'Verified', tone: 'good' },
        { value: 'partial', label: 'Partial', tone: 'warn' },
        { value: 'open', label: 'Open', tone: 'bad' },
      ],
    },
  } as unknown as ProfileInput;
}

const requirementsGraph = {
  nodes: [
    { id: 'req-1', kind: 'requirement', title: 'First', acceptance: [{ id: 'a', text: 'A', status: 'verified' }, { id: 'b', text: 'B', status: 'verified' }] },
    { id: 'req-2', kind: 'requirement', title: 'Second', acceptance: [{ id: 'a', text: 'A', status: 'verified' }, { id: 'b', text: 'B', status: 'open' }] },
    { id: 'req-3', kind: 'requirement', title: 'Third', acceptance: [{ id: 'a', text: 'A', status: 'open' }] },
    { id: 'req-4', kind: 'requirement', title: 'Fourth' },
  ],
};

const requirements = buildIndex(buildModel(requirementsGraph, requirementsProfile()));

// The index of a small docs graph. `links` names the pages that each body links to.
function indexOf(n: Names, links: Record<string, string[]> = {}): DocsIndex {
  const docs = buildIndex(buildModel(docsGraph(n), docsProfile(n)));
  const options = { relatedEdge: n.related, documentsField: n.documents, orderField: n.order, bodyField: n.body };
  const sources = docSources(docs, requirements, options);
  const rendered = new Map<string, RenderedBody>(sources.map((s) => [s.id, { headings: [], links: links[s.id] ?? [] }]));
  return buildDocsIndex(docs, sources, rendered);
}

describe.each([['wiki', WIKI], ['manual', MANUAL]] as const)('docs index of the %s profile', (_name, n) => {
  const index = indexOf(n, { 'ref-a': ['guide-b'], 'ref-b': ['ref-b'] });

  it('sorts the pages by kind in the order of the profile, then by order, then by title', () => {
    expect(index.pages.map((p) => p.id)).toEqual(['guide-a', 'guide-b', 'guide-y', 'guide-z', 'concept-a', 'ref-a', 'ref-b']);
  });

  it('groups the pages by kind and uses the plural label of the kind as the heading', () => {
    const groups = groupPages(index);
    expect(groups.map((g) => g.kind.id)).toEqual([...n.kinds]);
    expect(groups.map((g) => g.kind.heading)).toEqual(n.plurals.map((p) => p[0].toUpperCase() + p.slice(1)));
    expect(groups[0].pages).toHaveLength(4);
  });

  it('keeps the fields of a page and the path of its file', () => {
    const page = index.pages.find((p) => p.id === 'guide-b')!;
    expect(page).toMatchObject({ title: 'GUIDE-B', description: 'About guide-b.', order: 2, file: `docs/${n.kinds[0]}/guide-b.md` });
    // An id that is no page is left out.
    expect(page.related).toEqual(['guide-a']);
    expect(index.pages.find((p) => p.id === 'guide-z')!.order).toBeNull();
  });

  it('lists the documented nodes with the status roll-up of the requirements graph', () => {
    const page = index.pages.find((p) => p.id === 'guide-a')!;
    expect(page.documents.map((d) => [d.id, d.kind, d.title, d.status?.value])).toEqual([
      ['req-1', 'requirement', 'First', 'verified'],
      ['req-2', 'requirement', 'Second', 'partial'],
      ['req-3', 'requirement', 'Third', 'open'],
    ]);
    expect(page.documents[1].status).toEqual({ value: 'partial', label: 'Partial', tone: 'warn' });
  });

  it('gives a documented node with no status a null status', () => {
    const docs = buildIndex(buildModel({ nodes: [{ id: 'p', kind: n.kinds[0], title: 'P', [n.documents]: ['req-4'] }] }, docsProfile(n)));
    const [source] = docSources(docs, requirements, { documentsField: n.documents, relatedEdge: n.related, orderField: n.order, bodyField: n.body });
    expect(source.documents[0].status).toBeNull();
  });

  it('throws on an unknown documented node', () => {
    const docs = buildIndex(buildModel({ nodes: [{ id: 'p', kind: n.kinds[0], title: 'P', [n.documents]: ['nope'] }] }, docsProfile(n)));
    expect(() => docSources(docs, requirements, { documentsField: n.documents })).toThrow(/"p" documents "nope"/);
  });

  it('finds the related pages once each: the pages that the page names, then the pages that name it or link to it', () => {
    // guide-a names concept-a. concept-a and guide-b name guide-a. ref-b names guide-a. ref-a links to guide-b.
    expect(relatedPages(index, 'guide-a').map((p) => p.id)).toEqual(['concept-a', 'guide-b', 'ref-b']);
    expect(relatedPages(index, 'guide-b').map((p) => p.id)).toEqual(['guide-a', 'concept-a', 'ref-a']);
  });

  it('leaves out the page itself, also when it links to itself', () => {
    expect(relatedPages(index, 'ref-b').map((p) => p.id)).toEqual(['guide-a']);
    expect(relatedPages(index, 'unknown')).toEqual([]);
  });

  it('gives the previous and the next page in the order of the sidebar, across groups', () => {
    expect(neighbours(index, 'guide-a')).toMatchObject({ prev: null, next: { id: 'guide-b' } });
    expect(neighbours(index, 'guide-z')).toMatchObject({ prev: { id: 'guide-y' }, next: { id: 'concept-a' } });
    expect(neighbours(index, 'ref-b')).toMatchObject({ prev: { id: 'ref-a' }, next: null });
    expect(neighbours(index, 'unknown')).toEqual({ prev: null, next: null });
  });

  it('lists the routes: the index, the docs graph and 1 for each page', () => {
    expect(docsPaths(index)).toEqual(['/docs/', '/docs/graph/', ...index.pages.map((p) => `/docs/${p.id}/`)]);
  });

  it('builds the edit link from the file of the page', () => {
    expect(editUrl(index.pages[0])).toBe(`https://github.com/semspec/semspec/edit/${BRANCH}/docs/${n.kinds[0]}/guide-a.md`);
  });
});

describe('docs graph route', () => {
  it('moves to a fallback when a page has the id graph', () => {
    const docs = buildIndex(buildModel({ nodes: [{ id: 'graph', kind: 'guide', title: 'The graph' }] }, docsProfile(WIKI)));
    const index = buildDocsIndex(docs, docSources(docs, requirements), new Map());
    expect(graphPath(index)).toBe('/docs/docs-graph/');
    expect(pagePath('graph')).toBe('/docs/graph/');
  });
});

describe('slugs and text', () => {
  it('makes a slug of lower case letters and digits', () => {
    expect(slugify('Install the CLI')).toBe('install-the-cli');
    expect(slugify('  `semspec build`: flags & options ')).toBe('semspec-build-flags-options');
    expect(slugify('Café 2')).toBe('cafe-2');
    expect(slugify('???')).toBe('section');
  });

  it('numbers a repeated slug', () => {
    const slug = slugger();
    expect([slug('Options'), slug('Options'), slug('options'), slug('Other')]).toEqual(['options', 'options-2', 'options-3', 'other']);
  });

  it('turns HTML into plain text', () => {
    expect(htmlToText('Use <code>a &lt; b</code> &amp; <em>c</em> &#39;d&#39; &#x41;')).toBe("Use a < b & c 'd' A");
  });
});

describe('link rewrite', () => {
  const files = new Map([['docs/concept/graph.md', 'graph'], ['docs/guide/workspace.md', 'workspace']]);
  const from: LinkContext = { id: 'graph', file: 'docs/concept/graph.md', files };

  it('rewrites a relative link to a page and keeps the fragment', () => {
    expect(rewriteLink('../guide/workspace.md', from)).toEqual({ href: '/docs/workspace/', page: 'workspace' });
    expect(rewriteLink('../guide/workspace.md#setup', from)).toEqual({ href: '/docs/workspace/#setup', page: 'workspace' });
    expect(rewriteLink('./graph.md', from)).toEqual({ href: '/docs/graph/', page: 'graph' });
  });

  it('rewrites a relative link to another file of the repository to a link to GitHub', () => {
    expect(rewriteLink('../../schema/graph.schema.json', from)).toEqual({ href: 'https://github.com/semspec/semspec/blob/master/schema/graph.schema.json' });
    expect(rewriteLink('../../src/core/#model', from).href).toBe('https://github.com/semspec/semspec/blob/master/src/core#model');
  });

  it('keeps an absolute link, a link to a fragment and a link with a root path', () => {
    for (const href of ['https://example.com/a.md', 'mailto:a@example.com', '//example.com/x', '#section', '/demo/docs.html']) expect(rewriteLink(href, from)).toEqual({ href });
  });

  it('throws on a link to a Markdown file that is not a page, and names the page and the link', () => {
    expect(() => rewriteLink('../guide/nope.md', from)).toThrow('The page "graph" links to "../guide/nope.md", which is not a page of the docs');
    expect(() => rewriteLink('../../README.md', from)).toThrow(/"\.\.\/\.\.\/README\.md"/);
  });

  it('throws on a link that leaves the repository', () => {
    expect(() => rewriteLink('../../../x.json', from)).toThrow(/leaves the repository/);
  });
});

describe('render of a body', () => {
  const files = new Map([['docs/guide/a.md', 'a'], ['docs/guide/b.md', 'b']]);
  const context: LinkContext = { id: 'a', file: 'docs/guide/a.md', files };

  it('gives each H2 and H3 an id and an anchor, and lists them', async () => {
    const page = await renderBody('Intro.\n\n## Install\n\n### With `npm`\n\n## Install\n\n#### Deep\n', context);
    expect(page.headings).toEqual([
      { depth: 2, id: 'install', text: 'Install' },
      { depth: 3, id: 'with-npm', text: 'With npm' },
      { depth: 2, id: 'install-2', text: 'Install' },
    ]);
    expect(page.html).toContain('<h2 id="install">Install<a class="doc-anchor" href="#install" aria-label="Link to Install">#</a></h2>');
    expect(page.html).toContain('<h3 id="with-npm">With <code>npm</code><a class="doc-anchor"');
    expect(page.html).toContain('<h4>Deep</h4>');
  });

  it('rewrites the links and lists the pages that the body links to, once each', async () => {
    const page = await renderBody('See [B](b.md#x), [again](./b.md), [file](../../schema/a.json) and [site](https://example.com).', context);
    expect(page.links).toEqual(['b']);
    expect(page.html).toContain('href="/docs/b/#x"');
    expect(page.html).toContain('href="https://github.com/semspec/semspec/blob/master/schema/a.json"');
    expect(page.html).toContain('href="https://example.com"');
  });

  it('fails on a link to a Markdown file that is not a page', async () => {
    await expect(renderBody('[x](missing.md)', context)).rejects.toThrow('The page "a" links to "missing.md"');
  });

  it('highlights code with 2 themes, also for a language that Shiki does not know', async () => {
    const page = await renderBody('```yaml\nkey: value\n```\n\n```nonsense\nplain\n```\n\n```\nbare\n```\n', context);
    expect(page.html).toContain('<figure class="doc-code"><figcaption>yaml</figcaption><div class="code"><pre class="shiki');
    expect(page.html).toContain('--shiki-light');
    expect(page.html).toContain('--shiki-dark');
    expect(page.html).toContain('<figcaption>nonsense</figcaption>');
    expect(page.html).toContain('<figure class="doc-code"><div class="code">');
  });

  it('wraps a table in a box that scrolls', async () => {
    const page = await renderBody('| A | B |\n| - | - |\n| 1 | 2 |\n', context);
    expect(page.html).toMatch(/^<div class="doc-table"><table>/);
  });
});

describe('docs folder of the repository', async () => {
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const data = await loadDocs(repo);
  const files = (dir: string): string[] => readdirSync(join(repo, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(`${dir}/${e.name}`) : e.name.endsWith('.md') ? [`${dir}/${e.name}`] : []));

  it('renders every Markdown file as a page with a body', () => {
    const pages = data.index.pages;
    expect(pages.map((p) => p.file).sort()).toEqual(files('docs').sort());
    for (const p of pages) {
      expect(data.bodies[p.id], p.id).toBeTruthy();
      expect(p.title, p.id).toBeTruthy();
      expect(p.description, p.id).toBeTruthy();
    }
  });

  it('resolves every link: to a page, to a heading of a page or to a file of the repository', async () => {
    const files = new Map(data.index.pages.map((p) => [p.file, p.id]));
    for (const p of data.index.pages) {
      const html = data.bodies[p.id];
      for (const [, href] of html.matchAll(/<a href="([^"]*)"/g)) {
        const url = href.replace(/&amp;/g, '&');
        const page = /^\/docs\/([^/#]+)\/(#.*)?$/.exec(url);
        if (page) {
          const target = data.index.pages.find((x) => x.id === page[1]);
          expect(target, `${p.id}: ${url}`).toBeDefined();
          if (page[2]) expect(target!.headings.map((h) => `#${h.id}`), `${p.id}: ${url}`).toContain(page[2]);
        } else if (url.startsWith('https://github.com/semspec/semspec/blob/master/')) {
          const path = url.slice('https://github.com/semspec/semspec/blob/master/'.length).split('#')[0];
          expect(existsSync(join(repo, path)), `${p.id}: ${url}`).toBe(true);
        } else if (url.startsWith('#')) {
          expect(p.headings.map((h) => `#${h.id}`), `${p.id}: ${url}`).toContain(url);
        }
      }
      // The renderer already rewrote every link, so a second pass finds no unresolved Markdown link.
      expect(html, p.id).not.toMatch(/href="[^"]*\.md[#"]/);
      expect(files.has(p.file)).toBe(true);
    }
  });

  it('has unique routes', () => {
    const paths = docsPaths(data.index);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
