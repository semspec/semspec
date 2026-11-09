// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The command line tool.
//   semspec serve --graph <file> --profile <file> [--port 4173] [--host 127.0.0.1] [--exclude <pattern>]...
//   semspec build --graph <file> --profile <file> --out <file.html> [--exclude <pattern>]... [--sources]
//   semspec serve --workspace <file> [--port 4173] [--host 127.0.0.1]
//   semspec build --workspace <file> --out <file.html> [--sources]
//   semspec mcp --graph <file> --profile <file> [--exclude <pattern>]...
//   semspec mcp --workspace <file>
//   semspec search --graph <file> --profile <file> "<query>" [--kind <kind>]... [--scope <id>] [--limit <n>] [--mode keyword|hybrid|vector] [--json]
//   semspec search --workspace <file> "<query>" [--in <graph>] [--kind <kind>]... [--scope <id>] [--limit <n>] [--mode keyword|hybrid|vector] [--json]
//   semspec index --graph <file> --profile <file> [--exclude <pattern>]...
//   semspec index --workspace <file>
//   semspec eval-search [--set <file>] [--workspace <file> | --graph <file> --profile <file>] [--mode keyword|hybrid|vector]
//   semspec slice --graph <file> --profile <file> <id> [--depth <n>] [--budget <n>] [--json]
//   semspec slice --workspace <file> <id> [--in <graph>] [--depth <n>] [--budget <n>] [--json]
//   semspec deliverables --graph <file> --profile <file> [--scope <id>] [--kind <kind>]... [--json]
//   semspec deliverables --workspace <file> [--in <graph>] [--scope <id>] [--kind <kind>]... [--json]
//   semspec coverage --graph <file> --profile <file> [--scope <id>] [--kind <kind>]... [--lifecycle <state>]... [--delivery <value>]... [--status <value>]... [--marker <value>]... [--field <name>=<value>]... [--group <kind|field>] [--list <status>]... [--limit <n>] [--gate <tone>]... [--json]
//   semspec coverage --workspace <file> [--in <graph>] [same options]
//   semspec spec --graph <file> --profile <file> <template.md>... [--check] [--json]
//   semspec spec --workspace <file> --out <dir> [--roots <kind,...>] [--glossary <graph>] [--check] [--json]
//   semspec check --graph <file> --profile <file> [--exclude <pattern>]... [--changed <file>...] [--json] [--strict]
//   semspec check --workspace <file> [--changed <file>...] [--json] [--strict]
//   semspec --version | -v
//   semspec version --json
//   semspec schema --profile <file> --out <dir>
//   semspec export --graph <file> --profile <file> --format turtle|jsonld|shacl|cypher --out <file> [--annotations annotation|reified]
//   semspec export --workspace <file> --format turtle|jsonld|shacl|cypher --out <file> [--annotations annotation|reified]
// A graph is a JSON file, a YAML file, or a folder of YAML files. A profile is a JSON or YAML file.
// --exclude skips the paths of a graph folder that match a pattern. It can repeat.
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXPORT_FORMATS, sliceMarkdown, buildModel, exportModel, exportWorkspace, isExportFormat, kindSchemas, type ExportOptions } from '@semspec/core';
import { serveStdio } from '@semspec/mcp';
import { UsageError, checkInputs, exitCode, formatFindings, formatJson, parseCheckArgs, sortFindings } from './check';
import { setPermissions } from './embeddings';
import { evalSearch, parseEvalArgs } from './eval';
import { indexInputs, parseIndexArgs } from './indexcmd';
import { coverageInputs, formatCoverage, parseCoverageArgs } from './coverage';
import { deliverablesInputs, formatDeliverables, parseDeliverablesArgs } from './deliverables';
import { loadInputs, loadProfile } from './inputs';
import { readInput } from './input';
import { Channel, watchFiles } from './live';
import { mcpLoader } from './mcp';
import { renderPage } from './page';
import { nodeFiles, relativeFiles, sourceText, sourceTexts, type SourceIndex } from './sources';
import { parseSliceArgs, sliceInputs } from './slice';
import { formatSpec, parseSpecArgs, specInputs } from './spec';
import { formatHits, parseSearchArgs, searchInputs } from './search';
import { buildInfo, versionLine } from './version';
import { loadWorkspace } from './workspace';
import { vocabularyPaths } from './vocabulary';

