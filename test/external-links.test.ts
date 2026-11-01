// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the profile key externalLinks: the templates, the missing fields, the safe protocols, the profile check,
// and the links in the RDF export, in the Markdown specs and in the slice and the node detail of the agent tools.
// Every test runs on 2 profiles: the product fixture and the safety fixture.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildModel,
  checkLinks,
  datasetOf,
  exportModel,
  fillSpecs,
  fillTemplate,
  indexGraphs,
  markdownLink,
  nodeDetail,
  nodeLinks,
  safeHttpUrl,
  slice,
  sliceMarkdown,
  toTurtle,
  type Graph,
  type Model,
  type ProfileInput,
} from '@semspec/core';
import { validateProfile } from '../packages/cli/src/validate';

const read = (name: string, file: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}/${file}`, import.meta.url), 'utf8'));
const profileOf = (name: string): ProfileInput => read(name, 'profile.json');
const modelOf = (name: string): Model => buildModel(read(name, 'graph.json') as Graph, profileOf(name));
const withLinks = (name: string, externalLinks: unknown[]) => ({ ...profileOf(name), externalLinks }) as ProfileInput;

// One case for each fixture: a node with a link, a check with links and a check with a missing field.
const CASES = [
  {
    name: 'product',
    node: { id: 'story-pay-by-card', kind: 'story', links: [{ label: 'Tracker', url: 'https://tracker.example.org/items/story-pay-by-card' }] },
    check: { fields: { type: 'unit', file: 'tests/pay.test.ts', name: 'showsDeclineMessage' }, links: [{ label: 'Test report', url: 'https://ci.example.org/report?file=tests%2Fpay.test.ts&test=showsDeclineMessage' }] },
    plan: { fields: { type: 'unit', file: 'a', name: 'b' }, links: [{ label: 'Test report', url: 'https://ci.example.org/report?file=a&test=b' }] },
    hidden: 'Test run',
  },
  {
    name: 'safety',
    node: { id: 'hz-overheat', kind: 'hazard', links: [{ label: 'Hazard log', url: 'https://hazards.example.org/entries/hz-overheat' }] },
    check: { fields: { form: 'analysis', doc: 'FMEA-3', section: '4.2' }, links: [{ label: 'Document', url: 'https://docs.example.org/documents/FMEA-3' }, { label: 'Section', url: 'https://docs.example.org/documents/FMEA-3#section-4.2' }] },
    plan: { fields: { form: 'report', doc: 'FTA-12' }, links: [{ label: 'Document', url: 'https://docs.example.org/documents/FTA-12' }] },
    hidden: 'Section',
  },
];

describe.each(CASES)('externalLinks on the $name fixture', ({ name, node, check, plan, hidden }) => {
  const model = modelOf(name);

  // condition: template
  it('fills a template from the fields of a node and URL-encodes each value', () => {
    const n = model.nodes.find((x) => x.id === node.id)!;
    expect(nodeLinks(model.profile, n)).toEqual(node.links);
    expect(checkLinks(model.profile, check.fields)).toEqual(check.links);
    expect(checkLinks(model.profile, plan.fields)).toEqual(plan.links);
  });

  it('applies a spec only to the kinds and the check types that it names', () => {
    const other = model.nodes.find((x) => x.kind !== node.kind && x.kind !== model.profile.checks!.kind)!;
    expect(nodeLinks(model.profile, other)).toEqual([]);
    // The check node of the model gets the links of its check type, and a node of a kind does not get a check link.
    const checkNode = model.nodes.find((x) => x.kind === model.profile.checks!.kind)!;
    expect(nodeLinks(model.profile, checkNode).length).toBeGreaterThan(0);
    expect(nodeLinks(model.profile, { id: 'x', kind: node.kind, d: {} }).map((l) => l.label)).not.toContain(check.links[0].label);
  });

  // condition: missing
  it('shows no link when a field of the template is missing', () => {
    expect(checkLinks(model.profile, plan.fields).map((l) => l.label)).not.toContain(hidden);
    expect(fillTemplate('https://a.example.org/{x.y}', { x: {} })).toBeNull();
    expect(fillTemplate('https://a.example.org/{x}', { x: '' })).toBeNull();
    expect(fillTemplate('https://a.example.org/{x}', { x: ['a'] })).toBeNull();
  });
});

describe('the missing field', () => {
  it('hides the link of the product check that has no run', () => {
    const labels = checkLinks(modelOf('product').profile, { type: 'unit', file: 'a', name: 'b' }).map((l) => l.label);
    expect(labels).toEqual(['Test report']);
    expect(checkLinks(modelOf('product').profile, { type: 'unit', file: 'a', name: 'b', run: '7' }).map((l) => l.label)).toEqual(['Test report', 'Test run']);
  });

  it('hides the safety link of a report that has no section', () => {
    const p = modelOf('safety').profile;
    expect(checkLinks(p, { form: 'report', doc: 'FTA-12' }).map((l) => l.label)).toEqual(['Document']);
    expect(checkLinks(p, { form: 'analysis', doc: 'D', section: 'S' }).map((l) => l.label)).toEqual(['Document', 'Section']);
  });

  it('shows a link of the key field only when the field has a value', () => {
    const p = buildModel(read('safety', 'graph.json') as Graph, withLinks('safety', [{ label: 'Fixed', template: 'https://a.example.org/fixed', kinds: ['hazard'], field: 'severity' }])).profile;
    expect(nodeLinks(p, { id: 'h', kind: 'hazard', d: { severity: 'high' } })).toEqual([{ label: 'Fixed', url: 'https://a.example.org/fixed' }]);
    expect(nodeLinks(p, { id: 'h', kind: 'hazard', d: {} })).toEqual([]);
  });

  it('encodes a value with encodeURIComponent', () => {
    expect(fillTemplate('https://a.example.org/s/{k}?q={q}', { k: 'a b/c', q: 'x&y=z#' })).toBe('https://a.example.org/s/a%20b%2Fc?q=x%26y%3Dz%23');
    expect(fillTemplate('https://a.example.org/{a.b}', { a: { b: 5 } })).toBe('https://a.example.org/5');
  });
});

// condition: safe
describe('the safe protocols', () => {
  it('accepts http and https only', () => {
    expect(safeHttpUrl('https://a.example.org/x')).toBe('https://a.example.org/x');
    expect(safeHttpUrl('http://a.example.org/')).toBe('http://a.example.org/');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'ftp://a.example.org/', 'vbscript:x', '//a.example.org', '/path', '']) expect(safeHttpUrl(bad)).toBeNull();
  });

  it('refuses a filled URL that is not http or https, even when a field builds it', () => {
    expect(fillTemplate('{u}', { u: 'javascript:alert(1)' })).toBeNull();
    expect(fillTemplate('{u}', { u: 'https://a.example.org/' })).toBeNull();
    expect(fillTemplate('{s}://a.example.org/', { s: 'javascript' })).toBeNull();
    expect(fillTemplate('{s}://a.example.org/', { s: 'data' })).toBeNull();
    expect(fillTemplate('https://a.example.org/{u}', { u: 'javascript:alert(1)' })).toBe('https://a.example.org/javascript%3Aalert(1)');
  });

  it('gives no link for a profile whose template builds another protocol', () => {
    const p = buildModel(read('product', 'graph.json') as Graph, withLinks('product', [{ label: 'Bad', template: '{u}', kinds: ['story'] }])).profile;
    expect(nodeLinks(p, { id: 's', kind: 'story', d: { u: 'javascript:alert(1)' } })).toEqual([]);
  });
});

// The profile check.
describe('the profile check', () => {
  const problems = (name: string, specs: unknown[]) => validateProfile(withLinks(name, specs));

  it.each(['product', 'safety'])('accepts the %s fixture', (name) => expect(validateProfile(profileOf(name))).toEqual([]));

  it('reports a template with no placeholder and no fixed URL', () => {
    expect(problems('product', [{ label: 'A', template: 'story', kinds: ['story'] }])).toEqual([expect.stringContaining('no placeholder and no fixed URL')]);
    expect(problems('safety', [{ label: 'A', template: '', kinds: ['hazard'] }])).toEqual([expect.stringContaining('no placeholder and no fixed URL')]);
  });

  it('accepts a fixed URL with no placeholder', () => {
    expect(problems('product', [{ label: 'A', template: 'https://a.example.org/', kinds: ['story'] }])).toEqual([]);
  });

  it('reports a template that starts with a placeholder', () => {
    expect(problems('product', [{ label: 'A', template: '{u}', kinds: ['story'] }])).toEqual([expect.stringContaining('does not start with http')]);
  });

  it('reports an unknown kind and an unknown check type', () => {
    expect(problems('product', [{ label: 'A', template: 'https://a.example.org/{id}', kinds: ['nope'] }])).toEqual([expect.stringContaining('unknown kind "nope"')]);
    expect(problems('safety', [{ label: 'A', template: 'https://a.example.org/{id}', checkTypes: ['unit'] }])).toEqual([expect.stringContaining('unknown check type "unit"')]);
  });

  it('reports a protocol other than http or https in the fixed part', () => {
    for (const template of ['javascript:alert({id})', 'data:text/html,{id}', 'ftp://a.example.org/{id}', 'file:///{id}']) {
      expect(problems('product', [{ label: 'A', template, kinds: ['story'] }])).toEqual([expect.stringContaining('Only http and https are allowed')]);
    }
  });

  it('rejects a spec with an unknown key or no label through the schema', () => {
    expect(problems('product', [{ template: 'https://a.example.org/', kinds: ['story'] }]).length).toBeGreaterThan(0);
    expect(problems('product', [{ label: 'A', template: 'https://a.example.org/', colour: 'red' }]).length).toBeGreaterThan(0);
  });
});

// condition: export
describe('the RDF export', () => {
  const SEE_ALSO = 'http://www.w3.org/2000/01/rdf-schema#seeAlso';

  it('writes rdfs:seeAlso for each link of a node and a check on 2 fixtures', () => {
    for (const { name, node, check } of CASES) {
      const model = modelOf(name);
      const ds = datasetOf([{ id: 'graph', model }]);
      const urls = ds.graphs.flatMap((g) => g.triples).filter((t) => t.p === SEE_ALSO).map((t) => (t.o.t === 'iri' ? t.o.v : ''));
      for (const l of [...node.links, ...check.links]) expect(urls).toContain(l.url);
      // A missing field gives no triple.
      expect(urls.every((u) => !u.includes('ci.example.org/runs') && !u.includes('section-undefined'))).toBe(true);
      const turtle = exportModel(model, 'turtle');
      expect(turtle).toContain(`rdfs:seeAlso <${node.links[0].url}>`);
      expect(toTurtle(ds)).toBe(turtle);
    }
  });

  it('writes the links in JSON-LD', () => {
    expect(exportModel(modelOf('product'), 'jsonld')).toContain('https://tracker.example.org/items/story-pay-by-card');
  });

  it('writes no seeAlso for a profile without externalLinks', () => {
    const { externalLinks: _x, ...rest } = profileOf('product');
    const model = buildModel(read('product', 'graph.json') as Graph, rest as ProfileInput);
    expect(exportModel(model, 'turtle')).not.toContain('seeAlso');
  });
});

describe('the Markdown specs', () => {
  const run = (name: string, options: string) => {
    const graphs = indexGraphs([{ id: 'graph', label: name, model: modelOf(name) }]);
    const text = `# Doc\n\n<!-- semspec:section ${options} -->\n<!-- semspec:end -->\n`;
    const r = fillSpecs(graphs, [{ path: '/work/doc.md', text }]);
    expect(r.findings.filter((f) => f.code === 'error')).toEqual([]);
    return r.files[0].text;
  };

  it('puts a link after the node title in the tree and after the check title in the tests', () => {
    const md = run('product', 'shape=tree kinds=story show=statement,tests,conditions conditions=table');
    expect(md).toMatch(/## <a id="[^"]*"><\/a>[^\n]*\[Tracker\]\(https:\/\/tracker\.example\.org\/items\/story-pay-by-card\)/);
    expect(md).toContain('Shows decline message [Test report](https://ci.example.org/report?file=tests%2Fpay.test.ts&test=showsDeclineMessage)');
    expect(md).toContain('[Test plan](https://plans.example.org/plan-7)');
  });

  it('puts the links in the cells of the traceability', () => {
    const md = run('product', 'shape=traceability kinds=story');
    expect(md).toContain('[Test report](https://ci.example.org/report?file=tests%2Fpay.test.ts&test=showsDeclineMessage)');
    expect(md).not.toContain('Test run');
  });

  it('puts the links of the safety fixture in the tree and the traceability', () => {
    const tree = run('safety', 'shape=tree kinds=hazard,mitigation show=statement,tests');
    expect(tree).toContain('[Hazard log](https://hazards.example.org/entries/hz-overheat)');
    expect(tree).toContain('[Document](https://docs.example.org/documents/FMEA-3) [Section](https://docs.example.org/documents/FMEA-3#section-4.2)');
    const trace = run('safety', 'shape=traceability kinds=subgoal');
    expect(trace).toContain('[Document](https://docs.example.org/documents/FTA-12)');
    expect(trace).not.toContain('FTA-12#section');
  });

  it('escapes a label and a parenthesis of a URL', () => {
    expect(markdownLink({ label: 'a [b] *c*', url: 'https://a.example.org/x(1)' })).toBe('[a \\[b\\] \\*c\\*](https://a.example.org/x%281%29)');
  });
});

