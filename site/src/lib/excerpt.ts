// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Cuts blocks out of a YAML text. This module has no dependency, so the Vite config can import it.

// Returns the blocks of the top-level keys in `keys`, in the order of the text.
// A block starts at the key line. It ends before the next line that is not indented and not a comment.
// Trailing blank lines do not belong to a block.
export function excerptBlocks(text: string, keys: string[]): string {
  const lines = text.split(/\r?\n/);
  const isTop = (line: string) => /^[^\s#]/.test(line);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const key = /^([A-Za-z_][\w-]*):/.exec(lines[i])?.[1];
    if (!key || !keys.includes(key)) continue;
    let end = i + 1;
    while (end < lines.length && !isTop(lines[end])) end++;
    while (end > i + 1 && lines[end - 1].trim() === '') end--;
    out.push(...lines.slice(i, end));
    i = end - 1;
  }
  return out.join('\n');
}
