// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The command `semspec slice`: prints the brief for a task on 1 node, as Markdown or as JSON.
import { DEFAULT_SLICE_BUDGET, indexGraphs, slice, type Slice } from '@semspec/core';
import { mcpLoader } from './mcp';

export interface SliceArgs {
  id: string;
  flags: Record<string, string>;
  exclude: string[];
  json: boolean;
}

// Reads the arguments after the command name. The word with no option is the node id.
export function parseSliceArgs(argv: string[]): SliceArgs {
  const flags: Record<string, string> = {};
  const exclude: string[] = [];
  const words: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a.startsWith('--')) {
      const value = argv[++i] ?? '';
      flags[a.slice(2)] = value;
      if (a === '--exclude') exclude.push(value);
    } else words.push(a);
  }
  return { id: words.join(' ').trim(), flags, exclude, json };
}

const whole = (value: string | undefined, name: string, fallback: number): number => {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`The option --${name} must be a whole number from 1.`);
  return n;
};

// Builds the slice. It throws an error with a message for the user.
export function sliceInputs(args: SliceArgs): { result: Slice; warnings: string[] } {
  const { flags } = args;
  if (!args.id) throw new Error('Give the id of the node.');
  if (flags.workspace !== undefined ? flags.graph !== undefined || flags.profile !== undefined || args.exclude.length : !flags.graph || !flags.profile) {
    throw new Error('Use --workspace alone, or use --graph and --profile.');
  }
  const depth = whole(flags.depth, 'depth', 1);
  const budget = whole(flags.budget, 'budget', DEFAULT_SLICE_BUDGET);
  const loaded = mcpLoader(flags, args.exclude)();
  const graphs = indexGraphs(loaded.graphs.map((g) => ({ id: g.id, label: g.label, model: g.model })));
  return { result: slice(graphs, { graph: flags.in, id: args.id, depth, budget }), warnings: loaded.warnings };
}