export { loadInputs, loadProfile };

// The graph id of a page of 1 graph. The app uses the same id.
const SINGLE_GRAPH = 'main';

const USAGE = `Semspec

Usage:
  semspec serve --graph <file> --profile <file> [--port 4173] [--host 127.0.0.1] [--exclude <pattern>]...
  semspec build --graph <file> --profile <file> --out <file.html> [--exclude <pattern>]... [--sources]
  semspec serve --workspace <file> [--port 4173] [--host 127.0.0.1]
  semspec build --workspace <file> --out <file.html> [--sources]
  semspec mcp --graph <file> --profile <file> [--exclude <pattern>]...
  semspec mcp --workspace <file>
  semspec search --graph <file> --profile <file> "<query>" [--kind <kind>]... [--scope <id>] [--limit <n>] [--mode keyword|hybrid|vector] [--json]
  semspec search --workspace <file> "<query>" [--in <graph>] [--kind <kind>]... [--scope <id>] [--limit <n>] [--mode keyword|hybrid|vector] [--json]
  semspec index --graph <file> --profile <file> [--exclude <pattern>]...
  semspec index --workspace <file>
  semspec eval-search [--set <file>] [--workspace <file> | --graph <file> --profile <file>] [--mode keyword|hybrid|vector]
  semspec slice --graph <file> --profile <file> <id> [--depth <n>] [--budget <n>] [--json]
  semspec slice --workspace <file> <id> [--in <graph>] [--depth <n>] [--budget <n>] [--json]
  semspec deliverables --graph <file> --profile <file> [--scope <id>] [--kind <kind>]... [--json]
  semspec deliverables --workspace <file> [--in <graph>] [--scope <id>] [--kind <kind>]... [--json]
  semspec coverage --graph <file> --profile <file> [--scope <id>] [--kind <kind>]... [--lifecycle <state>]... [--delivery <value>]... [--status <value>]... [--marker <value>]... [--field <name>=<value>]... [--group <kind|field>] [--list <status>]... [--limit <n>] [--gate <tone>]... [--json]
  semspec coverage --workspace <file> [--in <graph>] [same options]
  semspec spec --graph <file> --profile <file> <template.md>... [--check] [--json]
  semspec spec --workspace <file> --out <dir> [--roots <kind,...>] [--glossary <graph>] [--check] [--json]
  semspec check --graph <file> --profile <file> [--exclude <pattern>]... [--changed <file>...] [--json] [--strict]
  semspec check --workspace <file> [--changed <file>...] [--json] [--strict]
  semspec schema --profile <file> --out <dir>
  semspec --version | -v
  semspec version --json
  semspec export --graph <file> --profile <file> --format turtle|jsonld|shacl|cypher --out <file> [--annotations annotation|reified]
  semspec export --workspace <file> --format turtle|jsonld|shacl|cypher --out <file> [--annotations annotation|reified]

The graph is a JSON file, a YAML file or a folder of YAML files. The profile is a JSON or YAML file.
--exclude skips the folders and files of a graph folder that match a pattern. The option can repeat.
A pattern matches a path relative to the graph folder. It supports *, ** and ?.
--sources puts the text of the source files of the nodes into the built page. Without it, the built page shows the paths only.
serve watches the files and reloads the open pages when a file changes. See docs/reference/cli.md.
--workspace reads a workspace file that lists several graphs. It cannot combine with --graph, --profile or --exclude.
The mcp command serves the graph or the workspace to an AI agent over the Model Context Protocol on stdio. See docs/reference/mcp.md.
The check command exits with 0 for a clean graph, 1 for an error and 2 for a wrong use. See docs/reference/cli.md.
The search command ranks the nodes for a query. See docs/reference/cli.md.
--allow-command and --allow-remote opt in to a command provider and to a remote endpoint of search.embeddings. See docs/guide/meaning-search.md.
The index command embeds the nodes with the model of search.embeddings and writes the index files. See docs/guide/meaning-search.md.
The eval-search command prints recall at 5 and MRR of the keyword and the hybrid search. See docs/guide/meaning-search.md.
The slice command prints the brief for a task on 1 node. See docs/reference/cli.md.
The deliverables command lists the nodes that miss a deliverable of the profile. See docs/reference/cli.md.
The coverage command reports the status of the conditions in a selection. It exits with 0, with 1 when --gate finds a condition, and with 2 for a wrong use. See docs/reference/cli.md.
The spec command fills the marked sections of Markdown templates from the graph. See docs/guide/specs.md.
The schema command writes 1 JSON Schema for each kind of the profile. See docs/reference/schemas.md.
The export command writes the graph as RDF (turtle, jsonld), as SHACL shapes (shacl) or as a Cypher script (cypher).
With --workspace, it writes all graphs into 1 file. See docs/reference/export.md.`;

