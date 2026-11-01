// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Vite config of the web site. A plugin gives 8 virtual modules to the pages, so the dev server,
// the client build and the server build use the same data:
//   virtual:roadmap     the planned and the shipped features, from the requirements of this repository
//   virtual:cards       the shipped features for the cards of the home page, in the order of the feature nodes
//   virtual:trace       the chain from the product down to a test for 1 requirement of this repository
//   virtual:hero-graph  the radial drawing of the hierarchy of the requirements of this repository
//   virtual:snippets    code from this repository, highlighted at build time
//   virtual:build-info  the version and the short commit
//   virtual:docs        the index of the docs pages, without the bodies
//   virtual:doc-bodies  the HTML of the docs bodies. Only the server build and the dev server import it.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { codeToHtml } from 'shiki';
import type { Plugin, ViteDevServer } from 'vite';
import { defineConfig } from 'vitest/config';
import { parse } from 'yaml';
import { buildIndex, buildModel } from '../packages/core/src/index';
import { THEME_KEY } from '../packages/app/src/lib/theme';
import { loadInputs } from '../packages/cli/src/inputs';
import { excerptBlocks } from './src/lib/excerpt';
import { loadDocs } from './src/lib/docs-load';
import type { DocsData } from './src/lib/docs-load';
import { buildHeroGraph } from './src/lib/hero-graph';
import { buildCards } from './src/lib/cards';
import { buildRoadmap } from './src/lib/roadmap';
import { buildTrace } from './src/lib/trace';
import type { TraceData } from './src/lib/trace';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const repo = resolve(here('..'));
const GRAPH = join(repo, 'requirements/graph');
const PROFILE = join(repo, 'requirements/profile.yaml');

// Sets the dark class before the first paint. The rule matches THEME_SCRIPT in packages/cli/src/page.ts.
const THEME_SCRIPT = `(function(){var s=null;try{s=localStorage.getItem('${THEME_KEY}')}catch(e){}var d=s==='dark'||(s!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)})();`;

const SHELL = [
  'npx semspec build --graph requirements/graph --profile requirements/profile.yaml --out requirements.html',
  'npx semspec serve --graph requirements/graph --profile requirements/profile.yaml',
].join('\n');

const read = (path: string) => readFileSync(path, 'utf8');

// The requirement file for the second step of "How it works". It needs acceptance conditions with
// tests. The function takes the preferred file, or else the first shipped requirement that has both.
function requirementFile(): string {
  const dir = join(repo, 'requirements/graph/requirement');
  const usable = (text: string) => /^acceptance:/m.test(text) && /^\s+tests:/m.test(text) && !/^state:\s*draft/m.test(text);
  const preferred = 'req-scope-collects.yaml';
  if (usable(read(join(dir, preferred)))) return join(dir, preferred);
  const other = readdirSync(dir).sort().find((f) => f.endsWith('.yaml') && usable(read(join(dir, f))));
  if (!other) throw new Error('No shipped requirement with acceptance conditions and tests in requirements/graph/requirement');
  return join(dir, other);
}

