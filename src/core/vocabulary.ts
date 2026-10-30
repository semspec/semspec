// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Vocabularies: the codes that a field can take, and what each code means. The shape follows W3C SKOS.
//   A vocabulary  maps to skos:ConceptScheme (its `iri` is the IRI of the scheme).
//   A concept     maps to skos:Concept (its `iri` is the IRI of the concept), with
//     code        skos:notation
//     label       skos:prefLabel
//     definition  skos:definition
//     broader     skos:broader (the code of another concept of the scheme)
//     altLabels   skos:altLabel
// Only a code is a valid value of a field. An alternative label is not.
import { filterValues } from './tagged';
import { getPath } from './profile';
import type { Concept, Profile, Vocabulary } from './types';

// The most codes that an error message lists.
export const MAX_LISTED_CODES = 10;

// The scheme of a field, by the field path.
export function schemeOfField(p: Pick<Profile, 'vocabularies' | 'fieldVocabularies'>, field: string): { id: string; scheme: Vocabulary } | undefined {
  const id = p.fieldVocabularies?.[field];
  const scheme = id === undefined ? undefined : p.vocabularies?.[id];
  // A scheme that names a file has no concepts until the command line tool reads the file.
  return id !== undefined && scheme && Array.isArray(scheme.concepts) ? { id, scheme } : undefined;
}

export const conceptOf = (scheme: Vocabulary, code: string): Concept | undefined => scheme.concepts.find((c) => c.code === code);

// The label of a code. A value that is not a code of the scheme shows as it is.
export const codeLabel = (scheme: Vocabulary, code: string): string => conceptOf(scheme, code)?.label ?? code;

// The concept of a value of a field, when the profile gives the field a scheme with that code.
export function fieldConcept(p: Pick<Profile, 'vocabularies' | 'fieldVocabularies'>, field: string, code: unknown): Concept | undefined {
  const found = schemeOfField(p, field);
  return found && (typeof code === 'string' || typeof code === 'number') ? conceptOf(found.scheme, String(code)) : undefined;
}

// The label of a value of a field. A field with no scheme, and a value that is not a code, show as they are.
export const fieldLabel = (p: Pick<Profile, 'vocabularies' | 'fieldVocabularies'>, field: string, code: string): string => fieldConcept(p, field, code)?.label ?? code;

// The label of a value of an edge property. A property with no vocabulary shows as it is.
export function propertyLabel(p: Pick<Profile, 'vocabularies' | 'edges'>, edge: string, property: string, value: unknown): string {
  const id = p.edges[edge]?.properties?.[property]?.vocabulary;
  const concept = id === undefined || typeof value !== 'string' ? undefined : p.vocabularies?.[id]?.concepts && conceptOf(p.vocabularies[id], value);
  return concept ? concept.label : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

// A concept with no order comes after the ones with an order.
const compareConcepts = (a: Concept, b: Concept) => (a.order === b.order ? 0 : a.order === undefined ? 1 : b.order === undefined ? -1 : a.order - b.order) || a.label.localeCompare(b.label) || a.code.localeCompare(b.code);

// The concepts in list order: by `order`, then by label. A concept with no order comes last.
export const sortConcepts = (concepts: Concept[]): Concept[] => [...concepts].sort(compareConcepts);

// The codes in list order. A code that the scheme does not know comes after the known ones, in
// alphabetical order. The empty code comes last of all.
export function orderCodes(scheme: Vocabulary, codes: string[]): string[] {
  const rank = new Map(sortConcepts(scheme.concepts).map((c, i) => [c.code, i]));
  const rankOf = (code: string) => (code === '' ? Infinity : rank.get(code) ?? Infinity);
  return [...codes].sort((a, b) => {
    if (a === b) return 0;
    if (a === '') return 1;
    if (b === '') return -1;
    const known = (rankOf(a) === Infinity ? 1 : 0) - (rankOf(b) === Infinity ? 1 : 0);
    return known || (rankOf(a) === Infinity ? a.localeCompare(b) : rankOf(a) - rankOf(b));
  });
}

export interface CodedOption {
  value: string;
  label: string;
  // The label of the broader concept. A list shows the option below it.
  group?: string;
  definition?: string;
}

// The options of a list that offers some values of a coded field, in list order. A value that is not
// a code shows as it is. The empty value has the empty label. The caller names it.
export function codedOptions(scheme: Vocabulary, values: string[]): CodedOption[] {
  return orderCodes(scheme, values).map((value) => {
    const concept = conceptOf(scheme, value);
    return { value, label: concept?.label ?? value, group: concept ? groupLabelOf(scheme, value) : undefined, definition: concept?.definition };
  });
}

// The codes from a concept up to the top of its hierarchy. The concept comes first. A cycle ends the chain.
export function broaderChain(scheme: Vocabulary, code: string): string[] {
  const chain: string[] = [];
  let cur: string | undefined = code;
  while (cur !== undefined && !chain.includes(cur) && conceptOf(scheme, cur)) {
    chain.push(cur);
    cur = conceptOf(scheme, cur)?.broader;
  }
  return chain;
}

// The label of the broader concept of a code. It is the heading of a group in a list of options.
export function groupLabelOf(scheme: Vocabulary, code: string): string | undefined {
  const broader = conceptOf(scheme, code)?.broader;
  return broader === undefined ? undefined : conceptOf(scheme, broader)?.label;
}

export interface ConceptNode {
  concept: Concept;
  children: ConceptNode[];
}

// The concepts as a forest. A top concept has no `broader`, or a `broader` that the scheme lacks.
// Siblings are in list order. A concept in a cycle is left out, because it has no top.
export function conceptTree(scheme: Vocabulary): ConceptNode[] {
  const codes = new Set(scheme.concepts.map((c) => c.code));
  const build = (parent: string | undefined, seen: string[]): ConceptNode[] =>
    sortConcepts(scheme.concepts.filter((c) => (parent === undefined ? c.broader === undefined || !codes.has(c.broader) : c.broader === parent)))
      .filter((c) => !seen.includes(c.code))
      .map((concept) => ({ concept, children: build(concept.code, [...seen, concept.code]) }));
  return build(undefined, []);
}

// The problems of a scheme: an empty or duplicated code, a `broader` that does not exist, and a cycle in `broader`.
export function vocabularyProblems(id: string, scheme: Vocabulary): string[] {
  const out: string[] = [];
  const where = `vocabulary "${id}"`;
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const c of scheme.concepts) {
    if (c.code === '') out.push(`profile ${where} has a concept with an empty code`);
    else if (seen.has(c.code)) dup.add(c.code);
    seen.add(c.code);
  }
  dup.forEach((code) => out.push(`profile ${where} has the code "${code}" more than once`));
  for (const c of scheme.concepts) {
    if (c.broader !== undefined && !seen.has(c.broader)) out.push(`profile ${where}, concept "${c.code}", has the broader code "${c.broader}", which is not a code of the vocabulary`);
  }
  const reported = new Set<string>();
  for (const c of scheme.concepts) {
    if (reported.has(c.code) || !seen.has(c.broader ?? '')) continue;
    // Walk up. A repeat of a code that is on the walk is a cycle.
    const walk: string[] = [];
    let cur: string | undefined = c.code;
    while (cur !== undefined && !walk.includes(cur) && seen.has(cur)) {
      walk.push(cur);
      cur = conceptOf(scheme, cur)?.broader;
    }
    if (cur !== undefined && walk.includes(cur)) {
      const loop = walk.slice(walk.indexOf(cur));
      loop.forEach((x) => reported.add(x));
      out.push(`profile ${where} has a cycle in broader: ${[...loop, cur].join(' -> ')}`);
    }
  }
  return out;
}

