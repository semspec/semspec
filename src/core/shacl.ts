// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// SHACL shapes of a profile. The shapes check the RDF that rdf-export.ts writes.
//   A kind                    a sh:NodeShape with sh:targetClass. The node must have 1 dct:identifier and an rdfs:label.
//   A parent or link field    a sh:property on the edge, with sh:class of the allowed target kinds (`to`).
//   A coded field             a sh:property with sh:in of the concept IRIs.
//   The provenance date       a sh:property with an ISO date sh:pattern.
//   An edge property          a shape that targets the subjects of the property IRI, with sh:datatype, sh:in or sh:pattern.
// A required edge property cannot be a constraint, because nothing targets an edge that lacks it. Semspec checks it.
import { encodeSegment, iriMap, type IriMap } from './iri';
import { parentFields } from './profile';
import { edgePredicate } from './rdf-export';
import { PROV, RDFS, RDF_TYPE, SH, XSD, DCT, blank, iri, list, lit, mergePrefixes, typed, type PO, type RdfDataset, type Term, type Triple } from './rdf';
import { schemeOfField } from './vocabulary';
import type { Model, PropertyType } from './types';

export const ISO_DATE_PATTERN = '^[0-9]{4}(-(0[1-9]|1[0-2])(-[0-9]{2})?)?$';

const datatypeAlternatives = (type: PropertyType): string[] =>
  type === 'string' ? ['string'] : type === 'boolean' ? ['boolean'] : type === 'number' ? ['integer', 'decimal', 'double'] : ['gYear', 'gYearMonth', 'date'];

// The constraint terms for a value of a declared type.
function typeConstraints(type: PropertyType): PO[] {
  const kinds = datatypeAlternatives(type);
  const out: PO[] = [];
  if (kinds.length === 1) out.push({ p: `${SH}datatype`, o: iri(XSD + kinds[0]) });
  else out.push({ p: `${SH}or`, o: list(kinds.map((k) => blank([{ p: `${SH}datatype`, o: iri(XSD + k) }]))) });
  if (type === 'date') out.push({ p: `${SH}pattern`, o: lit(ISO_DATE_PATTERN) });
  return out;
}

const property = (path: string, ...rest: PO[]): PO => ({ p: `${SH}property`, o: blank([{ p: `${SH}path`, o: iri(path) }, ...rest]) });

function codes(model: Model, I: IriMap, schemeId: string): Term {
  return list((model.profile.vocabularies?.[schemeId]?.concepts ?? []).map((c) => iri(I.concept(schemeId, c.code))));
}

// The shapes of 1 profile. `used` holds the shape IRIs that exist, so a clash gets the graph id.
export function shapeTriples(model: Model, graphId: string, prefixes: Record<string, string>, used: Set<string>): Triple[] {
  const P = model.profile;
  const I = iriMap(P, graphId);
  mergePrefixes(prefixes, I.prefixes);
  const out: Triple[] = [];
  const shapeIri = (...parts: string[]): string => {
    let candidate = `${I.base}shape/${parts.map(encodeSegment).join('/')}`;
    if (used.has(candidate)) candidate = `${I.base}shape/${encodeSegment(graphId)}/${parts.map(encodeSegment).join('/')}`;
    used.add(candidate);
    return candidate;
  };
  const shape = (s: string, po: PO[]) => po.forEach((x) => out.push({ s, p: x.p, o: x.o }));
  const coded = Object.keys(P.fieldVocabularies ?? {}).flatMap((field) => {
    const found = field.includes('.') ? undefined : schemeOfField(P, field);
    return found ? [{ field, id: found.id }] : [];
  });

  for (const k of P.kinds) {
    const props: PO[] = [
      property(`${DCT}identifier`, { p: `${SH}minCount`, o: typed('1', 'integer') }, { p: `${SH}maxCount`, o: typed('1', 'integer') }, { p: `${SH}datatype`, o: iri(`${XSD}string`) }),
      property(`${RDFS}label`, { p: `${SH}minCount`, o: typed('1', 'integer') }, { p: `${SH}datatype`, o: iri(`${XSD}string`) }),
    ];
    const own = new Set(parentFields(k));
    for (const [name, spec] of Object.entries(P.edges)) {
      if (!own.has(name) && !spec.from?.includes(k.id)) continue;
      const to = spec.to ?? [];
      const constraint: PO[] =
        to.length === 1 ? [{ p: `${SH}class`, o: iri(I.kind(to[0])) }] : to.length > 1 ? [{ p: `${SH}or`, o: list(to.map((t) => blank([{ p: `${SH}class`, o: iri(I.kind(t)) }]))) }] : [];
      props.push(property(edgePredicate(model, I, name), { p: `${SH}nodeKind`, o: iri(`${SH}IRI`) }, ...constraint));
    }
    for (const c of coded) props.push(property(I.field(c.field), { p: `${SH}in`, o: codes(model, I, c.id) }));
    if (P.provenance?.retrieved !== undefined) props.push(property(`${PROV}generatedAtTime`, { p: `${SH}pattern`, o: lit(ISO_DATE_PATTERN) }));
    const marker = P.provenance?.marker;
    if (marker && P.vocabularies?.[marker.vocabulary]) {
      const allowed = list([iri(`${PROV}Activity`), ...(P.vocabularies[marker.vocabulary].concepts.map((c) => iri(I.concept(marker.vocabulary, c.code))))]);
      props.push(property(`${PROV}wasGeneratedBy`, { p: `${SH}node`, o: blank([property(RDF_TYPE, { p: `${SH}in`, o: allowed })]) }));
    }
    shape(shapeIri(k.id), [
      { p: RDF_TYPE, o: iri(`${SH}NodeShape`) },
      { p: `${RDFS}label`, o: lit(`${k.label} shape`) },
      { p: `${SH}targetClass`, o: iri(I.kind(k.id)) },
      ...props,
    ]);
  }
  // The shapes of edge properties. They are keyed by the property IRI.
  for (const [name, spec] of Object.entries(P.edges)) {
    for (const [prop, d] of Object.entries(spec.properties ?? {})) {
      const path = I.edgeProperty(name, prop);
      const constraint: PO[] = d.vocabulary !== undefined ? [{ p: `${SH}in`, o: codes(model, I, d.vocabulary) }] : typeConstraints(d.type);
      shape(shapeIri('edge', name, prop), [
        { p: RDF_TYPE, o: iri(`${SH}NodeShape`) },
        { p: `${RDFS}label`, o: lit(`${name} ${prop} shape`) },
        { p: `${SH}targetSubjectsOf`, o: iri(path) },
        property(path, ...constraint),
      ]);
    }
  }
  return out;
}

// The shapes of a list of graphs, as 1 dataset in the default graph.
export function shaclDataset(inputs: { id: string; model: Model }[]): RdfDataset {
  const prefixes: Record<string, string> = {};
  const used = new Set<string>();
  const triples = inputs.flatMap((g) => shapeTriples(g.model, g.id, prefixes, used));
  return { prefixes, graphs: [{ triples }] };
}
