// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Prints the section of one version from a CHANGELOG.md that Changesets writes.
// A section starts at the line `## <version>` and ends before the next line that starts with `## `.
//
// Usage: node scripts/release-notes.mjs <version> [changelog]
// The default changelog is packages/core/CHANGELOG.md. Exit code 1 means no section or an empty section.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Returns the text of the section without its heading, or undefined when the section is missing or empty.
export function releaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start < 0) return undefined;
  let end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  if (end < 0) end = lines.length;
  const text = lines.slice(start + 1, end).join('\n').trim();
  return text === '' ? undefined : text;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [version, file] = process.argv.slice(2);
  if (!version) {
    console.error('Usage: node scripts/release-notes.mjs <version> [changelog]');
    process.exit(2);
  }
  const path = resolve(file ?? fileURLToPath(new URL('../packages/core/CHANGELOG.md', import.meta.url)));
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    console.error(`Cannot read ${path}.`);
    process.exit(1);
  }
  const notes = releaseNotes(text, version);
  if (notes === undefined) {
    console.error(`${path} has no section for version ${version}.`);
    process.exit(1);
  }
  console.log(notes);
}
