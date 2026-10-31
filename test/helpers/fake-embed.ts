// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// A fake embedding provider for the tests. It is deterministic and has no model. A vector counts the groups of 3 letters of
// the stemmed words in 64 slots. It measures nothing about a real model. It runs the code path of the meaning search.
import { tokenise, type Embedder } from '@semspec/core';

export function fakeVector(text: string, size = 64): number[] {
  const v = new Array<number>(size).fill(0);
  const t = ` ${tokenise(text).join(' ')} `;
  for (let i = 0; i + 3 <= t.length; i++) {
    let h = 0;
    for (const c of t.slice(i, i + 3)) h = (h * 31 + c.charCodeAt(0)) % 1009;
    v[h % size] += 1;
  }
  return v;
}

export const fakeEmbed: Embedder = async (texts) => texts.map((t) => fakeVector(t));
