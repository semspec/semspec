// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The pure logic of the docs: the page index, the sidebar order, the backlinks, the previous and the
// next page, the heading slugs and the rewrite of links. The module has no framework dependency and
// reads no file. The Vite config runs it at build time, so it imports the core module by a relative path.
import { statusOf } from '../../../packages/core/src/index';
import type { Index } from '../../../packages/core/src/index';
import { GITHUB_URL } from './links';
import { statusDataOf } from './roadmap';
import type { StatusData } from './roadmap';

// The names that the module reads from the docs graph. The defaults match docs/profile.yaml.
export interface DocsOptions {
  // The edge between 2 related pages.
  relatedEdge: string;
  // The cross link field that names the requirement nodes that a page documents.
  documentsField: string;
  // The field of the page order.
  orderField: string;
  // The field of the page body. It matches `source.markdown.body` in the profile.
  bodyField: string;
  // The folder of the docs, relative to the repository root.
  root: string;
}

export const DEFAULT_OPTIONS: DocsOptions = { relatedEdge: 'related', documentsField: 'documents', orderField: 'order', bodyField: 'body', root: 'docs' };

// The branch of the repository that the links to the source files use.
export const BRANCH = 'master';

// The slug of the page that shows the docs graph in the explorer. A page with the same id wins,
// and the graph page then uses the fallback slug.
export const GRAPH_SLUG = 'graph';
export const GRAPH_SLUG_FALLBACK = 'docs-graph';

export interface DocHeading {
  depth: 2 | 3;
  id: string;
  text: string;
}

export interface DocDocument {
  id: string;
  kind: string;
  title: string;
  // The status roll-up of the node. Null when the node has no known status.
  status: StatusData | null;
}

export interface DocKind {
  id: string;
  // The plural label of the kind in the profile, with a capital first letter. The index shows it as a group heading.
  heading: string;
}

// A page without its body. The client gets this data. The body stays at build time.
export interface DocPage {
  id: string;
  kind: string;
  title: string;
  description: string;
  // Null when the page has no order. Such a page sorts last.
  order: number | null;
  // The ids of the pages that the front matter names.
  related: string[];
  // The ids of the pages that the body links to.
  links: string[];
  headings: DocHeading[];
  documents: DocDocument[];
  // The path of the Markdown file, relative to the repository root.
  file: string;
}

export interface DocsIndex {
  kinds: DocKind[];
  // All pages in the order of the sidebar: by kind, then by `order`.
  pages: DocPage[];
}

// A page as the graph holds it, with its body.
export interface DocSource {
  id: string;
  kind: string;
  title: string;
  description: string;
  order: number | null;
  related: string[];
  documents: DocDocument[];
  body: string;
  file: string;
}

// What the renderer finds in 1 body.
export interface RenderedBody {
  headings: DocHeading[];
  links: string[];
}

const byOrder = (a: { order: number | null; title: string }, b: { order: number | null; title: string }) =>
  (a.order ?? Infinity) - (b.order ?? Infinity) || a.title.localeCompare(b.title, 'en');

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// The path of the Markdown file of a page: <root>/<kind>/<id>.md.
export function fileOf(root: string, kind: string, id: string): string {
  return `${root}/${kind}/${id}.md`;
}

// Reads the pages from the index of the docs graph. The requirements index gives the status of the
// documented nodes. It throws when a page names a node that the requirements graph does not have.
export function docSources(docs: Index, requirements: Index | undefined, options: Partial<DocsOptions> = {}): DocSource[] {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const ids = new Set(docs.model.nodes.map((n) => n.id));
  const related = new Map<string, string[]>();
  for (const e of docs.model.edges) {
    if (e.k === o.relatedEdge && ids.has(e.t)) related.set(e.s, [...(related.get(e.s) ?? []), e.t]);
  }
  const documented = new Map<string, string[]>();
  for (const c of docs.model.crossLinks) {
    if (c.field === o.documentsField) documented.set(c.s, [...(documented.get(c.s) ?? []), c.t]);
  }
  return docs.model.nodes.map<DocSource>((n) => {
    const order = n.d[o.orderField];
    const documents = (documented.get(n.id) ?? []).map<DocDocument>((id) => {
      const target = requirements?.byId.get(id);
      if (!target) throw new Error(`The page "${n.id}" documents "${id}", which is not a node of the requirements graph`);
      const rolled = statusOf(requirements!, id);
      return { id, kind: target.kind, title: target.title, status: statusDataOf(requirements!.profile, rolled.value ?? undefined) };
    });
    return {
      id: n.id,
      kind: n.kind,
      title: n.title,
      description: n.statement,
      order: typeof order === 'number' ? order : null,
      related: related.get(n.id) ?? [],
      documents,
      body: typeof n.d[o.bodyField] === 'string' ? n.d[o.bodyField] : '',
      file: fileOf(o.root, n.kind, n.id),
    };
  });
}

