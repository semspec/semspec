// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The command `semspec deliverables`: lists the nodes that miss a deliverable of the profile.
import { deliverableReport, indexGraphs, type DeliverableReport } from '@semspec/core';
import { mcpLoader } from './mcp';

export interface DeliverablesArgs {
  flags: Record<string, string>;
  kinds: string[];
  exclude: string[];
  json: boolean;
}

// Reads the arguments after the command name.
export function parseDeliverablesArgs(argv: string[]): DeliverablesArgs {
  const flags: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a.startsWith('--')) {
      const value = argv[++i] ?? '';
      flags[a.slice(2)] = value;
      (lists[a.slice(2)] ??= []).push(value);
    } else throw new Error(`Unexpected argument "${a}".`);
  }
  const kinds = (lists.kind ?? []).flatMap((k) => k.split(',')).filter(Boolean);
  return { flags, kinds, exclude: lists.exclude ?? [], json };
}

// Builds the report. It throws an error with a message for the user.
export function deliverablesInputs(args: DeliverablesArgs): { result: DeliverableReport; withGraph: boolean; warnings: string[] } {
  const { flags } = args;
  if (flags.workspace !== undefined ? flags.graph !== undefined || flags.profile !== undefined || args.exclude.length : !flags.graph || !flags.profile) {
    throw new Error('Use --workspace alone, or use --graph and --profile.');
  }
  const loaded = mcpLoader(flags, args.exclude)();
  const graphs = indexGraphs(loaded.graphs.map((g) => ({ id: g.id, label: g.label, model: g.model })));
  const result = deliverableReport(graphs, { graph: flags.in, scope: flags.scope, kinds: args.kinds });
  return { result, withGraph: flags.workspace !== undefined && flags.in === undefined, warnings: loaded.warnings };
}

// The findings as lines of text for a person.
export function formatDeliverables(result: DeliverableReport, withGraph: boolean): string {
  if (!result.findings.length) return `No missing deliverable in ${result.nodes} node(s).`;
  const lines = result.findings.map((f) => `${withGraph ? `${f.graph}:` : ''}${f.node}: ${f.message}`);
  const nodes = new Set(result.findings.map((f) => `${f.graph}:${f.node}`)).size;
  lines.push(`${result.findings.length} missing deliverable(s) in ${nodes} of ${result.nodes} node(s).`);
  return lines.join('\n');
}
