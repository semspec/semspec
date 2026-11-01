// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Links from a node or a check to an outside tool. The profile key `externalLinks` lists the link specs.
// The core fills the template of a spec with the fields of a node or of a check.
import { getPath } from './profile.js';
import type { ExternalLink, ExternalLinkSpec, Profile, VNode } from './types.js';

const PLACEHOLDER = /\{([^{}]*)\}/g;
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

// The core has no DOM types. Every runtime of the core (Node, a browser) has URL.
const UrlClass = (globalThis as unknown as { URL: new (url: string) => { protocol: string; href: string } }).URL;

// The address when it is an http or https URL, else null.
export function safeHttpUrl(url: unknown): string | null {
  try {
    const u = new UrlClass(String(url));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

// The paths of the placeholders of a template.
export const placeholdersOf = (template: string): string[] => [...template.matchAll(PLACEHOLDER)].map((m) => m[1].trim());

const hasValue = (v: unknown): boolean => (typeof v === 'string' && v !== '') || typeof v === 'number' || typeof v === 'boolean';

// Fills a template. Each value is URL-encoded with encodeURIComponent. A missing field gives null.
// The result is null when it is not an http or https URL.
export function fillTemplate(template: string, fields: unknown): string | null {
  let missing = false;
  const filled = template.replace(PLACEHOLDER, (_all, path: string) => {
    const value = getPath(fields, path.trim());
    if (!hasValue(value)) {
      missing = true;
      return '';
    }
    return encodeURIComponent(String(value));
  });
  return missing ? null : safeHttpUrl(filled);
}

function linkOf(spec: ExternalLinkSpec, fields: unknown): ExternalLink | null {
  if (spec.field !== undefined && !hasValue(getPath(fields, spec.field))) return null;
  const url = fillTemplate(spec.template, fields);
  return url === null ? null : { label: spec.label, url };
}

const fill = (specs: ExternalLinkSpec[], fields: unknown): ExternalLink[] =>
  specs.flatMap((s) => {
    const link = linkOf(s, fields);
    return link ? [link] : [];
  });

// The links of a node. A placeholder reads the fields of the node. The key of the node id (the profile key
// `source.id`) holds the id of the node and the key of the kind (`source.kind`) holds the kind, unless the fields have a value under that key.
// A check node gets the links of its check type.
export function nodeLinks(p: Pick<Profile, 'externalLinks' | 'checks' | 'source'>, n: Pick<VNode, 'id' | 'kind' | 'd'>): ExternalLink[] {
  if (!p.externalLinks?.length) return [];
  if (p.checks && n.kind === p.checks.kind) return checkLinks(p, n.d);
  return fill(p.externalLinks.filter((s) => (s.kinds ? s.kinds.includes(n.kind) : !s.checkTypes)), { [p.source.id]: n.id, [p.source.kind]: n.kind, ...n.d });
}

// The links of a check. `check` holds the fields of the check.
export function checkLinks(p: Pick<Profile, 'externalLinks' | 'checks'>, check: unknown): ExternalLink[] {
  if (!p.externalLinks?.length) return [];
  const type = p.checks ? String(getPath(check, p.checks.typeField) ?? '') : '';
  const kind = p.checks?.kind;
  return fill(
    p.externalLinks.filter((s) => {
      if (s.checkTypes?.includes(type)) return true;
      if (s.kinds) return kind !== undefined && s.kinds.includes(kind);
      return !s.checkTypes;
    }),
    check,
  );
}

// The problems of the externalLinks key of a profile, as sentences.
export function profileExternalLinkProblems(p: Profile): string[] {
  const out: string[] = [];
  const kinds = new Set(p.kinds.map((k) => k.id));
  const types = new Set(Object.keys(p.checks?.types ?? {}));
  (p.externalLinks ?? []).forEach((s, i) => {
    const where = `profile externalLinks[${i}] "${s.label}"`;
    for (const k of s.kinds ?? []) if (!kinds.has(k)) out.push(`${where} names the unknown kind "${k}"`);
    for (const t of s.checkTypes ?? []) if (!types.has(t)) out.push(`${where} names the unknown check type "${t}"`);
    const names = placeholdersOf(s.template);
    if (names.some((n) => n === '')) out.push(`${where} has an empty placeholder in its template`);
    const fixed = s.template.split('{')[0];
    const scheme = SCHEME.exec(fixed)?.[1]?.toLowerCase();
    if (scheme !== undefined && scheme !== 'http' && scheme !== 'https') out.push(`${where} uses the protocol "${scheme}". Only http and https are allowed.`);
    else if (!/^https?:\/\//i.test(fixed)) {
      out.push(names.length || scheme !== undefined ? `${where} has a template that does not start with http:// or https://` : `${where} has a template with no placeholder and no fixed URL`);
    }
  });
  return out;
}

// A link as Markdown: `[label](url)`. The label gets escapes, and a character in the URL that breaks a link or a table cell gets a percent code.
export function markdownLink(link: ExternalLink): string {
  const label = link.label.replace(/\s+/g, ' ').trim().replace(/[\\`*_[\]<>&|~]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : `\\${c}`));
  return `[${label}](${link.url.replace(/[|()<>\s\\`]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)})`;
}
