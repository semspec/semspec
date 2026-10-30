// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// A tagged list is a list of objects. Each object has exactly 1 key, the tag. The value of the tag
// is an object of inner keys, or nothing.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const compact = (v: unknown): string => {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

const show = (v: unknown): string => (typeof v === 'string' ? v : compact(v));

// The lines of 1 entry. `labels` maps "<tag>.<key>" and "<tag>" to a label.
// An entry that is not an object with exactly 1 key gives its compact JSON.
export function taggedLines(entry: unknown, labels: Record<string, string> = {}): string[] {
  if (!isRecord(entry)) return [compact(entry)];
  const keys = Object.keys(entry);
  if (keys.length !== 1) return [compact(entry)];
  const tag = keys[0];
  const inner = entry[tag];
  if (inner === null || inner === undefined) return [labels[tag] ?? tag];
  if (!isRecord(inner)) return [compact(entry)];
  const innerKeys = Object.keys(inner);
  if (!innerKeys.length) return [labels[tag] ?? tag];
  return innerKeys.map((key) => `${labels[`${tag}.${key}`] ?? `${tag} ${key}`}: ${show(inner[key])}`);
}

// The tags of a list: the keys of its objects, each once, in order of first use.
// A list entry that is not an object adds no tag.
export function taggedKeys(list: unknown): string[] {
  const keys = new Set<string>();
  if (Array.isArray(list)) list.forEach((e) => isRecord(e) && Object.keys(e).forEach((k) => keys.add(k)));
  return Array.from(keys);
}

// The values of a filter field of a node. With `from: "keys"` they are the tags of the list.
// A value that is not a list, a string or a number gives no value.
export function filterValues(value: unknown, from?: 'keys'): string[] {
  if (from === 'keys') return taggedKeys(value);
  if (Array.isArray(value)) return value.map(String);
  return value === undefined || value === null || value === '' ? [] : [String(value)];
}
