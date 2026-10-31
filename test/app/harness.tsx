// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Helpers of the DOM tests: a model from a fixture, and the app rendered with it.
import { readFileSync } from 'node:fs';
import { act, render } from '@testing-library/react';
import { buildModel, type Graph, type ProfileInput, type WorkspaceData } from '@semspec/core';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { setPhone } from './setup';

export function fixtureModel(name: string, edit?: (profile: any, graph: any) => void) {
  const dir = `${process.cwd()}/fixtures/${name}/`;
  const profile = JSON.parse(readFileSync(`${dir}profile.json`, 'utf8'));
  const graph = JSON.parse(readFileSync(`${dir}graph.json`, 'utf8'));
  edit?.(profile, graph);
  return buildModel(graph as Graph, profile as ProfileInput);
}

export function workspaceOf(name: string, edit?: (profile: any, graph: any) => void): WorkspaceData {
  const model = fixtureModel(name, edit);
  return { title: name, graphs: [{ id: name, label: model.profile.project, model }] };
}

// Renders the app. `phone` sets the phone breakpoint before the first render.
export function renderApp(name = 'product', options: { phone?: boolean; edit?: (profile: any, graph: any) => void } = {}) {
  setPhone(!!options.phone);
  return render(<App data={workspaceOf(name, options.edit)} />);
}

// The wait that lets React Flow measure its nodes and draw its edges.
export const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 120))));

export const flowNode = (id: string) => document.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement;

// The edge between 2 nodes, by its label.
export const flowEdge = (from: string, to: string) =>
  [...document.querySelectorAll('.react-flow__edge')].find((e) => e.getAttribute('aria-label') === `Edge from ${from} to ${to}`) as HTMLElement;

// Picks a node as the scope with its row in the tree.
export async function pickInTree(id: string) {
  const user = userEvent.setup();
  const find = () => document.querySelector(`[data-testid="tree-panel"] [data-node="${id}"]`) as HTMLElement | null;
  // A collapsed node hides its children. Open the nodes from the top until the row shows.
  for (let i = 0; i < 6 && !find(); i++) {
    const toggle = document.querySelector('[data-testid="tree-panel"] [role="treeitem"] button[aria-label^="Expand "]:not(.invisible)') as HTMLElement | null;
    if (!toggle) break;
    await user.click(toggle);
  }
  const row = find()!;
  await user.click(row.querySelector('button:not([tabindex="-1"])')!);
  await settle();
}
