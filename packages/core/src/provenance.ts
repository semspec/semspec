// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Provenance: where a fact comes from. A node and an edge can carry the same parts. The shape follows W3C PROV-O.
//   The node or the edge   is a prov:Entity.
//   source                 prov:wasDerivedFrom. The source is a node of the kind `source.kind`, or free text.
//   retrieved              prov:generatedAtTime.
//   agent                  prov:wasAttributedTo.
//   marker                 the rdf:type of the prov:Activity that generated the entity (prov:wasGeneratedBy).
//                          The code of the vocabulary names the type of activity, for example "read in a source".
//   note                   rdfs:comment.
// A part is a field of the node, or a property of the edge. The profile names the field.
import { isIsoDate } from './edges.js';
import { getPath, kindOf } from './profile.js';
import { codeProblem, conceptOf } from './vocabulary.js';
import type { Index, Profile, ProvenanceSpec } from './types.js';

export const DEFAULT_DERIVED_EDGE = 'derivedFrom';
export const DEFAULT_DERIVED_LABELS: [string, string] = ['Derived from', 'Source of'];

// The name of the edge from a node to its source node.
export const derivedEdgeName = (spec: ProvenanceSpec): string => spec.source?.edge ?? DEFAULT_DERIVED_EDGE;

// The values of the parts of one node or one edge. A part that the profile does not name, or that
// the record lacks, is undefined. A value that is not text is kept as it is.
export interface ProvenanceValues {
  marker?: unknown;
  source?: unknown;
  retrieved?: unknown;
  agent?: unknown;
  note?: unknown;
}

const present = (v: unknown) => v !== undefined && v !== null && v !== '';

export function provenanceOf(spec: ProvenanceSpec | undefined, record: Record<string, unknown> | undefined): ProvenanceValues {
  const out: ProvenanceValues = {};
  if (!spec || !record) return out;
  const names: Record<keyof ProvenanceValues, string | undefined> = { marker: spec.marker?.field, source: spec.source?.field, retrieved: spec.retrieved, agent: spec.agent, note: spec.note };
  for (const [part, field] of Object.entries(names) as [keyof ProvenanceValues, string | undefined][]) {
    const v = field === undefined ? undefined : getPath(record, field);
    if (present(v)) out[part] = v;
  }
  return out;
}

// The fields that the profile names for provenance.
export function provenanceFields(spec: ProvenanceSpec | undefined): string[] {
  if (!spec) return [];
  return [spec.marker?.field, spec.source?.field, spec.retrieved, spec.agent, spec.note].filter((f): f is string => f !== undefined);
}

// The marker value of a record, or '' when it has none or the value is not text.
export function markerOf(spec: ProvenanceSpec | undefined, record: Record<string, unknown> | undefined): string {
  const v = provenanceOf(spec, record).marker;
  return typeof v === 'string' ? v : '';
}

// A date is in the future when it is after the same part of today. `today` is YYYY-MM-DD.
export const isFutureDate = (value: string, today: string): boolean => value > today.slice(0, value.length);

export const todayIso = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

