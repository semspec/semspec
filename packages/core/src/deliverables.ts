// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The deliverables of a kind: what a task on a node must deliver. The profile key `deliverables` states them.
// A finding names 1 missing item. The report, the gaps, the slice and the check command read the same findings.
import { statusOf } from './explore.js';
import { getPath } from './profile.js';
import type { DeliverableKey, Index, Profile, VNode } from './types.js';

export interface DeliverableFinding {
  graph: string;
  node: string;
  kind: string;
  title: string;
  // The key of the profile entry that the node does not meet.
  deliverable: DeliverableKey;
  // The item that is missing: a part id, a field, an edge, a status, or `source` or `marker`.
  item: string;
  message: string;
}

const filled = (v: unknown): boolean => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

// The parts of a node, as the profile defines them.
function partsOf(index: Index, id: string): VNode[] {
  const specs = index.profile.parts ?? [];
  return (index.inc.get(id) ?? [])
    .filter((e) => specs.some((x) => x.edge === e.k && x.kind === index.byId.get(e.s)?.kind))
    .map((e) => index.byId.get(e.s)!);
}

const hasCheck = (index: Index, id: string): boolean => {
  const edge = index.profile.checks?.edge;
  return !!edge && (index.out.get(id) ?? []).some((e) => e.k === edge);
};

// Returns 1 finding for each missing deliverable of the nodes in `ids`. A node of a kind with no entry has no finding.
// `kinds` limits the result to these node kinds.
export function deliverableFindings(index: Index, graph: string, ids: Iterable<string>, kinds?: string[]): DeliverableFinding[] {
  const p = index.profile;
  const specs = p.deliverables;
  if (!specs) return [];
  const found: DeliverableFinding[] = [];
  for (const id of ids) {
    const n = index.byId.get(id);
    const spec = n && specs[n.kind];
    if (!n || !spec || (kinds?.length && !kinds.includes(n.kind))) continue;
    const what = `The ${p.kinds.find((k) => k.id === n.kind)?.label.toLowerCase() ?? n.kind} "${n.title}"`;
    const add = (deliverable: DeliverableKey, item: string, text: string) => found.push({ graph, node: n.id, kind: n.kind, title: n.title, deliverable, item, message: `${what} ${text}` });
    const parts = partsOf(index, n.id);
    if (spec.parts && parts.length < spec.parts.min) add('parts', 'parts', `has ${parts.length} part(s). It needs at least ${spec.parts.min}.`);
    if (spec.checks === 'each-part') for (const part of parts) if (!hasCheck(index, part.id)) add('checks', part.id, `has the part "${part.id}" with no check.`);
    if (spec.checks === 'node' && !hasCheck(index, n.id)) add('checks', n.id, 'has no check.');
    if (spec.status) {
      const own = statusOf(index, n.id);
      if (own.value === null) add('status', 'status', `has no status. It needs one of: ${spec.status.join(', ')}.`);
      else if (!spec.status.includes(own.value) && !spec.status.includes(own.tone ?? '')) add('status', own.value, `has the status "${own.value}". It needs one of: ${spec.status.join(', ')}.`);
    }
    for (const field of spec.fields ?? []) if (!filled(getPath(n.d, field))) add('fields', field, `has no value in the field "${field}".`);
    for (const [name, rule] of Object.entries(spec.links ?? {})) {
      const edges = (rule.direction === 'in' ? index.inc : index.out).get(n.id) ?? [];
      const count = edges.filter((e) => e.k === name).length + (index.crossOut.get(n.id) ?? []).filter((c) => c.field === name).length;
      if (count < rule.min) add('links', name, `has ${count} link(s) of "${name}". It needs at least ${rule.min}.`);
    }
    if (spec.provenance) {
      const prov = p.provenance;
      if (prov?.marker && !filled(getPath(n.d, prov.marker.field))) add('provenance', 'marker', `has no value in the provenance field "${prov.marker.field}".`);
      if (prov?.source && !filled(getPath(n.d, prov.source.field))) add('provenance', 'source', `has no source in the field "${prov.source.field}".`);
    }
  }
  return found;
}

// The problems of the `deliverables` key of a profile. Each entry must name what the profile defines.
export function profileDeliverableProblems(p: Profile): string[] {
  const out: string[] = [];
  const kinds = new Set(p.kinds.map((k) => k.id));
  const crossFields = new Set((p.crossLinks ?? []).map((c) => c.field));
  const edges = new Set(Object.keys(p.edges));
  for (const [kind, spec] of Object.entries(p.deliverables ?? {})) {
    const own = `profile deliverables entry for kind "${kind}"`;
    if (!kinds.has(kind)) out.push(`profile deliverables names the unknown kind "${kind}"`);
    if (spec.parts && !p.parts?.some((x) => x.owner === kind)) out.push(`${own} has "parts", but no entry of the profile key parts has the owner "${kind}"`);
    if (spec.checks && !p.checks) out.push(`${own} has "checks", but the profile has no key checks`);
    if (spec.checks === 'each-part' && !p.parts?.some((x) => x.owner === kind)) out.push(`${own} has "checks": "each-part", but no entry of the profile key parts has the owner "${kind}"`);
    if (spec.status) {
      if (!p.status) out.push(`${own} has "status", but the profile has no key status`);
      else {
        const known = new Set([...p.status.values.map((v) => v.value), ...p.status.values.map((v) => v.tone)]);
        for (const s of spec.status) if (!known.has(s)) out.push(`${own} names the status "${s}", which is not a status value or tone of the profile`);
      }
    }
    for (const name of Object.keys(spec.links ?? {})) if (!edges.has(name) && !crossFields.has(name)) out.push(`${own} names the link "${name}", which is not an edge or a cross link field of the profile`);
    if (spec.provenance && !p.provenance?.marker && !p.provenance?.source) out.push(`${own} has "provenance", but the profile provenance has no marker and no source`);
  }
  return out;
}
