// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Builds the 1-file page: the bundled app, its style, the colours of the kinds and the model.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Model } from '../core/index';

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
    for (const dir of [here('../app/'), here('../../dist/app/')]) {
      if (existsSync(dir + 'viewer.js')) {
        return { js: readFileSync(dir + 'viewer.js', 'utf8'), css: existsSync(dir + 'viewer.css') ? readFileSync(dir + 'viewer.css', 'utf8') : '' };
      }
    }
    const config = here('../../vite.config.ts');
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
export function kindColorCss(model: Model): string {
  const safe = (c: string) => c.replace(/[^#a-zA-Z0-9(),.%\s/-]/g, '');
  const id = (k: string) => k.replace(/[^a-zA-Z0-9_-]/g, '_');
  const light = model.profile.kinds.map((k) => `--kind-${id(k.id)}:${safe(k.color.light)};`).join('');
  const dark = model.profile.kinds.map((k) => `--kind-${id(k.id)}:${safe(k.color.dark)};`).join('');
  return `:root{${light}}.dark{${dark}}`;
}

// Sets the dark class before the first paint, from the colour scheme of the system.
const THEME_SCRIPT = `(function(){var m=window.matchMedia('(prefers-color-scheme: dark)');function a(){document.documentElement.classList.toggle('dark',m.matches)}a();m.addEventListener('change',a)})();`;

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export async function renderPage(model: Model): Promise<string> {
  const { js, css } = await loadAssets();
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Semspec – ${escapeHtml(model.profile.project)}</title>`,
    `<script>${THEME_SCRIPT}</script>`,
    `<style>${inlineStyle(css)}</style>`,
    `<style>${inlineStyle(kindColorCss(model))}</style>`,
    '</head>',
    '<body>',
    '<div id="root"></div>',
    `<script type="application/json" id="graph-data">${jsonForHtml(model)}</script>`,
    `<script>${inlineScript(js)}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
