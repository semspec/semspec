// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The app reads the pure logic through this module. It binds the profile of the page, so a
// component asks for a label or a role and does not name a kind.
import * as C from '@semspec/core';
import type { Chip, ExternalLink, FieldFilterSpec, Filters, Groups, Index, Model, NodeStatus, Profile, StatusTone, Summary, VEdge, VNode, Vocabulary, Walk } from '@semspec/core';

export type { Chip, ExternalLink, FieldFilterSpec, Filters, Groups, Index, Model, NodeStatus, Profile, StatusTone, Summary, VEdge, VNode, Vocabulary, Walk };
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

// The properties of an edge without the fields that the profile names for provenance.
function withoutProvenance(p: VEdge['p']): VEdge['p'] {
  if (!p) return p;
  const drop = C.provenanceFields(profile.provenance);
  const rest = Object.fromEntries(Object.entries(p).filter(([k]) => !drop.includes(k)));
  return Object.keys(rest).length ? rest : undefined;
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
  hierarchyRootKinds: C.hierarchyRootKinds,
  hierarchyGroupKey: C.hierarchyGroupKey,
  hierarchySections: C.hierarchySections,
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
  // Links to outside tools, from the externalLinks of the profile. Each URL is http or https.
  safeUrl: C.safeHttpUrl,
  nodeLinks: (n: VNode): ExternalLink[] => C.nodeLinks(profile, n),
  checkLinks: (check: unknown): ExternalLink[] => C.checkLinks(profile, check),
  getPath: C.getPath,
  taggedLines: C.taggedLines,
  // The properties of an edge as a line. A code shows as its label.
  formatEdgeProps: (p: VEdge['p'], edge?: string) => C.formatEdgeProps(withoutProvenance(p), edge === undefined ? undefined : (k, v) => C.propertyLabel(profile, edge, k, v)),
  // The properties of an edge without the provenance parts. The panel shows those in their own section.
  withoutProvenance: (p: VEdge['p']) => withoutProvenance(p),
  propertyLabel: (edge: string, property: string, value: unknown) => C.propertyLabel(profile, edge, property, value),
  // Vocabularies. A field with no scheme gives undefined.
  schemeOf: (field: string) => C.schemeOfField(profile, field),
  fieldConcept: (field: string, code: unknown) => C.fieldConcept(profile, field, code),
  fieldLabel: (field: string, code: string) => C.fieldLabel(profile, field, code),
  codedOptions: C.codedOptions,
  propertyConcept: (edge: string, property: string, value: unknown) => {
    const id = profile.edges[edge]?.properties?.[property]?.vocabulary;
    const scheme = id === undefined ? undefined : profile.vocabularies?.[id];
    return scheme && typeof value === 'string' ? C.conceptOf(scheme, value) : undefined;
  },
  // Provenance. The profile names the fields. The marker shows as the label of its code.
  get provenance() {
    return profile.provenance;
  },
  provenanceOf: (record: Record<string, unknown> | undefined) => C.provenanceOf(profile.provenance, record),
  markerConcept: (marker: unknown) => {
    const spec = profile.provenance?.marker;
    const scheme = spec ? profile.vocabularies?.[spec.vocabulary] : undefined;
    return scheme && Array.isArray(scheme.concepts) && typeof marker === 'string' ? C.conceptOf(scheme, marker) : undefined;
  },
  markerScheme: () => {
    const spec = profile.provenance?.marker;
    const scheme = spec ? profile.vocabularies?.[spec.vocabulary] : undefined;
    return scheme && Array.isArray(scheme.concepts) ? scheme : undefined;
  },
  provenanceLabel: () => C.provenanceLabel(profile),
  missingSource: C.missingSource,
  filterValues: C.filterValues,
  kindSpec: (id: string) => C.kindOf(profile, id),
};
