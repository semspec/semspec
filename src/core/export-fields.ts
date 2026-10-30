// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The fields of a node that an export does not write as data. A link field, a refs field and the
// superseded field are edges. The check field holds checks, which are nodes.
import { allLinkFields } from './profile';
import type { Profile } from './types';

export function structuralFields(p: Profile): Set<string> {
  const out = new Set<string>(allLinkFields(p));
  (p.refs ?? []).forEach((r) => out.add(r.field));
  if (p.supersededBy) out.add(p.supersededBy);
  if (p.checks) out.add(p.checks.field);
  return out;
}
