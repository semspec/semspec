// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The self-check of the Semspec repository. It loads the requirement graph with its test evidence,
// runs the checks of CHECKS and prints the findings grouped by check, as Markdown or as JSON (--json).
// The exit code is 0, except with --strict: then it is 1 when there is a finding. A wrong use or an unreadable input gives 2.
// Usage: node scripts/self-check.mjs [--strict] [--json] [--all]
//   [--graph <folder>] [--profile <file>] [--report <vitest.json>] [--exemptions <file>] [--root <folder>]
// To add a check, add 1 entry to CHECKS. A check is `{ id, title, run(context) }`, and `run` returns a list of finding texts.
// The context has the fields that `loadContext` builds.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { surfaceFindings } from './surface-inventory.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The words of the repository profile that the checks read.
const DRAFT = 'draft';
const NOTE = 'note';
const PRIORITY = 'priority';
const SHOWN_BY_DEFAULT = 20;

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const testKey = (file, name) => `${file}\u0000${name}`;
const label = (file, name) => `${file}: ${name}`;

// ---------- context ----------

function readYamlFile(path, what) {
  try {
    return parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`Cannot read the ${what} "${path}": ${e.message}`);
  }
}

// The tests of a Vitest JSON report, with the file relative to the root. It returns null when the report does not exist.
export function readReport(path, root) {
  if (!existsSync(path)) return null;
  let report;
  try {
    report = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`The Vitest report "${path}" is not valid JSON.`);
  }
  if (!isObject(report) || !Array.isArray(report.testResults)) throw new Error(`The Vitest report "${path}" has no testResults list.`);
  const tests = [];
  for (const file of report.testResults) {
    const inside = isAbsolute(file.name) ? relative(root, file.name) : file.name;
    const name = inside.split('\\').join('/');
    for (const t of file.assertionResults ?? []) tests.push({ file: name, name: t.title });
  }
  return tests;
}

// The exemptions of the tests. The file holds `exemptions`, a list of `{ file, name, reason }`.
// An entry with no `name` exempts every test of the file.
export function readExemptions(path) {
  if (!existsSync(path)) return [];
  const data = readYamlFile(path, 'exemption file');
  const list = isObject(data) ? data.exemptions : data;
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new Error(`The exemption file "${path}" must hold a list "exemptions".`);
  return list.map((e) => (isObject(e) ? e : {}));
}

// Reads the condition fields of the profile and the graph. `conditions` holds every acceptance condition, with its owner.
export function conditionsOf(graph, profile) {
  const nodes = graph[profile.source.nodes] ?? [];
  const kindKey = profile.source.kind;
  const idKey = profile.source.id;
  const statusField = profile.status?.field ?? 'status';
  const checksField = profile.checks?.field ?? 'tests';
  const conditions = [];
  for (const part of profile.parts ?? []) {
    for (const owner of nodes) {
      if ((owner[kindKey] ?? profile.source.defaultKind) !== part.owner) continue;
      for (const c of owner[part.field] ?? []) {
        conditions.push({
          id: `${owner[idKey]}#${c[part.id] ?? '?'}`,
          owner: owner[idKey],
          authored: c[statusField],
          derived: c.derivedStatus,
          stale: c.verification?.stale === true,
          note: c[NOTE],
          checks: c[checksField] ?? [],
        });
      }
    }
  }
  return { nodes, conditions, statusField, checksField };
}

// Loads the inputs and builds the context of the checks. `loadInputs` comes from the built command line tool.
export async function loadContext(options) {
  const { loadInputs } = await import('../packages/cli/dist/index.js');
  const { graph, profile, warnings } = loadInputs(options.graph, options.profile, [], { evidenceErrors: 'warn' });
  const read = conditionsOf(graph, profile);
  const withEvidence = read.conditions.some((c) => c.derived !== undefined);
  const stale = withEvidence && read.conditions.some((c) => c.stale);
  const evidence = !withEvidence ? 'stale or absent' : stale ? 'stale' : 'fresh';
  const good = profile.status?.values.find((v) => v.tone === 'good')?.value ?? 'verified';
  const warn = profile.status?.values.find((v) => v.tone === 'warn')?.value ?? 'partial';
  // With fresh evidence, the derived status counts. Otherwise the authored status counts.
  const conditions = read.conditions.map((c) => ({ ...c, effective: evidence === 'fresh' ? c.derived : c.authored }));
  const linkTypes = profile.evidence?.adapters?.flatMap((a) => a.checkTypes ?? []);
  return {
    ...read,
    conditions,
    graph,
    profile,
    warnings,
    evidence,
    good,
    warn,
    linkTypes: linkTypes?.length ? new Set(linkTypes) : null,
    lifecycleField: profile.lifecycle?.field ?? 'state',
    typeField: profile.checks?.typeField ?? 'type',
    tests: readReport(options.report, options.root),
    root: options.root,
    reportPath: options.report,
    exemptions: readExemptions(options.exemptions),
    exemptionsPath: options.exemptions,
  };
}

