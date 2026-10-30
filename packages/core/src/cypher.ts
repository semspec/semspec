// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Cypher script that loads a graph into a property graph database.
//   A node        a node with the label of its kind, the properties `id` and `title`, and its fields.
//                 A workspace adds the property `graph`. A list of texts, numbers or booleans stays a list.
//                 Any other list, and an object, becomes a JSON string.
//   An edge       a relationship with the type in upper snake case of the edge name, the properties of the edge
//                 (provenance included) and `note`.
//   A cross link  a relationship of a workspace, with the type in upper snake case of the field.
// Nodes use MERGE, so a second run adds no node. Relationships use CREATE, so run the script once.
// The batches are UNWIND lists. A label and a type cannot change in a batch, so each batch has 1 of each.
import { structuralFields } from './export-fields.js';
import type { Model } from './types.js';

export const BATCH_SIZE = 500;

const quoteName = (name: string): string => `\`${name.replace(/`/g, '``')}\``;

// A name as upper snake case: `inGroup` is `IN_GROUP`.
export function upperSnake(name: string): string {
  const text = name
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1_$2')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return text || 'EDGE';
}

// The text of a string literal. One line, with escapes.
export function cypherString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029 || (c >= 0xd800 && c <= 0xdfff)) out += `\\u${(c >= 0xd800 && c <= 0xdfff ? 0xfffd : c).toString(16).toUpperCase().padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

// A value as a Cypher literal, or undefined when the database cannot store it.
export function cypherValue(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') return cypherString(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : undefined;
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    const types = new Set(v.map((x) => typeof x));
    const flat = v.every((x) => x !== null && ['string', 'number', 'boolean'].includes(typeof x) && (typeof x !== 'number' || Number.isFinite(x)));
    if (v.length === 0 || (flat && types.size === 1)) return `[${v.map((x) => cypherValue(x)).join(', ')}]`;
    return cypherString(JSON.stringify(v));
  }
  return cypherString(JSON.stringify(v));
}

function cypherMap(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    const text = cypherValue(value);
    if (text !== undefined) parts.push(`${quoteName(key)}: ${text}`);
  }
  return `{${parts.join(', ')}}`;
}

export interface CypherGraph {
  id: string;
  model: Model;
}

interface NodeRow {
  graph: string;
  kind: string;
  id: string;
  props: Record<string, unknown>;
}

interface EdgeRow {
  type: string;
  sGraph: string;
  sKind: string;
  s: string;
  tGraph: string;
  tKind: string;
  t: string;
  props: Record<string, unknown>;
}

const chunks = <T>(list: T[]): T[][] => Array.from({ length: Math.ceil(list.length / BATCH_SIZE) }, (_, i) => list.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE));

// The script for a list of graphs. A workspace sets `workspace` and gets a `graph` property on each node.
export function cypherScript(graphs: CypherGraph[], workspace = false): string {
  const nodes: NodeRow[] = [];
  const edges: EdgeRow[] = [];
  const kindOf = new Map<string, Map<string, string>>();
  for (const g of graphs) kindOf.set(g.id, new Map(g.model.nodes.map((n) => [n.id, n.kind])));
  for (const g of graphs) {
    const P = g.model.profile;
    const skip = structuralFields(P);
    for (const n of g.model.nodes) {
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n.d)) if (!skip.has(k)) props[k] = v;
      props.id = n.id;
      props.title = n.title;
      if (workspace) props.graph = g.id;
      nodes.push({ graph: g.id, kind: n.kind, id: n.id, props });
    }
    for (const e of g.model.edges) {
      const props: Record<string, unknown> = { ...(e.p ?? {}) };
      if (e.n && props.note === undefined) props.note = e.n;
      edges.push({ type: upperSnake(e.k), sGraph: g.id, sKind: kindOf.get(g.id)!.get(e.s) ?? '', s: e.s, tGraph: g.id, tKind: kindOf.get(g.id)!.get(e.t) ?? '', t: e.t, props });
    }
    if (workspace) {
      for (const c of g.model.crossLinks) {
        const tKind = kindOf.get(c.graph)?.get(c.t);
        if (tKind === undefined) continue;
        edges.push({ type: upperSnake(c.field), sGraph: g.id, sKind: kindOf.get(g.id)!.get(c.s) ?? '', s: c.s, tGraph: c.graph, tKind, t: c.t, props: {} });
      }
    }
  }
  const lines: string[] = ['// Semspec export for a property graph database (Cypher).', '// Nodes use MERGE. Relationships use CREATE, so run the script once.'];
  const labels = [...new Set(nodes.map((n) => n.kind))];
  for (const label of labels) lines.push(`CREATE INDEX IF NOT EXISTS FOR (n:${quoteName(label)}) ON (n.id);`);
  for (const label of labels) {
    for (const batch of chunks(nodes.filter((n) => n.kind === label))) {
      // A workspace keeps the graph in the key of the node, because 2 graphs can use the same id.
      const grouped = workspace ? [...new Set(batch.map((n) => n.graph))] : [''];
      for (const graph of grouped) {
        const rows = batch.filter((n) => !workspace || n.graph === graph);
        lines.push(`UNWIND [${rows.map((n) => `{id: ${cypherString(n.id)}, props: ${cypherMap(n.props)}}`).join(',\n  ')}] AS row`);
        lines.push(`MERGE (n:${quoteName(label)} {id: row.id${workspace ? `, graph: ${cypherString(graph)}` : ''}})`);
        lines.push('SET n += row.props;');
      }
    }
  }
  const groups = new Map<string, EdgeRow[]>();
  for (const e of edges) {
    const key = JSON.stringify([e.type, e.sGraph, e.sKind, e.tGraph, e.tKind]);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  for (const rows of groups.values()) {
    const first = rows[0];
    for (const batch of chunks(rows)) {
      const end = (kind: string, graph: string, key: string) => `(${key}:${quoteName(kind)} {id: row.${key === 'a' ? 's' : 't'}${workspace ? `, graph: ${cypherString(graph)}` : ''}})`;
      lines.push(`UNWIND [${batch.map((e) => `{s: ${cypherString(e.s)}, t: ${cypherString(e.t)}, props: ${cypherMap(e.props)}}`).join(',\n  ')}] AS row`);
      lines.push(`MATCH ${end(first.sKind, first.sGraph, 'a')}`);
      lines.push(`MATCH ${end(first.tKind, first.tGraph, 'b')}`);
      lines.push(`CREATE (a)-[r:${quoteName(first.type)}]->(b)`);
      lines.push('SET r += row.props;');
    }
  }
  return `${lines.join('\n')}\n`;
}
