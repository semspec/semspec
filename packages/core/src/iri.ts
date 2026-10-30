// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// IRIs of the export. A profile gives an optional `iri` to a kind, an edge, an edge property, a field, a
// vocabulary and a concept. The value is a full IRI or a CURIE. Without it, the export mints an IRI.
//   node            <base><kind>/<url-encoded id>, or the value of the field `iri.field`
//   kind            <base>vocab/<kind>
//   edge            <base>vocab/edge/<name>
//   edge property   <base>vocab/edge/<edge>/<property>
//   node field      <base>vocab/field/<name>
//   vocabulary      <base>scheme/<id>
//   concept         <base>scheme/<id>/<code>
import { getPath, kindOf } from './profile.js';
import type { Profile } from './types.js';

// Prefixes that every export knows. A profile can use them in a CURIE and cannot redefine them.
export const BUILT_IN_PREFIXES: Record<string, string> = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  prov: 'http://www.w3.org/ns/prov#',
  sh: 'http://www.w3.org/ns/shacl#',
  dct: 'http://purl.org/dc/terms/',
};

// The base of a profile that names none. The id of the graph keeps the IRIs of 2 graphs apart.
export const defaultBase = (graphId: string): string => `urn:semspec:${encodeSegment(graphId)}:`;

const SCHEMES = new Set(['http', 'https', 'urn', 'mailto', 'tag', 'file', 'ftp', 'did']);
const BAD_IRI_CHARS = /[\s<>"{}|\\^`]/;
const PREFIX_NAME = /^[A-Za-z]([A-Za-z0-9_.-]*[A-Za-z0-9_-])?$/;
const ABSOLUTE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

// Encodes a text for 1 segment of an IRI. It also encodes the characters that encodeURIComponent keeps and
// that break a prefixed name.
export const encodeSegment = (text: string): string => encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function prefixesOf(p: Pick<Profile, 'iri'>): Record<string, string> {
  return { ...BUILT_IN_PREFIXES, ...(p.iri?.prefixes ?? {}) };
}

// Turns a full IRI or a CURIE into a full IRI. It returns `error` when the text is neither.
export function resolveIri(ref: string, prefixes: Record<string, string>): { iri: string } | { error: string } {
  const m = /^([A-Za-z][A-Za-z0-9_.-]*):(.*)$/s.exec(ref);
  if (!m) return { error: 'is not an IRI or a CURIE' };
  const [, prefix, rest] = m;
  if (Object.prototype.hasOwnProperty.call(prefixes, prefix)) return { iri: prefixes[prefix] + rest };
  if (rest.startsWith('//') || SCHEMES.has(prefix.toLowerCase())) return BAD_IRI_CHARS.test(ref) ? { error: 'is not a valid IRI' } : { iri: ref };
  return { error: `uses the prefix "${prefix}", which iri.prefixes does not declare` };
}

// The problems of the IRI parts of a profile. An unknown prefix in a CURIE is a problem.
export function profileIriProblems(p: Profile): string[] {
  const out: string[] = [];
  const prefixes = prefixesOf(p);
  if (p.iri?.base !== undefined && (!ABSOLUTE.test(p.iri.base) || BAD_IRI_CHARS.test(p.iri.base))) out.push(`profile iri.base "${p.iri.base}" is not an absolute IRI`);
  for (const [name, ns] of Object.entries(p.iri?.prefixes ?? {})) {
    if (!PREFIX_NAME.test(name)) out.push(`profile iri.prefixes has the prefix "${name}", which is not a valid prefix name`);
    else if (Object.prototype.hasOwnProperty.call(BUILT_IN_PREFIXES, name) && BUILT_IN_PREFIXES[name] !== ns) out.push(`profile iri.prefixes redefines the built-in prefix "${name}"`);
    if (!ABSOLUTE.test(ns) || BAD_IRI_CHARS.test(ns)) out.push(`profile iri.prefixes "${name}" is not an absolute IRI`);
  }
  const check = (where: string, ref: string | undefined) => {
    if (ref === undefined) return;
    const r = resolveIri(ref, prefixes);
    if ('error' in r) out.push(`profile ${where} iri "${ref}" ${r.error}`);
  };
  p.kinds.forEach((k) => check(`kind ${k.id}`, k.iri));
  for (const [name, spec] of Object.entries(p.edges)) {
    check(`edge ${name}`, spec.iri);
    for (const [prop, d] of Object.entries(spec.properties ?? {})) check(`edge ${name}, property "${prop}",`, d.iri);
  }
  for (const [field, ref] of Object.entries(p.fieldIris ?? {})) check(`field "${field}"`, ref);
  for (const [id, scheme] of Object.entries(p.vocabularies ?? {})) {
    check(`vocabulary "${id}"`, scheme.iri);
    if (Array.isArray(scheme.concepts)) for (const c of scheme.concepts) check(`vocabulary "${id}", concept "${c.code}",`, c.iri);
  }
  return out;
}

// The IRIs of one profile. A graph id keeps the default base of 2 graphs apart.
export interface IriMap {
  base: string;
  prefixes: Record<string, string>;
  node(id: string, kind: string, fields?: Record<string, unknown>): string;
  kind(id: string): string;
  edge(name: string): string;
  edgeProperty(edge: string, property: string): string;
  field(name: string): string;
  scheme(id: string): string;
  concept(scheme: string, code: string): string;
  agent(name: string): string;
}

export function iriMap(p: Profile, graphId = 'graph'): IriMap {
  const base = p.iri?.base ?? defaultBase(graphId);
  const prefixes = prefixesOf(p);
  const mapped = (ref: string | undefined, mint: () => string): string => {
    if (ref === undefined) return mint();
    const r = resolveIri(ref, prefixes);
    return 'iri' in r ? r.iri : mint();
  };
  const vocab = (...parts: string[]) => `${base}vocab/${parts.map(encodeSegment).join('/')}`;
  return {
    base,
    prefixes,
    node(id, kind, fields) {
      const own = p.iri?.field === undefined || !fields ? undefined : getPath(fields, p.iri.field);
      const minted = () => `${base}${encodeSegment(kind)}/${encodeSegment(id)}`;
      return typeof own === 'string' && own ? mapped(own, minted) : minted();
    },
    kind: (id) => mapped(kindOf(p, id)?.iri, () => vocab(id)),
    edge: (name) => mapped(p.edges[name]?.iri, () => vocab('edge', name)),
    edgeProperty: (edge, property) => mapped(p.edges[edge]?.properties?.[property]?.iri, () => vocab('edge', edge, property)),
    field: (name) => mapped(p.fieldIris?.[name], () => vocab('field', name)),
    scheme: (id) => mapped(p.vocabularies?.[id]?.iri, () => `${base}scheme/${encodeSegment(id)}`),
    concept: (scheme, code) => mapped(p.vocabularies?.[scheme]?.concepts?.find((c) => c.code === code)?.iri, () => `${base}scheme/${encodeSegment(scheme)}/${encodeSegment(code)}`),
    agent: (name) => `${base}agent/${encodeSegment(name)}`,
  };
}
