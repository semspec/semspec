// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Derives 1 JSON Schema (draft 2020-12) for each kind from the profile. The schema holds only what
// the profile knows. It allows any other field, because a profile does not name every field.
import { normalise } from './profile';
import { DEFAULT_LINK_TARGET } from './edges';
import type { EdgeSpec, Profile, ProfileInput, Vocabulary } from './types';

export type JsonSchema = Record<string, unknown>;

const text: JsonSchema = { type: 'string' };
const list: JsonSchema = { type: 'array', items: { type: 'string' } };

// A date is an ISO date string: YYYY, YYYY-MM or YYYY-MM-DD.
const DATE_PATTERN = '^\\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\\d|3[01]))?)?$';

// The schema of a string that takes its value from a scheme: the codes are the enum, and the
// description lists each code with its label.
function codeSchema(scheme: Vocabulary): JsonSchema {
  return { type: 'string', enum: scheme.concepts.map((c) => c.code), description: `${scheme.label}. ${scheme.concepts.map((c) => `${c.code} = ${c.label}`).join('; ')}` };
}

// The schema of the declared properties of an edge name.
function edgeProperties(profile: Profile, spec: EdgeSpec | undefined): Record<string, JsonSchema> {
  const out: Record<string, JsonSchema> = {};
  for (const [name, d] of Object.entries(spec?.properties ?? {})) {
    const scheme = d.vocabulary === undefined ? undefined : profile.vocabularies?.[d.vocabulary];
    out[name] = scheme ? codeSchema(scheme) : d.type === 'date' ? { type: 'string', pattern: DATE_PATTERN } : { type: d.type };
  }
  return out;
}

const requiredProperties = (spec: EdgeSpec | undefined): string[] => Object.entries(spec?.properties ?? {}).filter(([, d]) => d.required).map(([name]) => name);

// A link field holds node ids, or objects that hold the node id in the target key and the properties of the edge.
function linkProperty(profile: Profile, field: string): JsonSchema {
  const spec = profile.edges[field];
  const target = spec?.target ?? DEFAULT_LINK_TARGET;
  const object: JsonSchema = { type: 'object', properties: { [target]: text, ...edgeProperties(profile, spec) }, required: [target, ...requiredProperties(spec)], additionalProperties: true };
  return { type: 'array', items: { anyOf: [text, object] } };
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The fields of the status. They appear on a node and on a part.
function statusProperties(profile: Profile): Record<string, JsonSchema> {
  const status = profile.status;
  if (!status) return {};
  const props: Record<string, JsonSchema> = { [status.field]: { type: 'string', enum: status.values.map((v) => v.value) } };
  if (status.detail) props[status.detail.field] = list;
  return props;
}

// A check is an object. Its type field is an enum when the profile names the types.
function checkProperties(profile: Profile): Record<string, JsonSchema> {
  const checks = profile.checks;
  if (!checks) return {};
  const type: JsonSchema = checks.types ? { type: 'string', enum: Object.keys(checks.types) } : text;
  return { [checks.field]: { type: 'array', items: { type: 'object', properties: { [checks.typeField]: type }, additionalProperties: true } } };
}

function partProperty(profile: Profile, field: { id: string; text: string }): JsonSchema {
  const properties: Record<string, JsonSchema> = {
    [field.id]: text,
    [field.text]: text,
    ...checkProperties(profile),
    ...statusProperties(profile),
  };
  return { type: 'array', items: { type: 'object', properties, additionalProperties: true } };
}

// The provenance fields: the marker takes the codes of its scheme, and the date is an ISO date.
function provenanceProperties(profile: Profile): Record<string, JsonSchema> {
  const spec = profile.provenance;
  const out: Record<string, JsonSchema> = {};
  if (!spec) return out;
  const scheme = spec.marker ? profile.vocabularies?.[spec.marker.vocabulary] : undefined;
  if (spec.marker) out[spec.marker.field] = scheme ? codeSchema(scheme) : text;
  if (spec.source) out[spec.source.field] = text;
  if (spec.retrieved) out[spec.retrieved] = { type: 'string', pattern: DATE_PATTERN };
  if (spec.agent) out[spec.agent] = text;
  if (spec.note) out[spec.note] = text;
  return out;
}

export function kindSchemas(input: ProfileInput): Record<string, JsonSchema> {
  const profile = normalise(input);
  const { id: idKey, kind: kindKey } = profile.source;
  const result: Record<string, JsonSchema> = {};
  for (const kind of profile.kinds) {
    const properties: Record<string, JsonSchema> = {
      [idKey]: kind.prefix ? { type: 'string', pattern: `^${escapeRegex(kind.prefix)}` } : text,
      [kindKey]: { const: kind.id },
    };
    [...profile.fields.title, ...profile.fields.statement, profile.lifecycle.field].forEach((f) => (properties[f] = text));
    (kind.parents ?? []).forEach((group) => group.forEach((f) => (properties[f] = linkProperty(profile, f))));
    (profile.links ?? []).forEach((f) => (properties[f] = linkProperty(profile, f)));
    for (const { field, target, note, many } of profile.refs!) {
      const item: Record<string, JsonSchema> = { ...edgeProperties(profile, profile.edges[field]), [target]: text, [note]: text };
      if (many) item[many] = { type: 'boolean' };
      properties[field] = { type: 'array', items: { type: 'object', properties: item, required: [target, ...requiredProperties(profile.edges[field])], additionalProperties: true } };
    }
    if (profile.supersededBy) properties[profile.supersededBy] = text;
    (profile.parts ?? []).filter((p) => p.owner === kind.id).forEach((p) => (properties[p.field] = partProperty(profile, p)));
    Object.assign(properties, checkProperties(profile), statusProperties(profile));
    (profile.fieldFilters ?? []).forEach((f) => {
      if (f.field in properties) return;
      properties[f.field] = f.from === 'keys' ? { type: 'array', items: { type: 'object', minProperties: 1 } } : { anyOf: [text, list] };
    });
    // The provenance parts. They apply to a node and to the properties of an edge.
    Object.assign(properties, provenanceProperties(profile));
    // A field with a vocabulary takes the codes of the scheme. A field of a dotted path gets no enum.
    for (const [field, id] of Object.entries(profile.fieldVocabularies ?? {})) {
      const scheme = profile.vocabularies?.[id];
      if (!scheme || field.includes('.')) continue;
      const one = codeSchema(scheme);
      const keys = profile.fieldFilters?.find((f) => f.field === field)?.from === 'keys';
      if (keys) properties[field] = { type: 'array', items: { type: 'object', minProperties: 1, propertyNames: { enum: one.enum }, description: one.description } };
      else properties[field] = field === profile.lifecycle.field ? one : { anyOf: [one, { type: 'array', items: one }] };
    }
    result[kind.id] = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: kind.label,
      description: `A node of the kind "${kind.label}".`,
      type: 'object',
      properties,
      required: kind.id === profile.source.defaultKind ? [idKey] : [idKey, kindKey],
      additionalProperties: true,
    };
  }
  return result;
}
