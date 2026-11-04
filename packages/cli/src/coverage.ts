// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The command `semspec coverage`: reports the status of the conditions in a selection, as Markdown or as JSON.
// The options map to the inputs of the MCP tool coverage.
import { coverage, coverageMarkdown, indexGraphs, type CoverageQuery, type CoverageResult, type StatusSource, type StatusTone } from '@semspec/core';
import { mcpLoader } from './mcp';

export interface CoverageArgs {
  flags: Record<string, string>;
  lists: Record<string, string[]>;
  json: boolean;
}

// The options that the command accepts. Each takes 1 value, except --json. This list follows the usage line of the command.
const OPTIONS = new Set(['graph', 'profile', 'workspace', 'in', 'exclude', 'scope', 'kind', 'lifecycle', 'delivery', 'status', 'marker', 'field', 'group', 'list', 'limit', 'gate']);

// Reads the arguments after the command name. It throws for an unknown option and for an option with no value.
export function parseCoverageArgs(argv: string[]): CoverageArgs {
  const flags: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a.startsWith('--')) {
      const name = a.slice(2);
      if (!OPTIONS.has(name)) throw new Error(`Unknown option "${a}".`);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`The option ${a} needs a value.`);
      i++;
      flags[name] = value;
      (lists[name] ??= []).push(value);
    } else throw new Error(`Unexpected argument "${a}".`);
  }
  return { flags, lists, json };
}

// The values of an option that can repeat. A value can also hold several values with commas.
const values = (args: CoverageArgs, name: string): string[] | undefined => {
  const list = args.lists[name];
  return list ? list.flatMap((v) => v.split(',')) : undefined;
};

// Reads --field name=value[,value]... into the field filters.
function fieldsOf(args: CoverageArgs): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {};
  for (const item of args.lists.field ?? []) {
    const at = item.indexOf('=');
    if (at < 1) throw new Error('The option --field must have the form name=value.');
    const name = item.slice(0, at);
    out[name] = [...(out[name] ?? []), ...item.slice(at + 1).split(',')];
  }
  return Object.keys(out).length ? out : undefined;
}

// Builds the query of the core from the options. It throws an error with a message for the user.
export function coverageQuery(args: CoverageArgs): CoverageQuery {
  const { flags } = args;
  const limit = flags.limit === undefined ? undefined : Number(flags.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error('The option --limit must be a whole number from 1.');
  return {
    graph: flags.in,
    scope: flags.scope,
    kinds: values(args, 'kind'),
    lifecycles: values(args, 'lifecycle'),
    deliveries: values(args, 'delivery'),
    statuses: values(args, 'status'),
    markers: values(args, 'marker'),
    fields: fieldsOf(args),
    group: flags.group,
    list: values(args, 'list'),
    statusSource: flags['status-source'] as StatusSource | undefined,
    limit,
    gate: values(args, 'gate') as StatusTone[] | undefined,
  };
}

// Builds the report. It throws an error with a message for the user.
export function coverageInputs(args: CoverageArgs): { result: CoverageResult; warnings: string[] } {
  const { flags } = args;
  const exclude = args.lists.exclude ?? [];
  if (flags.workspace !== undefined ? flags.graph !== undefined || flags.profile !== undefined || exclude.length : !flags.graph || !flags.profile) {
    throw new Error('Use --workspace alone, or use --graph and --profile.');
  }
  const query = coverageQuery(args);
  const loaded = mcpLoader(flags, exclude)();
  const graphs = indexGraphs(loaded.graphs.map((g) => ({ id: g.id, label: g.label, model: g.model })));
  return { result: coverage(graphs, query), warnings: loaded.warnings };
}

export const formatCoverage = (result: CoverageResult, json: boolean): string => (json ? JSON.stringify(result) : coverageMarkdown(result).trimEnd());
