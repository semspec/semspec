// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Builds the RDF of a graph: its nodes and edges, its vocabularies (SKOS), its provenance (PROV-O) and
// its profile as an ontology (OWL). The README lists the mapping.
import { structuralFields } from './export-fields';
import { isIsoDate } from './edges';
import { iriMap, type IriMap } from './iri';
import { derivedEdgeName, provenanceFields, provenanceOf } from './provenance';
import { DCT, OWL, PROV, RDFS, RDF_TYPE, SKOS, XSD, blank, iri, list, lit, mergePrefixes, typed, type PO, type RdfDataset, type RdfGraph, type Term, type Triple } from './rdf';
import { fieldConcept, schemeOfField } from './vocabulary';
import type { Model, PropertyType } from './types';

// A hook that turns a cross link into the IRI of its target node. It is set for a workspace.
export type CrossResolver = (graph: string, id: string) => string | undefined;

export interface GraphInput {
  id: string;
  model: Model;
  // The name of the graph in the dataset. A single graph has none.
  name?: string;
  resolveCross?: CrossResolver;
}

// The datatype of a date string: xsd:gYear, xsd:gYearMonth or xsd:date.
export const dateType = (v: string): string => (v.length === 4 ? 'gYear' : v.length === 7 ? 'gYearMonth' : 'date');

function numberTerm(n: number): Term {
  if (Number.isInteger(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER) return typed(String(n), 'integer');
  const text = String(n);
  return typed(text, /e/i.test(text) ? 'double' : 'decimal');
}

// A value of unknown type as a term. A string that is an ISO date gets an xsd date type.
export function valueTerm(v: unknown): Term | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') return isIsoDate(v) ? typed(v, dateType(v)) : lit(v);
  if (typeof v === 'number') return Number.isFinite(v) ? numberTerm(v) : undefined;
  if (typeof v === 'boolean') return typed(String(v), 'boolean');
  return { t: 'json', v };
}

// A value of a declared type as a term.
function typedTerm(type: PropertyType, v: unknown): Term | undefined {
  if (type === 'date' && typeof v === 'string' && isIsoDate(v)) return typed(v, dateType(v));
  if (type === 'string' && typeof v === 'string') return lit(v);
  return valueTerm(v);
}

// The scheme triples of the vocabularies of a profile.
function vocabularyTriples(model: Model, I: IriMap): Triple[] {
  const out: Triple[] = [];
  for (const [id, scheme] of Object.entries(model.profile.vocabularies ?? {})) {
    const s = I.scheme(id);
    const add = (subject: string, p: string, o: Term) => out.push({ s: subject, p, o });
    add(s, RDF_TYPE, iri(`${SKOS}ConceptScheme`));
    add(s, `${SKOS}prefLabel`, lit(scheme.label));
    if (scheme.definition !== undefined) add(s, `${SKOS}definition`, lit(scheme.definition));
    for (const c of scheme.concepts) {
      const cs = I.concept(id, c.code);
      add(cs, RDF_TYPE, iri(`${SKOS}Concept`));
      add(cs, `${SKOS}inScheme`, iri(s));
      add(cs, `${SKOS}notation`, lit(c.code));
      add(cs, `${SKOS}prefLabel`, lit(c.label));
      if (c.definition !== undefined) add(cs, `${SKOS}definition`, lit(c.definition));
      if (c.broader !== undefined) add(cs, `${SKOS}broader`, iri(I.concept(id, c.broader)));
      for (const alt of c.altLabels ?? []) add(cs, `${SKOS}altLabel`, lit(alt));
    }
  }
  return out;
}

const XSD_OF_TYPE: Record<PropertyType, string | undefined> = { string: `${XSD}string`, number: `${XSD}decimal`, boolean: `${XSD}boolean`, date: undefined };

