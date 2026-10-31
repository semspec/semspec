// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The workspace of the page: the graphs, the cross links between them and the jump from a node of
// 1 graph to a node of another.
import { createContext, useContext } from 'react';
import { incomingCrossLinks, type IncomingCrossLink, type WorkspaceGraph } from '@semspec/core';
import type { VNode } from './core';

export interface WorkspaceApi {
  graphs: WorkspaceGraph[];
  activeId: string;
  // Shows another graph with no jump.
  setActive: (id: string) => void;
  // Shows a node of a graph and remembers the graph and the selected node that the user leaves.
  jump: (graph: string, node: string) => void;
  // The label of the graph that Back returns to.
  backLabel?: string;
  back: () => void;
  canBack: boolean;
  // Forgets the stored state of the workspace and starts fresh.
  resetView: () => void;
  // The incoming cross links of a node of the active graph.
  incoming: (node: string) => IncomingCrossLink[];
  // A node of any graph of the workspace.
  nodeOf: (graph: string, node: string) => VNode | undefined;
}

export const WorkspaceContext = createContext<WorkspaceApi | null>(null);

export function useWorkspace(): WorkspaceApi {
  const api = useContext(WorkspaceContext);
  if (!api) throw new Error('No workspace');
  return api;
}

export { incomingCrossLinks };
