// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Turns the index of a requirements graph into the trace of 1 requirement: the chain from the top of
// the tree down to a requirement, 1 of its conditions and 1 check of that condition. The module has no
// framework dependency. The Vite config runs it at build time, so it imports the core module by a relative path.
import { edgeLabel, kindLabel } from '../../../src/core/index';
import type { Index, Profile, VNode } from '../../../src/core/index';
import { statusDataOf } from './roadmap';
import type { StatusData } from './roadmap';

export interface TraceNode {
  id: string;
  kind: string;
  // The label of the kind, from the profile.
  kindLabel: string;
  // The title of the node. A condition shows its text. A check shows its name.
  title: string;
  // The label of the edge from the node above, read from the more general node down. Null for the first node.
  edge: string | null;
  // Set for a condition only. Null when the condition has no known status.
  status?: StatusData | null;
  // Set for a check only, when the check names a file.
  file?: string;
}

export interface TraceData {
  // The path of the file of the requirement, relative to the repository.
  file: string;
  nodes: TraceNode[];
}

// The edge between 2 nodes, read from the upper node. An edge that starts at the lower node reads with
// the label for the target. An edge that starts at the upper node reads with the label for the source.
function edgeBetween(index: Index, upper: VNode, lower: VNode): string | null {
  const toUpper = (index.out.get(lower.id) ?? []).find((e) => e.t === upper.id);
  if (toUpper) return edgeLabel(index.profile, toUpper.k, 1);
  const toLower = (index.out.get(upper.id) ?? []).find((e) => e.t === lower.id);
  return toLower ? edgeLabel(index.profile, toLower.k, 0) : null;
}

// The file of a check. The profile names it in `detail.file`. Without that, the file is the first field of
// the key of the check type that its title does not use.
function fileOf(profile: Profile, check: VNode): string | undefined {
  const spec = profile.checks;
  if (!spec) return undefined;
  const type = spec.types?.[String(check.d[spec.typeField] ?? '')];
  const field = spec.detail?.file ?? type?.key.find((f) => !type.title.includes(f));
  const value = field === undefined ? undefined : check.d[field];
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

// The title of a check: the values of the title fields of its type, as written, with a capital first letter.
// The node title of the model drops the punctuation, so the trace builds its own. Without the fields, it
// takes the node title.
function checkTitleOf(profile: Profile, check: VNode): string {
  const spec = profile.checks;
  const type = spec?.types?.[String(check.d[spec.typeField] ?? '')];
  const text = (type?.title ?? []).map((f) => check.d[f]).filter((v) => v !== undefined && v !== null && v !== '').join(' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : check.title;
}

// The trace of the requirement with the id `requirementId`, from the top down. The tree parents give the nodes
// above the requirement. The first condition of the requirement that has a check gives the 2 nodes below it.
// Throws when the node is missing or no condition has a check.
export function buildTrace(index: Index, requirementId: string): TraceNode[] {
  const profile = index.profile;
  const requirement = index.byId.get(requirementId);
  if (!requirement) throw new Error(`The graph has no node ${requirementId}`);
  const part = profile.parts?.find((p) => p.owner === requirement.kind);
  const checks = profile.checks;
  if (!part || !checks) throw new Error(`The profile has no parts and checks for the kind ${requirement.kind}`);

  // The first check that the condition has.
  const checkOf = (condition: VNode): VNode | undefined => {
    for (const e of index.out.get(condition.id) ?? []) {
      const target = index.byId.get(e.t);
      if (e.k === checks.edge && target?.kind === checks.kind) return target;
    }
    return undefined;
  };

  let condition: VNode | undefined;
  let check: VNode | undefined;
  for (const id of index.children.get(requirement.id) ?? []) {
    const child = index.byId.get(id);
    if (child?.kind !== part.kind) continue;
    check = checkOf(child);
    if (check) {
      condition = child;
      break;
    }
  }
  if (!condition || !check) throw new Error(`No condition of ${requirementId} has a check`);

  // The first tree parent of each node, until a node has none. A cycle ends the climb.
  const above: VNode[] = [];
  const seen = new Set<string>();
  for (let n: VNode | undefined = requirement; n && !seen.has(n.id); n = index.byId.get(n.parents[0])) {
    seen.add(n.id);
    above.unshift(n);
  }

  const chain = [...above, condition, check];
  return chain.map<TraceNode>((n, i) => {
    const node: TraceNode = { id: n.id, kind: n.kind, kindLabel: kindLabel(profile, n.kind), title: n.title, edge: i === 0 ? null : edgeBetween(index, chain[i - 1], n) };
    if (n === condition) {
      node.title = n.statement || n.title;
      node.status = statusDataOf(profile, n.status);
    }
    if (n === check) {
      node.title = checkTitleOf(profile, n);
      const file = fileOf(profile, n);
      if (file !== undefined) node.file = file;
    }
    return node;
  });
}
