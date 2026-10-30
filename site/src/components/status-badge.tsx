// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { Badge } from '@/components/ui/badge';
import type { StatusData } from '@/lib/roadmap';

// A status badge. The tone comes from the profile: good, warn or bad.
export function StatusBadge({ status }: { status: StatusData | null }) {
  if (!status) return <Badge variant="outline">No status</Badge>;
  if (status.tone === 'good') return <Badge variant="secondary" className="bg-good/15 text-good">{status.label}</Badge>;
  if (status.tone === 'warn') return <Badge variant="secondary" className="bg-warn/15 text-warn">{status.label}</Badge>;
  return <Badge variant="destructive">{status.label}</Badge>;
}
