// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('..', import.meta.url));
const text = (path: string) => readFileSync(join(repo, path), 'utf8');

describe('the deploy of the site', () => {
  it('names the lowest Node version of the engines field in .node-version', () => {
    const lowest = /\d+\.\d+\.\d+/.exec(JSON.parse(text('package.json')).engines.node)![0];
    expect(text('.node-version').trim()).toBe(lowest);
  });

  it('has no workflow that reads a Cloudflare secret', () => {
    const dir = join(repo, '.github/workflows');
    for (const file of readdirSync(dir)) expect(readFileSync(join(dir, file), 'utf8'), file).not.toMatch(/CLOUDFLARE|wrangler/i);
  });

  it('serves the folder site/dist as static assets of the Worker semspec at semspec.dev', () => {
    // wrangler.jsonc has comments, so they are cut before the parse.
    const config = JSON.parse(text('wrangler.jsonc').replace(/^\s*\/\/.*$/gm, ''));
    expect(config.name).toBe('semspec');
    expect(config.main).toBeUndefined();
    expect(config.assets.directory).toBe('./site/dist');
    expect(config.routes).toEqual([{ pattern: 'semspec.dev', custom_domain: true }]);
    expect(text('site/scripts/build.mjs')).toContain('dist');
  });

  it('names each setting of the Worker and its build in the guide', () => {
    const guide = text('docs/guide/deploying.md');
    expect(guide).toMatch(/documents: \[req-site-deploy\]/);
    for (const setting of ['`semspec/semspec`', 'Branch | `master`', 'npm run build && npm ci --prefix site && npm run build --prefix site', '`npx wrangler deploy`', '`wrangler.jsonc`', '`.node-version`', '`semspec.dev`']) {
      expect(guide).toContain(setting);
    }
  });
});
