// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Checks that the tests stay fast: no wait on the real clock over 100 ms, and 1 server process for each group of tests in mcp.test.ts.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('..', import.meta.url));
const LIMIT_MS = 100;

function filesOf(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return filesOf(path);
    return /\.(ts|tsx|mjs|js)$/.test(name) ? [path] : [];
  });
}

const testFiles = [...filesOf(join(repo, 'test')), ...filesOf(join(repo, 'site', 'test'))].filter((f) => !f.endsWith('speed.test.ts'));

// The lines that wait on the real clock, or could. A wait of the allow-list below is not an error.
const WAITS = [/\bsetTimeout\s*\(/, /\bsetInterval\s*\(/, /\bsleep\s*\(/, /Atomics\.wait\s*\(/, /\btimeoutMs\s*:\s*(\d[\d_]*)/, /\b(?:waitFor|findBy\w+|findAllBy\w+)\s*\(.*\btimeout\s*:\s*(\d[\d_]*)/];

// A line that matches a pattern of WAITS is allowed when it holds the text and the wait is short or runs in another process.
const ALLOWED: { file: string; text: string; reason: string }[] = [
  { file: 'test/embeddings.test.ts', text: 'slow.mjs', reason: 'The text is the script of a child process that never answers. The test does not wait for it, because the timeout of the embedder is 100 ms and it kills the child.' },
];

function realWaits(): string[] {
  const found: string[] = [];
  for (const file of testFiles) {
    const rel = relative(repo, file);
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/^\s*\/\//.test(line)) return;
        for (const pattern of WAITS) {
          const m = pattern.exec(line);
          if (!m) continue;
          // A number in the match is a time in ms. A wait up to the limit passes.
          if (m[1] !== undefined && Number(m[1].replace(/_/g, '')) <= LIMIT_MS) continue;
          if (ALLOWED.some((a) => a.file === rel && line.includes(a.text))) continue;
          found.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
  }
  return found;
}

describe('req-self-fast: no-real-waits', () => {
  it('holds no wait on the real clock over 100 ms in a test file, outside the allow-list', () => {
    expect(testFiles.length).toBeGreaterThan(20);
    expect(realWaits()).toEqual([]);
  });

  it('gives each entry of the allow-list a reason', () => {
    ALLOWED.forEach((a) => expect(a.reason.length).toBeGreaterThan(20));
  });

  it('runs the DOM tests on a fake clock', () => {
    const setup = readFileSync(join(repo, 'test', 'app', 'setup.ts'), 'utf8');
    expect(setup).toMatch(/vi\.useFakeTimers\(\)/);
    const harness = readFileSync(join(repo, 'test', 'app', 'harness.tsx'), 'utf8');
    expect(harness).toMatch(/advanceTimersByTimeAsync/);
  });
});

describe('req-self-fast: shared-setup', () => {
  const source = readFileSync(join(repo, 'test', 'mcp.test.ts'), 'utf8').split('\n');
  const connects = source.flatMap((line, i) => (/\bconnect\(\[/.test(line) ? [i] : []));

  it('starts each server of mcp.test.ts in a beforeAll, or marks it as an own server with a reason', () => {
    expect(connects.length).toBeGreaterThan(0);
    for (const i of connects) {
      const before = source.slice(Math.max(0, i - 2), i + 1).join('\n');
      const ok = /beforeAll\(/.test(before) || /\/\/ Own server: .{15,}/.test(before);
      expect(ok, `line ${i + 1} starts a server with no beforeAll and no own-server reason`).toBe(true);
    }
  });

  it('shares 1 server between the tests that only read the fixture workspace', () => {
    const shared = connects.filter((i) => /beforeAll\(/.test(source.slice(Math.max(0, i - 2), i + 1).join('\n')));
    expect(shared.length).toBe(1);
    expect(source.join('\n')).toMatch(/\/\/ Shared server: /);
  });
});
