// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Reads the inputs of the MCP server. A single graph is a workspace with 1 graph, which has the id "graph".
import { dirname, resolve } from 'node:path';
import { buildModel } from '@semspec/core';
import type { Loaded, Loader } from '@semspec/mcp';
import { embeddingTarget, semanticSourceOf, type EmbeddingTarget } from './embeddings';
import { loadInputs } from './inputs';
import { loadWorkspace } from './workspace';

export const SINGLE_GRAPH_ID = 'graph';

// The inputs and the embedding setting of each graph that has one. The index files are not read.
export interface LoadedWithTargets extends Omit<Loaded, 'graphs'> {
  graphs: (Loaded['graphs'][number])[];
  targets: Map<string, EmbeddingTarget>;
}

// Reads and checks all inputs. It throws on an error.
export function loadWithTargets(flags: Record<string, string>, exclude: string[] = []): LoadedWithTargets {
  const targets = new Map<string, EmbeddingTarget>();
  if (flags.workspace !== undefined) {
    const path = flags.workspace;
    const { data, warnings, sources, embeddings } = loadWorkspace(path);
    const dir = dirname(resolve(path));
    const graphs = data.graphs.map((g) => {
      const s = sources.get(g.id)!;
      const target = embeddingTarget({ graphId: g.id, graphPath: s.graphPath, profile: s.profile, profileDir: dirname(s.profilePath), workspace: { embeddings, dir, graphs: data.graphs.length } });
      if (target) targets.set(g.id, target);
      return { id: g.id, label: g.label, model: g.model, graph: s.graph, profile: s.profile };
    });
    return { title: data.title, warnings, graphs, targets };
  }
  const { graph, profile, warnings } = loadInputs(flags.graph, flags.profile, exclude);
  const target = embeddingTarget({ graphId: SINGLE_GRAPH_ID, graphPath: resolve(flags.graph), profile, profileDir: dirname(resolve(flags.profile)) });
  if (target) targets.set(SINGLE_GRAPH_ID, target);
  return { title: profile.project, warnings, graphs: [{ id: SINGLE_GRAPH_ID, label: profile.project, graph, profile, model: buildModel(graph, profile) }], targets };
}

// Returns a function that reads and checks all inputs. It throws on an error.
// A graph with an embedding setting also gets the source for the meaning search, with its index file.
export function mcpLoader(flags: Record<string, string>, exclude: string[] = []): Loader {
  return () => {
    const { targets, ...loaded } = loadWithTargets(flags, exclude);
    return { ...loaded, graphs: loaded.graphs.map((g) => (targets.has(g.id) ? { ...g, embedding: semanticSourceOf(targets.get(g.id)!) } : g)) };
  };
}
