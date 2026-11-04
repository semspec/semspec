// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Reads a workspace file and loads its graphs. Each message names the id of the graph.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { buildModel, checkCrossLinks, embeddingConfigProblems, type Graph, type Profile, type WorkspaceData, type WorkspaceGraph } from '@semspec/core';
import { readInput } from './input';
import { loadInputs } from './inputs';

const schemaPath = new URL('../../../schema/workspace.schema.json', import.meta.url);

interface WorkspaceFile {
  title: string;
  search?: { embeddings?: unknown };
  graphs: { id: string; label: string; graph: string; profile: string; exclude?: string[] }[];
}

// Checks the workspace file against its schema. It also checks that the graph ids are unique.
export function validateWorkspace(file: unknown, schema: object = JSON.parse(readFileSync(schemaPath, 'utf8'))): string[] {
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  if (!validate(file)) return (validate.errors ?? []).map((e) => `workspace${e.instancePath} ${e.message}`);
  const seen = new Set<string>();
  const errors: string[] = [];
  const embeddings = (file as WorkspaceFile).search?.embeddings;
  if (embeddings !== undefined) errors.push(...embeddingConfigProblems(embeddings, 'workspace search.embeddings'));
  for (const g of (file as WorkspaceFile).graphs) {
    if (seen.has(g.id)) errors.push(`The graph id "${g.id}" is not unique`);
    seen.add(g.id);
  }
  return errors;
}

// Reads the workspace file and all graphs. It throws on an error and returns the warnings.
// `sources` holds the raw graph and the profile of each graph, by graph id.
export interface WorkspaceSource {
  graph: Graph;
  profile: Profile;
  // The absolute paths of the graph and of the profile.
  graphPath: string;
  profilePath: string;
}

export function loadWorkspace(path: string, options: { evidenceErrors?: 'throw' | 'warn' } = {}): { data: WorkspaceData; warnings: string[]; sources: Map<string, WorkspaceSource>; embeddings?: unknown } {
  const file = readInput(path, 'workspace');
  const problems = validateWorkspace(file);
  if (problems.length) throw new Error(`The workspace "${path}" is not valid:\n  ${problems.join('\n  ')}`);
  const { title, graphs, search } = file as WorkspaceFile;
  const base = dirname(resolve(path));
  const errors: string[] = [];
  const warnings: string[] = [];
  const loaded: WorkspaceGraph[] = [];
  const sources = new Map<string, WorkspaceSource>();
  for (const g of graphs) {
    try {
      const graphPath = resolve(base, g.graph);
      const profilePath = resolve(base, g.profile);
      const inputs = loadInputs(graphPath, profilePath, g.exclude ?? [], options);
      warnings.push(...inputs.warnings.map((w) => `Graph "${g.id}": ${w}`));
      loaded.push({ id: g.id, label: g.label, model: buildModel(inputs.graph, inputs.profile) });
      sources.set(g.id, { graph: inputs.graph, profile: inputs.profile, graphPath, profilePath });
    } catch (e) {
      errors.push(`Graph "${g.id}": ${(e as Error).message}`);
    }
  }
  if (!errors.length) {
    const checked = checkCrossLinks(loaded);
    errors.push(...checked.errors);
    warnings.push(...checked.warnings);
  }
  if (errors.length) throw new Error(`The workspace "${path}" is not valid:\n  ${errors.join('\n  ')}`);
  return { data: { title, graphs: loaded }, warnings, sources, embeddings: search?.embeddings };
}
