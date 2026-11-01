// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The icon of each feature card on the home page, by feature id. A test fails when a shipped feature
// has no entry.
import { Bot, Cable, Compass, Package, PenLine, Shapes, type LucideIcon } from 'lucide-react';

export const FEATURE_ICONS: Record<string, LucideIcon> = {
  'feat-author': PenLine,
  'feat-connect': Cable,
  'feat-distribute': Package,
  'feat-explore': Compass,
  'feat-harness': Bot,
  'feat-model': Shapes,
};
