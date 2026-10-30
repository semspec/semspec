// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the exports: IRIs, Turtle, JSON-LD, SHACL and Cypher. Every test runs on 2 profiles and on
// the workspace fixture. The Turtle parser and the Cypher scanner here are small checkers, not libraries.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  RDF_TYPE,
  buildModel,
  cypherScript,
  cypherString,
  cypherValue,
  datasetOf,
  escapeIri,
  escapeString,
  exportModel,
  exportWorkspace,
  iriMap,
  profileIriProblems,
  reify,
  resolveIri,
  shaclDataset,
  toJsonLd,
  toTurtle,
  upperSnake,
  workspaceDataset,
  type ExportFormat,
  type Graph,
  type Model,
  type Profile,
  type RdfDataset,
  type WorkspaceData,
} from '@semspec/core';
import { loadInputs, loadProfile, run } from '../packages/cli/src/index';
import { validateGraph, validateProfile } from '../packages/cli/src/validate';
import { loadWorkspace } from '../packages/cli/src/workspace';

const fixture = (name: string, file: string) => new URL(`../fixtures/${name}/${file}`, import.meta.url).pathname;
const made: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'export-'));
  made.push(dir);
  return dir;
};
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

const modelOf = (name: string) => {
  const { graph, profile } = loadInputs(fixture(name, 'graph.json'), fixture(name, 'profile.json'));
  return buildModel(graph, profile);
};
const cases: { name: string; model: Model }[] = [
  { name: 'product', model: modelOf('product') },
  { name: 'glossary', model: modelOf('glossary') },
];
const workspace: WorkspaceData = loadWorkspace(fixture('workspace', 'workspace.json')).data;

// ---- A small Turtle and TriG parser. It throws on a syntax error. ----

interface Parsed {
  prefixes: Record<string, string>;
  // Top-level triples as keys `graph|s|p|o`. Annotation and blank node triples are counted apart.
  top: string[];
  annotated: number;
  blankTriples: number;
  used: Set<string>;
}

type Tok = { k: 'iri' | 'str' | 'pname' | 'a' | 'p' | 'dt' | 'prefix' | 'bnode'; v: string };

