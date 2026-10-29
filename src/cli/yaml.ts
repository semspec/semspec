// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Reads YAML input. A folder of YAML files is the graph: 1 node for each file, or a list of nodes.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Graph, Profile } from '../core/index';

export const isYamlPath = (path: string) => /\.ya?ml$/i.test(path);

// Parses a YAML file. The error names the file.
export function readYaml(path: string, what: string): unknown {
  try {
    return parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`Cannot read the ${what} "${path}": ${(e as Error).message}`);
  }
}

const escapeChar = (c: string) => c.replace(/[.+^${}()|[\]\\]/g, '\\$&');

// Turns an exclude pattern into a test for a path relative to the graph folder, with `/` separators.
// `*` matches any characters except `/`, `**` matches any characters, `?` matches 1 character except `/`.
// A pattern with no `/` and no wildcard matches a folder or a file of that name at any depth.
export function excludeMatcher(pattern: string): (rel: string) => boolean {
  const text = pattern.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  if (!/[/*?]/.test(text)) return (rel) => rel.split('/').includes(text);
  let source = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '*' && text[i + 1] === '*') {
      if (text[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else if (i > 0 && text[i - 1] === '/' && i + 2 === text.length) {
        // A trailing `/**` also matches the folder itself, so the walk skips it.
        source = `${source.slice(0, -1)}(?:/.*)?`;
        i += 1;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += escapeChar(c);
  }
  const regex = new RegExp(`^${source}$`);
  return (rel) => regex.test(rel);
}

// Lists the YAML files below a folder, in sorted order. A folder or a file that a test matches is skipped.
function yamlFiles(dir: string, skip: ((rel: string) => boolean)[], sub = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(dir, sub), { withFileTypes: true })) {
    const rel = sub ? `${sub}/${entry.name}` : entry.name;
    if (skip.some((test) => test(rel))) continue;
    if (entry.isDirectory()) found.push(...yamlFiles(dir, skip, rel));
    else if (entry.isFile() && isYamlPath(entry.name)) found.push(rel);
  }
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const isMapping = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// Builds the graph from a folder. `exclude` holds the patterns of the paths to skip.
// `labels` holds the file of each node, for the error messages.
export function readGraphFolder(dir: string, profile: Profile, exclude: string[] = []): { graph: Graph; labels: string[] } {
  const nodes: Record<string, unknown>[] = [];
  const labels: string[] = [];
  for (const rel of yamlFiles(dir, exclude.map(excludeMatcher))) {
    const path = join(dir, rel);
    const data = readYaml(path, 'graph file');
    if (isMapping(data)) {
      nodes.push(data);
      labels.push(`File "${path}"`);
    } else if (Array.isArray(data) && data.length && data.every(isMapping)) {
      data.forEach((n, i) => {
        nodes.push(n);
        labels.push(`File "${path}", node ${i}`);
      });
    } else {
      throw new Error(`The graph file "${path}" must hold a mapping or a list of mappings.`);
    }
  }
  return { graph: { [profile.source.nodes]: nodes }, labels };
}
