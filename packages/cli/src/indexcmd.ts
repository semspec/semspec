// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The command `semspec index`: embeds the text of each node with the model that the user configured
// and writes the index file of each graph. A rerun embeds only the nodes whose text changed.
import { indexGraphs } from '@semspec/core';
import { buildIndexFile } from './embeddings';
import { loadWithTargets } from './mcp';

export interface IndexArgs {
  flags: Record<string, string>;
  exclude: string[];
}

export function parseIndexArgs(argv: string[]): IndexArgs {
  const flags: Record<string, string> = {};
  const exclude: string[] = [];
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected "${argv[i]}". The options are --workspace, or --graph and --profile.`);
    flags[argv[i].slice(2)] = argv[i + 1] ?? '';
    if (argv[i] === '--exclude') exclude.push(argv[i + 1] ?? '');
  }
  return { flags, exclude };
}

// Builds the index files. It throws an error with a message for the user. It returns 1 line for each graph.
export async function indexInputs(args: IndexArgs): Promise<{ lines: string[]; warnings: string[] }> {
  const { flags } = args;
  if (flags.workspace !== undefined ? flags.graph !== undefined || flags.profile !== undefined || args.exclude.length : !flags.graph || !flags.profile) {
    throw new Error('Use --workspace alone, or use --graph and --profile.');
  }
  const loaded = loadWithTargets(flags, args.exclude);
  if (!loaded.targets.size) throw new Error('No embedding model is configured. Set search.embeddings in the workspace file or in the profile. See docs/guide/meaning-search.md.');
  const graphs = indexGraphs(loaded.graphs.map((g) => ({ id: g.id, label: g.label, model: g.model })));
  const lines: string[] = [];
  for (const g of graphs) {
    const target = loaded.targets.get(g.id);
    if (!target) {
      lines.push(`${g.id}: no embedding setting, skipped`);
      continue;
    }
    const u = await buildIndexFile(target, g);
    lines.push(`${g.id}: ${u.embedded} embedded, ${u.kept} kept, ${u.removed} removed${u.rebuilt ? ' (the settings changed, all nodes embedded again)' : ''} -> ${target.indexPath}`);
  }
  return { lines, warnings: loaded.warnings };
}
