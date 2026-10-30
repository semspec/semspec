// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Checks a graph against the names that the profile gives.
import { buildModel } from './model.js';
import { embeddedObjects, getPath, withDefaultKind } from './profile.js';
import { endProblems, linkTargetKey, propertyProblems, readLinkItem } from './edges.js';
import { nodeCodeProblems } from './vocabulary.js';
import { provenanceFields, provenanceProblems } from './provenance.js';
import type { Graph, Profile } from './types.js';

// Returns the errors, and the warnings. A warning does not stop the build.
// `labels` names the source of each node, for example its file. A message then uses the label.
export function validateGraph(graph: Graph, profile: Profile, labels?: string[], today?: string): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rawList = graph[profile.source.nodes];
  if (!Array.isArray(rawList)) return { errors: [`The graph has no list "${profile.source.nodes}"`], warnings };
  const list: Record<string, unknown>[] = withDefaultKind(profile.source, rawList);
  const kinds = new Set(profile.kinds.map((k) => k.id));
  const ids = new Set<string>();
  const label = (i: number, id: unknown) => labels?.[i] ?? `Node ${String(id ?? i)}`;
  list.forEach((n: Record<string, unknown>, i: number) => {
    const id = n[profile.source.id];
    const kind = n[profile.source.kind];
    if (typeof id !== 'string' || !id) errors.push(`${labels?.[i] ?? `Node ${i}`} has no "${profile.source.id}"`);
    else if (ids.has(id)) errors.push(`The id "${id}" is not unique${labels ? ` (${label(i, id)})` : ''}`);
    else ids.add(id);
    if (typeof kind !== 'string' || !kinds.has(kind)) errors.push(`${label(i, id)} has the unknown kind "${String(kind)}"`);
  });
  const fields = new Set<string>();
  profile.kinds.forEach((k) => (k.parents ?? []).forEach((g) => g.forEach((f) => fields.add(f))));
  profile.links?.forEach((f) => fields.add(f));
  let missing = 0;
  list.forEach((n: Record<string, unknown>, i: number) => {
    fields.forEach((f) => {
      const v = n[f];
      if (v === undefined) return;
      if (!Array.isArray(v)) errors.push(`Field "${f}" of "${String(n[profile.source.id])}" is not a list${labels ? ` (${label(i, n[profile.source.id])})` : ''}`);
      else {
        const key = linkTargetKey(profile.edges, f);
        v.forEach((item) => {
          const read = readLinkItem(item, key);
          if (!read) errors.push(`Field "${f}" of "${String(n[profile.source.id])}" holds an item that is not a node id and has no "${key}" key${labels ? ` (${label(i, n[profile.source.id])})` : ''}`);
          else if (!ids.has(read.target)) missing++;
        });
      }
    });
  });
  // A cross link field holds 1 node id or a list of node ids of another graph.
  list.forEach((n: Record<string, unknown>, i: number) => {
    for (const c of profile.crossLinks ?? []) {
      const v = n[c.field];
      if (v === undefined) continue;
      if (typeof v === 'string') continue;
      if (!Array.isArray(v) || v.some((t) => typeof t !== 'string')) errors.push(`Cross link field "${c.field}" of "${String(n[profile.source.id])}" is not an id or a list of ids${labels ? ` (${label(i, n[profile.source.id])})` : ''}`);
    }
  });
  // A field with a vocabulary holds codes of the scheme.
  list.forEach((n, i) => nodeCodeProblems(profile, n).forEach((m) => errors.push(`${label(i, n[profile.source.id])} ${m}`)));
  // 2 objects with the same id must hold the same fields. The model keeps the first one.
  for (const e of profile.embedded ?? []) {
    const nodes = list as Record<string, any>[];
    // An object needs the id key. A string or a number is the id.
    nodes.forEach((n, i) => {
      const value = getPath(n, e.field);
      if (n[profile.source.kind] !== e.owner || !value || typeof value !== 'object' || Array.isArray(value)) return;
      const raw = e.id ? (value as Record<string, unknown>)[e.id] : undefined;
      if (raw !== undefined && raw !== null && raw !== '') return;
      const reason = e.id ? `has no "${e.id}" key` : 'has no "id" key in its profile entry';
      errors.push(`${label(i, n[profile.source.id])} holds an object in "${e.field}" that ${reason}, so the explorer makes no ${e.kind} from it`);
    });
    for (const { id, object, owners } of embeddedObjects(e, nodes, profile.source.id, profile.source.kind)) {
      for (const other of owners.slice(1)) {
        const found = getPath(nodes.find((n) => n[profile.source.id] === other), e.field);
        const second = (found && typeof found === 'object' ? found : {}) as Record<string, unknown>;
        const same = (v: unknown) => (v === undefined || v === null ? '' : JSON.stringify(v));
        for (const key of new Set([...Object.keys(object), ...Object.keys(second)])) {
          if (same(object[key]) !== same(second[key])) warnings.push(`"${owners[0]}" and "${other}" both hold the ${e.kind} "${id}" in "${e.field}", but the field "${key}" differs. The explorer keeps the value of "${owners[0]}".`);
        }
      }
    }
  }
  // The constraints of the edge names. The model needs a graph with no error in its structure.
  if (!errors.length) {
    const model = buildModel(graph, profile);
    const kindOfNode = new Map(model.nodes.map((x) => [x.id, x.kind]));
    const where = (id: string) => {
      const i = list.findIndex((x) => x[profile.source.id] === id);
      return i >= 0 ? label(i, id) : `Node ${id}`;
    };
    // The provenance of a node of the graph. A source must be a node of the kind that the profile names.
    list.forEach((n, i) => provenanceProblems(profile, n, kindOfNode, today).forEach((m) => errors.push(`${label(i, n[profile.source.id])} ${m}`)));
    const exempt = provenanceFields(profile.provenance);
    for (const e of model.edges) {
      const spec = profile.edges[e.k];
      const head = `${where(e.s)}, edge "${e.k}" to "${e.t}"`;
      endProblems(spec, kindOfNode.get(e.s), kindOfNode.get(e.t)).forEach((m) => errors.push(`${head} ${m}`));
      provenanceProblems(profile, e.p, kindOfNode, today).forEach((m) => errors.push(`${head} ${m}`));
      const found = propertyProblems(spec, e.p, profile.vocabularies, exempt);
      found.errors.forEach((m) => errors.push(`${head} ${m}`));
      found.warnings.forEach((m) => warnings.push(`${head} ${m}`));
    }
  }
  if (missing) warnings.push(`${missing} link(s) name a node that is not in the graph. The explorer skips them.`);
  return { errors, warnings };
}
