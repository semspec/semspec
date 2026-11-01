// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Checks the licences of the installed packages against the rule in CONTRIBUTING.md.
//
// The shipped set holds the production closure of the root package and of packages/core, and every
// package that a bundle inlines. A package in this set needs a shipped licence. The tools set holds
// every other installed package. It may also use the tool licences.
//
// Bundled code, found in 2 ways:
// - CLI bundle: an esbuild run with a metafile lists every input file. The files below node_modules
//   give the packages. This is exact, because esbuild decides what it inlines.
// - App bundle: Vite gives no list of inputs. The script reads the imports of packages/app/src and
//   adds each imported package with its production closure. A package that only a style sheet
//   imports counts alone, without its dependencies. The list can be too wide, never too narrow.
//
// Usage: node scripts/check-licences.mjs [--root <dir>] [--json]
// Exit code 1 means a violation.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHIPPED = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD'];
const TOOLS = [...SHIPPED, 'BlueOak-1.0.0', 'CC0-1.0', 'MIT-0', 'CC-BY-4.0', 'MPL-2.0'];

// Tool packages with a reviewed licence that the rule does not list. Each key is name@version, so a
// new version needs a new review. A shipped package never uses this list.
// spawndamnit: the field says "SEE LICENSE IN LICENSE", and that file is the MIT text.
// argparse: Python-2.0 is a permissive licence. A dev tool (js-yaml of @changesets/cli) reads it, and no bundle inlines it.
const REVIEWED_TOOLS = new Map([
  ['spawndamnit@3.0.1', 'SEE LICENSE IN LICENSE'],
  ['argparse@2.0.1', 'Python-2.0'],
]);

const args = process.argv.slice(2);
const rootArg = args.indexOf('--root');
const root = realpathSync(resolve(rootArg >= 0 ? args[rootArg + 1] : fileURLToPath(new URL('..', import.meta.url))));
const asJson = args.includes('--json');

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};

// Returns the licence of a manifest as 1 SPDX expression, or undefined when the manifest has none.
export function licenceOf(pkg) {
  const one = (l) => (typeof l === 'string' ? l : l && typeof l.type === 'string' ? l.type : undefined);
  const list = (arr) => {
    const items = arr.map(one).filter(Boolean);
    return items.length === 0 ? undefined : items.length === 1 ? items[0] : `(${items.join(' OR ')})`;
  };
  if (Array.isArray(pkg.license)) return list(pkg.license);
  const direct = one(pkg.license);
  if (direct) return direct;
  if (Array.isArray(pkg.licenses)) return list(pkg.licenses);
  return one(pkg.licenses);
}

// True when an SPDX expression is allowed. OR needs 1 allowed option. AND needs all options allowed.
export function isAllowed(expression, allowed) {
  const ids = new Set(allowed.map((a) => a.toLowerCase()));
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const atom = () => {
    if (tokens[i] === '(') {
      i++;
      const v = or();
      if (tokens[i] !== ')') throw new Error('Unbalanced parenthesis');
      i++;
      return v;
    }
    const id = tokens[i++];
    if (id === undefined || /^(and|or|with)$/i.test(id)) throw new Error('Expected a licence');
    let ok = ids.has(id.replace(/\+$/, '').toLowerCase());
    if (tokens[i] && /^with$/i.test(tokens[i])) i += 2;
    return ok;
  };
  const and = () => {
    let v = atom();
    while (tokens[i] && /^and$/i.test(tokens[i])) {
      i++;
      const r = atom();
      v = v && r;
    }
    return v;
  };
  const or = () => {
    let v = and();
    while (tokens[i] && /^or$/i.test(tokens[i])) {
      i++;
      const r = and();
      v = v || r;
    }
    return v;
  };
  try {
    const v = or();
    return i === tokens.length && v;
  } catch {
    return false;
  }
}

// Finds the directory of a package like Node does: the nearest node_modules above `from`.
function resolvePackage(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(dir) === dir) return undefined;
  }
}

// The package directory of a file below node_modules, or undefined for other files.
function packageOfFile(file) {
  const marker = `${sep}node_modules${sep}`;
  const at = file.lastIndexOf(marker);
  if (at < 0) return undefined;
  const parts = file.slice(at + marker.length).split(sep);
  const name = parts[0].startsWith('@') ? parts.slice(0, 2).join(sep) : parts[0];
  const dir = file.slice(0, at + marker.length) + name;
  return existsSync(join(dir, 'package.json')) ? realpathSync(dir) : undefined;
}

