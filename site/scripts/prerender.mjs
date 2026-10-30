// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Renders each route of the site to HTML with the server build, puts the HTML into the built page
// at the placeholder, writes dist/sitemap.xml and removes the temporary server build.
// The docs routes share 1 built page, dist/docs/index.html. Each route gets its own copy with its own head.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { siteDir } from './lib.mjs';

const ORIGIN = 'https://semspec.dev';
const PLACEHOLDER = '<!--app-->';
const ssrDir = `${siteDir}.ssr/`;
const distDir = `${siteDir}dist/`;

const { render, docsRoutes, headOf } = await import(pathToFileURL(`${ssrDir}entry-server.js`).href);

const escapeAttr = (text) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escapeText = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// Replaces the first match of a pattern. A head without the element is an error.
function replaceOnce(html, pattern, value) {
  if (!pattern.test(html)) throw new Error(`The page template has no match for ${pattern}`);
  return html.replace(pattern, () => value);
}

// Sets the title, the description, the canonical URL and the Open Graph tags of a docs page.
function withHead(html, path, head) {
  const url = `${ORIGIN}${path}`;
  let out = html;
  out = replaceOnce(out, /<title>[^<]*<\/title>/, `<title>${escapeText(head.title)}</title>`);
  out = replaceOnce(out, /<meta name="description" content="[^"]*"/, `<meta name="description" content="${escapeAttr(head.description)}"`);
  out = replaceOnce(out, /<link rel="canonical" href="[^"]*"/, `<link rel="canonical" href="${url}"`);
  out = replaceOnce(out, /<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${url}"`);
  out = replaceOnce(out, /<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${escapeAttr(head.title)}"`);
  out = replaceOnce(out, /<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${escapeAttr(head.description)}"`);
  return out;
}

// `path` is the URL path. `file` is the built page. `template` is the built page to copy, for a docs route.
const routes = [
  { path: '/', file: `${distDir}index.html` },
  { path: '/roadmap/', file: `${distDir}roadmap/index.html` },
];
const docsTemplate = await readFile(`${distDir}docs/index.html`, 'utf8');
for (const path of docsRoutes()) routes.push({ path, file: `${distDir}${path.slice(1)}index.html`, template: docsTemplate, head: headOf(path) });

for (const route of routes) {
  let html = route.template ?? (await readFile(route.file, 'utf8'));
  if (!html.includes(PLACEHOLDER)) throw new Error(`The page ${route.file} has no ${PLACEHOLDER} placeholder`);
  const body = render(route.path);
  if (!body) throw new Error(`The route ${route.path} rendered no HTML`);
  if (route.head) html = withHead(html, route.path, route.head);
  await mkdir(dirname(route.file), { recursive: true });
  // A function as the replacement keeps "$" in the HTML as it is.
  await writeFile(route.file, html.replace(PLACEHOLDER, () => body));
  console.log(`prerendered ${route.path}`);
}

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...routes.map((r) => `  <url><loc>${ORIGIN}${r.path}</loc></url>`),
  '</urlset>',
  '',
].join('\n');
await writeFile(`${distDir}sitemap.xml`, sitemap);

await rm(ssrDir, { recursive: true, force: true });
