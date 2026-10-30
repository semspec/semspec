// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the package layout: the dependency direction, the framework-free core and the shape of the root package.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('..', import.meta.url));
const packagesDir = join(repo, 'packages');
const packageNames = readdirSync(packagesDir).filter((n) => existsSync(join(packagesDir, n, 'package.json')));
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const manifest = (name: string) => readJson(join(packagesDir, name, 'package.json'));

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

// Every module specifier that a source file imports or re-exports.
function specifiersOf(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /^[ \t]*(?:import|export)\b[^'"`;]*?\bfrom\s*(['"])([^'"\n]+)\1/gm,
    /^[ \t]*import\s*(['"])([^'"\n]+)\1/gm,
    /\bimport\s*\(\s*(['"])([^'"\n]+)\1/g,
  ];
  for (const re of patterns) for (let m = re.exec(source); m; m = re.exec(source)) found.push(m[2]);
  return found;
}

const sourcesOf = (name: string) => walk(join(packagesDir, name, 'src')).filter((f) => /\.tsx?$/.test(f));
const packageOf = (spec: string) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

// The packages that a package may import. The package core imports none.
const allowed: Record<string, string[]> = {
  core: [],
  app: ['core'],
  mcp: ['core'],
  cli: ['core', 'app', 'mcp'],
};

// The packages that the sources of a package import, as folder names.
function importedPackages(name: string): string[] {
  const out = new Set<string>();
  for (const file of sourcesOf(name)) {
    for (const spec of specifiersOf(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('@semspec/')) out.add(packageOf(spec).slice('@semspec/'.length));
      if (spec.startsWith('.')) {
        const target = join(file, '..', spec);
        const rel = target.slice(packagesDir.length + 1).split('/')[0];
        if (rel && rel !== name && !target.startsWith(join(packagesDir, name))) out.add(rel);
      }
    }
  }
  return [...out].sort();
}

const temp: string[] = [];
afterAll(() => {
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});

describe('the package layout', () => {
  it('has the packages core, app, mcp and cli, each with its own package.json', () => {
    expect(packageNames.sort()).toEqual(['app', 'cli', 'core', 'mcp']);
    for (const name of packageNames) expect(manifest(name).name).toBe(`@semspec/${name}`);
  });

  it('lets no package import from a package that it must not depend on', () => {
    for (const name of packageNames) {
      const imported = importedPackages(name);
      expect(imported.filter((p) => !allowed[name].includes(p)), `${name} imports ${imported.join(', ')}`).toEqual([]);
    }
  });

  it('lists the packages that a package imports in its package.json', () => {
    for (const name of packageNames) {
      const m = manifest(name);
      const declared = { ...m.dependencies, ...m.devDependencies };
      for (const p of importedPackages(name)) expect(declared[`@semspec/${p}`], `${name} declares ${p}`).toBeDefined();
    }
    const coreDeps = Object.keys({ ...manifest('core').dependencies, ...manifest('core').peerDependencies });
    expect(coreDeps).toEqual([]);
  });

  it('detects an import of a package that is not allowed', () => {
    expect(specifiersOf(`import { a } from '@semspec/cli';\nconst b = await import("../x");\nexport * from './y';`)).toEqual(['@semspec/cli', './y', '../x']);
  });
});

describe('the package core', () => {
  it('imports only its own files', () => {
    for (const file of sourcesOf('core')) {
      for (const spec of specifiersOf(readFileSync(file, 'utf8'))) {
        expect(spec.startsWith('./'), `${file} imports ${spec}`).toBe(true);
      }
    }
  });

  it('has no dependency on a framework, a browser API or a Node module', () => {
    const m = manifest('core');
    expect(m.dependencies ?? {}).toEqual({});
    const tsconfig = readJson(join(packagesDir, 'core', 'tsconfig.json'));
    expect(tsconfig.compilerOptions.types).toEqual([]);
    expect(tsconfig.compilerOptions.lib).toEqual(['ES2022']);
  });

  it('has the fields that a publish needs', () => {
    const m = manifest('core');
    expect(m.private).not.toBe(true);
    expect(m.name).toBe('@semspec/core');
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.license).toBe('Apache-2.0');
    expect(m.type).toBe('module');
    expect(m.exports['.']).toEqual({ types: './dist/index.d.ts', import: './dist/index.js' });
    expect(m.files).toContain('dist');
    for (const v of Object.values<string>({ ...m.dependencies, ...m.devDependencies })) expect(v).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('compiles and runs alone, without the other packages', async () => {
    const out = mkdtempSync(join(tmpdir(), 'semspec-core-'));
    temp.push(out);
    const tsc = join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
    execFileSync(process.execPath, [tsc, '-p', join(packagesDir, 'core', 'tsconfig.json'), '--outDir', out], { stdio: 'pipe' });
    expect(existsSync(join(out, 'index.d.ts'))).toBe(true);
    const built = await import(pathToFileURL(join(out, 'index.js')).href);
    expect(typeof built.buildModel).toBe('function');
    expect(typeof built.exportModel).toBe('function');
  }, 120000);
});

describe('the root package', () => {
  const root = readJson(join(repo, 'package.json'));

  it('is the package semspec with 1 bin that runs the built cli', () => {
    expect(root.name).toBe('semspec');
    expect(root.bin).toEqual({ semspec: 'bin/semspec.js' });
    expect(readFileSync(join(repo, 'bin', 'semspec.js'), 'utf8')).toContain('../packages/cli/dist/index.js');
  });

  it('lists the built cli, the built app, the schemas and the licence files for the pack', () => {
    for (const f of ['bin', 'packages/cli/dist', 'packages/app/dist', 'schema', 'LICENSE', 'NOTICE', 'AUTHORS', 'README.md']) expect(root.files).toContain(f);
    expect(root.workspaces).toEqual(['packages/*']);
  });

  it('installs the run time dependencies of the cli', () => {
    const cli = manifest('cli').dependencies;
    for (const dep of ['ajv', 'yaml', '@modelcontextprotocol/sdk']) expect(root.dependencies[dep]).toBe(cli[dep]);
  });

  it('installs the run time dependencies of the mcp package', () => {
    const mcp = manifest('mcp').dependencies;
    for (const dep of ['ajv', 'yaml', '@modelcontextprotocol/sdk']) expect(root.dependencies[dep]).toBe(mcp[dep]);
  });

  it('keeps the script names', () => {
    for (const s of ['build', 'build:app', 'build:cli', 'typecheck', 'test', 'requirements', 'requirements:build', 'prepare']) expect(root.scripts[s]).toBeDefined();
  });
});
