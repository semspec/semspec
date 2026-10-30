// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// An icon button that copies `text` to the clipboard. `label` names the text for screen readers.
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // The clipboard is blocked. The text stays selectable in the code block.
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} onClick={copy} />}>
          {copied ? <Check /> : <Copy />}
        </TooltipTrigger>
        <TooltipContent>{copied ? 'Copied' : 'Copy'}</TooltipContent>
      </Tooltip>
      <span role="status" className="sr-only">
        {copied ? 'Copied to the clipboard' : ''}
      </span>
    </>
  );
}