// Walks the dependency fields from the start directories. Returns Map<dir, { pkg, via }>, where
// `via` is the dir of the package that pulls it in first.
function walk(starts, fields) {
  const found = new Map();
  const queue = [];
  for (const dir of starts) {
    const real = realpathSync(dir);
    const pkg = readJson(join(real, 'package.json'));
    if (pkg && !found.has(real)) {
      found.set(real, { pkg, via: undefined });
      queue.push(real);
    }
  }
  while (queue.length > 0) {
    const dir = queue.shift();
    const { pkg } = found.get(dir);
    for (const field of fields) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        const target = resolvePackage(name, dir);
        if (!target || found.has(target)) continue;
        const child = readJson(join(target, 'package.json'));
        if (!child) continue;
        found.set(target, { pkg: child, via: dir });
        queue.push(target);
      }
    }
  }
  return found;
}

// Every installed package below the node_modules folders of the root and of the workspaces.
function installed(folders) {
  const found = new Map();
  const visit = (nm) => {
    let entries;
    try {
      entries = readdirSync(nm, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const names = e.name.startsWith('@') ? readdirSync(join(nm, e.name)).map((n) => `${e.name}/${n}`) : [e.name];
      for (const name of names) {
        const path = join(nm, name);
        if (!existsSync(join(path, 'package.json'))) continue;
        const real = realpathSync(path);
        if (found.has(real)) continue;
        found.set(real, { pkg: readJson(join(real, 'package.json')) ?? {}, via: undefined });
        visit(join(real, 'node_modules'));
      }
    }
  };
  for (const folder of folders) visit(join(folder, 'node_modules'));
  return found;
}

const rootPkg = readJson(join(root, 'package.json'));
if (!rootPkg) {
  console.error(`No package.json in ${root}`);
  process.exit(2);
}
const workspaceDirs = [];
const packagesDir = join(root, 'packages');
if (existsSync(packagesDir)) {
  for (const name of readdirSync(packagesDir)) {
    if (existsSync(join(packagesDir, name, 'package.json'))) workspaceDirs.push(realpathSync(join(packagesDir, name)));
  }
}
const coreDir = join(packagesDir, 'core');

// The production closure of the published packages.
const PROD = ['dependencies', 'optionalDependencies'];
const shipped = walk([root, ...(existsSync(join(coreDir, 'package.json')) ? [coreDir] : [])], PROD);
const bundledBy = new Map(); // package dir -> reason

// Adds a package and its production closure to the shipped set.
function addShipped(dir, reason, withClosure) {
  const starts = withClosure ? [dir] : [];
  const extra = withClosure ? walk(starts, PROD) : new Map([[dir, { pkg: readJson(join(dir, 'package.json')), via: undefined }]]);
  for (const [d, info] of extra) {
    if (shipped.has(d)) continue;
    shipped.set(d, { ...info, via: d === dir ? undefined : info.via });
    bundledBy.set(d, reason);
  }
}

// CLI bundle: the inputs that esbuild inlines.
const cliEntry = join(root, 'packages', 'cli', 'src', 'index.ts');
if (existsSync(cliEntry)) {
  let esbuild;
  try {
    esbuild = await import(pathToEsbuild());
  } catch {
    console.error('esbuild is not installed, so the CLI bundle cannot be listed.');
    process.exit(2);
  }
  let result;
  try {
    result = await esbuild.build({
    entryPoints: [cliEntry],
    outfile: join(root, 'packages', 'cli', 'dist', 'index.js'),
    tsconfig: join(root, 'tsconfig.json'),
    bundle: true,
    write: false,
    metafile: true,
    logLevel: 'silent',
    platform: 'node',
    format: 'esm',
    target: 'node20',
    // The bundle step also keeps vite out. Only a checkout without a built app uses it.
    external: ['vite'],
    });
  } catch (error) {
    console.error(`The CLI bundle failed, so its packages cannot be listed: ${error.message}`);
    process.exit(2);
  }
  const dirs = new Set();
  for (const input of Object.keys(result.metafile.inputs)) {
    const dir = packageOfFile(resolve(root, input));
    if (dir) dirs.add(dir);
  }
  for (const dir of dirs) addShipped(dir, 'CLI bundle', true);
}

// App bundle: the packages that the app source imports.
const appSrc = join(root, 'packages', 'app', 'src');
if (existsSync(appSrc)) {
  const appDir = join(root, 'packages', 'app');
  const jsNames = new Set();
  const cssNames = new Set();
  const nameOf = (spec) => {
    if (/^(\.|\/|@\/|node:|@semspec\/)/.test(spec)) return undefined;
    const p = spec.split('/');
    return spec.startsWith('@') ? p.slice(0, 2).join('/') : p[0];
  };
  const scan = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) scan(path);
      else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) {
        const text = readFileSync(path, 'utf8');
        for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)) {
          const n = nameOf(m[1]);
          if (n) jsNames.add(n);
        }
      } else if (e.name.endsWith('.css')) {
        const text = readFileSync(path, 'utf8');
        for (const m of text.matchAll(/@(?:import|plugin)\s+['"]([^'"]+)['"]/g)) {
          const n = nameOf(m[1]);
          if (n) cssNames.add(n);
        }
      }
    }
  };
  scan(appSrc);
  for (const [names, closure] of [[cssNames, false], [jsNames, true]]) {
    for (const name of names) {
      const dir = resolvePackage(name, appDir);
      if (dir) addShipped(dir, 'App bundle', closure);
    }
  }
}