function unescapeUchars(v: string): string {
  return v.replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) i++;
    else if (c === '#') i = text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i);
    else if (c === '<') {
      const j = text.indexOf('>', i);
      if (j < 0) throw new Error('unterminated IRI');
      const raw = text.slice(i + 1, j);
      if (/[\s<"{}|^`\\]/.test(raw.replace(/\\u[0-9A-Fa-f]{4}/g, ''))) throw new Error(`bad character in IRI ${raw}`);
      out.push({ k: 'iri', v: unescapeUchars(raw) });
      i = j + 1;
    } else if (c === '"') {
      let v = '';
      i++;
      for (;;) {
        const ch = text[i];
        if (ch === undefined) throw new Error('unterminated string');
        if (ch === '\n' || ch === '\r') throw new Error('raw newline in string');
        if (ch === '"') break;
        if (ch === '\\') {
          const n = text[i + 1];
          if (n === 'u') {
            if (!/^[0-9A-Fa-f]{4}$/.test(text.slice(i + 2, i + 6))) throw new Error('bad \\u escape');
            v += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
            i += 6;
            continue;
          }
          const map: Record<string, string> = { t: '\t', b: '\b', n: '\n', r: '\r', f: '\f', '"': '"', "'": "'", '\\': '\\' };
          if (!(n in map)) throw new Error(`bad escape \\${n}`);
          v += map[n];
          i += 2;
          continue;
        }
        v += ch;
        i++;
      }
      out.push({ k: 'str', v });
      i++;
    } else if (text.startsWith('^^', i)) {
      out.push({ k: 'dt', v: '^^' });
      i += 2;
    } else if (text.startsWith('{|', i) || text.startsWith('|}', i)) {
      out.push({ k: 'p', v: text.slice(i, i + 2) });
      i += 2;
    } else if ('{}[]().;,'.includes(c)) {
      out.push({ k: 'p', v: c });
      i++;
    } else {
      const m = /^[^\s;,()[\]{}|<>"#]+/.exec(text.slice(i));
      if (!m) throw new Error(`unexpected character ${c}`);
      const w = m[0];
      i += w.length;
      if (w === '@prefix') out.push({ k: 'prefix', v: w });
      else if (w === 'a') out.push({ k: 'a', v: w });
      else if (w.startsWith('_:')) out.push({ k: 'bnode', v: w });
      else if (w.includes(':')) out.push({ k: 'pname', v: w });
      else throw new Error(`unexpected word ${w}`);
    }
  }
  return out;
}

function parseTurtle(text: string): Parsed {
  const toks = tokenize(text);
  let pos = 0;
  const prefixes: Record<string, string> = {};
  const used = new Set<string>();
  const top: string[] = [];
  let annotated = 0;
  let blankTriples = 0;
  let blanks = 0;
  const peek = () => toks[pos];
  const next = () => {
    const t = toks[pos++];
    if (!t) throw new Error('unexpected end');
    return t;
  };
  const expectP = (v: string) => {
    const t = next();
    if (t.k !== 'p' || t.v !== v) throw new Error(`expected ${v}, got ${t.v}`);
  };
  const isP = (v: string) => peek()?.k === 'p' && peek().v === v;
  const iriOf = (t: Tok): string => {
    if (t.k === 'iri') return t.v;
    if (t.k === 'a') return RDF_TYPE;
    if (t.k === 'pname') {
      const [prefix, ...rest] = t.v.split(':');
      if (!(prefix in prefixes)) throw new Error(`undeclared prefix ${prefix}`);
      used.add(prefix);
      return prefixes[prefix] + rest.join(':');
    }
    throw new Error(`expected an IRI, got ${t.v}`);
  };
  // Reads an object. It returns the key of the object.
  function object(depth: number): string {
    const t = next();
    if (t.k === 'iri' || t.k === 'pname') return `<${iriOf(t)}>`;
    if (t.k === 'str') {
      if (peek()?.k === 'dt') {
        next();
        return `"${t.v}"^^<${iriOf(next())}>`;
      }
      return `"${t.v}"`;
    }
    if (t.k === 'p' && t.v === '[') {
      const id = `_:b${++blanks}`;
      if (!isP(']')) predicateObjectList(id, depth + 1);
      expectP(']');
      return id;
    }
    if (t.k === 'p' && t.v === '(') {
      const id = `_:l${++blanks}`;
      while (!isP(')')) object(depth + 1);
      expectP(')');
      return id;
    }
    throw new Error(`expected an object, got ${t.v}`);
  }
  function predicateObjectList(subject: string, depth: number, graph = '', annotation = false) {
    for (;;) {
      const p = iriOf(next());
      for (;;) {
        const o = object(depth);
        if (depth === 0 && !annotation) top.push(`${graph}|${subject}|<${p}>|${o}`);
        else blankTriples++;
        if (isP('{|')) {
          next();
          annotated++;
          predicateObjectList(`<<${subject} ${p} ${o}>>`, depth + 1, graph, true);
          expectP('|}');
        }
        if (isP(',')) {
          next();
          continue;
        }
        break;
      }
      if (isP(';')) {
        next();
        if (isP('.') || isP(']') || isP('|}')) return;
        continue;
      }
      return;
    }
  }
  function statement(graph: string) {
    const t = next();
    const subject = t.k === 'bnode' ? t.v : `<${iriOf(t)}>`;
    predicateObjectList(subject, 0, graph);
    expectP('.');
  }
  while (pos < toks.length) {
    const t = peek();
    if (t.k === 'prefix') {
      next();
      const name = next();
      if (name.k !== 'pname' || !name.v.endsWith(':')) throw new Error('bad prefix name');
      const ns = next();
      if (ns.k !== 'iri') throw new Error('bad prefix IRI');
      expectP('.');
      prefixes[name.v.slice(0, -1)] = ns.v;
    } else if (t.k === 'p' && t.v === '{') {
      next();
      while (!isP('}')) statement('');
      next();
    } else if ((t.k === 'iri' || t.k === 'pname') && toks[pos + 1]?.k === 'p' && toks[pos + 1].v === '{') {
      const graph = `<${iriOf(next())}>`;
      next();
      while (!isP('}')) statement(graph);
      next();
    } else statement('');
  }
  return { prefixes, top, annotated, blankTriples, used };
}

// The top-level triples of a dataset as keys, in the form of the parser.
function expectedKeys(ds: RdfDataset): string[] {
  const keys: string[] = [];
  for (const g of ds.graphs) {
    const graph = g.name === undefined ? '' : `<${g.name}>`;
    for (const t of g.triples) {
      const s = t.s.startsWith('_:') ? t.s : `<${t.s}>`;
      const o = t.o.t === 'iri' ? `<${t.o.v}>` : t.o.t === 'lit' ? (t.o.dt ? `"${t.o.v}"^^<${t.o.dt}>` : `"${t.o.v}"`) : t.o.t === 'json' ? `"${JSON.stringify(t.o.v)}"^^<http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON>` : '*';
      keys.push(`${graph}|${s}|<${t.p}>|${o}`);
    }
  }
  return keys;
}

// ---- A small Cypher scanner. It throws on a syntax error. ----

function scanCypher(text: string): { statements: string[]; rows: number } {
  const statements: string[] = [];
  let rows = 0;
  let cur = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/' && cur.trim() === '') {
      i = text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i);
    } else if (c === '"') {
      let j = i + 1;
      for (;;) {
        const ch = text[j];
        if (ch === undefined) throw new Error('unterminated string');
        if (ch === '\n' || ch === '\r') throw new Error('raw newline in string');
        if (ch === '\\') {
          if (!'tbnrf"\'\\u'.includes(text[j + 1])) throw new Error(`bad escape \\${text[j + 1]}`);
          j += text[j + 1] === 'u' ? 6 : 2;
          continue;
        }
        if (ch === '"') break;
        j++;
      }
      cur += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '`') {
      let j = i + 1;
      for (;;) {
        if (text[j] === undefined) throw new Error('unterminated name');
        if (text[j] === '`' && text[j + 1] === '`') j += 2;
        else if (text[j] === '`') break;
        else j++;
      }
      cur += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === ';') {
      statements.push(cur.trim());
      cur = '';
      i++;
    } else {
      cur += c;
      i++;
    }
  }
  if (cur.trim()) throw new Error('the last statement has no semicolon');
  for (const s of statements) {
    if (!s.startsWith('UNWIND [')) continue;
    let depthBrace = 0;
    let depthBracket = 0;
    for (let k = s.indexOf('['); k < s.length; k++) {
      const ch = s[k];
      if (ch === '"') {
        k++;
        while (s[k] !== '"') k += s[k] === '\\' ? (s[k + 1] === 'u' ? 6 : 2) : 1;
      } else if (ch === '`') {
        k++;
        while (!(s[k] === '`' && s[k + 1] !== '`')) k += s[k] === '`' ? 2 : 1;
      } else if (ch === '[') depthBracket++;
      else if (ch === ']') {
        depthBracket--;
        if (depthBracket === 0) break;
      } else if (ch === '{') {
        if (depthBrace === 0 && depthBracket === 1) rows++;
        depthBrace++;
      } else if (ch === '}') depthBrace--;
    }
    expect(depthBrace).toBe(0);
  }
  return { statements, rows };
}

