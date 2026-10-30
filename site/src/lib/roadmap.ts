// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Turns the index of a requirements graph into the data of the roadmap. The module has no framework
// dependency. The Vite config runs it at build time, so it imports the core module by a relative path.
import { filterValues, isMuted, statusOf } from '../../../src/core/index';
import type { Index, Profile, StatusTone, VNode } from '../../../src/core/index';

// The kinds and the lifecycle state that the roadmap reads. The defaults match requirements/profile.yaml.
export interface RoadmapOptions {
  featureKind: string;
  requirementKind: string;
  conditionKind: string;
  // A feature in this lifecycle state is planned. Every other feature that is not muted has shipped.
  plannedState: string;
}

export const DEFAULT_OPTIONS: RoadmapOptions = { featureKind: 'feature', requirementKind: 'requirement', conditionKind: 'condition', plannedState: 'draft' };

export interface StatusData {
  value: string;
  label: string;
  tone: StatusTone;
}

export interface ConditionData {
  id: string;
  text: string;
  // Null when the condition has no known status.
  status: StatusData | null;
}

export interface RequirementData {
  id: string;
  title: string;
  statement: string;
  // The labels of the field filter values, for example the area.
  areas: string[];
  conditions: ConditionData[];
}

export interface PlannedFeature {
  id: string;
  title: string;
  statement: string;
  // The conditions below the feature that have the status of the good tone, and all conditions below it.
  verified: number;
  total: number;
  requirements: RequirementData[];
}

export interface ShippedFeature {
  id: string;
  title: string;
  statement: string;
  verified: number;
  total: number;
}

export interface RoadmapData {
  planned: PlannedFeature[];
  shipped: ShippedFeature[];
  // The colours of the kinds, by kind id.
  kinds: Record<string, { light: string; dark: string }>;
}

const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, 'en');

// The status that the profile names for a value, or null when the profile names none.
export function statusDataOf(profile: Profile, value: string | undefined): StatusData | null {
  const spec = profile.status?.values.find((v) => v.value === value);
  return spec ? { value: spec.value, label: spec.label, tone: spec.tone } : null;
}

export function buildRoadmap(index: Index, options: Partial<RoadmapOptions> = {}): RoadmapData {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const profile = index.profile;
  const goodValue = profile.status?.values.find((v) => v.tone === 'good')?.value;
  const live = (n: VNode) => !isMuted(profile, n.lifecycle);

  // Every node of a kind below a node, through the tree children, once each, in graph order.
  const below = (id: string, kind: string): VNode[] => {
    const found: VNode[] = [];
    const seen = new Set<string>();
    const visit = (parent: string) => {
      for (const childId of index.children.get(parent) ?? []) {
        const child = index.byId.get(childId);
        if (!child || seen.has(childId) || !live(child)) continue;
        seen.add(childId);
        if (child.kind === kind) found.push(child);
        visit(childId);
      }
    };
    visit(id);
    return found;
  };

  const areaLabels = (n: VNode): string[] => {
    const labels: string[] = [];
    for (const spec of profile.fieldFilters ?? []) {
      for (const value of filterValues(n.d[spec.field], spec.from)) labels.push(spec.values?.[value] ?? value);
    }
    return labels;
  };

  // The count of verified conditions comes from the status roll-up of the core module.
  const counts = (feature: VNode) => {
    const conditions = below(feature.id, o.conditionKind);
    const rolled = statusOf(index, feature.id);
    return { verified: goodValue ? rolled.counts[goodValue] ?? 0 : 0, total: conditions.length };
  };

  const planned: PlannedFeature[] = [];
  const shipped: ShippedFeature[] = [];
  const features = index.model.nodes.filter((n) => n.kind === o.featureKind && live(n));
  for (const feature of features) {
    const { verified, total } = counts(feature);
    if (feature.lifecycle === o.plannedState) {
      const requirements = below(feature.id, o.requirementKind).map<RequirementData>((r) => ({
        id: r.id,
        title: r.title,
        statement: r.statement,
        areas: areaLabels(r),
        conditions: below(r.id, o.conditionKind).map((c) => ({ id: c.id, text: c.statement, status: statusDataOf(profile, c.status) })),
      }));
      planned.push({ id: feature.id, title: feature.title, statement: feature.statement, verified, total, requirements });
    } else {
      shipped.push({ id: feature.id, title: feature.title, statement: feature.statement, verified, total });
    }
  }
  planned.sort(byTitle);
  shipped.sort(byTitle);

  return {
    planned,
    shipped,
    kinds: Object.fromEntries(profile.kinds.map((k) => [k.id, { light: k.color.light, dark: k.color.dark }])),
  };
}
