// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Helpers that read a profile. The core knows no kind and no field. It asks the profile.
import type { CheckSpec, KindSpec, Profile, Role } from './types';

// A profile without checks gets a check definition that no node uses.
const NO_CHECKS: CheckSpec = { kind: '__no_check_kind', field: '__no_check_field', edge: '__no_check_edge', typeField: 'type', types: {} };

// Fills the optional parts of a profile, so the rest of the core reads no missing value.
export function normalise(p: Profile): Profile {
  return {
    ...p,
    links: p.links ?? [],
    parts: p.parts ?? [],
    checks: p.checks ?? NO_CHECKS,
    linkedScopeEdges: p.linkedScopeEdges ?? [],
    lifecycle: { ...p.lifecycle, byKind: p.lifecycle.byKind ?? {}, states: p.lifecycle.states ?? {} },
    fields: { ...p.fields, title: p.fields.title ?? [], statement: p.fields.statement ?? [] },
  };
}

export const kindOf = (p: Profile, id: string): KindSpec | undefined => p.kinds.find((k) => k.id === id);
export const kindLabel = (p: Profile, id: string) => kindOf(p, id)?.label ?? id;
export const kindPlural = (p: Profile, id: string) => kindOf(p, id)?.plural ?? id;
export const kindsWithRole = (p: Profile, ...roles: Role[]) => p.kinds.filter((k) => roles.includes(k.role)).map((k) => k.id);
// The kinds that the tree and the scope follow: the hierarchy and its parts.
export const treeKinds = (p: Profile) => kindsWithRole(p, 'hierarchy', 'part');
export const linkedKinds = (p: Profile) => kindsWithRole(p, 'linked');

export function parentFields(k: KindSpec): string[] {
  const out: string[] = [];
  (k.parents ?? []).forEach((group) => group.forEach((f) => !out.includes(f) && out.push(f)));
  return out;
}

// Every field that names another node, as an edge.
export function allLinkFields(p: Profile): string[] {
  const out: string[] = [];
  p.kinds.forEach((k) => parentFields(k).forEach((f) => !out.includes(f) && out.push(f)));
  (p.links ?? []).forEach((f) => !out.includes(f) && out.push(f));
  return out;
}

export function edgeLabel(p: Profile, kind: string, dir: 0 | 1): string {
  return p.edges[kind]?.labels[dir] ?? kind;
}

export function downEdges(p: Profile): Set<string> {
  return new Set(Object.keys(p.edges).filter((k) => p.edges[k].down));
}

export const isMuted = (p: Profile, lifecycle: string) => !!p.lifecycle.states?.[lifecycle]?.muted;

// Reads a field by a dotted path, for example "source.title".
export function getPath(obj: unknown, path: string): unknown {
  let cur: any = obj;
  for (const part of path.split('.')) {
    if (cur === undefined || cur === null) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function firstOf(obj: unknown, fields: string[]): string {
  for (const f of fields) {
    const v = getPath(obj, f);
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return '';
}