function commitOf(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function dataPlugin(): Plugin {
  const ids = new Set(['virtual:roadmap', 'virtual:cards', 'virtual:trace', 'virtual:hero-graph', 'virtual:snippets', 'virtual:build-info', 'virtual:docs', 'virtual:doc-bodies']);
  // The docs load once for the 2 virtual modules. A change of a watched file clears the cache.
  let docs: Promise<DocsData> | undefined;
  return {
    name: 'semspec-site-data',
    configureServer(server: ViteDevServer) {
      // The dev server serves the template of the docs for every docs route.
      server.middlewares.use((req, _res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (/^\/docs\/[^.]+$/.test(path)) req.url = '/docs/index.html';
        next();
      });
    },
    watchChange(file) {
      if (docs && (file.startsWith(join(repo, 'docs')) || file.startsWith(join(repo, 'requirements')))) docs = undefined;
    },
    resolveId(id) {
      return ids.has(id) ? `\0${id}` : undefined;
    },
    async load(id) {
      if (id === '\0virtual:roadmap') {
        const { graph, profile } = loadInputs(GRAPH, PROFILE);
        this.addWatchFile(PROFILE);
        const data = buildRoadmap(buildIndex(buildModel(graph, profile)));
        return `export default ${JSON.stringify(data)};`;
      }
      if (id === '\0virtual:cards') {
        const { graph, profile } = loadInputs(GRAPH, PROFILE);
        this.addWatchFile(PROFILE);
        const data = buildCards(buildIndex(buildModel(graph, profile)));
        return `export default ${JSON.stringify(data)};`;
      }
      if (id === '\0virtual:trace') {
        const { graph, profile } = loadInputs(GRAPH, PROFILE);
        const requirement = requirementFile();
        this.addWatchFile(PROFILE);
        this.addWatchFile(requirement);
        // The requirement of the second step of "How it works". Its id comes from the file.
        const requirementId = String((parse(read(requirement)) as Record<string, unknown>)[profile.source.id]);
        const data: TraceData = { file: requirement.slice(repo.length + 1), nodes: buildTrace(buildIndex(buildModel(graph, profile)), requirementId) };
        return `export default ${JSON.stringify(data)};`;
      }
      if (id === '\0virtual:hero-graph') {
        const { graph, profile } = loadInputs(GRAPH, PROFILE);
        this.addWatchFile(PROFILE);
        const data = buildHeroGraph(buildIndex(buildModel(graph, profile)));
        return `export default ${JSON.stringify(data)};`;
      }
      if (id === '\0virtual:snippets') {
        const highlight = (code: string, lang: string) => codeToHtml(code, { lang, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false });
        const requirement = requirementFile();
        this.addWatchFile(PROFILE);
        this.addWatchFile(requirement);
        const profileCode = excerptBlocks(read(PROFILE), ['kinds', 'edges']);
        const requirementCode = read(requirement).trimEnd();
        const data = {
          profile: { file: 'requirements/profile.yaml', code: profileCode, html: await highlight(profileCode, 'yaml') },
          requirement: { file: requirement.slice(repo.length + 1), code: requirementCode, html: await highlight(requirementCode, 'yaml') },
          shell: { file: 'terminal', code: SHELL, html: await highlight(SHELL, 'bash') },
        };
        return `export default ${JSON.stringify(data)};`;
      }
      if (id === '\0virtual:docs' || id === '\0virtual:doc-bodies') {
        docs ??= loadDocs(repo);
        const data = await docs;
        data.watch.forEach((f) => this.addWatchFile(f));
        return `export default ${JSON.stringify(id === '\0virtual:docs' ? data.index : data.bodies)};`;
      }
      if (id === '\0virtual:build-info') {
        const version = (JSON.parse(read(join(repo, 'package.json'))) as { version: string }).version;
        return `export default ${JSON.stringify({ version, commit: commitOf() })};`;
      }
      return undefined;
    },
  };
}

// Puts the theme script in the head of every page.
function themeScriptPlugin(): Plugin {
  return {
    name: 'semspec-site-theme-script',
    transformIndexHtml: () => [{ tag: 'script', children: THEME_SCRIPT, injectTo: 'head' }],
  };
}

export default defineConfig(({ isSsrBuild }) => ({
  root: here('.'),
  base: '/',
  appType: 'mpa',
  plugins: [react(), tailwindcss(), themeScriptPlugin(), dataPlugin()],
  // 1 copy of React for the site and for every library. 2 copies break the hooks.
  resolve: { alias: { '@': here('./src') }, dedupe: ['react', 'react-dom'] },
  server: { fs: { allow: [repo] } },
  build: {
    outDir: 'dist',
    // The server build needs no copy of the public folder.
    copyPublicDir: !isSsrBuild,
    rolldownOptions: { input: { index: here('./index.html'), roadmap: here('./roadmap/index.html'), docs: here('./docs/index.html') } },
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
}));
