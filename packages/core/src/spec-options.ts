// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The options of a spec marker: the names, the allowed values and the checks that need only a profile.
// A marker option has a raw text value. A list option holds comma separated items.
import type { Profile } from './types.js';

export const SPEC_SHAPES = ['tree', 'list', 'table', 'traceability', 'glossary', 'gaps'] as const;
export type SpecShape = (typeof SPEC_SHAPES)[number];

// The parts of a node that `show` can select.
export const SPEC_SHOW = ['statement', 'fields', 'conditions', 'tests', 'links', 'crosslinks', 'provenance'] as const;
export type SpecShow = (typeof SPEC_SHOW)[number];

export const SPEC_CONDITION_FORMS = ['list', 'table'] as const;
export const SPEC_SORTS = ['model', 'id', 'title', 'kind', 'lifecycle', 'status', 'ids'] as const;

// The column names of the shape table. Any other name is a field of the node.
export const SPEC_TABLE_COLUMNS = ['id', 'title', 'kind', 'lifecycle', 'status', 'statement', 'delivery', 'level', 'parent'] as const;
// The column names of the shape traceability.
export const SPEC_TRACE_COLUMNS = ['requirement', 'id', 'condition', 'key', 'status', 'tests'] as const;

// The options with a list value. The other options have 1 text value.
export const SPEC_LIST_OPTIONS = ['kinds', 'lifecycle', 'status', 'delivery', 'marker', 'ids', 'columns', 'show'] as const;

// The options of a section marker, and of a preset (a preset has no `use`). The field filters of the profile add
// more names. The name `priority` filters by the level field when the profile has no field filter of that name.
export const SPEC_PRESET_OPTIONS = [
  'graph',
  'scope',
  'depth',
  'kinds',
  'lifecycle',
  'status',
  'delivery',
  'marker',
  'ids',
  'shape',
  'columns',
  'show',
  'conditions',
  'sort',
  'empty',
  'level',
  'self',
  'vocabulary',
] as const;
export const SPEC_OPTIONS = ['use', ...SPEC_PRESET_OPTIONS] as const;

// The options of a node marker.
export const SPEC_NODE_OPTIONS = ['id', 'graph', 'show', 'level', 'conditions'] as const;

export type RawOptions = Record<string, string>;

export const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

// The names of the fields that a marker can use as a filter: the field filters of the profile, and `priority` when
// the profile has a level field and no field filter of that name.
export function fieldOptionNames(p: Profile): string[] {
  const names = (p.fieldFilters ?? []).map((f) => f.field);
  if (p.fields.level && !names.includes('priority')) names.push('priority');
  return names;
}

// The option names that a section accepts with this profile.
export function allowedOptionNames(p: Profile | undefined, preset: boolean): string[] {
  const base: string[] = preset ? [...SPEC_PRESET_OPTIONS] : [...SPEC_OPTIONS];
  for (const f of p ? fieldOptionNames(p) : []) if (!base.includes(f)) base.push(f);
  return base;
}

// The text of a preset value. A list becomes comma separated text.
export function presetText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every((x) => typeof x === 'string' || typeof x === 'number')) return value.join(',');
  return undefined;
}

const oneOf = (name: string, value: string, allowed: readonly string[]): string[] => (allowed.includes(value) ? [] : [`The option "${name}" has the value "${value}". The values are: ${allowed.join(', ')}.`]);

const isYes = (v: string) => ['yes', 'true', 'no', 'false'].includes(v.toLowerCase());
export const isTrue = (v: string) => ['yes', 'true'].includes(v.toLowerCase());

// The problems of the option values that need no graph. With a profile, the kinds and the status values are also checked.
export function optionValueProblems(options: RawOptions, profile?: Profile): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(options)) {
    if (name === 'shape') out.push(...oneOf(name, value, SPEC_SHAPES));
    else if (name === 'conditions') out.push(...oneOf(name, value, SPEC_CONDITION_FORMS));
    else if (name === 'sort') out.push(...oneOf(name, value, SPEC_SORTS));
    else if (name === 'show') for (const x of splitList(value)) out.push(...oneOf('show', x, SPEC_SHOW));
    else if (name === 'depth') {
      if (!/^\d+$/.test(value)) out.push(`The option "depth" has the value "${value}". It must be a whole number from 0.`);
    } else if (name === 'level') {
      if (!/^[1-6]$/.test(value)) out.push(`The option "level" has the value "${value}". It must be a whole number from 1 to 6.`);
    } else if (name === 'self') {
      if (!isYes(value)) out.push(`The option "self" has the value "${value}". The values are: yes, no.`);
    } else if (name === 'kinds' && profile) {
      const known = profile.kinds.map((k) => k.id);
      for (const k of splitList(value)) if (!known.includes(k)) out.push(`The option "kinds" names the unknown kind "${k}". The kinds are: ${known.join(', ')}.`);
    } else if (name === 'status' && profile?.status) {
      const known = profile.status.values;
      for (const s of splitList(value)) if (s !== '' && !known.some((v) => v.value === s || v.label.toLowerCase() === s.toLowerCase())) out.push(`The option "status" has the value "${s}". The values are: ${profile.status.values.map((v) => v.value).join(', ')}.`);
    } else if (name === 'status' && profile && !profile.status) out.push('The option "status" needs a status in the profile.');
  }
  return out;
}

// The problems of the `spec` key of a profile.
export function profileSpecProblems(p: Profile): string[] {
  const out: string[] = [];
  const spec = p.spec;
  if (!spec) return out;
  const kinds = new Set(p.kinds.map((k) => k.id));
  for (const k of spec.roots ?? []) if (!kinds.has(k)) out.push(`profile spec roots names the unknown kind "${k}"`);
  const allowed = allowedOptionNames(p, true);
  for (const [name, preset] of Object.entries(spec.presets ?? {})) {
    const where = `profile spec preset "${name}"`;
    const raw: RawOptions = {};
    // A preset with a graph is checked against the profile of that graph when a section uses it.
    const elsewhere = preset.graph !== undefined;
    for (const [option, value] of Object.entries(preset)) {
      if (!allowed.includes(option) && !elsewhere) {
        out.push(`${where} has the unknown option "${option}". The options are: ${allowed.join(', ')}.`);
        continue;
      }
      const text = presetText(value);
      if (text === undefined) out.push(`${where} has the option "${option}" with a value that is not text, a number, a boolean or a list.`);
      else raw[option] = text;
    }
    if (elsewhere) {
      delete raw.kinds;
      delete raw.status;
    }
    out.push(...optionValueProblems(raw, p).map((m) => `${where}: ${m}`));
  }
  return out;
}
