// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The command `semspec spec`: fills the marked sections of Markdown templates from the graph, or writes default documents.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { defaultDocuments, fillSpecs, indexGraphs, type SpecDocument, type SpecFinding } from '@semspec/core';
import { UsageError } from './check';
import { mcpLoader } from './mcp';

export interface SpecArgs {
  flags: Record<string, string>;
  files: string[];
  exclude: string[];
  roots: string[];
  check: boolean;
  json: boolean;
}

const VALUE_FLAGS = ['graph', 'profile', 'workspace', 'exclude', 'out', 'roots', 'glossary'];

// Reads the arguments after the command name. A word with no option is a template file.
export function parseSpecArgs(argv: string[]): SpecArgs {
  const args: SpecArgs = { flags: {}, files: [], exclude: [], roots: [], check: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') args.check = true;
    else if (a === '--json') args.json = true;
    else if (a.startsWith('--')) {
      const name = a.slice(2);
      if (!VALUE_FLAGS.includes(name)) throw new UsageError(`Unknown option "${a}".`);
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`The option ${a} needs a value.`);
      args.flags[name] = value;
      if (name === 'exclude') args.exclude.push(value);
      if (name === 'roots') args.roots.push(...value.split(',').map((x) => x.trim()).filter(Boolean));
    } else args.files.push(a);
  }
  const { flags } = args;
  if (flags.workspace !== undefined ? flags.graph !== undefined || flags.profile !== undefined || args.exclude.length : !flags.graph || !flags.profile) {
    throw new UsageError('Use --workspace alone, or use --graph and --profile.');
  }
  if (args.files.length && flags.out !== undefined) throw new UsageError('Give template files, or give --out. Not both.');
  if (!args.files.length && flags.out === undefined) throw new UsageError('Give the template files, or give --out for the default documents.');
  if (flags.out === undefined && (args.roots.length || flags.glossary !== undefined)) throw new UsageError('The options --roots and --glossary need --out.');
  return args;
}

export interface SpecOutcome {
  findings: SpecFinding[];
  // The files that a run without --check writes.
  written: string[];
  sections: number;
  files: number;
  warnings: string[];
}

const posix = (path: string): string => resolve(path).split(sep).join('/');

// Runs the command. It writes the files unless `check` is set, or unless a finding has the code `error`.
export function specInputs(args: SpecArgs): SpecOutcome {
  const loaded = mcpLoader(args.flags, args.exclude)();
  const graphs = indexGraphs(loaded.graphs.map((g) => ({ id: g.id, label: g.label, model: g.model })));
  const documents: SpecDocument[] = [];
  const findings: SpecFinding[] = [];
  if (args.flags.out === undefined) {
    for (const file of args.files) {
      try {
        documents.push({ path: posix(file), name: file, text: readFileSync(file, 'utf8') });
      } catch {
        findings.push({ code: 'error', file, line: 1, message: `The file "${file}" cannot be read.` });
      }
    }
  } else {
    const out = args.flags.out;
    const defaults = defaultDocuments(graphs, { roots: args.roots.length ? args.roots : undefined, glossary: args.flags.glossary });
    if (!defaults.length) throw new Error('No document to write. Name the root kinds in spec.roots of the profile, or use --roots, or use --glossary.');
    for (const d of defaults) {
      const file = resolve(out, d.name);
      const away = relative(resolve(out), file);
      if (away === '' || away === '..' || away.startsWith(`..${sep}`) || isAbsolute(away)) {
        findings.push({ code: 'error', file: d.name, line: 1, message: `The file "${d.name}" is outside the output directory "${out}". The command refuses it.` });
        continue;
      }
      // An existing file keeps the text of its author. Only its marked sections change.
      documents.push({ path: posix(file), name: `${out.replace(/[\\/]+$/, '')}/${d.name}`, text: existsSync(file) ? readFileSync(file, 'utf8') : d.text });
    }
  }
  const result = fillSpecs(graphs, documents);
  findings.push(...result.findings);
  const written: string[] = [];
  const blocked = findings.some((f) => f.code === 'error');
  if (!args.check && !blocked) {
    for (const f of result.files) {
      if (!f.changed) continue;
      mkdirSync(dirname(f.path), { recursive: true });
      writeFileSync(f.path, f.text);
      written.push(f.name);
    }
  }
  const failed = args.check || blocked ? findings : findings.filter((f) => f.code === 'error');
  return { findings: failed, written, sections: result.sections, files: documents.length, warnings: loaded.warnings };
}

// The findings as lines for a person.
export function formatSpec(outcome: SpecOutcome, args: SpecArgs): string {
  const lines = outcome.findings.map((f) => `${f.file}:${f.line}: ${f.message}`);
  if (outcome.findings.length) return lines.join('\n');
  if (args.check) return `All ${outcome.sections} section(s) in ${outcome.files} file(s) match the graph.`;
  return outcome.written.length ? `wrote ${outcome.written.length} file(s)\n${outcome.written.join('\n')}` : `No change in ${outcome.files} file(s).`;
}