// Writes 1 JSON Schema for each kind of the profile. It returns the paths.
export function writeSchemas(profilePath: string, outDir: string): string[] {
  mkdirSync(resolve(outDir), { recursive: true });
  return Object.entries(kindSchemas(loadProfile(profilePath))).map(([kind, schema]) => {
    const file = join(outDir, `${kind}.schema.json`);
    writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
    return file;
  });
}

// Exports a graph, or all graphs of a workspace, as text. It throws on an error and returns the warnings.
export function exportText(flags: Record<string, string>, exclude: string[] = []): { text: string; warnings: string[] } {
  const format = flags.format ?? '';
  if (!isExportFormat(format)) throw new Error(`The option --format must be one of ${EXPORT_FORMATS.join(', ')}.`);
  const annotations = flags.annotations ?? 'annotation';
  if (annotations !== 'annotation' && annotations !== 'reified') throw new Error('The option --annotations must be annotation or reified.');
  const options: ExportOptions = { annotations };
  if (flags.workspace !== undefined) {
    const { data, warnings } = loadWorkspace(flags.workspace);
    return { text: exportWorkspace(data, format, options), warnings };
  }
  const { graph, profile, warnings } = loadInputs(flags.graph, flags.profile, exclude);
  return { text: exportModel(buildModel(graph, profile), format, options), warnings };
}

export interface PageChoice {
  // serve sets it. The page opens the event channel and asks serve for the source texts.
  live?: boolean;
  // build --sources puts the texts of the source files into the page.
  sources?: boolean;
}

interface Rendered {
  html: string;
  warnings: string[];
  // The source file of each node. serve reads the texts from it.
  files: SourceIndex;
}

export async function pageFor(graphPath: string, profilePath: string, exclude: string[] = [], choice: PageChoice = {}): Promise<Rendered> {
  const { graph, profile, files, warnings } = loadInputs(graphPath, profilePath, exclude);
  // The paths are relative to the profile. The source root is the folder of the profile.
  const base = dirname(resolve(profilePath));
  const found = nodeFiles(graph, profile, files, base);
  const index: SourceIndex = { root: base, base, graphs: new Map([[SINGLE_GRAPH, found]]) };
  const model = { ...buildModel(graph, profile), files: relativeFiles(found, base) };
  return { html: await renderPage(model, { live: choice.live, sources: choice.sources ? sourceTexts(index) : undefined }), warnings, files: index };
}

