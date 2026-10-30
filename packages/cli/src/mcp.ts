// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Reads the inputs of the MCP server. A single graph is a workspace with 1 graph, which has the id "graph".
import { buildModel } from '@semspec/core';
import type { Loader } from '@semspec/mcp';
import { loadInputs } from './inputs';
import { loadWorkspace } from './workspace';

export const SINGLE_GRAPH_ID = 'graph';

// Returns a function that reads and checks all inputs. It throws on an error.
export function mcpLoader(flags: Record<string, string>, exclude: string[] = []): Loader {
  if (flags.workspace !== undefined) {
    const path = flags.workspace;
    return () => {
      const { data, warnings, sources } = loadWorkspace(path);
      return { title: data.title, warnings, graphs: data.graphs.map((g) => ({ id: g.id, label: g.label, model: g.model, ...sources.get(g.id)! })) };
    };
  }
  return () => {
    const { graph, profile, warnings } = loadInputs(flags.graph, flags.profile, exclude);
    return { title: profile.project, warnings, graphs: [{ id: SINGLE_GRAPH_ID, label: profile.project, graph, profile, model: buildModel(graph, profile) }] };
  };
}