// condition: mcp (the core part; the tools return these answers)
describe('the agent answers', () => {
  it('puts links in the slice and the node detail of 2 fixtures', () => {
    for (const [name, id, nodeLabel, checkLabel, partId] of [
      ['product', 'story-pay-by-card', 'Tracker', 'Test report', 'story-pay-by-card#declined'],
      ['safety', 'mit-thermal-fuse', undefined, 'Document', 'mit-thermal-fuse'],
    ] as const) {
      const graphs = indexGraphs([{ id: 'graph', label: name, model: modelOf(name) }]);
      const s = slice(graphs, { id });
      const checks = [...s.checks, ...s.parts.flatMap((p) => p.checks)];
      expect(s.links?.map((l) => l.label)).toEqual(nodeLabel ? [nodeLabel] : undefined);
      expect(checks.flatMap((c) => c.links ?? []).map((l) => l.label)).toContain(checkLabel);
      expect(sliceMarkdown(s)).toContain(checkLabel);
      const detail = nodeDetail(graphs, undefined, partId) as { links?: unknown; edges: { out: Record<string, { links?: { label: string }[] }[]> } };
      expect((nodeDetail(graphs, undefined, id) as { links?: { label: string }[] }).links?.[0]?.label).toBe(nodeLabel);
      const outChecks = Object.values(detail.edges.out).flat().flatMap((x) => x.links ?? []);
      expect(outChecks.map((l) => l.label)).toContain(checkLabel);
    }
  });
});
