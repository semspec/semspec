// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

describe('the mark of the site', () => {
  it('draws the logo with the Network icon of the app on a rounded square', () => {
    const icons = read('src/components/icons.tsx');
    expect(icons).toContain("import { Network } from 'lucide-react';");
    expect(icons).toMatch(/rounded-md bg-primary text-primary-foreground/);
    // The app shows the same icon in its header.
    const app = read('../packages/app/src/App.tsx');
    expect(app).toMatch(/rounded-md bg-primary text-primary-foreground">\s*<Network /);
  });

  it('draws the favicon with the paths of the Network icon and a dark version', () => {
    const svg = read('public/favicon.svg');
    for (const shape of ['<rect x="16" y="16" width="6" height="6" rx="1"/>', '<rect x="2" y="16" width="6" height="6" rx="1"/>', '<rect x="9" y="2" width="6" height="6" rx="1"/>', 'M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3', 'M12 12V8']) {
      expect(svg).toContain(shape);
    }
    expect(svg).toContain('@media (prefers-color-scheme: dark)');
  });

  it('blurs the page under the header with fixed values and the Safari prefix', () => {
    const header = read('src/components/site-header.tsx');
    expect(header).toContain('[-webkit-backdrop-filter:blur(16px)_saturate(1.8)]');
    expect(header).toContain('[backdrop-filter:blur(16px)_saturate(1.8)]');
    expect(header).toMatch(/sticky top-0/);
  });
});
