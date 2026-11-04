// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Reads a workspace file and loads its graphs and views. Each message names the id of the graph or of the view.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { buildModel, checkCrossLinks, embeddingConfigProblems, viewProfile, type Graph, type Profile, type ProfileLayout, type ViewFilters, type WorkspaceData, type WorkspaceGraph, type WorkspaceView } from '@semspec/core';
import { readInput } from './input';
import { loadInputs, loadProfile } from './inputs';
import { nodeFiles, relativeFiles, type SourceIndex } from './sources';
import { validateGraph, validateProfile } from './validate';

const schemaPath = new URL('../../../schema/workspace.schema.json', import.meta.url);

export interface ViewFile {
  id: string;
  label: string;
  graph: string;
  profile?: string;
  parents?: Record<string, string[][]>;
  layout?: ProfileLayout;
  filters?: ViewFilters;
}

interface WorkspaceFile {
  title: string;
  search?: { embeddings?: unknown };
  sourceRoot?: string;
  graphs: { id: string; label: string; graph: string; profile: string; exclude?: string[] }[];
  views?: ViewFile[];
}

// The problems of the views. The checks of the ids and of the graphs need no file. With `base`, the
// function also reads the profiles: the profile file of a view, the kinds of its parents rules and the
// profile that results from the view.
function viewProblems(file: WorkspaceFile, base: string | undefined): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const graphs = new Map(file.graphs.map((g) => [g.id, g]));
  for (const v of file.views ?? []) {
    if (seen.has(v.id)) errors.push(`The view id "${v.id}" is not unique`);
    seen.add(v.id);
    const graph = graphs.get(v.graph);
    if (!graph) {
      errors.push(`View "${v.id}": the graph "${v.graph}" is not in the workspace`);
      continue;
    }
    if (base === undefined) continue;
    let profile: Profile;
    try {
      profile = loadProfile(resolve(base, v.profile ?? graph.profile));
    } catch (e) {
      // A profile of a graph has its own message from the check of the graph.
      if (v.profile !== undefined) errors.push(`View "${v.id}": ${(e as Error).message}`);
      continue;
    }
    const kinds = new Set(profile.kinds.map((k) => k.id));
    const unknown = Object.keys(v.parents ?? {}).filter((k) => !kinds.has(k));
    unknown.forEach((k) => errors.push(`View "${v.id}": parents names the unknown kind "${k}"`));
    if (unknown.length || (!v.parents && !v.layout)) continue;
    validateProfile(viewProfile(profile, v)).forEach((m) => errors.push(`View "${v.id}": ${m}`));
  }
  if (base !== undefined && file.views?.length) errors.push(...crossLinkViewProblems(file, base));
  return errors;
}

// A cross link opens in a view of the graph that it names. A views list with no view for such a graph
// leaves the link without a target. The profiles of the graphs and of the views are the ones to read.
function crossLinkViewProblems(file: WorkspaceFile, base: string): string[] {
  const shown = new Set((file.views ?? []).map((v) => v.graph));
  const known = new Set(file.graphs.map((g) => g.id));
  const owners: { owner: string; profile: string }[] = [
    ...file.graphs.map((g) => ({ owner: `graph "${g.id}"`, profile: g.profile })),
    ...(file.views ?? []).flatMap((v) => (v.profile === undefined ? [] : [{ owner: `view "${v.id}"`, profile: v.profile }])),
  ];
  const errors: string[] = [];
  const named = new Set<string>();
  for (const { owner, profile } of owners) {
    let read: Profile;
    try {
      read = loadProfile(resolve(base, profile));
    } catch {
      // The profile has its own message from the check of the graph or of the view.
      continue;
    }
    for (const c of read.crossLinks ?? []) {
      // An unknown graph has its own message from the check of the cross links.
      if (!known.has(c.graph) || shown.has(c.graph) || named.has(c.graph)) continue;
      named.add(c.graph);
      errors.push(`The views list has no view for the graph "${c.graph}", and the cross link "${c.field}" of the ${owner} names it`);
    }
  }
  return errors;
}

