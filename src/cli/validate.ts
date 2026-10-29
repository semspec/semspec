// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Checks the 2 inputs. A profile is checked against its JSON Schema. A graph is checked against
// the names that the profile gives.
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { embeddedObjects, getPath, parentFields, withDefaultKind, type Graph, type Profile } from '../core/index';

const schemaPath = new URL('../../schema/profile.schema.json', import.meta.url);

export function validateProfile(profile: unknown, schema: object = JSON.parse(readFileSync(schemaPath, 'utf8'))): string[] {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (validate(profile)) return crossCheckProfile(profile as Profile);
  return (validate.errors ?? []).map((e) => `profile${e.instancePath} ${e.message}`);
}

// A profile must name kinds that it defines.
function crossCheckProfile(p: Profile): string[] {
  const errors: string[] = [];
  const kinds = new Set(p.kinds.map((k) => k.id));
  const need = (where: string, id: string | undefined) => id !== undefined && !kinds.has(id) && errors.push(`profile ${where} names the unknown kind "${id}"`);
  p.kinds.forEach((k) => need(`kind ${k.id} placedUnder`, k.placedUnder));
  p.parts?.forEach((x) => {
    need(`part ${x.field} kind`, x.kind);
    need(`part ${x.field} owner`, x.owner);
  });
  p.embedded?.forEach((x) => {
    need(`embedded ${x.field} kind`, x.kind);
    need(`embedded ${x.field} owner`, x.owner);
  });
  need('source defaultKind', p.source.defaultKind);
  need('checks kind', p.checks?.kind);
  need('facets groupKind', p.facets?.groupKind);
  need('entry kind', p.entry?.kind);
  need('entry childKind', p.entry?.childKind);
  if (p.status) {
    const tones = p.status.values.map((x) => x.tone).join(',');
    if (tones !== 'good,warn,bad') errors.push(`profile status values have the tones ${tones}. They must have the tones good, warn, bad in this order.`);
  }
  const edges = new Set(Object.keys(p.edges));
  const needEdge = (where: string, e: string | undefined) => e !== undefined && !edges.has(e) && errors.push(`profile ${where} names the edge "${e}", which has no entry in edges`);
  p.kinds.forEach((k) => (k.parents ?? []).forEach((g) => g.forEach((f) => needEdge(`kind ${k.id} parents`, f))));
  p.links?.forEach((f) => needEdge('links', f));
  needEdge('supersededBy', p.supersededBy);
  needEdge('refs', p.refs?.field);
  p.parts?.forEach((x) => needEdge('parts', x.edge));
  p.embedded?.forEach((x) => needEdge('embedded', x.edge));
  needEdge('checks', p.checks?.edge);
  p.embedded?.forEach((x) => {
    const head = x.field.split('.')[0];
    const owner = p.kinds.find((k) => k.id === x.owner);
    const own = `profile embedded entry for kind "${x.owner}"`;
    if (x.edge === x.field || x.edge === head) errors.push(`${own} uses the edge name "${x.edge}", which is also its field. Use a different edge name.`);
    const others = new Set([...(owner ? parentFields(owner) : []), ...(p.links ?? [])]);
    others.delete(x.edge);
    if (others.has(head)) errors.push(`${own} uses the field "${x.field}", which is also the link or parent field "${head}" of the kind. Use a different field.`);
    if (p.links?.includes(x.edge)) errors.push(`${own} uses the edge name "${x.edge}", which is also a link field. Use a different edge name.`);
  });
  return errors;
}

// Returns the errors, and the warnings. A warning does not stop the build.
// `labels` names the source of each node, for example its file. A message then uses the label.
export function validateGraph(graph: Graph, profile: Profile, labels?: string[]): { errors: string[]; warnings: string[] } {
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
      else v.forEach((t) => !ids.has(String(t)) && missing++);
    });
  });
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
  if (missing) warnings.push(`${missing} link(s) name a node that is not in the graph. The explorer skips them.`);
  return { errors, warnings };
}
