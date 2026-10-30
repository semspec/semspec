// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { CopyButton } from '@/components/copy-button';
import { cn } from '@/lib/utils';

// A code block with a top bar. The bar holds the file name and a copy button.
// `html` is the code that Shiki highlighted at build time. `code` is the plain text to copy.
export function CodeBlock({ file, code, html, className }: { file: string; code: string; html: string; className?: string }) {
  return (
    <figure className={cn('min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground', className)}>
      <figcaption className="flex items-center justify-between gap-2 border-b bg-muted/50 py-1 pr-1.5 pl-4">
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{file}</span>
        <CopyButton text={code} label={`Copy ${file}`} />
      </figcaption>
      <div className="code" dangerouslySetInnerHTML={{ __html: html }} />
    </figure>
  );
}

// The install command: 1 line with a copy button. A command that is too long scrolls inside the block.
// The `$` stays at the left. The scroll area takes the keyboard focus, so a keyboard user can scroll it.
export function CommandLine({ code, label }: { code: string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-card py-1.5 pr-1.5 pl-4 text-card-foreground shadow-xs">
      <span aria-hidden="true" className="shrink-0 font-mono text-sm text-muted-foreground select-none">
        $
      </span>
      <code tabIndex={0} className="min-w-0 flex-1 overflow-x-auto rounded-sm py-1 text-sm whitespace-nowrap [scrollbar-width:thin] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
        {code}
      </code>
      <CopyButton text={code} label={label} />
    </div>
  );
}
