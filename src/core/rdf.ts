// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// A small RDF model and 2 writers: Turtle (TriG when a graph has a name) and JSON-LD. No library.
// An edge with properties is a triple with an annotation. Turtle writes it as RDF 1.2 `{| ... |}`.
// JSON-LD writes it as `@annotation` (the JSON-LD 1.1 star draft). `reify` turns an annotation into
// an `rdf:Statement` node for a reader that knows neither form.
import { BUILT_IN_PREFIXES } from './iri';

export const RDF = BUILT_IN_PREFIXES.rdf;
export const RDFS = BUILT_IN_PREFIXES.rdfs;
export const OWL = BUILT_IN_PREFIXES.owl;
export const XSD = BUILT_IN_PREFIXES.xsd;
export const SKOS = BUILT_IN_PREFIXES.skos;
export const PROV = BUILT_IN_PREFIXES.prov;
export const SH = BUILT_IN_PREFIXES.sh;
export const DCT = BUILT_IN_PREFIXES.dct;
export const RDF_TYPE = `${RDF}type`;

// An object of a triple. A blank node holds its own properties. A list is an RDF collection.
export type Term =
  | { t: 'iri'; v: string }
  | { t: 'lit'; v: string; dt?: string }
  | { t: 'json'; v: unknown }
  | { t: 'blank'; po: PO[] }
  | { t: 'list'; items: Term[] };

export interface PO {
  p: string;
  o: Term;
}

// `s` is an IRI, or a blank node label that starts with `_:`.
export interface Triple {
  s: string;
  p: string;
  o: Term;
  ann?: PO[];
}

export interface RdfGraph {
  // The IRI of a named graph. A graph with no name is the default graph.
  name?: string;
  triples: Triple[];
}

export interface RdfDataset {
  prefixes: Record<string, string>;
  graphs: RdfGraph[];
}

export const iri = (v: string): Term => ({ t: 'iri', v });
export const lit = (v: string, dt?: string): Term => ({ t: 'lit', v, ...(dt ? { dt } : {}) });
export const typed = (v: string, dtLocal: string): Term => lit(v, XSD + dtLocal);
export const blank = (po: PO[]): Term => ({ t: 'blank', po });
export const list = (items: Term[]): Term => ({ t: 'list', items });

// Adds the prefixes of `more` that do not clash with `into`. A prefix with 2 meanings keeps the first.
export function mergePrefixes(into: Record<string, string>, more: Record<string, string>): void {
  for (const [name, ns] of Object.entries(more)) if (!Object.prototype.hasOwnProperty.call(into, name)) into[name] = ns;
}

// Turns each annotation into a node of the type rdf:Statement. The triple stays as a plain triple.
export function reify(ds: RdfDataset): RdfDataset {
  let count = 0;
  return {
    prefixes: ds.prefixes,
    graphs: ds.graphs.map((g) => ({
      name: g.name,
      triples: g.triples.flatMap((tr) => {
        if (!tr.ann?.length) return [tr];
        const node = `_:r${++count}`;
        const plain: Triple = { s: tr.s, p: tr.p, o: tr.o };
        const stmt = (p: string, o: Term): Triple => ({ s: node, p, o });
        return [
          plain,
          stmt(RDF_TYPE, iri(`${RDF}Statement`)),
          stmt(`${RDF}subject`, iri(tr.s)),
          stmt(`${RDF}predicate`, iri(tr.p)),
          stmt(`${RDF}object`, tr.o),
          ...tr.ann.map((a) => stmt(a.p, a.o)),
        ];
      }),
    })),
  };
}

// ---- Turtle ----

const UNSAFE_IRI = /[\u0000- <>"{}|^`\\\u007f-\u009f]/g;
const hex4 = (code: number) => `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`;

// The text of an IRI reference for Turtle, without the brackets. A character that Turtle forbids gets a
// \u escape, which keeps the IRI as it is.
export const escapeIri = (s: string): string => s.replace(UNSAFE_IRI, (c) => hex4(c.charCodeAt(0)));

// The text of a string for Turtle, without the quotes. One line, with escapes. A lone surrogate becomes U+FFFD.
export function escapeString(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i];
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (c < 0x20 || c === 0x7f) out += hex4(c);
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) {
      out += ch + s[i + 1];
      i++;
    } else if (c >= 0xd800 && c <= 0xdfff) out += '\\uFFFD';
    else out += ch;
  }
  return out;
}

const LOCAL = /^[A-Za-z_][A-Za-z0-9_-]*$/;

class Names {
  readonly used = new Set<string>();
  constructor(private readonly prefixes: Record<string, string>) {}
  // `<iri>` or a prefixed name, whichever is possible. The longest namespace wins.
  iri(value: string): string {
    let best: [string, string] | undefined;
    for (const [name, ns] of Object.entries(this.prefixes)) {
      if (value.startsWith(ns) && LOCAL.test(value.slice(ns.length)) && (!best || ns.length > this.prefixes[best[0]].length)) best = [name, value.slice(ns.length)];
    }
    if (!best) return `<${escapeIri(value)}>`;
    this.used.add(best[0]);
    return `${best[0]}:${best[1]}`;
  }
}

function writeTerm(o: Term, names: Names): string {
  switch (o.t) {
    case 'iri':
      return names.iri(o.v);
    case 'lit':
      return `"${escapeString(o.v)}"${o.dt ? `^^${names.iri(o.dt)}` : ''}`;
    case 'json':
      return `"${escapeString(JSON.stringify(o.v))}"^^${names.iri(`${RDF}JSON`)}`;
    case 'blank':
      return o.po.length ? `[ ${writePO(o.po, names)} ]` : '[]';
    case 'list':
      return o.items.length ? `( ${o.items.map((i) => writeTerm(i, names)).join(' ')} )` : '()';
  }
}