// ---------- checks ----------

// The links of the graph to tests: every check with a file and a name, from a condition or from a node.
function linksOf(ctx) {
  const links = [];
  const add = (owner, list) => {
    for (const t of list ?? []) {
      if (!isObject(t) || typeof t.file !== 'string' || typeof t.name !== 'string') continue;
      if (ctx.linkTypes && !ctx.linkTypes.has(t[ctx.typeField])) continue;
      links.push({ owner, file: t.file, name: t.name });
    }
  };
  for (const c of ctx.conditions) add(c.id, c.checks);
  for (const n of ctx.nodes) add(n[ctx.profile.source.id], n[ctx.checksField]);
  return links;
}

// Check tests (req-self-tests): every test has a link or an exemption with a reason, and every link has a test.
// A link has no test when its file is in the report and its name is not, or when its file is gone.
function testsCheck(ctx) {
  if (!ctx.tests) return [`The Vitest report "${ctx.reportPath}" does not exist. Run \`npm run test:evidence\`.`];
  const findings = [];
  const links = linksOf(ctx);
  const linked = new Set(links.map((l) => testKey(l.file, l.name)));
  const present = new Set(ctx.tests.map((t) => testKey(t.file, t.name)));
  const presentFiles = new Set(ctx.tests.map((t) => t.file));
  const reasoned = ctx.exemptions.filter((e) => typeof e.reason === 'string' && e.reason.trim());
  const exempt = (t) => reasoned.some((e) => e.file === t.file && (e.name === undefined || e.name === t.name));
  for (const [i, e] of ctx.exemptions.entries()) {
    const what = typeof e.file === 'string' ? label(e.file, e.name ?? '(every test)') : `entry ${i + 1}`;
    if (typeof e.file !== 'string' || !e.file) findings.push(`The exemption ${what} of "${ctx.exemptionsPath}" has no file.`);
    else if (!(typeof e.reason === 'string' && e.reason.trim())) findings.push(`The exemption ${what} of "${ctx.exemptionsPath}" has no reason.`);
    else if (e.name === undefined ? !presentFiles.has(e.file) : !present.has(testKey(e.file, e.name))) findings.push(`The exemption ${what} of "${ctx.exemptionsPath}" matches no test of the report.`);
  }
  const seen = new Set();
  for (const t of ctx.tests) {
    const key = testKey(t.file, t.name);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!linked.has(key) && !exempt(t)) findings.push(`The test has no link and no exemption: ${label(t.file, t.name)}`);
  }
  const dangling = new Set();
  for (const l of links) {
    const key = testKey(l.file, l.name);
    if (present.has(key) || dangling.has(`${l.owner}${key}`)) continue;
    // A file that is not in the report can belong to another test suite, for example the site. Only a file that is gone is a finding.
    if (!presentFiles.has(l.file) && existsSync(resolve(ctx.root, l.file))) continue;
    dangling.add(`${l.owner}${key}`);
    findings.push(presentFiles.has(l.file) ? `The link of ${l.owner} has no test in the report: ${label(l.file, l.name)}` : `The link of ${l.owner} names a test file that does not exist: ${l.file}`);
  }
  return findings;
}

