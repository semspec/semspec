// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The check command. It reads the inputs with the rules of build, adds the gates of the profile
// and returns 1 finding for each problem. It never throws for a problem of the inputs.
import { realpathSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildModel, checkCrossLinks, gateFindings, indexGraphs, validateGraph, type Graph, type Model, type Profile, type WorkspaceGraph } from '@semspec/core';
import { readInput } from './input';
import { validateProfile } from './validate';
import { resolveVocabularyFiles } from './vocabulary';
import { readGraphFolder } from './yaml';
import { validateWorkspace } from './workspace';
import { verifiedGraph } from './test-record';

export interface Finding {
  level: 'error' | 'warning';
  subject: string;
  message: string;
  // The gate kind, for a finding that a gate of the profile makes.
  gate?: string;
}

export interface CheckArgs {
  graph?: string;
  profile?: string;
  workspace?: string;
  exclude: string[];
  // The files that changed. Undefined means all files.
  changed?: string[];
  json: boolean;
  strict: boolean;
}

// A wrong use of the command. The command exits with code 2.
export class UsageError extends Error {}

const message = (e: unknown) => (e as Error).message.replace(/\s*\n\s*/g, ' ');

// Reads the arguments after `check`. `--changed` takes all values up to the next option, and can take none.
export function parseCheckArgs(args: string[]): CheckArgs {
  const out: CheckArgs = { exclude: [], json: false, strict: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') out.json = true;
    else if (a === '--strict') out.strict = true;
    else if (a === '--changed') {
      out.changed ??= [];
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) out.changed.push(args[++i]);
    } else if (a === '--graph' || a === '--profile' || a === '--workspace' || a === '--exclude') {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`The option ${a} needs a value.`);
      if (a === '--exclude') out.exclude.push(value);
      else out[a.slice(2) as 'graph' | 'profile' | 'workspace'] = value;
    } else throw new UsageError(a.startsWith('--') ? `Unknown option "${a}".` : `Unexpected argument "${a}".`);
  }
  if (out.workspace !== undefined) {
    if (out.graph !== undefined || out.profile !== undefined || out.exclude.length) throw new UsageError('The option --workspace cannot combine with --graph, --profile or --exclude.');
  } else if (!out.graph || !out.profile) throw new UsageError('The options --graph and --profile are required, or the option --workspace.');
  return out;
}

// The absolute path with no symbolic link, so that 2 spellings of 1 file are equal.
const canonical = (path: string): string => {
  try {
    return realpathSync(resolve(path));
  } catch {
    return resolve(path);
  }
};

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

// The file of a message that starts with a file label, for example `File "a.yaml", node 1 has no "id"`.
const labelFile = (text: string): string | undefined => /^File "([^"]+)"/.exec(text)?.[1];

interface Loaded {
  profile: Profile;
  model: Model;
  // The absolute path of the file of each node. An embedded node has the file of its owner.
  files: Map<string, string>;
}

// Checks 1 graph and its profile. `loaded` is set only when the inputs have no error.
function checkGraph(graphPath: string, profilePath: string, exclude: string[]): { findings: Finding[]; loaded?: Loaded } {
  const findings: Finding[] = [];
  const error = (subject: string, text: string) => findings.push({ level: 'error', subject, message: text });
  let profile: Profile;
  try {
    const read = resolveVocabularyFiles(readInput(profilePath, 'profile'), profilePath);
    const problems = read.errors.length ? read.errors : validateProfile(read.profile);
    if (problems.length) {
      problems.forEach((p) => error(profilePath, p));
      return { findings };
    }
    profile = read.profile as Profile;
  } catch (e) {
    error(profilePath, message(e));
    return { findings };
  }
  let graph: Graph;
  let labels: string[] | undefined;
  try {
    if (isDirectory(graphPath)) {
      const folder = readGraphFolder(graphPath, profile, exclude);
      ({ graph, labels } = folder);
      folder.warnings.forEach((w) => findings.push({ level: 'warning', subject: graphPath, message: w }));
    } else {
      graph = readInput(graphPath, 'graph') as Graph;
      if (exclude.length) findings.push({ level: 'warning', subject: graphPath, message: 'The option --exclude has no effect because the graph is a file, not a folder.' });
    }
  } catch (e) {
    error(graphPath, message(e));
    return { findings };
  }
  const checked = validateGraph(graph, profile, labels);
  checked.errors.forEach((m) => error(labelFile(m) ?? graphPath, m));
  checked.warnings.forEach((m) => findings.push({ level: 'warning', subject: labelFile(m) ?? graphPath, message: m }));
  if (checked.errors.length) return { findings };
  try {
    const verified = verifiedGraph(graph, profile, profilePath, graphPath);
    graph = verified.graph;
    verified.warnings.forEach((warning) => findings.push({ level: 'warning', subject: graphPath, message: warning }));
  } catch (e) {
    error(graphPath, message(e));
    return { findings };
  }
  const model = buildModel(graph, profile);
  const files = new Map<string, string>();
  const list = graph[profile.source.nodes] as Record<string, unknown>[];
  list.forEach((n, i) => {
    const file = labels ? labelFile(labels[i]) : graphPath;
    if (file !== undefined && typeof n[profile.source.id] === 'string') files.set(n[profile.source.id] as string, canonical(file));
  });
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  for (const n of model.nodes) {
    let id: string | undefined = n.id;
    for (let hops = 0; id !== undefined && !files.has(id) && hops < byId.size; hops++) id = byId.get(id)?.parents[0];
    if (id !== undefined && id !== n.id && files.has(id)) files.set(n.id, files.get(id)!);
  }
  return { findings, loaded: { profile, model, files } };
}

