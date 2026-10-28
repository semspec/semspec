// SPDX-License-Identifier: Apache-2.0
// The command line tool.
//   requirement-explorer serve --graph <file> --profile <file> [--port 4173] [--host 127.0.0.1]
//   requirement-explorer build --graph <file> --profile <file> --out <file.html>
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildModel, type Graph, type Profile } from '../core/index';
import { renderPage } from './page';
import { validateGraph, validateProfile } from './validate';

const USAGE = `Requirement Explorer

Usage:
  requirement-explorer serve --graph <file> --profile <file> [--port 4173] [--host 127.0.0.1]
  requirement-explorer build --graph <file> --profile <file> --out <file.html>

The graph and the profile are JSON files. See the README for their formats.`;

function readJson(path: string, what: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`Cannot read the ${what} "${path}": ${(e as Error).message}`);
  }
}

// Reads and checks both inputs. It throws on an error and returns the warnings.
export function loadInputs(graphPath: string, profilePath: string): { graph: Graph; profile: Profile; warnings: string[] } {
  const profile = readJson(profilePath, 'profile');
  const problems = validateProfile(profile);
  if (problems.length) throw new Error(`The profile "${profilePath}" is not valid:\n  ${problems.join('\n  ')}`);
  const graph = readJson(graphPath, 'graph') as Graph;
  const checked = validateGraph(graph, profile as Profile);
  if (checked.errors.length) throw new Error(`The graph "${graphPath}" is not valid:\n  ${checked.errors.slice(0, 20).join('\n  ')}`);
  return { graph, profile: profile as Profile, warnings: checked.warnings };
}

export async function pageFor(graphPath: string, profilePath: string): Promise<{ html: string; warnings: string[] }> {
  const { graph, profile, warnings } = loadInputs(graphPath, profilePath);
  return { html: await renderPage(buildModel(graph, profile)), warnings };
}

// Serves the page. The server reads the files again on each request, so a reload shows an edit.
export async function startServer(graphPath: string, profilePath: string, port: number, host: string): Promise<{ url: string; close: () => Promise<void> }> {
  const first = await pageFor(graphPath, profilePath);
  first.warnings.forEach((w) => console.warn(`warning: ${w}`));
  const server = createServer(async (req, res) => {
    if (req.url !== '/' && req.url !== '/index.html') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    try {
      const { html } = await pageFor(graphPath, profilePath);
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

function parseArgs(argv: string[]): { command?: string; flags: Record<string, string> } {
  const [command, ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[i + 1] ?? '';
    i++;
  }
  return { command, flags };
}

export async function run(argv: string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);
  if (!command || command === '--help' || command === 'help') {
    console.log(USAGE);
    return command ? 0 : 1;
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
      const { html, warnings } = await pageFor(flags.graph, flags.profile);
      warnings.forEach((w) => console.warn(`warning: ${w}`));
      mkdirSync(dirname(resolve(flags.out)), { recursive: true });
      writeFileSync(flags.out, html);
      console.log(`wrote ${flags.out} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
      return 0;
    }
    const { url } = await startServer(flags.graph, flags.profile, Number(flags.port ?? 4173), flags.host || '127.0.0.1');
    console.log(`Requirement Explorer is at ${url}`);
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
