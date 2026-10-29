// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The command line tool.
//   semspec serve --graph <file> --profile <file> [--port 4173] [--host 127.0.0.1] [--exclude <pattern>]...
//   semspec build --graph <file> --profile <file> --out <file.html> [--exclude <pattern>]...
//   semspec schema --profile <file> --out <dir>
// A graph is a JSON file, a YAML file, or a folder of YAML files. A profile is a JSON or YAML file.
// --exclude skips the paths of a graph folder that match a pattern. It can repeat.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildModel, kindSchemas, type Graph, type Profile } from '../core/index';
import { renderPage } from './page';
import { validateGraph, validateProfile } from './validate';
import { isYamlPath, readGraphFolder, readYaml } from './yaml';

const USAGE = `Semspec

Usage:
  semspec serve --graph <file> --profile <file> [--port 4173] [--host 127.0.0.1] [--exclude <pattern>]...
  semspec build --graph <file> --profile <file> --out <file.html> [--exclude <pattern>]...
  semspec schema --profile <file> --out <dir>

The graph is a JSON file, a YAML file or a folder of YAML files. The profile is a JSON or YAML file.
--exclude skips the folders and files of a graph folder that match a pattern. The option can repeat.
A pattern matches a path relative to the graph folder. It supports *, ** and ?.
The schema command writes 1 JSON Schema for each kind of the profile. See the README for the formats.`;

function readInput(path: string, what: string): unknown {
  if (isYamlPath(path)) return readYaml(path, what);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`Cannot read the ${what} "${path}": ${(e as Error).message}`);
  }
}

// Reads and checks the profile. It throws on an error.
export function loadProfile(profilePath: string): Profile {
  const profile = readInput(profilePath, 'profile');
  const problems = validateProfile(profile);
  if (problems.length) throw new Error(`The profile "${profilePath}" is not valid:\n  ${problems.join('\n  ')}`);
  return profile as Profile;
}

// Reads and checks both inputs. It throws on an error and returns the warnings.
// `exclude` holds the patterns of the paths to skip in a graph folder.
export function loadInputs(graphPath: string, profilePath: string, exclude: string[] = []): { graph: Graph; profile: Profile; warnings: string[] } {
  const profile = loadProfile(profilePath);
  let labels: string[] | undefined;
  let graph: Graph;
  const extra: string[] = [];
  if (isDirectory(graphPath)) ({ graph, labels } = readGraphFolder(graphPath, profile, exclude));
  else {
    graph = readInput(graphPath, 'graph') as Graph;
    if (exclude.length) extra.push('The option --exclude has no effect because the graph is a file, not a folder.');
  }
  const checked = validateGraph(graph, profile, labels);
  if (checked.errors.length) throw new Error(`The graph "${graphPath}" is not valid:\n  ${checked.errors.slice(0, 20).join('\n  ')}`);
  return { graph, profile, warnings: [...extra, ...checked.warnings] };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// Writes 1 JSON Schema for each kind of the profile. It returns the paths.
export function writeSchemas(profilePath: string, outDir: string): string[] {
  mkdirSync(resolve(outDir), { recursive: true });
  return Object.entries(kindSchemas(loadProfile(profilePath))).map(([kind, schema]) => {
    const file = join(outDir, `${kind}.schema.json`);
    writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
    return file;
  });
}

export async function pageFor(graphPath: string, profilePath: string, exclude: string[] = []): Promise<{ html: string; warnings: string[] }> {
  const { graph, profile, warnings } = loadInputs(graphPath, profilePath, exclude);
  return { html: await renderPage(buildModel(graph, profile)), warnings };
}

// Serves the page. The server reads the files again on each request, so a reload shows an edit.
export async function startServer(graphPath: string, profilePath: string, port: number, host: string, exclude: string[] = []): Promise<{ url: string; close: () => Promise<void> }> {
  const first = await pageFor(graphPath, profilePath, exclude);
  first.warnings.forEach((w) => console.warn(`warning: ${w}`));
  const server = createServer(async (req, res) => {
    if (req.url !== '/' && req.url !== '/index.html') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    try {
      const { html } = await pageFor(graphPath, profilePath, exclude);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end((e as Error).message);
    }
  });
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, ok);
  });
  const address = server.address();
  const actual = typeof address === 'object' && address ? address.port : port;
  return { url: `http://${host}:${actual}/`, close: () => new Promise<void>((done) => server.close(() => done())) };
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

export async function run(argv: string[]): Promise<number> {
  const { command, flags, lists } = parseArgs(argv);
  const exclude = lists.exclude ?? [];
  if (!command || command === '--help' || command === 'help') {
    console.log(USAGE);
    return command ? 0 : 1;
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
  if (command !== 'serve' && command !== 'build') {
    console.error(`Unknown command "${command}".\n\n${USAGE}`);
    return 1;
  }
  if (!flags.graph || !flags.profile) {
    console.error(`The options --graph and --profile are required.\n\n${USAGE}`);
    return 1;
  }
  try {
    if (command === 'build') {
      if (!flags.out) {
        console.error(`The option --out is required.\n\n${USAGE}`);
        return 1;
      }
      const { html, warnings } = await pageFor(flags.graph, flags.profile, exclude);
      warnings.forEach((w) => console.warn(`warning: ${w}`));
      mkdirSync(dirname(resolve(flags.out)), { recursive: true });
      writeFileSync(flags.out, html);
      console.log(`wrote ${flags.out} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
      return 0;
    }
    const { url } = await startServer(flags.graph, flags.profile, Number(flags.port ?? 4173), flags.host || '127.0.0.1', exclude);
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
