// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The source files of the nodes. A node comes from a file, or names its origin file in the field that
// the profile key source.origin gives. serve shows the text of such a file when the file lies inside
// the source root. No other file is read.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import type { Graph, Profile } from '@semspec/core';

export interface SourceIndex {
  // The source root as an absolute path.
  root: string;
  // The folder that the relative paths start from: the folder of the workspace file, or of the profile.
  base: string;
  // The absolute path of the file of each node, by graph id and node id.
  graphs: Map<string, Map<string, string>>;
}

// The file of each node by node id. `files` holds the file of each node of the graph, in order.
// A node with a text in the field source.origin has that file instead.
export function nodeFiles(graph: Graph, profile: Profile, files: string[], base: string): Map<string, string> {
  const list = graph[profile.source.nodes];
  const found = new Map<string, string>();
  if (!Array.isArray(list)) return found;
  list.forEach((node: Record<string, unknown> | null, i) => {
    const id = node?.[profile.source.id];
    if (typeof id !== 'string' && typeof id !== 'number') return;
    const origin = profile.source.origin === undefined ? undefined : node?.[profile.source.origin];
    const file = typeof origin === 'string' && origin.trim() ? resolve(base, origin.trim()) : files[i];
    if (file !== undefined && !found.has(String(id))) found.set(String(id), file);
  });
  return found;
}

// The paths of a node map, relative to the base and with `/` as separator.
export function relativeFiles(files: Map<string, string>, base: string): Record<string, string> {
  return Object.fromEntries([...files].map(([id, file]) => [id, relative(base, file).split(sep).join('/')]));
}

// The real path of the file when it is a file inside the source root, else undefined.
// The function resolves symbolic links first, so a link cannot lead out of the root.
function insideRoot(file: string, root: string): string | undefined {
  try {
    const real = realpathSync(file);
    const top = realpathSync(root);
    if (real !== top && !real.startsWith(top.endsWith(sep) ? top : top + sep)) return undefined;
    return statSync(real).isFile() ? real : undefined;
  } catch {
    return undefined;
  }
}

// The text of the file of a node, or undefined when the node has no file or the file is outside the source root.
export function sourceText(index: SourceIndex, graph: string, node: string): string | undefined {
  const file = index.graphs.get(graph)?.get(node);
  const real = file === undefined ? undefined : insideRoot(file, index.root);
  if (real === undefined) return undefined;
  try {
    return readFileSync(real, 'utf8');
  } catch {
    return undefined;
  }
}

// The texts for `build --sources`: for each graph id, the text of each file by its relative path.
export function sourceTexts(index: SourceIndex): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [graph, files] of index.graphs) {
    const texts: Record<string, string> = {};
    for (const [node, file] of files) {
      const path = relative(index.base, file).split(sep).join('/');
      if (path in texts) continue;
      const text = sourceText(index, graph, node);
      if (text !== undefined) texts[path] = text;
    }
    out[graph] = texts;
  }
  return out;
}
