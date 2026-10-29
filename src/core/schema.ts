// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Derives 1 JSON Schema (draft 2020-12) for each kind from the profile. The schema holds only what
// the profile knows. It allows any other field, because a profile does not name every field.
import type { Profile } from './types';

export type JsonSchema = Record<string, unknown>;

const text: JsonSchema = { type: 'string' };
const list: JsonSchema = { type: 'array', items: { type: 'string' } };

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

export function kindSchemas(profile: Profile): Record<string, JsonSchema> {
  const { id: idKey, kind: kindKey } = profile.source;
  const result: Record<string, JsonSchema> = {};
  for (const kind of profile.kinds) {
    const properties: Record<string, JsonSchema> = {
      [idKey]: kind.prefix ? { type: 'string', pattern: `^${escapeRegex(kind.prefix)}` } : text,
      [kindKey]: { const: kind.id },
    };
    [...profile.fields.title, ...profile.fields.statement, profile.lifecycle.field].forEach((f) => (properties[f] = text));
    (kind.parents ?? []).forEach((group) => group.forEach((f) => (properties[f] = list)));
    (profile.links ?? []).forEach((f) => (properties[f] = list));
    if (profile.refs) {
      const { field, target, note } = profile.refs;
      properties[field] = { type: 'array', items: { type: 'object', properties: { [target]: text, [note]: text }, required: [target], additionalProperties: true } };
    }
    if (profile.supersededBy) properties[profile.supersededBy] = text;
    (profile.parts ?? []).filter((p) => p.owner === kind.id).forEach((p) => (properties[p.field] = partProperty(profile, p)));
    Object.assign(properties, checkProperties(profile), statusProperties(profile));
    (profile.fieldFilters ?? []).forEach((f) => {
      if (!(f.field in properties)) properties[f.field] = { anyOf: [text, list] };
    });
    result[kind.id] = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: kind.label,
      description: `A node of the kind "${kind.label}".`,
      type: 'object',
      properties,
      required: [idKey, kindKey],
      additionalProperties: true,
    };
  }
  return result;
}