const everything = installed([root, ...workspaceDirs]);
const toolSet = new Map([...everything].filter(([dir]) => !shipped.has(dir)));
for (const dir of workspaceDirs) toolSet.delete(dir);
toolSet.delete(root);
// Gives the tools their path: who pulls them in, when a walk from the workspaces reaches them.
const reach = walk([root, ...workspaceDirs], [...PROD, 'devDependencies', 'peerDependencies']);

const label = (info) => `${info.pkg.name ?? '?'}@${info.pkg.version ?? '?'}`;
function pathOf(dir, map) {
  const chain = [];
  const seen = new Set();
  for (let d = dir; d && !seen.has(d); ) {
    seen.add(d);
    const info = map.get(d);
    if (!info) break;
    chain.unshift(label(info));
    d = info.via;
  }
  const reason = bundledBy.get(dir);
  if (reason) chain.unshift(reason);
  return chain.join(' > ');
}

function check(map, allowed, isShipped, via) {
  const rows = [];
  for (const [dir, info] of map) {
    const licence = licenceOf(info.pkg);
    const row = { name: info.pkg.name ?? dir, version: info.pkg.version ?? '?', licence: licence ?? '(none)', status: 'ok', path: pathOf(dir, via(dir)) };
    const reviewed = !isShipped && REVIEWED_TOOLS.get(`${row.name}@${row.version}`) === licence;
    if (!licence) row.status = isShipped ? 'violation' : 'warning';
    else if (!isAllowed(licence, allowed) && !reviewed) row.status = 'violation';
    row.outside = !licence || !isAllowed(licence, SHIPPED);
    rows.push(row);
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

const shippedRows = check(shipped, SHIPPED, true, () => shipped);
const toolRows = check(toolSet, TOOLS, false, (dir) => (reach.has(dir) ? reach : toolSet));

const report = { shipped: shippedRows, tools: toolRows };
const violations = [...shippedRows, ...toolRows].filter((r) => r.status === 'violation');
const warnings = toolRows.filter((r) => r.status === 'warning');

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const table = (title, rows) => {
    const counts = new Map();
    for (const r of rows) counts.set(r.licence, (counts.get(r.licence) ?? 0) + 1);
    console.log(`${title}: ${rows.length} packages`);
    for (const [l, n] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) console.log(`  ${String(n).padStart(4)}  ${l}`);
    const outside = rows.filter((r) => r.outside);
    if (outside.length > 0) {
      console.log('  Outside the shipped list:');
      for (const r of outside) console.log(`    ${r.name}@${r.version}  ${r.licence}  [${r.status}]`);
    }
    console.log('');
  };
  table('Shipped set', shippedRows);
  table('Tools set', toolRows);
  for (const w of warnings) console.log(`warning: ${w.name}@${w.version} has no licence field. Path: ${w.path}`);
  for (const v of violations) console.log(`VIOLATION: ${v.name}@${v.version} has the licence ${v.licence}. Path: ${v.path}`);
  console.log(violations.length > 0 ? `\n${violations.length} violation(s).` : '\nNo violation.');
}
process.exitCode = violations.length > 0 ? 1 : 0;

// The path of the esbuild module, found from the root first, then from this script.
function pathToEsbuild() {
  const dir = resolvePackage('esbuild', join(root, 'packages', 'cli')) ?? resolvePackage('esbuild', root);
  if (!dir) throw new Error('no esbuild');
  const pkg = readJson(join(dir, 'package.json'));
  const main = typeof pkg.exports?.['.'] === 'string' ? pkg.exports['.'] : pkg.exports?.['.']?.import ?? pkg.exports?.['.']?.default ?? pkg.main ?? 'lib/main.js';
  return pathToFileHref(join(dir, main));
}
function pathToFileHref(p) {
  return new URL(`file://${p}`).href;
}
