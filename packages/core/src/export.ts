// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Exports a graph, or all graphs of a workspace, as text for other tools.
//   turtle   RDF as Turtle. A workspace gives TriG, with 1 named graph for each workspace graph.
//   jsonld   RDF as JSON-LD. A workspace gives 1 `@graph` for each workspace graph.
//   shacl    SHACL shapes of the profile, or of all profiles of a workspace, as Turtle.
//   cypher   A Cypher script that loads the graph. A workspace adds the property `graph` to each node.
// An edge with properties is a triple with an annotation (RDF 1.2 `{| |}` in Turtle, `@annotation` in JSON-LD).
// `annotations: 'reified'` writes an rdf:Statement node instead, for a reader that knows neither form.
import { cypherScript } from './cypher.js';
import { iriMap } from './iri.js';
import { datasetOf, type GraphInput } from './rdf-export.js';
import { reify, toJsonLd, toTurtle, type RdfDataset } from './rdf.js';
import { shaclDataset } from './shacl.js';
import type { Model } from './types.js';
import type { WorkspaceData } from './workspace.js';

export const EXPORT_FORMATS = ['turtle', 'jsonld', 'shacl', 'cypher'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportOptions {
  annotations?: 'annotation' | 'reified';
}

export const isExportFormat = (v: string): v is ExportFormat => (EXPORT_FORMATS as readonly string[]).includes(v);

const graphName = (id: string) => `urn:semspec:graph:${encodeURIComponent(id)}`;

function write(ds: RdfDataset, format: 'turtle' | 'jsonld' | 'shacl', options: ExportOptions): string {
  const data = options.annotations === 'reified' ? reify(ds) : ds;
  return format === 'jsonld' ? toJsonLd(data) : toTurtle(data);
}

// Exports 1 graph.
export function exportModel(model: Model, format: ExportFormat, options: ExportOptions = {}): string {
  if (format === 'cypher') return cypherScript([{ id: 'graph', model }]);
  if (format === 'shacl') return write(shaclDataset([{ id: 'graph', model }]), format, options);
  return write(datasetOf([{ id: 'graph', model }]), format, options);
}

// Exports all graphs of a workspace into 1 text.
export function exportWorkspace(data: WorkspaceData, format: ExportFormat, options: ExportOptions = {}): string {
  if (format === 'cypher') return cypherScript(data.graphs.map((g) => ({ id: g.id, model: g.model })), true);
  if (format === 'shacl') return write(shaclDataset(data.graphs.map((g) => ({ id: g.id, model: g.model }))), format, options);
  return write(workspaceDataset(data), format, options);
}

// The RDF of a workspace: 1 named graph for each graph. A cross link points at the IRI of its target node.
export function workspaceDataset(data: WorkspaceData): RdfDataset {
  const nodeIris = new Map(data.graphs.map((g) => {
    const I = iriMap(g.model.profile, g.id);
    return [g.id, new Map(g.model.nodes.map((n) => [n.id, I.node(n.id, n.kind, n.d)]))] as const;
  }));
  const inputs: GraphInput[] = data.graphs.map((g) => ({ id: g.id, model: g.model, name: graphName(g.id), resolveCross: (graph, id) => nodeIris.get(graph)?.get(id) }));
  return datasetOf(inputs);
}