// Builds the page index. `rendered` holds the headings and the page links of each body.
export function buildDocsIndex(docs: Index, sources: DocSource[], rendered: Map<string, RenderedBody>): DocsIndex {
  const kinds = docs.profile.kinds.map<DocKind>((k) => ({ id: k.id, heading: capital(k.plural) }));
  const kindOrder = new Map(kinds.map((k, i) => [k.id, i]));
  const pages = sources
    .map<DocPage>((s) => {
      const body = rendered.get(s.id);
      return { id: s.id, kind: s.kind, title: s.title, description: s.description, order: s.order, related: s.related, links: body?.links ?? [], headings: body?.headings ?? [], documents: s.documents, file: s.file };
    })
    .sort((a, b) => (kindOrder.get(a.kind) ?? Infinity) - (kindOrder.get(b.kind) ?? Infinity) || byOrder(a, b));
  return { kinds: kinds.filter((k) => pages.some((p) => p.kind === k.id)), pages };
}

// ---------- queries ----------

export interface DocGroup {
  kind: DocKind;
  pages: DocPage[];
}

// The pages grouped by kind, in the order of the sidebar.
export function groupPages(index: DocsIndex): DocGroup[] {
  return index.kinds.map((kind) => ({ kind, pages: index.pages.filter((p) => p.kind === kind.id) }));
}

export function pageOf(index: DocsIndex, id: string): DocPage | undefined {
  return index.pages.find((p) => p.id === id);
}

// The related pages: the pages that the front matter names, then every page that names this page
// in its front matter or links to it in its body. Each page appears once. The page itself never appears.
export function relatedPages(index: DocsIndex, id: string): DocPage[] {
  const page = pageOf(index, id);
  if (!page) return [];
  const ids = [...page.related, ...index.pages.filter((p) => p.related.includes(id) || p.links.includes(id)).map((p) => p.id)];
  const unique = [...new Set(ids)].filter((x) => x !== id);
  return unique.map((x) => pageOf(index, x)).filter((p): p is DocPage => p !== undefined);
}

// The previous and the next page in the order of the sidebar.
export function neighbours(index: DocsIndex, id: string): { prev: DocPage | null; next: DocPage | null } {
  const i = index.pages.findIndex((p) => p.id === id);
  if (i < 0) return { prev: null, next: null };
  return { prev: index.pages[i - 1] ?? null, next: index.pages[i + 1] ?? null };
}

// ---------- routes ----------

// The slug of the docs graph page.
export function graphSlug(index: DocsIndex): string {
  return index.pages.some((p) => p.id === GRAPH_SLUG) ? GRAPH_SLUG_FALLBACK : GRAPH_SLUG;
}

export const DOCS_ROOT = '/docs/';

export const pagePath = (id: string) => `${DOCS_ROOT}${id}/`;

export const graphPath = (index: DocsIndex) => `${DOCS_ROOT}${graphSlug(index)}/`;

// The URL path of every docs route: the index, the docs graph and 1 for each page.
export function docsPaths(index: DocsIndex): string[] {
  return [DOCS_ROOT, graphPath(index), ...index.pages.map((p) => pagePath(p.id))];
}

// The GitHub link that edits the Markdown file of a page.
export const editUrl = (page: Pick<DocPage, 'file'>) => `${GITHUB_URL}/edit/${BRANCH}/${page.file}`;

// ---------- headings ----------

// The slug of a heading text: lower case letters and digits, joined by hyphens.
export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

// Returns a function that gives a unique slug for each text. A repeated text gets "-2", "-3" and so on.
export function slugger(): (text: string) => string {
  const used = new Map<string, number>();
  return (text) => {
    const base = slugify(text);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

// The plain text of an HTML snippet: no tags, and the entities decoded.
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === '#') {
        const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- links ----------

export interface LinkContext {
  // The id and the file of the page that holds the link.
  id: string;
  file: string;
  // The id of each page by its file path.
  files: ReadonlyMap<string, string>;
}

export interface RewrittenLink {
  href: string;
  // The id of the page that the link targets, when it targets a page.
  page?: string;
}

const SCHEME = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

// Resolves a path against a folder. Both are relative to the repository root. Returns null when the path leaves the repository.
function resolvePath(folder: string, path: string): string | null {
  const parts = folder ? folder.split('/') : [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

// Rewrites a link of a page body.
//   An absolute link, a link to the same page and a link with a root path stay as they are.
//   A relative link to the Markdown file of a page becomes the route of the page. A #fragment stays.
//   A relative link to any other file of the repository becomes a link to the file on GitHub.
// It throws on a link to a Markdown file that is not a page, and on a link that leaves the repository.
export function rewriteLink(href: string, from: LinkContext): RewrittenLink {
  if (href === '' || href.startsWith('#') || href.startsWith('/') || SCHEME.test(href)) return { href };
  const hash = href.indexOf('#');
  const fragment = hash < 0 ? '' : href.slice(hash);
  const withoutFragment = hash < 0 ? href : href.slice(0, hash);
  const query = withoutFragment.indexOf('?');
  const path = query < 0 ? withoutFragment : withoutFragment.slice(0, query);
  const folder = from.file.includes('/') ? from.file.slice(0, from.file.lastIndexOf('/')) : '';
  const target = resolvePath(folder, path);
  if (target === null) throw new Error(`The page "${from.id}" has the link "${href}", which leaves the repository`);
  if (target.toLowerCase().endsWith('.md')) {
    const id = from.files.get(target);
    if (id === undefined) throw new Error(`The page "${from.id}" links to "${href}", which is not a page of the docs`);
    return { href: `${pagePath(id)}${fragment}`, page: id };
  }
  return { href: `${GITHUB_URL}/blob/${BRANCH}/${target}${fragment}` };
}
