// SPDX-License-Identifier: Apache-2.0
// Readable titles. A node with no title gets one from its id, in sentence case. The casing of
// each word comes from the statements of the graph.
import type { CheckTypeSpec, KindSpec, Profile } from './types';
import { getPath } from './profile';

// The keywords of RFC 2119. They are capitals by rule, so they say nothing about the casing of a word.
const KEYWORDS = new Set(['MUST', 'SHOULD', 'MAY', 'NOT', 'SHALL', 'RECOMMENDED', 'REQUIRED', 'OPTIONAL']);

// The casing of each word, taken from the texts of the graph. A word gets a casing only when the
// texts write it with capitals more often than in lowercase. A capital at the start of a
// sentence does not count.
export function wordCasing(texts: Iterable<string>): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const text of texts) {
    const re = /[A-Za-z0-9]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const form = m[0];
      if (form.length < 2 || KEYWORDS.has(form)) continue;
      const atStart = /(^|[.!?:]\s+|\n\s*)$/.test(text.slice(0, m.index));
      if (atStart && /^[A-Z][a-z0-9]*$/.test(form)) continue;
      const lower = form.toLowerCase();
      const forms = counts.get(lower) ?? new Map<string, number>();
      forms.set(form, (forms.get(form) ?? 0) + 1);
      counts.set(lower, forms);
    }
  }
  const result = new Map<string, string>();
  counts.forEach((forms, lower) => {
    const lowerN = forms.get(lower) ?? 0;
    let best: string | null = null;
    let bestN = 0;
    forms.forEach((n, f) => {
      if (f !== lower && n > bestN) {
        best = f;
        bestN = n;
      }
    });
    if (!best) return;
    const b: string = best;
    const allCaps = b === b.toUpperCase();
    const capOnly = /^[A-Z][a-z0-9]*$/.test(b);
    let ok: boolean;
    if (allCaps) ok = lowerN === 0 || (b.length < 6 && bestN >= 2 * lowerN);
    else if (capOnly) ok = bestN >= 2 && lowerN / (lowerN + bestN) < 0.25;
    else ok = bestN >= lowerN;
    if (ok) result.set(lower, b);
  });
  return result;
}

const upperFirst = (word: string) => (word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word);

// Words with their casing, in sentence case: only the first word gets a capital, and only when
// the graph gives the word no casing of its own.
function sentenceCase(words: string[], casing?: Map<string, string>): string {
  const out = words.map((w) => casing?.get(w.toLowerCase()) ?? w.toLowerCase());
  if (out.length) out[0] = upperFirst(out[0]);
  return out.join(' ');
}

export function deriveTitle(id: string, casing?: Map<string, string>, pattern?: string): string {
  const stripped = pattern ? id.replace(new RegExp(pattern), '') : id;
  return sentenceCase(stripped.split('-'), casing);
}

// A name such as "aValidChecksumPasses" or "trace_rail_rejection" as a sentence.
export function humanise(name: string, casing?: Map<string, string>): string {
  const words = String(name ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  return sentenceCase(words, casing);
}

// The title of a node whose kind has a citation rule, for example "Source Art. 4(1)".
export function citationTitle(kind: KindSpec, node: Record<string, unknown>, casing?: Map<string, string>): string | null {
  const c = kind.citation;
  if (!c) return null;
  const source = getPath(node, c.source);
  const first = c.parts[0] ? node[c.parts[0].field] : undefined;
  if (!source || !first) return null;
  const name = String(source)
    .split('-')
    .map((w) => casing?.get(w.toLowerCase()) ?? upperFirst(w.toLowerCase()))
    .join(' ');
  let ref = '';
  for (const p of c.parts) {
    const v = node[p.field];
    if (v === undefined || v === null || v === '') continue;
    ref += (p.prefix ?? '') + (p.wrap ? p.wrap.charAt(0) + v + p.wrap.charAt(1) : v);
  }
  return `${name} ${ref}`;
}

export function snippet(text: unknown, max: number): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// The key of a check node. 2 edges with the same key share 1 node.
export function checkKey(p: Profile, edge: Record<string, unknown>, ownerId: string): string {
  const checks = p.checks!;
  const type = String(edge[checks.typeField]);
  const spec: CheckTypeSpec | undefined = checks.types?.[type];
  const values = spec ? spec.key.map((f) => (edge[f] === undefined ? '' : String(edge[f]))) : [ownerId];
  return `${type}:${values.join('#')}`;
}

export function checkTitle(p: Profile, edge: Record<string, unknown>, casing?: Map<string, string>): string {
  const checks = p.checks!;
  const type = String(edge[checks.typeField]);
  const spec = checks.types?.[type];
  if (!spec) return humanise(type, casing);
  let name = '';
  for (const f of spec.title) {
    const v = edge[f];
    if (v !== undefined && v !== null && v !== '') {
      name = String(v);
      break;
    }
  }
  return humanise((spec.titlePrefix ? spec.titlePrefix + ' ' : '') + name, casing);
}
