// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The app reads the pure logic through this module. It binds the profile of the page, so a
// component asks for a label or a role and does not name a kind.
import * as C from '@core/index';
import type { Chip, FieldFilterSpec, Filters, Groups, Index, Model, NodeStatus, Profile, StatusTone, Summary, VEdge, VNode, Walk } from '@core/index';

export type { Chip, FieldFilterSpec, Filters, Groups, Index, Model, NodeStatus, Profile, StatusTone, Summary, VEdge, VNode, Walk };
export type Kind = string;

let profile: Profile;
let labels: Record<string, string> = {};
let plurals: Record<string, string> = {};
let edgeLabels: Record<string, [string, string]> = {};

// Called once, before the first render.
export function setProfile(p: Profile) {
  profile = p;
  labels = Object.fromEntries(p.kinds.map((k) => [k.id, k.label]));
  plurals = Object.fromEntries(p.kinds.map((k) => [k.id, k.plural]));
  edgeLabels = Object.fromEntries(Object.entries(p.edges).map(([k, v]) => [k, v.labels]));
}

export const Core = {
  get profile() {
    return profile;
  },
  get KIND_LABEL() {
    return labels;
  },
  get KIND_PLURAL() {
    return plurals;
  },
  get EDGE_LABEL() {
    return edgeLabels;
  },
  get HIERARCHY_KINDS() {
    return C.treeKinds(profile);
  },
  get LINKED_KINDS() {
    return C.linkedKinds(profile);
  },
  get ALL_KINDS() {
    return profile.kinds.map((k) => k.id);
  },
  get DOWN_EDGES() {
    return C.downEdges(profile);
  },
  buildIndex: C.buildIndex,
  computeScope: C.computeScope,
  groupsOf: C.groupsOf,
  applyFilters: C.applyFilters,
  facetCounts: C.facetCounts,
  scopedEdges: C.scopedEdges,
  neighbourIds: C.neighbourIds,
  badgeCount: C.badgeCount,
  neighbourGroups: C.neighbourGroups,
  walkStart: C.walkStart,
  walkExpand: C.walkExpand,
  walkCollapse: C.walkCollapse,
  walkHide: C.walkHide,
  summaryOf: C.summaryOf,
  statusOf: C.statusOf,
  toCsv: C.toCsv,
  getPath: C.getPath,
  kindSpec: (id: string) => C.kindOf(profile, id),
};