// The problems of the provenance parts of one node or one edge. Each text starts with `has`.
// `kinds` maps a node id to its kind. `today` is the date of the run, YYYY-MM-DD.
export function provenanceProblems(p: Profile, record: Record<string, unknown> | undefined, kinds: Map<string, string>, today: string = todayIso()): string[] {
  const spec = p.provenance;
  if (!spec) return [];
  const out: string[] = [];
  const v = provenanceOf(spec, record);
  const scheme = spec.marker ? p.vocabularies?.[spec.marker.vocabulary] : undefined;
  if (spec.marker && v.marker !== undefined) {
    if (typeof v.marker !== 'string') out.push(`has the marker field "${spec.marker.field}" with the value ${JSON.stringify(v.marker)}, which is not text`);
    else if (scheme && Array.isArray(scheme.concepts)) {
      const problem = codeProblem(spec.marker.vocabulary, scheme, v.marker);
      if (problem) out.push(`has the marker field "${spec.marker.field}" with ${problem}`);
    }
  }
  if (spec.retrieved !== undefined && v.retrieved !== undefined) {
    if (!isIsoDate(v.retrieved)) out.push(`has the field "${spec.retrieved}" with the value ${JSON.stringify(v.retrieved)}, which is not an ISO date (YYYY, YYYY-MM or YYYY-MM-DD)`);
    else if (isFutureDate(v.retrieved as string, today)) out.push(`has the field "${spec.retrieved}" with the date ${v.retrieved}, which is after today (${today})`);
  }
  if (spec.source && v.source !== undefined) {
    if (typeof v.source !== 'string') out.push(`has the source field "${spec.source.field}" with the value ${JSON.stringify(v.source)}, which is not text`);
    else if (spec.source.kind !== undefined) {
      const kind = kinds.get(v.source);
      if (kind === undefined) out.push(`has the source "${v.source}", which is not a node of the graph. It must be a node of the kind "${spec.source.kind}".`);
      else if (kind !== spec.source.kind) out.push(`has the source "${v.source}", which is a node of the kind "${kind}". It must be a node of the kind "${spec.source.kind}".`);
    }
  }
  for (const part of ['agent', 'note'] as const) {
    const field = spec[part];
    if (field !== undefined && v[part] !== undefined && typeof v[part] !== 'string') out.push(`has the field "${field}" with the value ${JSON.stringify(v[part])}, which is not text`);
  }
  const marker = typeof v.marker === 'string' ? v.marker : undefined;
  if (marker !== undefined && spec.requireSource?.includes(marker) && v.source === undefined) {
    out.push(`has the marker "${marker}", which needs a source in "${spec.source?.field ?? 'the source field'}"`);
  }
  return out;
}

// The problems of the provenance part of a profile.
export function profileProvenanceProblems(p: Profile): string[] {
  const spec = p.provenance;
  if (!spec) return [];
  const out: string[] = [];
  const parts = provenanceFields(spec);
  parts.forEach((f, i) => parts.indexOf(f) !== i && out.push(`profile provenance uses the field "${f}" for 2 parts. Use a different field for each part.`));
  if (spec.marker) {
    const scheme = p.vocabularies?.[spec.marker.vocabulary];
    if (!scheme) out.push(`profile provenance marker names the vocabulary "${spec.marker.vocabulary}", which has no entry in vocabularies`);
    else if (Array.isArray(scheme.concepts)) {
      for (const code of spec.requireSource ?? []) if (!conceptOf(scheme, code)) out.push(`profile provenance requireSource names the code "${code}", which is not a code of the vocabulary "${spec.marker.vocabulary}"`);
    }
  } else if (spec.requireSource?.length) out.push('profile provenance requireSource needs a marker');
  if (spec.requireSource?.length && !spec.source) out.push('profile provenance requireSource needs a source');
  if (spec.source?.kind !== undefined && !kindOf(p, spec.source.kind)) out.push(`profile provenance source names the unknown kind "${spec.source.kind}"`);
  if (spec.source?.edge !== undefined && spec.source.kind === undefined) out.push('profile provenance source has an edge and no kind. The edge exists only when the source is a node.');
  return out;
}

// The nodes that need a source, and the ones among them that have none. A node needs a source when
// its kind is not the source kind and its role is hierarchy or linked. A part and a check do not.
export function sourceCheck(index: Index, ids: Iterable<string>): { missing: string[]; total: number } | null {
  const spec = index.profile.provenance;
  if (!spec?.source) return null;
  const missing: string[] = [];
  let total = 0;
  for (const id of ids) {
    const n = index.byId.get(id);
    if (!n || n.kind === spec.source.kind) continue;
    const role = kindOf(index.profile, n.kind)?.role;
    if (role !== 'hierarchy' && role !== 'linked') continue;
    total++;
    if (!present(getPath(n.d, spec.source.field))) missing.push(id);
  }
  return { missing, total };
}

// The count of nodes that need a source, and how many of them have none.
export function missingSource(index: Index, ids: Iterable<string>): { missing: number; total: number } | null {
  const found = sourceCheck(index, ids);
  return found && { missing: found.missing.length, total: found.total };
}

// The label of the marker facet: the label of the profile, or the default.
export const provenanceLabel = (p: Pick<Profile, 'provenance'>): string => p.provenance?.label ?? 'Provenance';