// The allowed codes as text, or an empty text when the scheme has more than the limit.
export function allowedCodes(scheme: Vocabulary): string {
  return scheme.concepts.length <= MAX_LISTED_CODES ? ` Allowed codes: ${scheme.concepts.map((c) => c.code).join(', ')}.` : '';
}

// The text of the problem when a value is not a code of the scheme, or undefined when it is a code.
export function codeProblem(id: string, scheme: Vocabulary, value: unknown): string | undefined {
  const shown = typeof value === 'string' ? value : JSON.stringify(value);
  const ok = (typeof value === 'string' || typeof value === 'number') && conceptOf(scheme, String(value));
  return ok ? undefined : `the value ${JSON.stringify(shown)}, which is not a code of the vocabulary "${id}".${allowedCodes(scheme)}`;
}

// The problems of the vocabulary parts of a profile. It checks the schemes themselves, the scheme
// names in `fieldVocabularies` and in the edge properties, and the lifecycle values.
export function profileVocabularyProblems(p: Profile): string[] {
  const out: string[] = [];
  const schemes = p.vocabularies ?? {};
  for (const [id, scheme] of Object.entries(schemes)) if (Array.isArray(scheme.concepts)) out.push(...vocabularyProblems(id, scheme));
  for (const [field, id] of Object.entries(p.fieldVocabularies ?? {})) {
    if (!schemes[id]) out.push(`profile fieldVocabularies names the vocabulary "${id}" for the field "${field}", which has no entry in vocabularies`);
  }
  for (const [edge, spec] of Object.entries(p.edges)) {
    for (const [name, d] of Object.entries(spec.properties ?? {})) {
      if (d.vocabulary === undefined) continue;
      if (!schemes[d.vocabulary]) out.push(`profile edge ${edge}, property "${name}", names the vocabulary "${d.vocabulary}", which has no entry in vocabularies`);
      if (d.type !== 'string') out.push(`profile edge ${edge}, property "${name}", has a vocabulary and the type ${d.type}. A property with a vocabulary has the type string.`);
    }
  }
  const life = schemeOfField(p, p.lifecycle.field);
  if (life) {
    const check = (where: string, code: string) => {
      const found = codeProblem(life.id, life.scheme, code);
      if (code !== '' && found) out.push(`profile lifecycle ${where} has ${found}`);
    };
    check('fallback', p.lifecycle.fallback);
    Object.entries(p.lifecycle.byKind ?? {}).forEach(([kind, code]) => check(`byKind "${kind}"`, code));
    Object.keys(p.lifecycle.states ?? {}).forEach((code) => check(`state "${code}"`, code));
  }
  return out;
}

// The problems of the coded fields of 1 node. Each text starts with `the field "<path>"`.
export function nodeCodeProblems(p: Profile, node: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const field of Object.keys(p.fieldVocabularies ?? {})) {
    const found = schemeOfField(p, field);
    if (!found) continue;
    const from = p.fieldFilters?.find((f) => f.field === field)?.from;
    for (const value of filterValues(getPath(node, field), from)) {
      const problem = codeProblem(found.id, found.scheme, value);
      if (problem) out.push(`has the field "${field}" with ${problem}`);
    }
  }
  return out;
}
