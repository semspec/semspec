// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// A tagged list is a list of objects. Each object has exactly 1 key, the tag. The value of the tag
// is an object of inner keys, or nothing.

import { safeHttpUrl } from './external-links.js';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const compact = (v: unknown): string => {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

const show = (v: unknown): string => (typeof v === 'string' ? v : compact(v));

// A node that a text names. `graph` is the id of the graph that holds the node.
export interface TaggedNode {
  graph: string;
  id: string;
  title: string;
}

// 1 line of an entry. `text` is the whole line as plain text. `href` is an http or https address.
// `node` is the node that the value names: `value` is its title and the line shows it as a link.
export interface TaggedLine {
  label: string;
  value: string;
  text: string;
  href?: string;
  node?: TaggedNode;
}

export interface TaggedOptions {
  // The inner key whose value is a URL. It links the line of its entry and gives no line.
  linkKey?: string;
  // Finds the node that has an id. A tag with a text value uses it.
  resolve?: (id: string) => TaggedNode | undefined;
}

const line = (label: string, value: string, sep: string, href?: string): TaggedLine => {
  const l: TaggedLine = { label, value, text: value === '' ? label : `${label}${sep}${value}` };
  if (href) l.href = href;
  return l;
};

// The lines of 1 entry. `labels` maps "<tag>.<key>" and "<tag>" to a label.
// A tag with a text value gives 1 line, and the line links to the node that has the text as its id.
// An inner value that is an object with 1 key is a nested tag. It gives 1 line for the entry.
// Any other shape gives its compact JSON.
export function taggedLines(entry: unknown, labels: Record<string, string> = {}, options: TaggedOptions = {}): TaggedLine[] {
  const raw = (): TaggedLine[] => [line(compact(entry), '', '')];
  if (!isRecord(entry)) return raw();
  const keys = Object.keys(entry);
  if (keys.length !== 1) return raw();
  const tag = keys[0];
  const inner = entry[tag];
  if (inner === null || inner === undefined) return [line(labels[tag] ?? tag, '', '')];
  if (typeof inner === 'string') {
    const label = labels[tag] ?? tag;
    const node = inner === '' ? undefined : options.resolve?.(inner);
    if (!node) return [line(label, inner, ': ')];
    return [{ label, value: node.title, text: `${label}: ${node.title}`, node }];
  }
  if (!isRecord(inner)) return raw();
  const linkKey = options.linkKey;
  const innerKeys = Object.keys(inner);
  if (!innerKeys.length) return [line(labels[tag] ?? tag, '', '')];
  // Splits the link out of an object of inner keys. The link key gives no line when its value is a text.
  const split = (o: Record<string, unknown>) => {
    const link = linkKey !== undefined ? o[linkKey] : undefined;
    const href = typeof link === 'string' ? (safeHttpUrl(link) ?? undefined) : undefined;
    return { href, keys: Object.keys(o).filter((k) => k !== linkKey || typeof link !== 'string') };
  };
  if (innerKeys.length === 1 && isRecord(inner[innerKeys[0]])) {
    const nestedTag = innerKeys[0];
    const nested = inner[nestedTag] as Record<string, unknown>;
    const { href, keys } = split(nested);
    return [line(labels[`${tag}.${nestedTag}`] ?? `${tag} ${nestedTag}`, keys.map((k) => show(nested[k])).join(' '), ' ', href)];
  }
  const own = split(inner);
  if (!own.keys.length) return [line(labels[tag] ?? tag, '', '', own.href)];
  return own.keys.map((key) => line(labels[`${tag}.${key}`] ?? `${tag} ${key}`, show(inner[key]), ': ', own.href));
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
