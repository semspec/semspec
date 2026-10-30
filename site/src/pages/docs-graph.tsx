// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import docs from 'virtual:docs';
import { DocsShell } from '@/components/docs-shell';
import { ExplorerFrame } from '@/components/explorer-frame';
import { graphPath } from '@/lib/docs';

// The docs graph: the docs and the requirements of Semspec in the explorer.
export function DocsGraph() {
  return (
    <DocsShell path={graphPath(docs)}>
      <h1 className="text-4xl font-semibold tracking-tighter sm:text-5xl">Docs graph</h1>
      <p className="mt-4 max-w-3xl text-lg text-pretty text-muted-foreground">
        The docs are a Semspec graph. Each page is a node. A page links to related pages and to the requirements that it documents. The explorer below shows the docs and the requirements of Semspec in 1 workspace.
      </p>
      <div className="mt-8">
        <ExplorerFrame title="Semspec explorer: docs and requirements" href="/demo/docs.html" />
      </div>
    </DocsShell>
  );
}