// The profile as an ontology: a class for each kind, an object property for each edge, a datatype
// property for each edge property and for each field that the nodes use.
function ontologyTriples(model: Model, I: IriMap, fields: Map<string, 'object' | 'datatype'>): Triple[] {
  const P = model.profile;
  const out: Triple[] = [];
  const add = (s: string, p: string, o: Term) => out.push({ s, p, o });
  const declared = new Set<string>();
  const declare = (s: string, type: string, label: string): boolean => {
    if (declared.has(`${s} ${type}`)) return false;
    declared.add(`${s} ${type}`);
    add(s, RDF_TYPE, iri(type));
    add(s, `${RDFS}label`, lit(label));
    return true;
  };
  const kindSet = (kinds: string[]): Term => (kinds.length === 1 ? iri(I.kind(kinds[0])) : blank([{ p: RDF_TYPE, o: iri(`${OWL}Class`) }, { p: `${OWL}unionOf`, o: list(kinds.map((k) => iri(I.kind(k)))) }]));
  for (const k of P.kinds) declare(I.kind(k.id), `${OWL}Class`, k.label);
  for (const [name, spec] of Object.entries(P.edges)) {
    const predicate = edgePredicate(model, I, name);
    // The PROV-O term is not declared again.
    if (predicate.startsWith(PROV)) continue;
    if (!declare(predicate, `${OWL}ObjectProperty`, spec.labels[0])) continue;
    if (spec.from?.length) add(predicate, `${RDFS}domain`, kindSet(spec.from));
    if (spec.to?.length) add(predicate, `${RDFS}range`, kindSet(spec.to));
    for (const [prop, d] of Object.entries(spec.properties ?? {})) {
      const s = I.edgeProperty(name, prop);
      if (d.vocabulary !== undefined) {
        declare(s, `${OWL}ObjectProperty`, prop);
        add(s, `${RDFS}range`, iri(`${SKOS}Concept`));
      } else {
        declare(s, `${OWL}DatatypeProperty`, prop);
        const range = XSD_OF_TYPE[d.type];
        if (range) add(s, `${RDFS}range`, iri(range));
      }
    }
  }
  for (const [field, kind] of fields) {
    const s = I.field(field);
    declare(s, kind === 'object' ? `${OWL}ObjectProperty` : `${OWL}DatatypeProperty`, field);
    if (kind === 'object' && schemeOfField(P, field)) add(s, `${RDFS}range`, iri(`${SKOS}Concept`));
  }
  return out;
}

// The predicate of an edge name. An edge to a source node is prov:wasDerivedFrom, unless the profile maps it.
export function edgePredicate(model: Model, I: IriMap, name: string): string {
  const P = model.profile;
  if (P.provenance?.source?.kind !== undefined && name === derivedEdgeName(P.provenance) && !P.edges[name]?.iri) return `${PROV}wasDerivedFrom`;
  return I.edge(name);
}