// Checks the workspace file against its schema. It also checks that the graph ids and the view ids are
// unique, and that each view names a graph. With `base`, the folder of the workspace file, it also reads
// the profiles of the views.
export function validateWorkspace(file: unknown, schema: object = JSON.parse(readFileSync(schemaPath, 'utf8')), base?: string): string[] {
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
  errors.push(...viewProblems(file as WorkspaceFile, base));
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

// The page data of a view. The graph is loaded once. A view with its own profile, parents rule or
// layout gets its own model from the same graph. Any other view shares the model of its graph.
// The message for a graph that does not fit the profile file of a view, or undefined when it fits.
// The build and the check of the workspace both use it.
export function viewGraphProblem(v: ViewFile, graph: Graph, base: string): string | undefined {
  if (v.profile === undefined) return undefined;
  const checked = validateGraph(graph, viewProfile(loadProfile(resolve(base, v.profile)), v));
  if (!checked.errors.length) return undefined;
  return `The graph is not valid for the profile "${v.profile}":\n  ${checked.errors.slice(0, 20).join('\n  ')}`;
}

function loadView(v: ViewFile, source: WorkspaceSource, base: string): WorkspaceView {
  const out: WorkspaceView = { id: v.id, label: v.label, graph: v.graph, ...(v.filters ? { filters: v.filters } : {}) };
  if (v.profile === undefined && !v.parents && !v.layout) return out;
  const profile = viewProfile(v.profile === undefined ? source.profile : loadProfile(resolve(base, v.profile)), v);
  const problem = viewGraphProblem(v, source.graph, base);
  if (problem !== undefined) throw new Error(problem);
  return { ...out, model: buildModel(source.graph, profile) };
}

export function loadWorkspace(path: string): { data: WorkspaceData; warnings: string[]; sources: Map<string, WorkspaceSource>; files: SourceIndex; embeddings?: unknown } {
  const file = readInput(path, 'workspace');
  const base = dirname(resolve(path));
  const problems = validateWorkspace(file, undefined, base);
  if (problems.length) throw new Error(`The workspace "${path}" is not valid:\n  ${problems.join('\n  ')}`);
  const { title, graphs, search, views, sourceRoot } = file as WorkspaceFile;
  const errors: string[] = [];
  const warnings: string[] = [];
  const loaded: WorkspaceGraph[] = [];
  const sources = new Map<string, WorkspaceSource>();
  const files: SourceIndex = { root: resolve(base, sourceRoot ?? '.'), base, graphs: new Map() };
  for (const g of graphs) {
    try {
      const graphPath = resolve(base, g.graph);
      const profilePath = resolve(base, g.profile);
      const inputs = loadInputs(graphPath, profilePath, g.exclude ?? []);
      warnings.push(...inputs.warnings.map((w) => `Graph "${g.id}": ${w}`));
      const found = nodeFiles(inputs.graph, inputs.profile, inputs.files, base);
      files.graphs.set(g.id, found);
      loaded.push({ id: g.id, label: g.label, model: { ...buildModel(inputs.graph, inputs.profile), files: relativeFiles(found, base) } });
      sources.set(g.id, { graph: inputs.graph, profile: inputs.profile, graphPath, profilePath });
    } catch (e) {
      errors.push(`Graph "${g.id}": ${(e as Error).message}`);
    }
  }
  const loadedViews: WorkspaceView[] = [];
  for (const v of views ?? []) {
    const source = sources.get(v.graph);
    // A graph that failed to load has its own message.
    if (!source) continue;
    try {
      loadedViews.push(loadView(v, source, base));
    } catch (e) {
      errors.push(`View "${v.id}": ${(e as Error).message}`);
    }
  }
  if (!errors.length) {
    const checked = checkCrossLinks(loaded);
    errors.push(...checked.errors);
    warnings.push(...checked.warnings);
  }
  if (errors.length) throw new Error(`The workspace "${path}" is not valid:\n  ${errors.join('\n  ')}`);
  return { data: { title, graphs: loaded, ...(views ? { views: loadedViews } : {}) }, warnings, sources, files, embeddings: search?.embeddings };
}
