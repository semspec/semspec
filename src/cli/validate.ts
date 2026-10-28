// SPDX-License-Identifier: Apache-2.0
// Checks the 2 inputs. A profile is checked against its JSON Schema. A graph is checked against
// the names that the profile gives.
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import type { Graph, Profile } from '../core/index';

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
  need('checks kind', p.checks?.kind);
  need('facets groupKind', p.facets?.groupKind);
  need('entry kind', p.entry?.kind);
  need('entry childKind', p.entry?.childKind);
  const edges = new Set(Object.keys(p.edges));
  const needEdge = (where: string, e: string | undefined) => e !== undefined && !edges.has(e) && errors.push(`profile ${where} names the edge "${e}", which has no entry in edges`);
  p.kinds.forEach((k) => (k.parents ?? []).forEach((g) => g.forEach((f) => needEdge(`kind ${k.id} parents`, f))));
  p.links?.forEach((f) => needEdge('links', f));
  needEdge('supersededBy', p.supersededBy);
  needEdge('refs', p.refs?.field);
  p.parts?.forEach((x) => needEdge('parts', x.edge));
  needEdge('checks', p.checks?.edge);
  return errors;
}

// Returns the errors, and the warnings. A warning does not stop the build.
export function validateGraph(graph: Graph, profile: Profile): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const list = graph[profile.source.nodes];
  if (!Array.isArray(list)) return { errors: [`The graph has no list "${profile.source.nodes}"`], warnings };
  const kinds = new Set(profile.kinds.map((k) => k.id));
  const ids = new Set<string>();
  list.forEach((n: Record<string, unknown>, i: number) => {
    const id = n[profile.source.id];
    const kind = n[profile.source.kind];
    if (typeof id !== 'string' || !id) errors.push(`Node ${i} has no "${profile.source.id}"`);
    else if (ids.has(id)) errors.push(`The id "${id}" is not unique`);
    else ids.add(id);
    if (typeof kind !== 'string' || !kinds.has(kind)) errors.push(`Node ${String(id ?? i)} has the unknown kind "${String(kind)}"`);
  });
  const fields = new Set<string>();
  profile.kinds.forEach((k) => (k.parents ?? []).forEach((g) => g.forEach((f) => fields.add(f))));
  profile.links?.forEach((f) => fields.add(f));
  let missing = 0;
  list.forEach((n: Record<string, unknown>) => {
    fields.forEach((f) => {
      const v = n[f];
      if (v === undefined) return;
      if (!Array.isArray(v)) errors.push(`Field "${f}" of "${String(n[profile.source.id])}" is not a list`);
      else v.forEach((t) => !ids.has(String(t)) && missing++);
    });
  });
  if (missing) warnings.push(`${missing} link(s) name a node that is not in the graph. The explorer skips them.`);
  return { errors, warnings };
}