// The provenance parts of 1 node or 1 edge as properties. Agents go to `agents`, so the graph describes each once.
function provenanceProperties(model: Model, I: IriMap, record: Record<string, unknown> | undefined, agents: Map<string, string>): PO[] {
  const spec = model.profile.provenance;
  const v = provenanceOf(spec, record);
  const out: PO[] = [];
  if (typeof v.marker === 'string' && spec?.marker) {
    out.push({ p: `${PROV}wasGeneratedBy`, o: blank([{ p: RDF_TYPE, o: iri(`${PROV}Activity`) }, { p: RDF_TYPE, o: iri(I.concept(spec.marker.vocabulary, v.marker)) }]) });
  }
  // A source node has an edge. Free text is a URL or a literal.
  if (typeof v.source === 'string' && spec?.source && spec.source.kind === undefined) {
    out.push({ p: `${PROV}wasDerivedFrom`, o: /^https?:\/\/[^\s<>"{}|\\^`]+$/.test(v.source) ? iri(v.source) : lit(v.source) });
  }
  if (typeof v.retrieved === 'string' && isIsoDate(v.retrieved)) out.push({ p: `${PROV}generatedAtTime`, o: typed(v.retrieved, dateType(v.retrieved)) });
  if (typeof v.agent === 'string') {
    const agent = I.agent(v.agent);
    agents.set(agent, v.agent);
    out.push({ p: `${PROV}wasAttributedTo`, o: iri(agent) });
  }
  if (typeof v.note === 'string') out.push({ p: `${RDFS}comment`, o: lit(v.note) });
  return out;
}

// The triples of 1 graph. `prefixes` gets the namespaces of the profile.
export function graphTriples(input: GraphInput, prefixes: Record<string, string>): Triple[] {
  const { model } = input;
  const P = model.profile;
  const I = iriMap(P, input.id);
  mergePrefixes(prefixes, I.prefixes);
  const skip = structuralFields(P);
  provenanceFields(P.provenance).forEach((f) => skip.add(f));
  if (P.iri?.field) skip.add(P.iri.field);
  const crossFields = new Set((P.crossLinks ?? []).map((c) => c.field));
  const coded = new Set(Object.keys(P.fieldVocabularies ?? {}).filter((f) => schemeOfField(P, f)));
  const fieldKinds = new Map<string, 'object' | 'datatype'>();
  const agents = new Map<string, string>();
  const body: Triple[] = [];
  const nodeIri = new Map(model.nodes.map((n) => [n.id, I.node(n.id, n.kind, n.d)]));
  const hasProvenance = P.provenance !== undefined;
  const crossGraphOf = new Map((P.crossLinks ?? []).map((c) => [c.field, c.graph]));

  for (const n of model.nodes) {
    const s = nodeIri.get(n.id)!;
    const add = (p: string, o: Term, ann?: PO[]) => body.push({ s, p, o, ...(ann ? { ann } : {}) });
    add(RDF_TYPE, iri(I.kind(n.kind)));
    if (hasProvenance) add(RDF_TYPE, iri(`${PROV}Entity`));
    add(`${RDFS}label`, lit(n.title));
    add(`${DCT}identifier`, lit(n.id));
    for (const [field, value] of Object.entries(n.d)) {
      if (skip.has(field) || value === null || value === undefined) continue;
      const p = I.field(field);
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        let term: Term | undefined;
        let kind: 'object' | 'datatype' = 'datatype';
        const concept = coded.has(field) ? fieldConcept(P, field, item) : undefined;
        if (concept) {
          const scheme = schemeOfField(P, field)!;
          term = iri(I.concept(scheme.id, concept.code));
          kind = 'object';
        } else if (crossFields.has(field) && typeof item === 'string' && input.resolveCross?.(crossGraphOf.get(field)!, item)) {
          term = iri(input.resolveCross(crossGraphOf.get(field)!, item)!);
          kind = 'object';
        } else term = valueTerm(item);
        if (!term) continue;
        add(p, term);
        if (fieldKinds.get(field) !== 'object') fieldKinds.set(field, kind);
      }
    }
    for (const po of provenanceProperties(model, I, n.d, agents)) add(po.p, po.o);
  }

  for (const e of model.edges) {
    const s = nodeIri.get(e.s);
    const t = nodeIri.get(e.t);
    if (!s || !t) continue;
    const spec = P.edges[e.k];
    const exempt = new Set(provenanceFields(P.provenance));
    const ann: PO[] = [];
    for (const [name, v] of Object.entries(e.p ?? {})) {
      if (exempt.has(name)) continue;
      const d = spec?.properties?.[name];
      const term = d?.vocabulary !== undefined && typeof v === 'string' ? iri(I.concept(d.vocabulary, v)) : d ? typedTerm(d.type, v) : valueTerm(v);
      if (term) ann.push({ p: I.edgeProperty(e.k, name), o: term });
    }
    if (e.n) ann.push({ p: `${RDFS}comment`, o: lit(e.n) });
    const prov = provenanceProperties(model, I, e.p, agents);
    if (prov.length) ann.unshift({ p: RDF_TYPE, o: iri(`${PROV}Entity`) }, ...prov);
    body.push({ s, p: edgePredicate(model, I, e.k), o: iri(t), ...(ann.length ? { ann } : {}) });
  }

  const agentTriples: Triple[] = [...agents].flatMap(([agent, name]) => [
    { s: agent, p: RDF_TYPE, o: iri(`${PROV}Agent`) },
    { s: agent, p: `${RDFS}label`, o: lit(name) },
  ]);
  return [...ontologyTriples(model, I, fieldKinds), ...vocabularyTriples(model, I), ...body, ...agentTriples];
}

// The RDF of 1 graph, or of a list of named graphs of a workspace.
export function datasetOf(inputs: GraphInput[]): RdfDataset {
  const prefixes: Record<string, string> = {};
  const graphs: RdfGraph[] = inputs.map((g) => ({ name: g.name, triples: graphTriples(g, prefixes) }));
  return { prefixes, graphs };
}