const crossLinkCount = (data: WorkspaceData) => data.graphs.reduce((sum, g) => sum + g.model.crossLinks.filter((c) => data.graphs.find((x) => x.id === c.graph)?.model.nodes.some((n) => n.id === c.t)).length, 0);

// ---- Tests ----

describe('IRIs', () => {
  const profile = (extra: Record<string, unknown> = {}): Profile => ({ ...cases[0].model.profile, ...extra }) as Profile;

  it('mints node IRIs from the base, the kind and the url-encoded id', () => {
    const I = iriMap(cases[0].model.profile);
    expect(I.node('story-pay-by-card', 'story')).toBe('https://example.org/shop/story/story-pay-by-card');
    expect(I.node('a/b c#1', 'story')).toBe('https://example.org/shop/story/a%2Fb%20c%231');
    expect(I.node('x', 'k').startsWith(I.base)).toBe(true);
  });
  it('maps a kind, an edge, an edge property and a field to the IRI of the profile', () => {
    const I = iriMap(cases[0].model.profile);
    expect(I.kind('story')).toBe('https://example.org/ns/Story');
    expect(I.edge('complies')).toBe('https://example.org/ns/compliesWith');
    expect(I.edgeProperty('complies', 'since')).toBe('https://example.org/ns/since');
    expect(I.field('priority')).toBe('https://example.org/ns/priority');
  });
  it('mints the IRI of a term without a mapping under the base', () => {
    const I = iriMap(cases[0].model.profile);
    expect(I.kind('scenario')).toBe('https://example.org/shop/vocab/scenario');
    expect(I.edge('scenario')).toBe('https://example.org/shop/vocab/edge/scenario');
    expect(I.field('summary')).toBe('https://example.org/shop/vocab/field/summary');
    expect(I.scheme('priority')).toBe('https://example.org/shop/scheme/priority');
  });
  it('uses a base with the id of the graph when the profile has none', () => {
    const I = iriMap(cases[1].model.profile, 'g1');
    expect(I.node('scale', 'term')).toBe('urn:semspec:g1:term/scale');
    expect(iriMap(cases[1].model.profile, 'g2').node('scale', 'term')).not.toBe(I.node('scale', 'term'));
  });
  it('takes the IRI of a node from the field that iri.field names', () => {
    const p = profile({ iri: { ...cases[0].model.profile.iri, field: 'webid' } });
    expect(iriMap(p).node('x', 'story', { webid: 'ex:me' })).toBe('https://example.org/ns/me');
    expect(iriMap(p).node('x', 'story', { webid: 'https://example.org/own/1' })).toBe('https://example.org/own/1');
    expect(iriMap(p).node('x', 'story', {})).toBe('https://example.org/shop/story/x');
  });
  it('resolves a CURIE and a full IRI, and refuses an unknown prefix', () => {
    const prefixes = { ex: 'https://example.org/ns/' };
    expect(resolveIri('ex:Thing', prefixes)).toEqual({ iri: 'https://example.org/ns/Thing' });
    expect(resolveIri('https://example.org/a', prefixes)).toEqual({ iri: 'https://example.org/a' });
    expect(resolveIri('urn:isbn:1', prefixes)).toEqual({ iri: 'urn:isbn:1' });
    expect(resolveIri('zz:Thing', prefixes)).toEqual({ error: expect.stringMatching(/prefix "zz"/) });
    expect(resolveIri('plain', prefixes)).toEqual({ error: expect.any(String) });
  });
  it('is a profile error when a CURIE uses an unknown prefix', () => {
    for (const c of cases) {
      const raw = JSON.parse(readFileSync(fixture(c.name, 'profile.json'), 'utf8'));
      expect(validateProfile(loadProfile(fixture(c.name, 'profile.json'))), c.name).toEqual([]);
      raw.kinds[1].iri = 'zz:Thing';
      raw.edges[Object.keys(raw.edges)[0]].iri = 'qq:thing';
      raw.fieldIris = { name: 'yy:name' };
      const errors = validateProfile(raw);
      expect(errors.some((e) => /kind .* iri "zz:Thing" uses the prefix "zz"/.test(e)), c.name).toBe(true);
      expect(errors.some((e) => /edge .* iri "qq:thing" uses the prefix "qq"/.test(e)), c.name).toBe(true);
      expect(errors.some((e) => /field "name" iri "yy:name" uses the prefix "yy"/.test(e)), c.name).toBe(true);
    }
  });
  it('is a profile error for a vocabulary or a concept with an unknown prefix, a bad base and a built-in prefix redefined', () => {
    const p = clone(cases[0].model.profile);
    const first = Object.values(p.vocabularies!)[0];
    first.iri = 'nope:Scheme';
    first.concepts[0].iri = 'nope:Concept';
    p.iri = { base: 'not an iri', prefixes: { rdf: 'https://example.org/rdf#', 'bad name': 'https://example.org/' } };
    const errors = profileIriProblems(p);
    expect(errors.filter((e) => /prefix "nope"/.test(e)).length).toBe(2);
    expect(errors.some((e) => /iri\.base/.test(e))).toBe(true);
    expect(errors.some((e) => /redefines the built-in prefix "rdf"/.test(e))).toBe(true);
    expect(errors.some((e) => /not a valid prefix name/.test(e))).toBe(true);
  });
  it('adds no problem for a profile without iri', () => {
    for (const c of cases) expect(profileIriProblems({ ...c.model.profile, iri: undefined, fieldIris: undefined, kinds: c.model.profile.kinds.map((k) => ({ ...k, iri: undefined })), edges: {} }), c.name).toEqual([]);
  });
});

