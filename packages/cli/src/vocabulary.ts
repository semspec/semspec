// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Reads the vocabularies that a profile keeps in files. A file holds 1 vocabulary, in JSON or YAML.
// The path is relative to the profile. The file is checked against the vocabulary definition of the
// profile schema.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { readInput } from './input';

const schemaPath = new URL('../../../schema/profile.schema.json', import.meta.url);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// Returns a copy of the profile where each vocabulary that names a file holds the content of the
// file. A problem of a file is in `errors`. A vocabulary with a problem stays as it was.
export function resolveVocabularyFiles(profile: unknown, profilePath: string): { profile: unknown; errors: string[] } {
  if (!isObject(profile) || !isObject(profile.vocabularies)) return { profile, errors: [] };
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const check = new Ajv({ allErrors: true, strict: false }).compile({ $defs: schema.$defs, $ref: '#/$defs/vocabulary' });
  const base = dirname(resolve(profilePath));
  const errors: string[] = [];
  const vocabularies: Record<string, unknown> = {};
  for (const [id, entry] of Object.entries(profile.vocabularies)) {
    if (!isObject(entry) || typeof entry.file !== 'string') {
      vocabularies[id] = entry;
      continue;
    }
    const path = resolve(base, entry.file);
    vocabularies[id] = entry;
    try {
      const content = readInput(path, 'vocabulary file');
      if (check(content)) vocabularies[id] = content;
      else (check.errors ?? []).forEach((e) => errors.push(`vocabulary "${id}", file "${path}": ${e.instancePath || '/'} ${e.message}`));
    } catch (e) {
      errors.push(`vocabulary "${id}": ${(e as Error).message}`);
    }
  }
  return { profile: { ...profile, vocabularies }, errors };
}
