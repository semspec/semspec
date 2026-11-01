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

  it('names each setting of the Pages project in the guide', () => {
    const guide = text('docs/guide/deploying.md');
    expect(guide).toMatch(/documents: \[req-site-deploy\]/);
    for (const setting of ['`semspec/semspec`', 'Production branch | `master`', 'npm ci && npm run build && npm ci --prefix site && npm run build --prefix site', '`site/dist`', '`.node-version`', '`semspec.dev`']) {
      expect(guide).toContain(setting);
    }
  });
});
