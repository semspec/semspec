// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The link to a view: the hash of the page address holds the graph, the scope and the node.
// Format: #graph=<id>&scope=<id>&node=<id>, each value URL-encoded.

export interface LinkValues {
  graph?: string;
  scope?: string;
  node?: string;
}

const PARTS = ['graph', 'scope', 'node'] as const;

export function formatLink(values: LinkValues): string {
  const parts = PARTS.filter((k) => values[k]).map((k) => `${k}=${encodeURIComponent(values[k]!)}`);
  return parts.length ? `#${parts.join('&')}` : '';
}

// Reads a hash. A part that is broken is skipped.
export function parseLink(hash: string): LinkValues {
  const out: LinkValues = {};
  for (const part of hash.replace(/^#/, '').split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq) as (typeof PARTS)[number];
    if (!PARTS.includes(name)) continue;
    try {
      const value = decodeURIComponent(part.slice(eq + 1));
      if (value) out[name] = value;
    } catch {
      // A broken escape. Skip the part.
    }
  }
  return out;
}
