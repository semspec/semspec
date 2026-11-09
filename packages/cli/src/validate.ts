// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Checks the 2 inputs. A profile is checked against its JSON Schema. A graph is checked against
// the names that the profile gives.
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { embeddingConfigProblems, profileExternalLinkProblems, profileDeliverableProblems, profileIriProblems, parentFields, profileProvenanceProblems, profileSpecProblems, profileVocabularyProblems, refsOf, validateGraph, type Profile } from '@semspec/core';

export { validateGraph };

const schemaPath = new URL('../../../schema/profile.schema.json', import.meta.url);

export function validateProfile(profile: unknown, schema: object = JSON.parse(readFileSync(schemaPath, 'utf8'))): string[] {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (validate(profile)) return crossCheckProfile(profile as Profile);
  return (validate.errors ?? []).map((e) => `profile${e.instancePath} ${e.message}`);
}

// A profile must name kinds that it defines.
function crossCheckProfile(p: Profile): string[] {
  const errors: string[] = [];
  const kinds = new Set(p.kinds.map((k) => k.id));
  const need = (where: string, id: string | undefined) => id !== undefined && !kinds.has(id) && errors.push(`profile ${where} names the unknown kind "${id}"`);
  p.kinds.forEach((k) => need(`kind ${k.id} placedUnder`, k.placedUnder));
  p.parts?.forEach((x) => {
    need(`part ${x.field} kind`, x.kind);
    need(`part ${x.field} owner`, x.owner);
  });
  p.embedded?.forEach((x) => {
    need(`embedded ${x.field} kind`, x.kind);
    need(`embedded ${x.field} owner`, x.owner);
  });
  errors.push(...profileVocabularyProblems(p));
  errors.push(...profileProvenanceProblems(p));
  errors.push(...profileIriProblems(p));
  errors.push(...profileDeliverableProblems(p));
  errors.push(...profileSpecProblems(p));
  errors.push(...profileExternalLinkProblems(p));
  if (p.search?.embeddings !== undefined) errors.push(...embeddingConfigProblems(p.search.embeddings, 'profile search.embeddings'));
  need('source defaultKind', p.source.defaultKind);
  const body = p.source.markdown?.body;
  if (body !== undefined && (body === p.source.id || body === p.source.kind)) errors.push(`profile source markdown body "${body}" is also the id key or the kind key. Use a different field.`);
  need('checks kind', p.checks?.kind);
  need('facets groupKind', p.facets?.groupKind);
  need('entry kind', p.entry?.kind);
  need('entry childKind', p.entry?.childKind);
  if (p.status) {
    const tones = p.status.values.map((x) => x.tone).join(',');
    if (tones !== 'good,warn,bad') errors.push(`profile status values have the tones ${tones}. They must have the tones good, warn, bad in this order.`);
  }
  const edges = new Set(Object.keys(p.edges));
  for (const [name, spec] of Object.entries(p.edges)) {
    spec.from?.forEach((id) => need(`edge ${name} from`, id));
    spec.to?.forEach((id) => need(`edge ${name} to`, id));
  }
  const needEdge = (where: string, e: string | undefined) => e !== undefined && !edges.has(e) && errors.push(`profile ${where} names the edge "${e}", which has no entry in edges`);
  p.kinds.forEach((k) => (k.parents ?? []).forEach((g) => g.forEach((f) => needEdge(`kind ${k.id} parents`, f))));
  p.links?.forEach((f) => needEdge('links', f));
  needEdge('supersededBy', p.supersededBy);
  refsOf(p).forEach((r) => needEdge('refs', r.field));
  p.parts?.forEach((x) => needEdge('parts', x.edge));
  p.embedded?.forEach((x) => needEdge('embedded', x.edge));
  needEdge('layout groupEdge', p.layout?.groupEdge);
  if (p.layout?.default === 'grouped' && !p.layout.groupEdge && !p.layout.groupBy) errors.push('profile layout default is "grouped", which needs a groupEdge or a groupBy');
  needEdge('checks', p.checks?.edge);
  const linkFields = new Set([...p.kinds.flatMap(parentFields), ...(p.links ?? [])]);
  p.crossLinks?.forEach((c) => linkFields.has(c.field) && errors.push(`profile crossLinks field "${c.field}" is also a parent or link field. Use a different field.`));
  p.embedded?.forEach((x) => {
    const head = x.field.split('.')[0];
    const owner = p.kinds.find((k) => k.id === x.owner);
    const own = `profile embedded entry for kind "${x.owner}"`;
    if (x.edge === x.field || x.edge === head) errors.push(`${own} uses the edge name "${x.edge}", which is also its field. Use a different edge name.`);
    const others = new Set([...(owner ? parentFields(owner) : []), ...(p.links ?? [])]);
    others.delete(x.edge);
    if (others.has(head)) errors.push(`${own} uses the field "${x.field}", which is also the link or parent field "${head}" of the kind. Use a different field.`);
    if (p.links?.includes(x.edge)) errors.push(`${own} uses the edge name "${x.edge}", which is also a link field. Use a different edge name.`);
  });
  return errors;
}

