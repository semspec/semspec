// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Edge properties and edge type constraints. The model is a labelled property graph: an edge has a
// kind, a note and properties. A parallel edge is an edge with the same source, target and kind.
import { codeProblem } from './vocabulary.js';
import type { EdgeSpec, PropertyType, RefsSpec, VEdge, Vocabulary } from './types.js';

export const DEFAULT_LINK_TARGET = 'id';

// The key of the node id in an object of a link field.
export const linkTargetKey = (edges: Record<string, EdgeSpec>, field: string): string => edges[field]?.target ?? DEFAULT_LINK_TARGET;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const withoutKeys = (item: Record<string, unknown>, drop: (string | undefined)[]): Record<string, unknown> | undefined => {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(item)) if (!drop.includes(key) && item[key] !== undefined) out[key] = item[key];
  return Object.keys(out).length ? out : undefined;
};

// One item of a link field: a node id, or an object that holds the node id in the target key. The
// other keys of an object are the properties of the edge. An item of any other shape gives null.
export function readLinkItem(item: unknown, targetKey: string): { target: string; p?: Record<string, unknown> } | null {
  if (typeof item === 'string') return { target: item };
  if (!isObject(item)) return null;
  const target = item[targetKey];
  if (typeof target !== 'string' || !target) return null;
  return { target, p: withoutKeys(item, [targetKey]) };
}

// The properties of the edge of a refs item: every key except the target key, the note key and the many key.
export const refProps = (spec: RefsSpec, item: Record<string, unknown>) => withoutKeys(item, [spec.target, spec.note, spec.many]);

// A key for the equality of 2 property sets. The order of the keys does not matter.
export function propsKey(p: Record<string, unknown> | undefined): string {
  if (!p) return '';
  const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
  return JSON.stringify(sorted(p));
}

// An ISO date string: YYYY, YYYY-MM or YYYY-MM-DD, with a real month and a real day.
export function isIsoDate(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(v);
  if (!m) return false;
  const month = m[2] === undefined ? 1 : Number(m[2]);
  if (month < 1 || month > 12) return false;
  if (m[3] === undefined) return true;
  const day = Number(m[3]);
  return day >= 1 && day <= new Date(Date.UTC(Number(m[1]), month, 0)).getUTCDate();
}

export function hasType(type: PropertyType, v: unknown): boolean {
  if (type === 'string') return typeof v === 'string';
  if (type === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (type === 'boolean') return typeof v === 'boolean';
  return isIsoDate(v);
}

// The problems of the properties of 1 edge against its declaration. An edge name with no `properties`
// declaration has no problem. An undeclared property is a warning. A missing required property and a
// wrong type are errors. A value that is not a code of the vocabulary of its property is an error too.
export function propertyProblems(spec: EdgeSpec | undefined, p: Record<string, unknown> | undefined, vocabularies?: Record<string, Vocabulary>, exempt: string[] = []): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const declared = spec?.properties;
  if (!declared) return { errors, warnings };
  for (const [name, value] of Object.entries(p ?? {})) {
    const d = declared[name];
    if (!d) exempt.includes(name) || warnings.push(`has the property "${name}", which the profile does not declare`);
    else if (!hasType(d.type, value)) errors.push(`has the property "${name}" with the value ${JSON.stringify(value)}, which is not of the type ${d.type}`);
    else if (d.vocabulary !== undefined && Array.isArray(vocabularies?.[d.vocabulary]?.concepts)) {
      const problem = codeProblem(d.vocabulary, vocabularies![d.vocabulary], value);
      if (problem) errors.push(`has the property "${name}" with ${problem}`);
    }
  }
  for (const [name, d] of Object.entries(declared)) if (d.required && (p?.[name] === undefined)) errors.push(`lacks the required property "${name}"`);
  return { errors, warnings };
}

// The problems of the kinds of the 2 ends of an edge against `from` and `to`.
export function endProblems(spec: EdgeSpec | undefined, sourceKind: string | undefined, targetKind: string | undefined): string[] {
  const out: string[] = [];
  if (spec?.from && (sourceKind === undefined || !spec.from.includes(sourceKind))) out.push(`starts at a node of the kind "${sourceKind}", which is not in from (${spec.from.join(', ')})`);
  if (spec?.to && (targetKind === undefined || !spec.to.includes(targetKind))) out.push(`ends at a node of the kind "${targetKind}", which is not in to (${spec.to.join(', ')})`);
  return out;
}

// The properties of an edge as 1 line, for example `since 2024 · share 0.4`.
// `show` gives the text of a value, for example the label of a code.
export function formatEdgeProps(p: VEdge['p'], show?: (key: string, value: unknown) => string): string {
  if (!p) return '';
  return Object.entries(p)
    .map(([k, v]) => `${k} ${show ? show(k, v) : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}
