// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Reads the docs folder of the repository with the CLI loader and renders every page. The Vite config
// and the tests call it. It runs in Node only.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildIndex, buildModel } from '../../../packages/core/src/index';
import { loadInputs } from '../../../packages/cli/src/inputs';
import { buildDocsIndex, docSources, fileOf } from './docs';
import type { DocsIndex, DocsOptions, RenderedBody } from './docs';
import { renderBody } from './docs-markdown';

export interface DocsData {
  index: DocsIndex;
  // The HTML of each body, by page id.
  bodies: Record<string, string>;
  // The files that the data comes from, for the watch of the dev server.
  watch: string[];
}

// Loads the docs of the repository at `repo`. It throws on a warning of the loader, on a page that is
// not at <root>/<kind>/<id>.md, on a link that does not resolve and on an unknown documented node.
export async function loadDocs(repo: string, options: Partial<DocsOptions> = {}): Promise<DocsData> {
  const root = options.root ?? 'docs';
  const folder = join(repo, root);
  const loaded = loadInputs(folder, join(folder, 'profile.yaml'), ['profile.yaml', 'workspace.yaml']);
  if (loaded.warnings.length) throw new Error(`The docs graph has warnings:\n  ${loaded.warnings.join('\n  ')}`);
  const requirements = loadInputs(join(repo, 'requirements/graph'), join(repo, 'requirements/profile.yaml'));
  const docs = buildIndex(buildModel(loaded.graph, loaded.profile));
  const sources = docSources(docs, buildIndex(buildModel(requirements.graph, requirements.profile)), options);
  for (const s of sources) {
    if (!existsSync(join(repo, s.file))) throw new Error(`The page "${s.id}" is not at ${fileOf(root, s.kind, s.id)}`);
  }
  const files = new Map(sources.map((s) => [s.file, s.id]));
  const rendered = new Map<string, RenderedBody>();
  const bodies: Record<string, string> = {};
  for (const s of sources) {
    const page = await renderBody(s.body, { id: s.id, file: s.file, files });
    rendered.set(s.id, page);
    bodies[s.id] = page.html;
  }
  return { index: buildDocsIndex(docs, sources, rendered), bodies, watch: [...sources.map((s) => join(repo, s.file)), join(folder, 'profile.yaml'), join(repo, 'requirements/profile.yaml')] };
}