const writePredicate = (p: string, names: Names) => (p === RDF_TYPE ? 'a' : names.iri(p));

// Predicates with their objects, as `p o , o ; p o`. Same predicates stay together.
function writePO(po: PO[], names: Names): string {
  const byP = new Map<string, Term[]>();
  for (const x of po) byP.set(x.p, [...(byP.get(x.p) ?? []), x.o]);
  return [...byP].map(([p, os]) => `${writePredicate(p, names)} ${os.map((o) => writeTerm(o, names)).join(' , ')}`).join(' ; ');
}

function writeGraphBody(g: RdfGraph, names: Names, indent: string): string {
  const subjects = new Map<string, Triple[]>();
  for (const t of g.triples) subjects.set(t.s, [...(subjects.get(t.s) ?? []), t]);
  const blocks: string[] = [];
  for (const [s, triples] of subjects) {
    const byP = new Map<string, Triple[]>();
    for (const t of triples) byP.set(t.p, [...(byP.get(t.p) ?? []), t]);
    const lines = [...byP].map(([p, ts]) => {
      const objects = ts.map((t) => `${writeTerm(t.o, names)}${t.ann?.length ? ` {| ${writePO(t.ann, names)} |}` : ''}`);
      return `${indent}    ${writePredicate(p, names)} ${objects.join(' , ')}`;
    });
    const subject = s.startsWith('_:') ? s : names.iri(s);
    blocks.push(`${indent}${subject}\n${lines.join(' ;\n')} .`);
  }
  return blocks.join('\n\n');
}

// Writes Turtle, or TriG when a graph has a name. Only the prefixes that the text uses get a declaration.
export function toTurtle(ds: RdfDataset): string {
  const names = new Names(ds.prefixes);
  const trig = ds.graphs.some((g) => g.name !== undefined);
  const parts = ds.graphs.map((g) => {
    if (!trig) return writeGraphBody(g, names, '');
    const body = writeGraphBody(g, names, '    ');
    return g.name === undefined ? `{\n${body}\n}` : `${names.iri(g.name)} {\n${body}\n}`;
  });
  const header = Object.entries(ds.prefixes)
    .filter(([name]) => names.used.has(name))
    .map(([name, ns]) => `@prefix ${name}: <${escapeIri(ns)}> .`);
  return `${[header.join('\n'), parts.filter(Boolean).join('\n\n')].filter(Boolean).join('\n\n')}\n`;
}

// ---- JSON-LD ----

type Json = unknown;

export function toJsonLd(ds: RdfDataset): string {
  // Only a namespace that ends in a delimiter works as a prefix in JSON-LD.
  const usable = Object.entries(ds.prefixes).filter(([, ns]) => /[/#]$/.test(ns));
  const compact = (value: string): string => {
    let best: [string, string] | undefined;
    for (const [name, ns] of usable) {
      const rest = value.slice(ns.length);
      if (value.startsWith(ns) && rest && !rest.startsWith('//') && (!best || ns.length > ds.prefixes[best[0]].length)) best = [name, rest];
    }
    return best ? `${best[0]}:${best[1]}` : value;
  };
  const key = (p: string) => (p === RDF_TYPE ? '@type' : compact(p));
  const value = (o: Term, ann?: PO[]): Json => {
    const extra = ann?.length ? { '@annotation': properties(ann) } : {};
    switch (o.t) {
      case 'iri':
        return { '@id': compact(o.v), ...extra };
      case 'lit':
        return o.dt || ann?.length ? { '@value': o.v, ...(o.dt ? { '@type': compact(o.dt) } : {}), ...extra } : o.v;
      case 'json':
        return { '@value': o.v, '@type': '@json', ...extra };
      case 'blank':
        return properties(o.po);
      case 'list':
        return { '@list': o.items.map((i) => value(i)) };
    }
  };
  const properties = (po: PO[]): Record<string, Json> => {
    const out: Record<string, Json[]> = {};
    for (const x of po) {
      if (x.p === RDF_TYPE && x.o.t === 'iri') (out['@type'] ??= []).push(compact(x.o.v));
      else (out[key(x.p)] ??= []).push(value(x.o));
    }
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length === 1 ? v[0] : v]));
  };
  const nodes = (g: RdfGraph): Json[] => {
    const bySubject = new Map<string, Record<string, Json[]>>();
    for (const t of g.triples) {
      const node = bySubject.get(t.s) ?? {};
      bySubject.set(t.s, node);
      if (t.p === RDF_TYPE && t.o.t === 'iri') (node['@type'] ??= []).push(compact(t.o.v));
      else (node[key(t.p)] ??= []).push(value(t.o, t.ann));
    }
    return [...bySubject].map(([s, node]) => ({
      '@id': s.startsWith('_:') ? s : compact(s),
      ...Object.fromEntries(Object.entries(node).map(([k, v]) => [k, v.length === 1 ? v[0] : v])),
    }));
  };
  const context = Object.fromEntries(usable);
  const graph = ds.graphs.length === 1 && ds.graphs[0].name === undefined ? nodes(ds.graphs[0]) : ds.graphs.map((g) => ({ ...(g.name === undefined ? {} : { '@id': compact(g.name) }), '@graph': nodes(g) }));
  return `${JSON.stringify({ '@context': context, '@graph': graph }, null, 2)}\n`;
}
