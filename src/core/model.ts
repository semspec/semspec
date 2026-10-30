// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Turns a graph and a profile into the model of the page: nodes, edges, tree parents and scope
// parents. 2 parent lists exist on purpose.
//   parents: where the tree shows the node. The first group of parent fields that names a node wins.
//   up:      every parent field of the kind. The scope and the group facet follow this list.
// Edge direction follows the graph: from the specific node to the general node.
// An edge has a kind, an optional note and optional properties. The model keeps parallel edges (the same
// source, target and kind) when their properties differ, and keeps 1 edge when the properties are equal.
import type { CrossLink, Graph, Index, Model, ProfileInput, RawNode, VEdge, VNode } from './types';
import { allLinkFields, embeddedObjects, firstOf, getPath, isMuted, kindOf, normalise, omitPath, refNote, withDefaultKind } from './profile';
import { propsKey, readLinkItem, refProps, linkTargetKey } from './edges';
import { derivedEdgeName } from './provenance';
import { checkKey, checkTitle, citationTitle, deriveTitle, snippet, wordCasing } from './titles';

// The items of a link field. A value that is not a list has none.
const linkList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function buildModel(graph: Graph, input: ProfileInput): Model {
  const P = normalise(input);
  const checks = P.checks!;
  const { id: idKey, kind: kindKey } = P.source;
  const graphNodes = withDefaultKind(P.source, ((graph[P.source.nodes] as RawNode[]) ?? []) as Record<string, any>[]);
  const linkFields = allLinkFields(P);
  const nodes: VNode[] = [];
  const edges: VEdge[] = [];
  const ids = new Set<string>();
  const edgeKeys = new Set<string>();
  const unresolved: Model['unresolved'] = [];
  const byId = new Map<string, VNode>();

  const texts: string[] = [];
  for (const n of graphNodes) {
    for (const f of P.fields.statement) if (n[f]) texts.push(String(n[f]));
    for (const part of P.parts!) for (const a of (n[part.field] as Record<string, any>[]) ?? []) if (a[part.text]) texts.push(String(a[part.text]));
  }
  const casing = wordCasing(texts);

  const addNode = (node: VNode) => {
    if (ids.has(node.id)) return;
    ids.add(node.id);
    nodes.push(node);
    byId.set(node.id, node);
  };
  const addEdge = (s: string, t: string, k: string, note?: string, props?: Record<string, unknown>) => {
    const key = `${s}\u0000${t}\u0000${k}\u0000${propsKey(props)}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ s, t, k, ...(note ? { n: note } : {}), ...(props ? { p: props } : {}) });
  };
  const lifecycleOf = (n: Record<string, any>): string => {
    const v = n[P.lifecycle.field];
    if (v !== undefined) return String(v);
    const by = P.lifecycle.byKind!;
    return Object.prototype.hasOwnProperty.call(by, n[kindKey]) ? by[n[kindKey]] : P.lifecycle.fallback;
  };
  // The status value of a graph item, when it names a value of the profile.
  const statusValue = (item: Record<string, any>): string | undefined => {
    const v = P.status ? item[P.status.field] : undefined;
    return P.status?.values.some((x) => x.value === v) ? String(v) : undefined;
  };
  const blank = { lifecycle: '', delivery: '', level: '', statement: '', parents: [] as string[], up: [] as string[] };

  for (const n of graphNodes) {
    const k = kindOf(P, n[kindKey]);
    let title = firstOf(n, P.fields.title);
    if (!title && k?.citation) title = citationTitle(k, n, casing) ?? '';
    if (!title) title = deriveTitle(n[idKey], casing, P.fields.idPrefixPattern);
    const raw: Record<string, any> = {};
    for (const key of Object.keys(n)) if (key !== idKey && key !== kindKey) raw[key] = n[key];
    for (const part of P.parts!) delete raw[part.field];
    let d = raw;
    for (const e of P.embedded!) if (n[kindKey] === e.owner) d = omitPath(d, e.field);
    addNode({
      id: n[idKey],
      kind: n[kindKey],
      title,
      sub: k?.citation?.subtitle ? String(getPath(n, k.citation.subtitle) ?? '') : '',
      lifecycle: lifecycleOf(n),
      delivery: P.fields.delivery ? String(n[P.fields.delivery] ?? '') : '',
      level: P.fields.level ? String(n[P.fields.level] ?? '') : '',
      statement: firstOf(n, P.fields.statement),
      parents: [],
      up: [],
      d,
      status: statusValue(n),
    });
  }

  // An embedded object, string or number is a node of its own. A node of the graph with the same id wins, and the
  // owner then only gets the edge. The tree and the scope read the edge as a parent field.
  const embeddedParents = new Map<string, Map<string, string[]>>();
  for (const e of P.embedded!) {
    for (const { id, object, owners } of embeddedObjects(e, graphNodes, idKey, kindKey)) {
      const fields = e.id ? (({ [e.id]: _id, ...rest }) => rest)(object) : object;
      addNode({
        id,
        kind: e.kind,
        title: firstOf(object, P.fields.title) || deriveTitle(id, casing, P.fields.idPrefixPattern),
        sub: '',
        lifecycle: lifecycleOf({ ...object, [kindKey]: e.kind }),
        delivery: P.fields.delivery ? String(object[P.fields.delivery] ?? '') : '',
        level: P.fields.level ? String(object[P.fields.level] ?? '') : '',
        statement: firstOf(object, P.fields.statement),
        parents: [],
        up: [],
        d: fields,
        status: statusValue(object),
      });
      for (const owner of owners) {
        addEdge(owner, id, e.edge);
        const byEdge = embeddedParents.get(owner) ?? new Map<string, string[]>();
        byEdge.set(e.edge, [...(byEdge.get(e.edge) ?? []), id]);
        embeddedParents.set(owner, byEdge);
      }
    }
  }

  const addCheck = (v: Record<string, any>, ownerNodeId: string, ownerId: string) => {
    const cid = checkKey(P, v, ownerId);
    if (!ids.has(cid)) addNode({ id: cid, kind: checks.kind, title: checkTitle(P, v, casing), sub: String(v[checks.typeField] ?? ''), ...blank, d: v });
    addEdge(ownerNodeId, cid, checks.edge);
  };

  for (const part of P.parts!) {
    for (const n of graphNodes) {
      if (n[kindKey] !== part.owner) continue;
      const items = (n[part.field] as Record<string, any>[]) ?? [];
      let verified = 0;
      items.forEach((a, i) => {
        const base = a[part.id] as string | undefined;
        let cid = `${n[idKey]}#${base || 'p' + (i + 1)}`;
        if (ids.has(cid)) cid = `${cid}#${i + 1}`;
        const list = (a[checks.field] as Record<string, any>[]) ?? [];
        addNode({
          id: cid,
          kind: part.kind,
          title: base ? deriveTitle(String(base), casing, part.idPrefixPattern) : snippet(a[part.text], 80),
          sub: '',
          ...blank,
          statement: a[part.text] ?? '',
          parents: [n[idKey]],
          up: [n[idKey]],
          d: {
            id: base ?? '',
            text: a[part.text],
            setup: part.setup ? a[part.setup] : undefined,
            scope: part.scope ? a[part.scope] : undefined,
            checks: list,
            ...(P.status ? { [P.status.field]: a[P.status.field] } : {}),
            ...(P.status?.detail ? { [P.status.detail.field]: a[P.status.detail.field] } : {}),
          },
          status: statusValue(a),
        });
        addEdge(cid, n[idKey], part.edge);
        if (list.length) verified++;
        list.forEach((v) => addCheck(v, cid, n[idKey]));
      });
      const owner = byId.get(n[idKey]);
      if (owner) owner.cov = { parts: items.length, verified };
    }
  }
  for (const n of graphNodes) ((n[checks.field] as Record<string, any>[]) ?? []).forEach((v) => addCheck(v, n[idKey], n[idKey]));

  for (const n of graphNodes) {
    const id = n[idKey] as string;
    const link = (field: string, target: string, note?: string, props?: Record<string, unknown>) => {
      if (!ids.has(target)) unresolved.push({ s: id, t: target, k: field });
      else addEdge(id, target, field, note, props);
    };
    for (const field of linkFields) {
      const key = linkTargetKey(P.edges, field);
      for (const item of linkList(n[field])) {
        const read = readLinkItem(item, key);
        if (read) link(field, read.target, undefined, read.p);
      }
    }
    if (P.supersededBy && n[P.supersededBy]) link(P.supersededBy, n[P.supersededBy]);
    for (const spec of P.refs!) for (const t of (n[spec.field] as Record<string, any>[]) ?? []) link(spec.field, t[spec.target], refNote(spec, t), refProps(spec, t));
    // A source that is a node makes an edge from the node to the source node.
    const source = P.provenance?.source;
    const sourceId = source?.kind === undefined ? undefined : n[source.field];
    if (source && typeof sourceId === 'string' && sourceId) link(derivedEdgeName(P.provenance!), sourceId);
  }

  const crossLinks: CrossLink[] = [];
  for (const n of graphNodes) {
    for (const spec of P.crossLinks ?? []) {
      const value = n[spec.field];
      if (!Array.isArray(value)) continue;
      for (const t of value) if (typeof t === 'string') crossLinks.push({ s: n[idKey], field: spec.field, graph: spec.graph, t });
    }
  }

  const existing = (list: string[]) => list.filter((p) => byId.has(p));
  const targets = (n: Record<string, any>, field: string) => {
    const key = linkTargetKey(P.edges, field);
    const own = linkList(n[field]).flatMap((item) => readLinkItem(item, key)?.target ?? []);
    return existing([...new Set([...own, ...(embeddedParents.get(n[idKey])?.get(field) ?? [])])]);
  };
  for (const n of graphNodes) {
    const node = byId.get(n[idKey])!;
    let tree: string[] = [];
    let up: string[] = [];
    for (const group of kindOf(P, n[kindKey])?.parents ?? []) {
      let found: string[] = [];
      for (const f of group) {
        found = found.concat(targets(n, f));
        up = up.concat(targets(n, f));
      }
      if (!tree.length) tree = found;
    }
    node.parents = tree;
    node.up = up;
  }

  // A node of a kind with `placedUnder` is placed when it, or a node of its own kind that it
  // refines, has a parent of the kind that `placedUnder` names.
  const placedMemo = new Map<string, boolean>();
  const placed = (id: string, seen: Set<string>): boolean => {
    if (placedMemo.has(id)) return placedMemo.get(id)!;
    if (seen.has(id)) return false;
    seen.add(id);
    const n = byId.get(id)!;
    const under = kindOf(P, n.kind)?.placedUnder;
    const result = n.parents.some((p) => {
      const pk = byId.get(p)!.kind;
      return pk === under || (pk === n.kind && placed(p, seen));
    });
    placedMemo.set(id, result);
    return result;
  };
  const unplaced = nodes.filter((n) => kindOf(P, n.kind)?.placedUnder && !placed(n.id, new Set())).map((n) => n.id);
  const live = unplaced.filter((id) => !isMuted(P, byId.get(id)!.lifecycle));

  return {
    profile: P,
    nodes,
    edges,
    unresolved,
    crossLinks,
    unplaced,
    stats: { unplaced: unplaced.length, unplacedLive: live.length },
    disclosure: (graph.disclosure as Record<string, unknown>) ?? {},
    problems: Array.isArray(graph.problems) ? graph.problems.length : 0,
  };
}

// Indexes for the lookups of the explore module.
export function buildIndex(model: Model): Index {
  const byId = new Map<string, VNode>();
  const children = new Map<string, string[]>();
  const scopeChildren = new Map<string, string[]>();
  const out = new Map<string, VEdge[]>();
  const inc = new Map<string, VEdge[]>();
  const crossOut = new Map<string, CrossLink[]>();
  for (const n of model.nodes) {
    byId.set(n.id, n);
    children.set(n.id, []);
    scopeChildren.set(n.id, []);
    out.set(n.id, []);
    inc.set(n.id, []);
  }
  for (const n of model.nodes) {
    n.parents.forEach((p) => children.get(p)!.push(n.id));
    n.up.forEach((p) => scopeChildren.get(p)!.push(n.id));
  }
  for (const e of model.edges) {
    out.get(e.s)?.push(e);
    inc.get(e.t)?.push(e);
  }
  for (const c of model.crossLinks) crossOut.set(c.s, [...(crossOut.get(c.s) ?? []), c]);
  return { profile: model.profile, byId, children, scopeChildren, out, inc, crossOut, model, moduleCache: new Map(), statusCache: new Map(), carrierCache: new Map(), fieldCache: new Map(), unplaced: new Set(model.unplaced) };
}
