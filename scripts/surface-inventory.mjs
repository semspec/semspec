// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Lists the user-visible surface of Semspec and names the requirement that covers each item.
// An item is a CLI command or flag, an MCP tool or resource, a key of the profile or the workspace schema,
// a page of the site or a control of the app. The file requirements/surface.yaml maps items to requirement ids.
// An item with no requirement is a finding.
// Run `node scripts/surface-inventory.mjs [--json] [--missing]` from the repository root.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const MAPPING_FILE = 'requirements/surface.yaml';
const GRAPH_FOLDER = 'requirements/graph';

export const KINDS = ['cli-command', 'cli-flag', 'mcp-tool', 'mcp-resource', 'profile-key', 'workspace-key', 'site-page', 'app-control'];

const read = (root, file) => readFileSync(join(root, file), 'utf8');

// All files below a folder that match a test, as paths relative to the root, sorted.
function walk(root, folder, test) {
  const out = [];
  const visit = (dir) => {
    for (const entry of readdirSync(join(root, dir)).sort()) {
      const path = `${dir}/${entry}`;
      if (statSync(join(root, path)).isDirectory()) visit(path);
      else if (test(path)) out.push(path);
    }
  };
  if (existsSync(join(root, folder))) visit(folder);
  return out;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// The commands and the flags of the USAGE text of the CLI.
export function cliItems(root) {
  const file = 'packages/cli/src/index.ts';
  const text = read(root, file);
  const usage = /const USAGE = `([\s\S]*?)`;/.exec(text);
  if (!usage) throw new Error(`No USAGE text found in ${file}.`);
  const items = [];
  const seen = new Set();
  const add = (kind, name) => {
    if (seen.has(`${kind} ${name}`)) return;
    seen.add(`${kind} ${name}`);
    items.push({ kind, name, source: file });
  };
  for (const line of usage[1].split('\n')) {
    const command = /^ {2}semspec ([a-z][a-z-]*)/.exec(line);
    if (command) add('cli-command', command[1]);
    // The short flag -v is the alternative of --version.
    if (/^ {2}semspec --version \| -v/.test(line)) add('cli-flag', '-v');
    for (const flag of line.matchAll(/(?<![\w-])--[a-z][a-z-]*/g)) add('cli-flag', flag[0]);
  }
  return items;
}

// The tools and the resources of the MCP server.
export function mcpItems(root) {
  const toolsFile = 'packages/mcp/src/tools.ts';
  const serverFile = 'packages/mcp/src/index.ts';
  const tools = read(root, toolsFile);
  const start = tools.indexOf('export const TOOLS');
  if (start < 0) throw new Error(`No TOOLS list found in ${toolsFile}.`);
  const items = [...tools.slice(start).matchAll(/^ {4}name: '([^']+)',/gm)].map((m) => ({ kind: 'mcp-tool', name: m[1], source: toolsFile }));
  const server = read(root, serverFile);
  const pattern = /RESOURCE_PATH = \/\^semspec:\\\/\\\/\(\[\^\/\]\+\)\\\/\(([^)]+)\)\$\//.exec(server);
  if (!pattern) throw new Error(`No RESOURCE_PATH found in ${serverFile}.`);
  for (const name of pattern[1].split('|')) items.push({ kind: 'mcp-resource', name: `semspec://<graph>/${name}`, source: serverFile });
  return items;
}

// The top-level keys of the profile and the workspace schemas.
export function schemaItems(root) {
  const items = [];
  for (const [file, kind] of [['schema/profile.schema.json', 'profile-key'], ['schema/workspace.schema.json', 'workspace-key']]) {
    for (const name of Object.keys(JSON.parse(read(root, file)).properties ?? {})) items.push({ kind, name, source: file });
  }
  return items;
}

// The pages of the site: the routes of the router. The pages of the docs share the route `doc`.
export function siteItems(root) {
  const file = 'site/src/app.tsx';
  const text = read(root, file);
  const route = /export type Route =([^;]+);/.exec(text);
  if (!route) throw new Error(`No Route type found in ${file}.`);
  return [...route[1].matchAll(/name: '([^']+)'/g)].map((m) => ({ kind: 'site-page', name: m[1], source: file }));
}

// The end of an opening tag that starts at `from`: the index after its `>`. Braces and quotes hide a `>`.
function tagEnd(text, from) {
  let depth = 0;
  let quote = '';
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (depth === 0 && c === '"') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0 && c === '>') return i + 1;
  }
  return -1;
}

const LABELLED = /^(Button|Toggle|\w+Trigger|\w+Item)$/;