export async function workspacePageFor(workspacePath: string, choice: PageChoice = {}): Promise<Rendered> {
  const { data, warnings, files } = loadWorkspace(workspacePath);
  return { html: await renderPage(data, { live: choice.live, sources: choice.sources ? sourceTexts(files) : undefined }), warnings, files };
}

type Render = () => Promise<Rendered>;

// The paths that serve watches for a graph and a profile: the graph, the profile and its vocabulary files.
const inputPaths = (graph: string, profile: string) => [resolve(graph), resolve(profile), ...vocabularyPaths(profile)];

// The paths that serve watches for a workspace: the file, and for each graph and each view profile the same as for 1 graph.
// The function reads the workspace file itself, so it works while the file is not valid.
function workspacePaths(workspacePath: string): string[] {
  const out = [resolve(workspacePath)];
  try {
    const file = readInput(workspacePath, 'workspace') as { graphs?: { graph?: string; profile?: string }[]; views?: { profile?: string }[] };
    const base = dirname(resolve(workspacePath));
    for (const g of file.graphs ?? []) {
      if (typeof g.graph === 'string') out.push(resolve(base, g.graph));
      if (typeof g.profile === 'string') out.push(resolve(base, g.profile), ...vocabularyPaths(resolve(base, g.profile)));
    }
    for (const v of file.views ?? []) if (typeof v.profile === 'string') out.push(resolve(base, v.profile), ...vocabularyPaths(resolve(base, v.profile)));
  } catch {
    // The workspace file is not valid. serve reports it.
  }
  return out;
}

// Serves the page. serve reads the files again on each request and pushes a reload to each open page when a file changes.
export async function startServer(graphPath: string, profilePath: string, port: number, host: string, exclude: string[] = []): Promise<{ url: string; close: () => Promise<void> }> {
  return serve(() => pageFor(graphPath, profilePath, exclude, { live: true }), () => inputPaths(graphPath, profilePath), port, host);
}

// Serves a workspace page. It reads all inputs again on each request and on each change.
export async function startWorkspaceServer(workspacePath: string, port: number, host: string): Promise<{ url: string; close: () => Promise<void> }> {
  return serve(() => workspacePageFor(workspacePath, { live: true }), () => workspacePaths(workspacePath), port, host);
}

async function serve(render: Render, paths: () => string[], port: number, host: string): Promise<{ url: string; close: () => Promise<void> }> {
  let last = await render();
  last.warnings.forEach((w) => console.warn(`warning: ${w}`));
  const channel = new Channel();
  // The files that a change event reads again run 1 at a time.
  let queue: Promise<void> = Promise.resolve();
  const refresh = () => {
    queue = queue.then(async () => {
      try {
        last = await render();
        // The origin files of the nodes can differ in the new data.
        watcher.rewatch();
        channel.reload();
      } catch (e) {
        // The page keeps the last valid data and shows the error.
        channel.invalid((e as Error).message);
      }
    });
  };
  // The files of the nodes are watched too, because an origin file can lie outside the graph folder.
  const watcher = watchFiles(() => [...paths(), ...[...last.files.graphs.values()].flatMap((m) => [...m.values()])], refresh);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/events') {
      channel.add(res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/source') {
      const text = sourceText(last.files, url.searchParams.get('graph') ?? '', url.searchParams.get('node') ?? '');
      if (text === undefined) res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      else res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(text);
      return;
    }
    if (url.pathname !== '/' && url.pathname !== '/index.html') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    try {
      last = await render();
      watcher.rewatch();
    } catch (e) {
      // The last valid page is the answer. The open pages show the error.
      channel.invalid((e as Error).message);
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(last.html);
  });
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, ok);
  });
  const address = server.address();
  const actual = typeof address === 'object' && address ? address.port : port;
  return {
    url: `http://${host}:${actual}/`,
    close: () => {
      watcher.close();
      channel.close();
      return new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
    },
  };
}