const clone = <T>(v: T): T => structuredClone(v);

describe('Turtle', () => {
  const targets: { name: string; ds: RdfDataset; text: string }[] = [
    ...cases.map((c) => ({ name: c.name, ds: datasetOf([{ id: 'graph', model: c.model }]), text: exportModel(c.model, 'turtle') })),
    { name: 'workspace', ds: workspaceDataset(workspace), text: exportWorkspace(workspace, 'turtle') },
  ];

  it('parses, ends each statement with a dot and declares each prefix that it uses', () => {
    for (const t of targets) {
      const parsed = parseTurtle(t.text);
      expect(parsed.top.length, t.name).toBeGreaterThan(0);
      for (const prefix of parsed.used) expect(parsed.prefixes[prefix], `${t.name} prefix ${prefix}`).toBeDefined();
      for (const prefix of Object.keys(parsed.prefixes)) expect(parsed.used.has(prefix), `${t.name} declares only used prefix ${prefix}`).toBe(true);
    }
  });
  it('round-trips every triple of the graph', () => {
    for (const t of targets) {
      const parsed = parseTurtle(t.text);
      const expected = expectedKeys(t.ds);
      expect(parsed.top.length, t.name).toBe(expected.length);
      const known = new Set(expected);
      for (const key of expected.filter((k) => !k.endsWith('|*'))) expect(parsed.top, `${t.name} ${key.slice(0, 120)}`).toContain(key);
      for (const key of parsed.top.filter((k) => !k.split('|')[3].startsWith('_:'))) expect(known.has(key), `${t.name} ${key.slice(0, 120)}`).toBe(true);
    }
  });
  it('writes an edge with properties as an RDF 1.2 annotation, and the plain triple of an edge without', () => {
    const text = targets.find((t) => t.name === 'product')!.text;
    expect(text).toMatch(/\{\| ex:since "2024-03"\^\^xsd:gYearMonth/);
    const parsed = parseTurtle(text);
    const model = cases[0].model;
    expect(parsed.annotated).toBe(model.edges.filter((e) => e.p || e.n).length);
  });
  it('writes the reified form without annotations when asked', () => {
    const text = exportModel(cases[0].model, 'turtle', { annotations: 'reified' });
    expect(text).not.toContain('{|');
    parseTurtle(text);
    expect(text).toContain('rdf:Statement');
    expect(text).toContain('rdf:subject');
    expect((text.match(/rdf:predicate/g) ?? []).length).toBe(cases[0].model.edges.filter((e) => e.p || e.n).length);
  });
  it('writes the workspace as TriG with a named graph for each workspace graph', () => {
    const text = targets.find((t) => t.name === 'workspace')!.text;
    for (const g of workspace.graphs) expect(text).toContain(`<urn:semspec:graph:${g.id}> {`);
    const parsed = parseTurtle(text);
    expect(new Set(parsed.top.map((k) => k.split('|')[0]))).toEqual(new Set(workspace.graphs.map((g) => `<urn:semspec:graph:${g.id}>`)));
  });
  it('writes a triple for each edge of the model, between the IRIs of its nodes', () => {
    for (const c of cases) {
      const ds = datasetOf([{ id: 'graph', model: c.model }]);
      const I = iriMap(c.model.profile, 'graph');
      const kindOf = new Map(c.model.nodes.map((n) => [n.id, n]));
      for (const e of c.model.edges) {
        const s = kindOf.get(e.s)!;
        const t = kindOf.get(e.t)!;
        const found = ds.graphs[0].triples.some((tr) => tr.s === I.node(s.id, s.kind, s.d) && tr.o.t === 'iri' && tr.o.v === I.node(t.id, t.kind, t.d) && tr.p.length > 0 && (tr.ann?.length ?? 0) >= 0);
        expect(found, `${c.name} ${e.s} ${e.k} ${e.t}`).toBe(true);
      }
    }
  });
  it('types each node with the class of its kind and the label of its title', () => {
    for (const c of cases) {
      const ds = datasetOf([{ id: 'graph', model: c.model }]);
      const I = iriMap(c.model.profile, 'graph');
      for (const n of c.model.nodes) {
        const s = I.node(n.id, n.kind, n.d);
        const own = ds.graphs[0].triples.filter((t) => t.s === s);
        expect(own.some((t) => t.p === RDF_TYPE && t.o.t === 'iri' && t.o.v === I.kind(n.kind)), `${c.name} ${n.id}`).toBe(true);
        expect(own.some((t) => t.p === 'http://www.w3.org/2000/01/rdf-schema#label' && t.o.t === 'lit' && t.o.v === n.title), `${c.name} ${n.id}`).toBe(true);
      }
    }
  });
  it('writes numbers, booleans and ISO dates with xsd types, and a coded field as the concept IRI', () => {
    const product = targets.find((t) => t.name === 'product')!.text;
    expect(product).toContain('"2024"^^xsd:gYear');
    expect(product).toContain('"2024-03"^^xsd:gYearMonth');
    expect(product).toContain('"2026-02-10"^^xsd:date');
    expect(product).toContain('"true"^^xsd:boolean');
    expect(product).toContain('"0.4"^^xsd:decimal');
    expect(product).toContain('<https://example.org/shop/scheme/priority/high>');
    expect(product).toContain('ex:priority <https://example.org/shop/scheme/priority/high>');
  });
  it('writes the vocabularies as SKOS', () => {
    for (const c of cases) {
      const ds = datasetOf([{ id: 'graph', model: c.model }]);
      const triples = ds.graphs[0].triples;
      const of = (type: string) => triples.filter((t) => t.p === RDF_TYPE && t.o.t === 'iri' && t.o.v === type).length;
      const schemes = Object.values(c.model.profile.vocabularies ?? {});
      expect(of('http://www.w3.org/2004/02/skos/core#ConceptScheme'), c.name).toBe(schemes.length);
      expect(of('http://www.w3.org/2004/02/skos/core#Concept'), c.name).toBe(schemes.reduce((n, s) => n + s.concepts.length, 0));
      const count = (p: string) => triples.filter((t) => t.p === `http://www.w3.org/2004/02/skos/core#${p}`).length;
      expect(count('notation'), c.name).toBe(schemes.reduce((n, s) => n + s.concepts.length, 0));
      expect(count('inScheme'), c.name).toBe(count('notation'));
      expect(count('broader'), c.name).toBe(schemes.reduce((n, s) => n + s.concepts.filter((x) => x.broader).length, 0));
      expect(count('altLabel'), c.name).toBe(schemes.reduce((n, s) => n + s.concepts.reduce((m, x) => m + (x.altLabels?.length ?? 0), 0), 0));
      expect(count('prefLabel'), c.name).toBe(schemes.length + count('notation'));
    }
  });
  it('writes provenance with PROV-O', () => {
    for (const c of cases) {
      const ds = datasetOf([{ id: 'graph', model: c.model }]);
      const P = 'http://www.w3.org/ns/prov#';
      const triples = ds.graphs[0].triples;
      expect(triples.filter((t) => t.p === `${P}wasGeneratedBy`).length, c.name).toBeGreaterThan(0);
      expect(triples.filter((t) => t.p === `${P}generatedAtTime`).length, c.name).toBeGreaterThan(0);
      expect(triples.filter((t) => t.p === `${P}wasAttributedTo`).length, c.name).toBeGreaterThan(0);
      expect(triples.some((t) => t.p === RDF_TYPE && t.o.t === 'iri' && t.o.v === `${P}Agent`), c.name).toBe(true);
      const withMarker = triples.find((t) => t.p === `${P}wasGeneratedBy`)!;
      expect(withMarker.o.t).toBe('blank');
      expect(triples.some((t) => t.ann?.some((a) => a.p === `${P}wasGeneratedBy`)), `${c.name} edge provenance`).toBe(true);
    }
  });
  it('writes the profile as an ontology', () => {
    for (const c of cases) {
      const ds = datasetOf([{ id: 'graph', model: c.model }]);
      const I = iriMap(c.model.profile, 'graph');
      const triples = ds.graphs[0].triples;
      for (const k of c.model.profile.kinds) {
        expect(triples.some((t) => t.s === I.kind(k.id) && t.p === RDF_TYPE && t.o.t === 'iri' && t.o.v === 'http://www.w3.org/2002/07/owl#Class'), `${c.name} ${k.id}`).toBe(true);
        expect(triples.some((t) => t.s === I.kind(k.id) && t.p === 'http://www.w3.org/2000/01/rdf-schema#label' && t.o.t === 'lit' && t.o.v === k.label), `${c.name} ${k.id}`).toBe(true);
      }
      for (const [name, spec] of Object.entries(c.model.profile.edges)) {
        if (name === 'derivedFrom') continue;
        const s = I.edge(name);
        expect(triples.some((t) => t.s === s && t.p === RDF_TYPE && t.o.t === 'iri' && t.o.v === 'http://www.w3.org/2002/07/owl#ObjectProperty'), `${c.name} ${name}`).toBe(true);
        expect(triples.some((t) => t.s === s && t.p === 'http://www.w3.org/2000/01/rdf-schema#domain'), `${c.name} ${name} domain`).toBe(!!spec.from?.length);
        expect(triples.some((t) => t.s === s && t.p === 'http://www.w3.org/2000/01/rdf-schema#range'), `${c.name} ${name} range`).toBe(!!spec.to?.length);
      }
    }
  });
  it('turns a cross link of the workspace into an object property to the node of the other graph', () => {
    const ds = datasetOf(workspace.graphs.map((g) => ({ id: g.id, model: g.model, name: g.id, resolveCross: (graph: string, id: string) => `x:${graph}/${id}` })));
    const req = ds.graphs[0].triples.filter((t) => t.p.endsWith('/field/concerns'));
    expect(req.length).toBeGreaterThan(0);
    expect(req.every((t) => t.o.t === 'iri' && t.o.v.startsWith('x:domain/'))).toBe(true);
    const text = targets.find((t) => t.name === 'workspace')!.text;
    expect(text).toContain('<https://example.org/retail/shop/shop-brightcart>');
    expect(text).toContain('<https://example.org/shop/story/story-pay-by-card>');
    expect(text).toContain('schema:Store');
  });
});

describe('JSON-LD', () => {
  it('is valid JSON with a context and a graph', () => {
    for (const c of cases) {
      const doc = JSON.parse(exportModel(c.model, 'jsonld'));
      expect(doc['@context'], c.name).toBeTypeOf('object');
      expect(Array.isArray(doc['@graph']), c.name).toBe(true);
      expect(doc['@graph'].every((n: any) => typeof n['@id'] === 'string'), c.name).toBe(true);
      const ids = doc['@graph'].map((n: any) => n['@id']);
      expect(new Set(ids).size, c.name).toBe(ids.length);
    }
  });
  it('has the same subjects as the Turtle', () => {
    for (const c of cases) {
      const doc = JSON.parse(exportModel(c.model, 'jsonld'));
      const ds = datasetOf([{ id: 'graph', model: c.model }]);
      expect(doc['@graph'].length, c.name).toBe(new Set(ds.graphs[0].triples.map((t) => t.s)).size);
    }
  });
  it('writes an edge with properties with @annotation, and the reified form without it', () => {
    const star = JSON.parse(exportModel(cases[0].model, 'jsonld'));
    expect(JSON.stringify(star)).toContain('"@annotation"');
    const reified = exportModel(cases[0].model, 'jsonld', { annotations: 'reified' });
    expect(reified).not.toContain('@annotation');
    expect(reified).toContain('rdf:Statement');
    expect(JSON.parse(reified)['@context']).toBeDefined();
  });
  it('writes a @graph for each graph of the workspace, with its name', () => {
    const doc = JSON.parse(exportWorkspace(workspace, 'jsonld'));
    expect(doc['@context']).toBeDefined();
    expect(doc['@graph'].map((g: any) => g['@id'])).toEqual(workspace.graphs.map((g) => `urn:semspec:graph:${g.id}`));
    for (const g of doc['@graph']) expect(Array.isArray(g['@graph'])).toBe(true);
  });
  it('writes a typed literal with @value and @type, and an object as @json', () => {
    const doc = JSON.parse(exportModel(cases[0].model, 'jsonld'));
    const text = JSON.stringify(doc);
    expect(text).toContain('"@type":"xsd:gYear"');
    expect(text).toContain('"@type":"@json"');
  });
});

describe('SHACL', () => {
  it('has a shape with a target class for each kind', () => {
    for (const c of cases) {
      const text = exportModel(c.model, 'shacl');
      parseTurtle(text);
      const I = iriMap(c.model.profile, 'graph');
      const ds = shaclDataset([{ id: 'graph', model: c.model }]);
      const targets = ds.graphs[0].triples.filter((t) => t.p === 'http://www.w3.org/ns/shacl#targetClass');
      expect(targets.map((t) => (t.o.t === 'iri' ? t.o.v : '')).sort(), c.name).toEqual(c.model.profile.kinds.map((k) => I.kind(k.id)).sort());
      expect((text.match(/a sh:NodeShape/g) ?? []).length, c.name).toBeGreaterThanOrEqual(c.model.profile.kinds.length);
    }
  });
  it('requires the id, constrains the target kinds of an edge and lists the codes of a coded field', () => {
    const text = exportModel(cases[0].model, 'shacl');
    expect(text).toContain('sh:path dct:identifier ; sh:minCount "1"^^xsd:integer');
    expect(text).toContain('sh:class ex:Story');
    expect(text).toContain('sh:path ex:priority ; sh:in ( <https://example.org/shop/scheme/priority/low> <https://example.org/shop/scheme/priority/medium> <https://example.org/shop/scheme/priority/high> )');
    expect(text).toContain('sh:pattern "^[0-9]{4}');
    expect(text).toMatch(/sh:targetSubjectsOf ex:since/);
    expect(text).toMatch(/sh:datatype xsd:boolean/);
  });
  it('has the shapes of all profiles in the workspace', () => {
    const text = exportWorkspace(workspace, 'shacl');
    parseTurtle(text);
    const kinds = workspace.graphs.reduce((n, g) => n + g.model.profile.kinds.length, 0);
    // The 4 organisation kinds of the retail market profile share the class schema:Organization.
    expect(new Set(text.match(/sh:targetClass [^ ]+/g)).size).toBeGreaterThanOrEqual(kinds - 4);
    expect((text.match(/sh:targetClass/g) ?? []).length).toBe(kinds);
  });
});

describe('Cypher', () => {
  it('has well formed statements: quotes balanced, no raw newline in a string, a semicolon at the end of each', () => {
    for (const c of cases) {
      const { statements } = scanCypher(exportModel(c.model, 'cypher'));
      expect(statements.length, c.name).toBeGreaterThan(0);
      for (const s of statements) expect(/^(CREATE INDEX|UNWIND)/.test(s), `${c.name} ${s.slice(0, 40)}`).toBe(true);
    }
    scanCypher(exportWorkspace(workspace, 'cypher'));
  });
  it('writes a node for each node of the model and a relationship for each edge', () => {
    for (const c of cases) {
      const { statements } = scanCypher(exportModel(c.model, 'cypher'));
      const count = (re: RegExp) => scanCypher(statements.filter((s) => re.test(s)).map((s) => `${s};`).join('\n')).rows;
      expect(count(/\nMERGE \(n:/), c.name).toBe(c.model.nodes.length);
      expect(count(/\nCREATE \(a\)-\[r:/), c.name).toBe(c.model.edges.length);
    }
  });
  it('adds the property graph to each node of the workspace and counts the nodes, edges and cross links', () => {
    const text = exportWorkspace(workspace, 'cypher');
    const { statements } = scanCypher(text);
    const count = (re: RegExp) => scanCypher(statements.filter((s) => re.test(s)).map((s) => `${s};`).join('\n')).rows;
    expect(count(/\nMERGE \(n:/)).toBe(workspace.graphs.reduce((n, g) => n + g.model.nodes.length, 0));
    expect(count(/\nCREATE \(a\)-\[r:/)).toBe(workspace.graphs.reduce((n, g) => n + g.model.edges.length, 0) + crossLinkCount(workspace));
    expect((text.match(/`graph`: "/g) ?? []).length).toBe(workspace.graphs.reduce((n, g) => n + g.model.nodes.length, 0));
    expect(text).toContain('MERGE (n:`story` {id: row.id, graph: "req"})');
    expect(exportModel(cases[0].model, 'cypher')).not.toContain('`graph`');
  });
  it('uses the upper snake case of the edge name as the relationship type', () => {
    expect(exportModel(cases[1].model, 'cypher')).toContain('CREATE (a)-[r:`IN_GROUP`]->(b)');
    expect(upperSnake('inGroup')).toBe('IN_GROUP');
    expect(upperSnake('derived-from x')).toBe('DERIVED_FROM_X');
    expect(upperSnake('!!')).toBe('EDGE');
  });
  it('keeps a list of texts as a list and writes an object or a mixed list as a JSON string', () => {
    expect(cypherValue(['a', 'b'])).toBe('["a", "b"]');
    expect(cypherValue([1, 2.5])).toBe('[1, 2.5]');
    expect(cypherValue([])).toBe('[]');
    expect(cypherValue([1, 'a'])).toBe('"[1,\\"a\\"]"');
    expect(cypherValue({ a: 1 })).toBe('"{\\"a\\":1}"');
    expect(cypherValue([{ a: 1 }])).toBe('"[{\\"a\\":1}]"');
    expect(cypherValue(null)).toBeUndefined();
    expect(cypherValue(Number.NaN)).toBeUndefined();
    expect(cypherValue(true)).toBe('true');
  });
  it('writes the provenance of a node and of an edge as properties', () => {
    const text = exportModel(cases[0].model, 'cypher');
    expect(text).toContain('`how`: "verified"');
    expect(text).toMatch(/`retrieved`: "2026-0\d/);
    expect(text).toMatch(/\{s: "story-save-card", t: "story-pay-by-card", props: \{[^}]*`how`: "inferred"/);
  });
});

describe('Escaping', () => {
  const nasty = 'quote " backslash \\ newline \n tab \t return \r unicode é 漢 😀 control \u0001 end';

  it('escapes a string for Turtle on 1 line and keeps unicode', () => {
    const out = escapeString(nasty);
    expect(out).not.toMatch(/[\n\r\t]/);
    expect(out).toContain('\\"');
    expect(out).toContain('\\\\');
    expect(out).toContain('\\n');
    expect(out).toContain('\\u0001');
    expect(out).toContain('é 漢 😀');
    expect(escapeString('a\ud800b')).toBe('a\\uFFFDb');
  });
  it('escapes an IRI so that > and other forbidden characters stay out of the brackets', () => {
    const out = escapeIri('https://example.org/a>b <c> "d" {e} |f| ^g `h` \\i j');
    expect(out).not.toMatch(/[<>"{}|^` \\][^u]/);
    expect(out).toContain('\\u003E');
    expect(escapeIri('https://example.org/ok')).toBe('https://example.org/ok');
  });
  it('escapes a string for Cypher on 1 line and keeps unicode', () => {
    const out = cypherString(nasty);
    expect(out.startsWith('"')).toBe(true);
    expect(out).not.toMatch(/[\n\r\t]/);
    expect(out).toContain('\\"');
    expect(out).toContain('\\\\');
    expect(out).toContain('\\u0001');
    expect(out).toContain('é 漢 😀');
    expect(cypherString('\u2028')).toBe('"\\u2028"');
  });

  // A graph whose texts hold every nasty case, in 2 profiles.
  const nastyGraph = (extra: Partial<Profile> = {}) => {
    const profile: Profile = {
      project: 'Escapes',
      source: { nodes: 'nodes', id: 'id', kind: 'kind' },
      fields: { title: ['name'], statement: ['text'] },
      lifecycle: { field: 'state', fallback: 'live' },
      kinds: [
        { id: 'item`s', label: 'Item "q"', plural: 'items', role: 'hierarchy', color: { light: '#000', dark: '#fff' }, parents: [['of']], iri: 'ex:Item' },
        { id: 'box', label: 'Box', plural: 'boxes', role: 'hierarchy', color: { light: '#000', dark: '#fff' } },
      ],
      edges: { of: { labels: ['Of `x`', 'Has'], properties: { note: { type: 'string' }, n: { type: 'number' } } } },
      iri: { base: 'https://example.org/x/', prefixes: { ex: 'https://example.org/ns/' } },
      ...extra,
    };
    const graph: Graph = {
      nodes: [
        { id: 'b>1', kind: 'box', name: nasty, text: 'line 1\nline 2 "q" \\' },
        { id: 'i "1" `2`', kind: 'item`s', name: 'Item\tone', text: nasty, tags: ['a"b', 'c\nd'], meta: { k: 'v"\n' }, of: [{ id: 'b>1', note: nasty, n: 1.5 }] },
      ],
    };
    return buildModel(graph, profile);
  };

  it('writes Turtle, TriG and Cypher with every nasty case in a form that parses', () => {
    const model = nastyGraph();
    const turtle = exportModel(model, 'turtle');
    const parsed = parseTurtle(turtle);
    expect(parsed.top.some((k) => k.endsWith(`|"${nasty}"`))).toBe(true);
    expect(parsed.top.some((k) => k.includes('<https://example.org/x/box/b%3E1>'))).toBe(true);
    scanCypher(exportModel(model, 'cypher'));
    expect(exportModel(model, 'cypher')).toContain('MERGE (n:`item``s` {id: row.id})');
    expect(() => JSON.parse(exportModel(model, 'jsonld'))).not.toThrow();
    parseTurtle(exportModel(model, 'shacl'));
    parseTurtle(exportModel(model, 'turtle', { annotations: 'reified' }));
  });
  it('keeps a raw > out of an IRI', () => {
    const ds: RdfDataset = { prefixes: {}, graphs: [{ triples: [{ s: 'https://example.org/a>b', p: 'https://example.org/p', o: { t: 'iri', v: 'https://example.org/c>d' } }] }] };
    const text = toTurtle(ds);
    expect(text).not.toMatch(/<[^>]*>[^ ]*>/);
    expect(parseTurtle(text).top).toEqual(['|<https://example.org/a>b>|<https://example.org/p>|<https://example.org/c>d>']);
  });
  it('escapes the strings of JSON-LD through JSON', () => {
    const out = toJsonLd({ prefixes: {}, graphs: [{ triples: [{ s: 'https://example.org/s', p: 'https://example.org/p', o: { t: 'lit', v: nasty } }] }] });
    expect(JSON.parse(out)['@graph'][0]['https://example.org/p']).toBe(nasty);
  });
  it('keeps the reified form valid', () => {
    const ds = datasetOf([{ id: 'graph', model: nastyGraph() }]);
    const out = toTurtle(reify(ds));
    parseTurtle(out);
    expect(out).not.toContain('{|');
  });
});

describe('The command line', () => {
  const run1 = async (args: string[]) => run(['export', ...args]);
  const formats: ExportFormat[] = ['turtle', 'jsonld', 'shacl', 'cypher'];

  it('writes each format of a graph into the file', async () => {
    const dir = tmp();
    for (const format of formats) {
      for (const c of cases) {
        const out = join(dir, `${c.name}.${format}`);
        expect(await run1(['--graph', fixture(c.name, 'graph.json'), '--profile', fixture(c.name, 'profile.json'), '--format', format, '--out', out]), `${c.name} ${format}`).toBe(0);
        expect(readFileSync(out, 'utf8')).toBe(exportModel(c.model, format));
      }
    }
  });
  it('writes each format of the workspace into 1 file', async () => {
    const dir = tmp();
    for (const format of formats) {
      const out = join(dir, `ws.${format}`);
      expect(await run1(['--workspace', fixture('workspace', 'workspace.json'), '--format', format, '--out', out]), format).toBe(0);
      expect(readFileSync(out, 'utf8')).toBe(exportWorkspace(workspace, format));
    }
  });
  it('refuses a missing option, an unknown format and a workspace with a graph', async () => {
    const dir = tmp();
    const base = ['--graph', fixture('glossary', 'graph.json'), '--profile', fixture('glossary', 'profile.json')];
    expect(await run1([...base, '--out', join(dir, 'a')])).toBe(1);
    expect(await run1([...base, '--format', 'turtle'])).toBe(1);
    expect(await run1([...base, '--format', 'xml', '--out', join(dir, 'a')])).toBe(1);
    expect(await run1([...base, '--format', 'turtle', '--annotations', 'x', '--out', join(dir, 'a')])).toBe(1);
    expect(await run1(['--workspace', fixture('workspace', 'workspace.json'), '--graph', 'g', '--format', 'turtle', '--out', join(dir, 'a')])).toBe(1);
    expect(await run1(['--format', 'turtle', '--out', join(dir, 'a')])).toBe(1);
  });
  it('checks the graph before it exports', async () => {
    const dir = tmp();
    expect(await run1(['--graph', fixture('glossary', 'graph.json'), '--profile', join(dir, 'missing.json'), '--format', 'turtle', '--out', join(dir, 'a')])).toBe(1);
  });
});

describe('The graph check', () => {
  it('still accepts the fixtures with their iri keys', () => {
    for (const c of cases) {
      const { graph } = loadInputs(fixture(c.name, 'graph.json'), fixture(c.name, 'profile.json'));
      expect(validateGraph(graph, c.model.profile, undefined, '2026-10-30').errors, c.name).toEqual([]);
    }
  });
});
