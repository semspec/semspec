// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Vitest config. The tests import the packages from their sources, so no build is needed first.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@semspec\/core$/, replacement: here('./packages/core/src/index.ts') },
      { find: /^@semspec\/app\//, replacement: here('./packages/app/src/') },
      { find: /^@\//, replacement: here('./packages/app/src/') },
    ],
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
