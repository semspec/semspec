// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Reads and checks a graph and a profile.
import { statSync } from 'node:fs';
import type { Graph, Profile } from '@semspec/core';
import { readInput } from './input';
import { validateGraph, validateProfile } from './validate';
import { resolveVocabularyFiles } from './vocabulary';
import { readGraphFolder } from './yaml';
import { applyVerification } from '@semspec/core';
import { verifiedGraph } from './test-record';

// Reads and checks the profile. It throws on an error.
export function loadProfile(profilePath: string): Profile {
  const read = resolveVocabularyFiles(readInput(profilePath, 'profile'), profilePath);
  const problems = read.errors.length ? read.errors : validateProfile(read.profile);
  if (problems.length) throw new Error(`The profile "${profilePath}" is not valid:\n  ${problems.join('\n  ')}`);
  return read.profile as Profile;
}

// Reads and checks both inputs. It throws on an error and returns the warnings.
// `exclude` holds the patterns of the paths to skip in a graph folder.
// With `evidenceErrors: 'warn'`, an error of the test evidence gives a warning, and every condition is not-run.
export function loadInputs(graphPath: string, profilePath: string, exclude: string[] = [], options: { evidenceErrors?: 'throw' | 'warn' } = {}): { graph: Graph; profile: Profile; warnings: string[] } {
  const profile = loadProfile(profilePath);
  let labels: string[] | undefined;
  let graph: Graph;
  const extra: string[] = [];
  if (isDirectory(graphPath)) {
    const folder = readGraphFolder(graphPath, profile, exclude);
    ({ graph, labels } = folder);
    extra.push(...folder.warnings);
  }
  else {
    graph = readInput(graphPath, 'graph') as Graph;
    if (exclude.length) extra.push('The option --exclude has no effect because the graph is a file, not a folder.');
  }
  const checked = validateGraph(graph, profile, labels);
  if (checked.errors.length) throw new Error(`The graph "${graphPath}" is not valid:\n  ${checked.errors.slice(0, 20).join('\n  ')}`);
  const verified = options.evidenceErrors === 'warn' ? evidenceOrWarning(graph, profile, profilePath, graphPath) : verifiedGraph(graph, profile, profilePath, graphPath);
  return { graph: verified.graph, profile, warnings: [...extra, ...checked.warnings, ...verified.warnings] };
}

function evidenceOrWarning(graph: Graph, profile: Profile, profilePath: string, graphPath: string): { graph: Graph; warnings: string[] } {
  try {
    return verifiedGraph(graph, profile, profilePath, graphPath);
  } catch (e) {
    return { graph: applyVerification(graph, profile, [], true), warnings: [`The test evidence cannot load: ${(e as Error).message} Every condition is not-run.`] };
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

