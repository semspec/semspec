// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The icon of each feature card on the home page, by feature id. A test fails when a shipped feature
// has no entry.
import { Bot, Download, Globe, FileText, FolderGit2, Layers, LayoutDashboard, ListChecks, ListTodo, Network, Search, Shapes, SlidersHorizontal, type LucideIcon } from 'lucide-react';

export const FEATURE_ICONS: Record<string, LucideIcon> = {
  'feat-context': Bot,
  'feat-export': Download,
  'feat-filters': ListChecks,
  'feat-graph-input': FolderGit2,
  'feat-model': Shapes,
  'feat-navigate': Search,
  'feat-obligations': ListTodo,
  'feat-profile': SlidersHorizontal,
  'feat-scope-walk': Network,
  'feat-site': Globe,
  'feat-specs': FileText,
  'feat-views': LayoutDashboard,
  'feat-workspace': Layers,
};
