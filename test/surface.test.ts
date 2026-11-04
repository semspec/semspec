// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of scripts/surface-inventory.mjs: the parsers on this repository and the finding logic on a small invented mapping.
import { describe, expect, it } from 'vitest';
// @ts-expect-error The scripts are plain ES modules without types.
import { findingsOf, surfaceFindings, surfaceInventory, surfaceScan } from '../scripts/surface-inventory.mjs';

const root = process.cwd();
const items = surfaceInventory(root);
const has = (kind: string, name: string) => items.some((i: { kind: string; name: string }) => i.kind === kind && i.name === name);

describe('surface inventory', () => {
  it('lists the commands, the flags, the tools, the resources, the keys, the pages and the controls of this repository', () => {
    expect(has('cli-command', 'coverage')).toBe(true);
    expect(has('cli-flag', '--gate')).toBe(true);
    expect(has('mcp-tool', 'slice')).toBe(true);
    expect(has('mcp-resource', 'semspec://<graph>/profile')).toBe(true);
    expect(has('profile-key', 'layout')).toBe(true);
    expect(has('workspace-key', 'graphs')).toBe(true);
    expect(has('site-page', 'roadmap')).toBe(true);
    expect(has('app-control', 'Reset the view')).toBe(true);
    expect(has('app-control', 'Remove the scope')).toBe(true);
  });

  it('skips a control with a name that the code builds at run time and lists it as skipped', () => {
    const { items: all, skipped } = surfaceScan(root);
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.every((s: { reason: string }) => s.reason.startsWith('dynamic'))).toBe(true);
    expect(all.some((i: { name: string }) => i.name.includes('${') || i.name.includes('{'))).toBe(false);
  });
});

describe('surface coverage', () => {
  it('names the requirement of an item from the mapping file, and gives null for an item with no entry', () => {
    const find = (kind: string, name: string) => items.find((i: { kind: string; name: string }) => i.kind === kind && i.name === name);
    expect(find('cli-command', 'coverage')?.requirement).toBe('req-coverage-query');
    expect(find('mcp-tool', 'slice')?.requirement).toBe('req-context-slice');
    expect(items.some((i: { requirement: string | null }) => i.requirement === null)).toBe(true);
  });

  it('maps only to requirements that exist in the graph of this repository', () => {
    const unknown = surfaceFindings(root).findings.filter((f: { message: string }) => /unknown requirement|not in the inventory|not a requirement/.test(f.message));
    expect(unknown).toEqual([]);
  });
});

describe('surface finding', () => {
  const invented = [
    { kind: 'cli-command', name: 'alpha', source: 'a' },
    { kind: 'cli-command', name: 'beta', source: 'a' },
    { kind: 'mcp-tool', name: 'gamma', source: 'b' },
    { kind: 'profile-key', name: 'delta', source: 'c' },
  ];
  const nodes = new Map([['req-one', 'requirement'], ['cap-two', 'capability']]);

  it('reports an item with no requirement, an unknown requirement id and a mapping entry with no item', () => {
    const mapping = {
      'cli-command': { alpha: 'req-one', beta: 'req-missing', ghost: 'req-one' },
      'profile-key': { delta: 'cap-two' },
    };
    const result = findingsOf(invented, mapping, nodes);
    const by = (item: string) => result.filter((f: { item: string }) => f.item === item);
    expect(by('cli-command alpha')).toEqual([]);
    expect(by('cli-command beta')[0].message).toContain('unknown requirement "req-missing"');
    expect(by('mcp-tool gamma')[0].message).toContain('has no requirement');
    expect(by('profile-key delta')[0].message).toContain('not a requirement');
    expect(by('cli-command ghost')[0].message).toContain('not in the inventory');
    expect(result).toHaveLength(4);
  });

  it('reports no finding when each item has a known requirement', () => {
    const mapping = { 'cli-command': { alpha: 'req-one', beta: 'req-one' }, 'mcp-tool': { gamma: 'req-one' }, 'profile-key': { delta: 'req-one' } };
    expect(findingsOf(invented, mapping, nodes)).toEqual([]);
  });

  it('returns the check name surface and a list of findings with an item and a message', () => {
    const result = surfaceFindings(root);
    expect(result.check).toBe('surface');
    expect(result.findings.length).toBeGreaterThan(0);
    for (const f of result.findings) expect(Object.keys(f).sort()).toEqual(['item', 'message']);
  });
});
