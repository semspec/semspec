// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The gates of the check command: the gaps of a graph that its profile marks as failing.
import { gapLists, type GraphIndex } from './agent.js';
import type { GateKind } from './types.js';

export interface GateFinding {
  gate: GateKind;
  graph: string;
  node: string;
  message: string;
}

// Returns 1 finding for each gap whose kind the profile of the graph lists in `gates.fail`.
// A graph with no `gates` has no finding.
export function gateFindings(graphs: GraphIndex[]): GateFinding[] {
  const found: GateFinding[] = [];
  for (const g of graphs) {
    const fail = new Set(g.index.profile.gates?.fail ?? []);
    if (!fail.size) continue;
    const lists = gapLists(graphs, g, new Set(g.index.model.nodes.map((n) => n.id)));
    const add = (gate: GateKind, node: string, message: string) => fail.has(gate) && found.push({ gate, graph: g.id, node, message });
    lists.status.filter((n) => n.tone === 'bad').forEach((n) => add('bad-status', n.id, `The status is "${n.status}", which has the tone bad.`));
    lists.uncheckedParts.forEach((n) => add('no-check', n.id, `The ${n.kind} "${n.title}" has no check.`));
    lists.withoutSource.forEach((n) => add('no-source', n.id, `The ${n.kind} "${n.title}" has no source.`));
    lists.unplaced.forEach((n) => add('unplaced', n.id, `The ${n.kind} "${n.title}" is not placed in the hierarchy.`));
    lists.unresolvedLinks.forEach((u) => add('unresolved-link', u.from, `The edge "${u.edge}" names the node "${u.to}", which is not in the graph.`));
    lists.brokenCrossLinks.forEach((c) => add('broken-cross-link', c.from, `The cross link "${c.field}" names the node "${c.to}", which is not in the graph "${c.graph}".`));
    lists.missingDeliverables.forEach((d) => add('missing-deliverable', d.node, d.message));
  }
  return found;
}