// `flags` keeps the last value of each flag. `lists` keeps all values of each flag, in order.
export function parseArgs(argv: string[]): { command?: string; flags: Record<string, string>; lists: Record<string, string[]> } {
  const [command, ...rest] = argv;
  const flags: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
      const name = rest[i].slice(2);
      const value = rest[i + 1] ?? '';
      flags[name] = value;
      (lists[name] ??= []).push(value);
    }
    i++;
  }
  return { command, flags, lists };
}

export async function run(rawArgv: string[]): Promise<number> {
  const argv = rawArgv.filter((a) => a !== '--allow-command' && a !== '--allow-remote' && a !== '--sources');
  setPermissions({ command: rawArgv.includes('--allow-command'), remote: rawArgv.includes('--allow-remote') });
  const { command, flags, lists } = parseArgs(argv);
  const exclude = lists.exclude ?? [];
  if (command === '--version' || command === '-v') {
    console.log(versionLine());
    return 0;
  }
  if (command === 'version') {
    console.log('json' in flags ? JSON.stringify(buildInfo()) : versionLine());
    return 0;
  }
  if (!command || command === '--help' || command === 'help') {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  if (command === 'check') {
    try {
      const args = parseCheckArgs(argv.slice(1));
      const findings = sortFindings(checkInputs(args));
      console.log(args.json ? formatJson(findings, args.strict) : formatFindings(findings, args.strict));
      return exitCode(findings, args.strict);
    } catch (e) {
      console.error(e instanceof UsageError ? `${e.message}\n\n${USAGE}` : (e as Error).message);
      return e instanceof UsageError ? 2 : 1;
    }
  }
  if (command === 'search') {
    try {
      const args = parseSearchArgs(argv.slice(1));
      const { result, warnings } = await searchInputs(args);
      warnings.forEach((w) => console.error(`warning: ${w}`));
      console.log(args.json ? JSON.stringify(result) : formatHits(result, args.flags.workspace !== undefined && args.flags.in === undefined));
      return 0;
    } catch (e) {
      console.error((e as Error).message);
      return 1;
    }
  }
  if (command === 'index' || command === 'eval-search') {
    try {
      const { lines, warnings } = command === 'index' ? await indexInputs(parseIndexArgs(argv.slice(1))) : await evalSearch(parseEvalArgs(argv.slice(1)));
      warnings.forEach((w) => console.error(`warning: ${w}`));
      console.log(lines.join('\n'));
      return 0;
    } catch (e) {
      console.error((e as Error).message);
      return 1;
    }
  }
  if (command === 'slice') {
    try {
      const args = parseSliceArgs(argv.slice(1));
      const { result, warnings } = sliceInputs(args);
      warnings.forEach((w) => console.error(`warning: ${w}`));
      console.log(args.json ? JSON.stringify(result) : sliceMarkdown(result).trimEnd());
      return 0;
    } catch (e) {
      console.error((e as Error).message);
      return 1;
    }
  }
  if (command === 'coverage') {
    try {
      const args = parseCoverageArgs(argv.slice(1));
      const { result, warnings } = coverageInputs(args);
      warnings.forEach((w) => console.error(`warning: ${w}`));
      console.log(formatCoverage(result, args.json));
      return result.gate && !result.gate.pass ? 1 : 0;
    } catch (e) {
      console.error((e as Error).message);
      return 2;
    }
  }
  if (command === 'spec') {
    try {
      const args = parseSpecArgs(argv.slice(1));
      const outcome = specInputs(args);
      outcome.warnings.forEach((w) => console.error(`warning: ${w}`));
      const ok = outcome.findings.length === 0;
      console.log(args.json ? JSON.stringify({ ok, findings: outcome.findings, written: outcome.written, sections: outcome.sections }) : formatSpec(outcome, args));
      return ok ? 0 : 1;
    } catch (e) {
      console.error(e instanceof UsageError ? `${e.message}\n\n${USAGE}` : (e as Error).message);
      return e instanceof UsageError ? 2 : 1;
    }
  }
  if (command === 'deliverables') {
    try {
      const args = parseDeliverablesArgs(argv.slice(1));
      const { result, withGraph, warnings } = deliverablesInputs(args);
      warnings.forEach((w) => console.error(`warning: ${w}`));
      console.log(args.json ? JSON.stringify(result) : formatDeliverables(result, withGraph));
      return 0;
    } catch (e) {
      console.error((e as Error).message);
      return 1;
    }
  }
  if (command === 'schema') {
    if (!flags.profile || !flags.out) {
      console.error(`The options --profile and --out are required.\n\n${USAGE}`);
      return 1;
    }
    try {
      const files = writeSchemas(flags.profile, flags.out);
      console.log(`wrote ${files.length} schemas to ${flags.out}`);
      return 0;
    } catch (e) {
      console.error((e as Error).message);
      return 1;
    }
  }
  if (command === 'export') {
    if (flags.workspace !== undefined ? flags.graph !== undefined || flags.profile !== undefined || exclude.length : !flags.graph || !flags.profile) {
      console.error(`Use --workspace alone, or use --graph and --profile.\n\n${USAGE}`);
      return 1;
    }
    if (!flags.format || !flags.out) {
      console.error(`The options --format and --out are required.\n\n${USAGE}`);
      return 1;
    }
    try {
      const { text, warnings } = exportText(flags, exclude);
      warnings.forEach((w) => console.warn(`warning: ${w}`));
      mkdirSync(dirname(resolve(flags.out)), { recursive: true });
      writeFileSync(flags.out, text);
      console.log(`wrote ${flags.out} (${(Buffer.byteLength(text) / 1024).toFixed(0)} KB)`);
      return 0;
    } catch (e) {
      console.error((e as Error).message);
      return 1;
    }
  }
  if (command !== 'serve' && command !== 'build' && command !== 'mcp') {
    console.error(`Unknown command "${command}".\n\n${USAGE}`);
    return 1;
  }
  if (flags.workspace !== undefined && (flags.graph !== undefined || flags.profile !== undefined || exclude.length)) {
    console.error(`The option --workspace cannot combine with --graph, --profile or --exclude.\n\n${USAGE}`);
    return 1;
  }
  if (flags.workspace === undefined && (!flags.graph || !flags.profile)) {
    console.error(`The options --graph and --profile are required.\n\n${USAGE}`);
    return 1;
  }
  try {
    if (command === 'mcp') {
      // Stdout carries only protocol messages. The command writes everything else to stderr.
      const loader = mcpLoader(flags, exclude);
      loader().warnings.forEach((w) => console.error(`warning: ${w}`));
      await serveStdio({ version: buildInfo().version, loader });
      return 0;
    }
    if (command === 'build') {
      if (!flags.out) {
        console.error(`The option --out is required.\n\n${USAGE}`);
        return 1;
      }
      const choice = { sources: rawArgv.includes('--sources') };
      const { html, warnings } = flags.workspace !== undefined ? await workspacePageFor(flags.workspace, choice) : await pageFor(flags.graph, flags.profile, exclude, choice);
      warnings.forEach((w) => console.warn(`warning: ${w}`));
      mkdirSync(dirname(resolve(flags.out)), { recursive: true });
      writeFileSync(flags.out, html);
      console.log(`wrote ${flags.out} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
      return 0;
    }
    const port = Number(flags.port ?? 4173);
    const host = flags.host || '127.0.0.1';
    const { url } = flags.workspace !== undefined ? await startWorkspaceServer(flags.workspace, port, host) : await startServer(flags.graph, flags.profile, port, host, exclude);
    console.log(`Semspec is at ${url}`);
    return await new Promise<number>(() => undefined);
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
}

// The entry point runs only when this file is the program, not when a test imports it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