// Runs the check. `changed` limits the gate findings to the nodes of those files. A rule error always counts.
export function checkInputs(args: CheckArgs): Finding[] {
  const findings: Finding[] = [];
  const graphs: { id: string; label: string; loaded: Loaded; profilePath: string }[] = [];
  let failed = false;
  let sources: string[];
  if (args.workspace !== undefined) {
    sources = [canonical(args.workspace)];
    let file: unknown;
    try {
      file = readInput(args.workspace, 'workspace');
    } catch (e) {
      return [{ level: 'error', subject: args.workspace, message: message(e) }];
    }
    const problems = validateWorkspace(file);
    if (problems.length) return problems.map((m) => ({ level: 'error', subject: args.workspace!, message: m }));
    const base = dirname(resolve(args.workspace));
    for (const g of (file as { graphs: { id: string; label: string; graph: string; profile: string; exclude?: string[] }[] }).graphs) {
      const profilePath = resolve(base, g.profile);
      const result = checkGraph(resolve(base, g.graph), profilePath, g.exclude ?? []);
      findings.push(...result.findings);
      if (result.loaded) graphs.push({ id: g.id, label: g.label, loaded: result.loaded, profilePath });
      else failed = true;
    }
    if (!failed) {
      const workspaceGraphs: WorkspaceGraph[] = graphs.map((g) => ({ id: g.id, label: g.label, model: g.loaded.model }));
      const cross = checkCrossLinks(workspaceGraphs);
      cross.errors.forEach((m) => findings.push({ level: 'error', subject: args.workspace!, message: m }));
      cross.warnings.forEach((m) => findings.push({ level: 'warning', subject: args.workspace!, message: m }));
    }
  } else {
    const result = checkGraph(args.graph!, args.profile!, args.exclude);
    findings.push(...result.findings);
    sources = [canonical(args.profile!)];
    if (result.loaded) graphs.push({ id: 'graph', label: result.loaded.profile.project, loaded: result.loaded, profilePath: args.profile! });
  }
  // A graph with an error has no gate findings, because its model is not reliable.
  if (findings.some((f) => f.level === 'error') || !graphs.length) return findings;
  const changed = args.changed && new Set(args.changed.map(canonical));
  const everything = !changed || sources.concat(graphs.map((g) => canonical(g.profilePath))).some((s) => changed.has(s));
  const single = args.workspace === undefined;
  const indexes = indexGraphs(graphs.map((g) => ({ id: g.id, label: g.label, model: g.loaded.model })));
  for (const f of gateFindings(indexes)) {
    const file = graphs.find((g) => g.id === f.graph)?.loaded.files.get(f.node);
    if (!everything && (file === undefined || !changed!.has(file))) continue;
    findings.push({ level: 'error', subject: single ? f.node : `${f.graph}:${f.node}`, message: f.message, gate: f.gate });
  }
  return findings;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function sortFindings(findings: Finding[]): Finding[] {
  const rank = (f: Finding) => (f.level === 'error' ? 0 : 1);
  return [...findings].sort((a, b) => rank(a) - rank(b) || compare(a.subject, b.subject) || compare(a.message, b.message));
}

export const exitCode = (findings: Finding[], strict: boolean): number => (findings.some((f) => f.level === 'error' || (strict && f.level === 'warning')) ? 1 : 0);

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The text of the result: 1 line for each finding and a summary line.
export function formatFindings(findings: Finding[], strict: boolean): string {
  const errors = findings.filter((f) => f.level === 'error').length;
  const warnings = findings.length - errors;
  const lines = findings.map((f) => `${f.level} ${f.subject}: ${f.message.replace(/\s*\n\s*/g, ' ')}`);
  lines.push(`${exitCode(findings, strict) ? 'check failed' : 'check passed'}: ${count(errors, 'error')}, ${count(warnings, 'warning')}`);
  return lines.join('\n');
}

export function formatJson(findings: Finding[], strict: boolean): string {
  const errors = findings.filter((f) => f.level === 'error').length;
  return JSON.stringify({ ok: exitCode(findings, strict) === 0, strict, errors, warnings: findings.length - errors, findings });
}