// Check conditions (req-self-conditions): the status of each condition, requirement and capability matches the work.
function conditionsCheck(ctx) {
  const findings = [];
  if (ctx.evidence === 'fresh') {
    for (const c of ctx.conditions) {
      if ((c.authored ?? null) !== (c.derived ?? null)) findings.push(`The condition ${c.id} is authored ${c.authored ?? 'with no status'} and derived ${c.derived ?? 'with no status'}.`);
    }
  }
  for (const c of ctx.conditions) {
    if (c.authored === ctx.warn && !(typeof c.note === 'string' && c.note.trim())) findings.push(`The condition ${c.id} is authored ${ctx.warn} and has no ${NOTE}.`);
  }
  const idKey = ctx.profile.source.id;
  const kindKey = ctx.profile.source.kind;
  const byOwner = new Map();
  for (const c of ctx.conditions) byOwner.set(c.owner, [...(byOwner.get(c.owner) ?? []), c]);
  const allGood = (list) => list.length > 0 && list.every((c) => c.effective === ctx.good);
  for (const n of ctx.nodes) {
    if (n[kindKey] !== 'requirement') continue;
    const own = byOwner.get(n[idKey]) ?? [];
    if (n[ctx.lifecycleField] === DRAFT && allGood(own)) findings.push(`The requirement ${n[idKey]} has state ${DRAFT} and all its conditions are ${ctx.good}.`);
    if (allGood(own) && n[PRIORITY] !== undefined) findings.push(`The requirement ${n[idKey]} has all conditions ${ctx.good} and still has a ${PRIORITY}.`);
  }
  for (const n of ctx.nodes) {
    if (n[kindKey] !== 'capability') continue;
    const below = ctx.nodes.filter((r) => r[kindKey] === 'requirement' && (r.capabilities ?? []).includes(n[idKey]));
    const list = below.flatMap((r) => byOwner.get(r[idKey]) ?? []);
    if (allGood(list) && n[PRIORITY] !== undefined) findings.push(`The capability ${n[idKey]} has all conditions ${ctx.good} and still has a ${PRIORITY}.`);
  }
  return findings;
}

// The checks, in the order of the report. Add a check here.
export const CHECKS = [
  { id: 'tests', title: 'Tests with no link to a condition', run: testsCheck },
  { id: 'conditions', title: 'Status of conditions, requirements and capabilities', run: conditionsCheck },
  { id: 'surface', title: 'User-visible items with no requirement', run: (ctx) => surfaceFindings(ctx.root).findings.map((f) => f.message) },
];

// ---------- report ----------

export function runChecks(ctx, checks = CHECKS) {
  return checks.map((c) => ({ id: c.id, title: c.title, findings: c.run(ctx) }));
}

export function markdown(results, evidence, all = false) {
  const total = results.reduce((n, r) => n + r.findings.length, 0);
  const note = evidence === 'fresh' ? '' : ' The checks use the authored status, and the derived status is not compared.';
  const lines = ['# Self-check', '', `Evidence: ${evidence}.${note} Findings: ${total}.`, ''];
  for (const r of results) {
    lines.push(`## ${r.id}: ${r.title} (${r.findings.length})`, '');
    if (!r.findings.length) lines.push('No finding.');
    for (const f of all ? r.findings : r.findings.slice(0, SHOWN_BY_DEFAULT)) lines.push(`- ${f}`);
    if (!all && r.findings.length > SHOWN_BY_DEFAULT) lines.push(`- ${r.findings.length - SHOWN_BY_DEFAULT} more. Use --all to list them.`);
    lines.push('');
  }
  return lines.join('\n');
}

// ---------- command ----------

const VALUES = ['graph', 'profile', 'report', 'exemptions', 'root', 'only'];
const FLAGS = ['json', 'strict', 'all'];

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].startsWith('--') ? argv[i].slice(2) : '';
    if (FLAGS.includes(name)) args[name] = true;
    else if (VALUES.includes(name)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`The option --${name} needs a value.`);
      args[name] = name === 'only' ? value.split(',') : resolve(value);
    } else throw new Error(`Unknown argument "${argv[i]}".`);
  }
  return args;
}

export async function main(argv) {
  const args = parseArgs(argv);
  const root = args.root ?? REPO;
  const ctx = await loadContext({
    graph: args.graph ?? resolve(root, 'requirements/graph'),
    profile: args.profile ?? resolve(root, 'requirements/profile.yaml'),
    report: args.report ?? resolve(root, 'dist/vitest.json'),
    exemptions: args.exemptions ?? resolve(root, 'requirements/test-exemptions.yaml'),
    root,
  });
  // --only <ids> runs some of the checks, for example on a repository that has no app or command line sources.
  const unknown = (args.only ?? []).filter((id) => !CHECKS.some((c) => c.id === id));
  if (unknown.length) throw new Error(`Unknown check "${unknown[0]}". The checks are: ${CHECKS.map((c) => c.id).join(', ')}.`);
  const results = runChecks(ctx, args.only ? CHECKS.filter((c) => args.only.includes(c.id)) : CHECKS);
  const total = results.reduce((n, r) => n + r.findings.length, 0);
  console.log(args.json ? JSON.stringify({ evidence: ctx.evidence, total, checks: results }, null, 2) : markdown(results, ctx.evidence, args.all));
  return args.strict && total > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
