// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The JUnit adapter of the evidence port. It reads the XML of JUnit, of node test with the JUnit reporter,
// of cargo nextest and of the JUnit reporters of Playwright and Vitest.
import { isAbsolute, relative } from 'node:path';
import { junitKey, type AdapterResult, type EvidenceAdapter, type EvidenceResult, type TestCase } from '@semspec/core';

// A suite name that looks like a source file is no title.
const FILE_LIKE = /[\\/]|\.(?:[cm]?[jt]sx?|rs|py|go|rb|php)$/;
// The reporters of Playwright and Vitest join the titles of a case in its name.
const NAME_SEPARATORS = / › | > /;

interface Suite { start: number; name: string; attrs: Record<string, string> }
export interface JUnitReport { cases: TestCase[]; at?: string }

// A small strict XML reader for JUnit reports. DTDs and custom entities are forbidden.
export function readJUnit(xml: string): JUnitReport {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('JUnit entity declarations are forbidden.');
  const cases: TestCase[] = [];
  const stack: string[] = [];
  const suites: Suite[] = [];
  let current: TestCase | undefined;
  let roots = 0;
  let at: number | undefined;
  const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (entity in named) return named[entity];
    const code = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (code < 1 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) throw new Error('Invalid XML character.');
    return String.fromCodePoint(code);
  });
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_][\w:.-]*(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>|[^<]+/g;
  const finishSuite = () => {
    const suite = suites.pop()!;
    const members = cases.slice(suite.start);
    for (const key of ['tests', 'failures', 'errors', 'skipped']) if (suite.attrs[key] !== undefined && !/^\d+$/.test(suite.attrs[key])) throw new Error('Invalid JUnit suite count.');
    if (suite.attrs.tests !== undefined && Number(suite.attrs.tests) !== members.length) throw new Error('JUnit testcase count does not match its suite.');
    if ((suite.attrs.failures !== undefined || suite.attrs.errors !== undefined) && Number(suite.attrs.failures ?? 0) + Number(suite.attrs.errors ?? 0) !== members.filter((c) => c.outcome === 'failed').length) throw new Error('JUnit failure count does not match its cases.');
    if (suite.attrs.skipped !== undefined && Number(suite.attrs.skipped) !== members.filter((c) => c.outcome === 'not-run').length) throw new Error('JUnit skip count does not match its cases.');
  };
  let end = 0;
  for (const match of xml.matchAll(tokens)) {
    if (match.index !== end) throw new Error('Malformed JUnit XML.');
    end = match.index + match[0].length;
    const token = match[0];
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (!token.startsWith('<') || token.startsWith('<![CDATA[')) {
      if (!stack.length && token.trim()) throw new Error('Text outside the XML root.');
      if (!token.startsWith('<![CDATA[') && /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(token)) throw new Error('Unknown XML entity.');
      continue;
    }
    const name = /^<\/?([\w:.-]+)/.exec(token)![1];
    if (token.startsWith('</')) {
      if (!/^<\/[\w:.-]+\s*>$/.test(token) || stack.pop() !== name) throw new Error('Unbalanced JUnit XML.');
      if (name === 'testcase') { cases.push(current!); current = undefined; }
      if (name === 'testsuite' || name === 'testsuites') finishSuite();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of token.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/g)) {
      if (a[1] in attrs) throw new Error('Duplicate XML attribute.');
      const raw = a[2] ?? a[3];
      if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(raw)) throw new Error('Unknown XML entity.');
      attrs[a[1]] = decode(raw);
    }
    if (!stack.length) {
      roots++;
      if (roots !== 1 || !['testsuite', 'testsuites'].includes(name)) throw new Error('Invalid JUnit root.');
    }
    if (name === 'testcase') {
      // node test writes a case of the top level directly in testsuites.
      if (current || !['testsuite', 'testsuites'].includes(stack.at(-1) ?? '') || !attrs.classname || !attrs.name) throw new Error('Invalid JUnit testcase.');
      const titles = suites.map((s) => s.name).filter((t) => t && !FILE_LIKE.test(t));
      current = { class: attrs.classname, method: attrs.name, name: attrs.name, titlePath: NAME_SEPARATORS.test(attrs.name) ? attrs.name.split(NAME_SEPARATORS) : [...titles, attrs.name], outcome: 'passed' };
      if (attrs.file) current.file = attrs.file;
      else {
        // Playwright writes the project before the file: "[chromium] › cart.spec.ts".
        const last = attrs.classname.split(' › ').at(-1)!;
        if (FILE_LIKE.test(last) && !/\s/.test(last)) current.file = last;
      }
      if (['status', 'disabled', 'skipped', 'result'].some((key) => attrs[key] !== undefined)) throw new Error('JUnit testcase status attributes are not supported.');
    }
    if (name === 'testsuite' || name === 'testsuites') {
      if (attrs.disabled !== undefined && attrs.disabled !== '0') throw new Error('JUnit disabled cases are not supported.');
      suites.push({ start: cases.length, name: name === 'testsuite' ? (attrs.name ?? '') : '', attrs });
      const time = attrs.timestamp ? Date.parse(attrs.timestamp) : NaN;
      if (Number.isFinite(time) && (at === undefined || time < at)) at = time;
    }
    if (!current && ['failure', 'error', 'skipped'].includes(name)) throw new Error('JUnit outcome has no testcase.');
    if (current && ['failure', 'error'].includes(name)) current.outcome = 'failed';
    if (current && name === 'skipped' && current.outcome !== 'failed') current.outcome = 'not-run';
    if (token.endsWith('/>')) {
      if (name === 'testcase') { cases.push(current!); current = undefined; }
      if (name === 'testsuite' || name === 'testsuites') finishSuite();
    } else stack.push(name);
  }
  if (end !== xml.length || stack.length || roots !== 1) throw new Error('Incomplete JUnit XML.');
  return { cases, ...(at === undefined ? {} : { at: new Date(at).toISOString() }) };
}

export const parseJUnit = (xml: string): TestCase[] => readJUnit(xml).cases;

// A path in a report is absolute for most tools. The key holds it relative to root.
const relativeTo = (root: string, path: string): string => {
  if (!isAbsolute(path)) return path.replace(/^(\.\/)+/, '');
  const inside = relative(root, path);
  return inside && !inside.startsWith('..') && !isAbsolute(inside) ? inside.split('\\').join('/') : path;
};

export const junitAdapter: EvidenceAdapter = {
  id: 'junit',
  normalise: junitKey,
  read(text, options): AdapterResult {
    const report = readJUnit(text);
    const results: EvidenceResult[] = report.cases.map((c) => ({
      key: {
        class: c.class,
        method: c.method,
        name: c.name ?? c.method,
        ...(c.file ? { file: relativeTo(options.root, c.file) } : {}),
        ...(c.titlePath?.length ? { titlePath: c.titlePath.join(options.separator) } : {}),
      },
      outcome: c.outcome,
    }));
    return { results, run: { tool: 'junit', source: options.source, ...(report.at ? { at: report.at } : {}) }, warnings: [] };
  },
};
