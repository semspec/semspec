// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Builds the 1-file page: the bundled app, its style, the colours of the kinds and the model.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { kindColorCss as coreKindColorCss, type Model, type WorkspaceData } from '@semspec/core';
import { THEME_KEY } from '@semspec/app/lib/theme';
import { generatorLabel } from './version';

export interface Assets {
  js: string;
  css: string;
}

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

let cached: Promise<Assets> | undefined;

// Reads the app that `npm run build:app` wrote. When the app is not built, the function builds
// it in memory, which works in a checkout of the repository.
export function loadAssets(): Promise<Assets> {
  cached ??= (async () => {
    for (const dir of [here('../../app/dist/')]) {
      if (existsSync(dir + 'viewer.js')) {
        return { js: readFileSync(dir + 'viewer.js', 'utf8'), css: existsSync(dir + 'viewer.css') ? readFileSync(dir + 'viewer.css', 'utf8') : '' };
      }
    }
    const config = here('../../app/vite.config.ts');
    if (!existsSync(config)) throw new Error('The app is not built. Run npm run build:app.');
    const { build } = await import('vite');
    const result = await build({ configFile: config, logLevel: 'silent', build: { write: false } });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((r: any) => r.output) as any[];
    const chunk = outputs.find((o) => o.type === 'chunk');
    const css = outputs.find((o) => o.type === 'asset' && String(o.fileName).endsWith('.css'));
    if (!chunk) throw new Error('The Vite build wrote no script');
    return { js: chunk.code as string, css: css ? Buffer.from(css.source).toString('utf8') : '' };
  })();
  return cached;
}

// A script element ends at the first "</script", and a style element at the first "</style".
const inlineScript = (s: string) => s.replace(/<\/script/gi, '<\\/script');
const inlineStyle = (s: string) => s.replace(/<\/style/gi, '<\\/style');
// The data sits in a JSON script element. A "<" becomes an escape, so no "</script" can end it.
const jsonForHtml = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

// The colour of each kind, as CSS variables for the light and the dark theme.
export const kindColorCss = (model: Model): string => coreKindColorCss(model.profile);

// Sets the dark class before the first paint, from the stored choice or else the system colour
// scheme. The key and the rule match packages/app/src/lib/theme.ts. The app takes over after the load.
const THEME_SCRIPT = `(function(){var s=null;try{s=localStorage.getItem('${THEME_KEY}')}catch(e){}var d=s==='dark'||(s!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)})();`;

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// A workspace page holds `{ title, graphs }`. A page of 1 graph holds the model itself.
export async function renderPage(data: Model | WorkspaceData): Promise<string> {
  const { js, css } = await loadAssets();
  const workspace = 'graphs' in data;
  const first = workspace ? data.graphs[0].model : data;
  const title = workspace ? data.title : data.profile.project;
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="generator" content="${escapeHtml(generatorLabel())}">`,
    `<title>Semspec – ${escapeHtml(title)}</title>`,
    `<script>${THEME_SCRIPT}</script>`,
    `<style>${inlineStyle(css)}</style>`,
    `<style>${inlineStyle(kindColorCss(first))}</style>`,
    '</head>',
    '<body>',
    '<div id="root"></div>',
    `<script type="application/json" id="graph-data">${jsonForHtml(data)}</script>`,
    `<script>${inlineScript(js)}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
