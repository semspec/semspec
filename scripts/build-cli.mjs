// SPDX-License-Identifier: Apache-2.0
// Bundles the command line tool into dist/cli/index.js. The tool needs the app assets in
// dist/app, which `npm run build:app` writes.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/cli/index.ts'],
  outfile: 'dist/cli/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['vite', 'ajv', 'ajv/dist/2020.js'],
  banner: { js: '#!/usr/bin/env node' },
});
console.log('wrote dist/cli/index.js');
