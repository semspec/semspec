// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Reads and checks a graph and a profile.
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Graph, Profile } from '@semspec/core';
import { readInput } from './input';
import { validateGraph, validateProfile } from './validate';
import { resolveVocabularyFiles } from './vocabulary';
import { readGraphFolder } from './yaml';

// Reads and checks the profile. It throws on an error.
export function loadProfile(profilePath: string): Profile {
  const read = resolveVocabularyFiles(readInput(profilePath, 'profile'), profilePath);
  const problems = read.errors.length ? read.errors : validateProfile(read.profile);
  if (problems.length) throw new Error(`The profile "${profilePath}" is not valid:\n  ${problems.join('\n  ')}`);
  return read.profile as Profile;
}

// Reads and checks both inputs. It throws on an error and returns the warnings.
// `exclude` holds the patterns of the paths to skip in a graph folder.
// `files` holds the absolute path of the file of each node, in the order of the nodes.
export function loadInputs(graphPath: string, profilePath: string, exclude: string[] = []): { graph: Graph; profile: Profile; files: string[]; warnings: string[] } {
  const profile = loadProfile(profilePath);
  let labels: string[] | undefined;
  let files: string[];
  let graph: Graph;
  const extra: string[] = [];
  if (isDirectory(graphPath)) {
    const folder = readGraphFolder(graphPath, profile, exclude);
    ({ graph, labels, files } = folder);
    extra.push(...folder.warnings);
  }
  else {
    graph = readInput(graphPath, 'graph') as Graph;
    const list = (graph as Record<string, unknown> | null)?.[profile.source.nodes];
    files = Array.isArray(list) ? list.map(() => resolve(graphPath)) : [];
    if (exclude.length) extra.push('The option --exclude has no effect because the graph is a file, not a folder.');
  }
  const checked = validateGraph(graph, profile, labels);
  if (checked.errors.length) throw new Error(`The graph "${graphPath}" is not valid:\n  ${checked.errors.slice(0, 20).join('\n  ')}`);
  return { graph, profile, files, warnings: [...extra, ...checked.warnings] };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

