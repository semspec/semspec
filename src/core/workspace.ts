// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// A workspace holds several graphs of 1 system. A node of 1 graph can link to a node of another
// graph. A cross link is not an edge: no graph holds it as an edge.
import type { Model } from './types';

export interface WorkspaceGraph {
  id: string;
  label: string;
  model: Model;
}

// The data of a workspace page.
export interface WorkspaceData {
  title: string;
  graphs: WorkspaceGraph[];
}

// A cross link seen from its target node.
export interface IncomingCrossLink {
  // The id of the graph and of the node that hold the link.
  graph: string;
  s: string;
  field: string;
  // The label of the link in the profile of the source graph.
  label: string;
}

// The incoming cross links by target graph id, then by target node id. A link to a missing graph
// or to a missing node is left out.
export function incomingCrossLinks(graphs: WorkspaceGraph[]): Map<string, Map<string, IncomingCrossLink[]>> {
  const nodeIds = new Map(graphs.map((g) => [g.id, new Set(g.model.nodes.map((n) => n.id))]));
  const result = new Map<string, Map<string, IncomingCrossLink[]>>(graphs.map((g) => [g.id, new Map()]));
  for (const g of graphs) {
    const labels = new Map((g.model.profile.crossLinks ?? []).map((c) => [c.field, c.label]));
    for (const c of g.model.crossLinks) {
      if (!nodeIds.get(c.graph)?.has(c.t)) continue;
      const byNode = result.get(c.graph)!;
      byNode.set(c.t, [...(byNode.get(c.t) ?? []), { graph: g.id, s: c.s, field: c.field, label: labels.get(c.field) ?? c.field }]);
    }
  }
  return result;
}

// Checks the cross links of all graphs. A link to a graph that the workspace does not have is an
// error. A link to a node that the target graph does not have is a warning.
export function checkCrossLinks(graphs: WorkspaceGraph[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeIds = new Map(graphs.map((g) => [g.id, new Set(g.model.nodes.map((n) => n.id))]));
  for (const g of graphs) {
    for (const spec of g.model.profile.crossLinks ?? []) {
      if (!nodeIds.has(spec.graph)) errors.push(`Graph "${g.id}": the cross link "${spec.field}" names the unknown graph "${spec.graph}"`);
    }
    const missing = new Map<string, string[]>();
    for (const c of g.model.crossLinks) {
      if (nodeIds.has(c.graph) && !nodeIds.get(c.graph)!.has(c.t)) {
        missing.set(c.field, [...(missing.get(c.field) ?? []), c.t]);
      }
    }
    for (const [field, ids] of missing) {
      const target = g.model.profile.crossLinks!.find((c) => c.field === field)!.graph;
      const shown = ids.slice(0, 3).map((id) => `"${id}"`).join(', ');
      warnings.push(`Graph "${g.id}": ${ids.length} cross link(s) in "${field}" name a node that is not in the graph "${target}" (${shown}${ids.length > 3 ? ', ...' : ''}). The explorer skips them.`);
    }
  }
  return { errors, warnings };
}