// The controls of the app with a name in the source: the literal aria-label values, and the literal text of buttons and menu items.
// A name that the code builds at run time is skipped and listed in `skipped`.
export function appScan(root) {
  const items = [];
  const skipped = [];
  const seen = new Set();
  const files = walk(root, 'packages/app/src', (p) => p.endsWith('.tsx') && !p.includes('/components/ui/'));
  for (const file of files) {
    const text = read(root, file);
    const add = (name, index) => {
      const source = `${file}:${lineOf(text, index)}`;
      if (!name) return;
      if (seen.has(name)) return;
      seen.add(name);
      items.push({ kind: 'app-control', name, source });
    };
    const skip = (name, index, reason) => skipped.push({ kind: 'app-control', name, source: `${file}:${lineOf(text, index)}`, reason });
    for (const m of text.matchAll(/aria-label=(?:"([^"]*)"|\{((?:[^{}]|\$\{[^}]*\})*)\})/g)) {
      if (m[1] !== undefined) add(m[1], m.index);
      else {
        const literal = /^\s*(['"])([^'"`]*)\1\s*$/.exec(m[2]);
        if (literal) add(literal[2], m.index);
        else skip(`aria-label={${m[2].trim()}}`, m.index, 'dynamic aria-label');
      }
    }
    for (const m of text.matchAll(/<([A-Z]\w*)(?=[\s>])/g)) {
      if (!LABELLED.test(m[1])) continue;
      const end = tagEnd(text, m.index + m[0].length);
      if (end < 0 || text[end - 2] === '/') continue;
      const close = text.indexOf(`</${m[1]}>`, end);
      if (close < 0) continue;
      const children = text
        .slice(end, close)
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/<[A-Z]\w*(?:\s[^<>]*?)?\/>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!children) continue;
      if (/[{<]/.test(children)) skip(children, m.index, 'dynamic text');
      else add(children, m.index);
    }
  }
  return { items, skipped };
}

// All items and the skipped dynamic names, with no requirement attached.
export function surfaceScan(root) {
  const app = appScan(root);
  const items = [...cliItems(root), ...mcpItems(root), ...schemaItems(root), ...siteItems(root), ...app.items];
  return { items, skipped: app.skipped };
}

// The mapping of kind and name to requirement id. A missing file is an empty mapping.
export function loadMapping(root) {
  if (!existsSync(join(root, MAPPING_FILE))) return {};
  return parse(read(root, MAPPING_FILE)) ?? {};
}

// The ids of the nodes of the requirement graph and their kinds: a Map of id to kind.
export function graphNodes(root) {
  const nodes = new Map();
  for (const file of walk(root, GRAPH_FOLDER, (p) => /\.ya?ml$/.test(p))) {
    const data = parse(read(root, file));
    for (const node of Array.isArray(data?.nodes) ? data.nodes : [data]) {
      if (node && typeof node.id === 'string') nodes.set(node.id, node.kind);
    }
  }
  return nodes;
}

// The items with the requirement of the mapping, or null.
export function surfaceInventory(root) {
  const mapping = loadMapping(root);
  return surfaceScan(root).items.map((item) => ({ ...item, requirement: mapping[item.kind]?.[item.name] ?? null }));
}

// The findings of a list of items against a mapping and the nodes of the graph (a Map of id to kind).
// A finding is an item with no requirement, an item whose requirement is not in the graph,
// and a mapping entry for an item that does not exist.
export function findingsOf(items, mapping, nodes) {
  const findings = [];
  const label = (item) => `${item.kind} ${item.name}`;
  for (const item of items) {
    const id = mapping[item.kind]?.[item.name];
    if (!id) findings.push({ item: label(item), message: `The ${item.kind} "${item.name}" has no requirement in ${MAPPING_FILE}.` });
    else if (!nodes.has(id)) findings.push({ item: label(item), message: `The ${item.kind} "${item.name}" maps to the unknown requirement "${id}".` });
    else if (nodes.get(id) !== 'requirement') findings.push({ item: label(item), message: `The ${item.kind} "${item.name}" maps to "${id}", which is not a requirement.` });
  }
  const known = new Set(items.map(label));
  for (const [kind, names] of Object.entries(mapping)) {
    for (const name of Object.keys(names ?? {})) {
      if (!known.has(`${kind} ${name}`)) findings.push({ item: `${kind} ${name}`, message: `${MAPPING_FILE} lists the ${kind} "${name}", which is not in the inventory.` });
    }
  }
  return findings;
}

// The check for scripts/self-check.mjs.
export function surfaceFindings(root) {
  return { check: 'surface', findings: findingsOf(surfaceScan(root).items, loadMapping(root), graphNodes(root)) };
}

function markdown(items, skipped, onlyMissing) {
  const lines = ['# Surface inventory', ''];
  for (const kind of KINDS) {
    const list = items.filter((i) => i.kind === kind && (!onlyMissing || !i.requirement));
    const covered = items.filter((i) => i.kind === kind && i.requirement).length;
    const total = items.filter((i) => i.kind === kind).length;
    lines.push(`## ${kind} (${covered} of ${total} covered)`, '');
    for (const i of list) lines.push(`- \`${i.name}\`: ${i.requirement ?? 'NO REQUIREMENT'} (${i.source})`);
    lines.push('');
  }
  lines.push(`## Skipped: ${skipped.length} app controls with a dynamic name`, '');
  for (const s of skipped) lines.push(`- \`${s.name}\` (${s.source}, ${s.reason})`);
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--json' && a !== '--missing');
  if (unknown.length) {
    console.error('Use: node scripts/surface-inventory.mjs [--json] [--missing]');
    process.exit(2);
  }
  const root = process.cwd();
  const items = surfaceInventory(root);
  const skipped = surfaceScan(root).skipped;
  const onlyMissing = args.includes('--missing');
  if (args.includes('--json')) {
    console.log(JSON.stringify({ items: onlyMissing ? items.filter((i) => !i.requirement) : items, skipped, findings: surfaceFindings(root).findings }, null, 2));
  } else {
    console.log(markdown(items, skipped, onlyMissing));
  }
  process.exit(0);
}
