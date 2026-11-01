// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Turns the index of a requirements graph into the feature cards of the home page. The module has no
// framework dependency. A card is a shipped feature. The cards keep the order of the feature nodes in the
// graph, which is the order of the files. The profile has no sort field for features.
import type { Index } from '../../../packages/core/src/index';
import { buildRoadmap } from './roadmap';
import type { RoadmapOptions } from './roadmap';

export interface FeatureCard {
  id: string;
  title: string;
  // The tagline of the feature, or else its statement.
  text: string;
}

export interface CardOptions {
  // The field of a feature node that holds the tagline.
  taglineField: string;
}

export const DEFAULT_CARD_OPTIONS: CardOptions = { taglineField: 'tagline' };

export function buildCards(index: Index, options: Partial<RoadmapOptions & CardOptions> = {}): FeatureCard[] {
  const { taglineField } = { ...DEFAULT_CARD_OPTIONS, ...options };
  const shipped = new Set(buildRoadmap(index, options).shipped.map((f) => f.id));
  const kind = options.featureKind ?? 'feature';
  return index.model.nodes
    .filter((n) => n.kind === kind && shipped.has(n.id))
    .map((n) => {
      const tagline = n.d[taglineField];
      return { id: n.id, title: n.title, text: typeof tagline === 'string' && tagline.trim() ? tagline.trim() : n.statement };
    });
}
