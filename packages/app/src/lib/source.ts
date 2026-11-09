// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The source texts of the Source section. A page that serve gave asks serve for the text. A page that
// build wrote has the texts inside when the build had --sources, else it has none.

export interface SourceHost {
  // True when serve gave the page.
  live: boolean;
  // The texts of a built page: for each graph id, the text of each file by its relative path.
  texts?: Record<string, Record<string, string>>;
}

let host: SourceHost = { live: false };

export function setSourceHost(next: SourceHost): void {
  host = next;
}

// True when the page can give the text of this file.
export function hasSourceText(graph: string, path: string): boolean {
  return host.live || host.texts?.[graph]?.[path] !== undefined;
}

// Reads the text of the file of a node. It throws when the text is not available.
export async function loadSourceText(graph: string, node: string, path: string): Promise<string> {
  if (!host.live) {
    const text = host.texts?.[graph]?.[path];
    if (text === undefined) throw new Error('The page has no text of this file.');
    return text;
  }
  const res = await fetch(`/source?${new URLSearchParams({ graph, node })}`);
  if (!res.ok) throw new Error(res.status === 404 ? 'serve gives no text of this file. The file is not inside the source root.' : `serve answered with ${res.status}.`);
  return res.text();
}

// Reads the embedded texts of a built page, when it has them.
export function readEmbeddedSources(doc: Document = document): SourceHost['texts'] {
  const el = doc.getElementById('source-data');
  if (!el?.textContent) return undefined;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return undefined;
  }
}
