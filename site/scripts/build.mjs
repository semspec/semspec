// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The production build of the site. The output is static HTML in dist/.
//   1. Build the CLI and the app of the repository root.
//   2. Write the demo pages with the CLI.
//   3. Build the client, with 3 HTML inputs: the home page, the roadmap and the template of the docs.
//   4. Build the server entry into a temporary folder.
//   5. Render each route into its HTML file, write the sitemap and remove the temporary folder.
import { buildRoot, requireSiteModules, run, siteDir } from './lib.mjs';

requireSiteModules();
buildRoot();
run('node', ['scripts/demo.mjs'], siteDir);
// The runner loader reads the config without a bundle. The config imports TypeScript files of the repository.
run('npx', ['--no-install', 'vite', 'build', '--configLoader', 'runner'], siteDir);
run('npx', ['--no-install', 'vite', 'build', '--ssr', 'src/entry-server.tsx', '--outDir', '.ssr', '--emptyOutDir', '--configLoader', 'runner'], siteDir);
run('node', ['scripts/prerender.mjs'], siteDir);
