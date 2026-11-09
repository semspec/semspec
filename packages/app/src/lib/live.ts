// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The live channel of a page that serve gave. serve sends the event `reload` when a file changes, and the
// event `invalid` with the error when the new files are not valid. A page that build wrote, or that
// a person opened from a file, has no live marker. It opens no channel and makes no network request.
import { useSyncExternalStore } from 'react';

// The path of the event channel of serve.
export const EVENTS_PATH = '/events';

// serve writes this element into the head of the page.
export const isLivePage = (doc: Document = document): boolean => doc.querySelector('meta[name="semspec-live"]') !== null;

let error: string | null = null;
const listeners = new Set<() => void>();

function setError(next: string | null): void {
  error = next;
  listeners.forEach((l) => l());
}

// The error of the last change of the files, or null.
export function useLiveError(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => error,
  );
}

// A reload reads the page again. The scope, the selection, the view, the layout and the filters come back
// from the browser storage and from the hash of the address. The function does nothing for a page that is not live.
export function startLive(options: { doc?: Document; reload?: () => void; open?: (url: string) => EventSource } = {}): EventSource | undefined {
  const { doc = document, reload = () => window.location.reload(), open = (url: string) => new EventSource(url) } = options;
  if (!isLivePage(doc)) return undefined;
  const source = open(EVENTS_PATH);
  source.addEventListener('reload', () => {
    setError(null);
    reload();
  });
  source.addEventListener('invalid', (e) => {
    try {
      setError(String((JSON.parse((e as MessageEvent).data) as { message: unknown }).message));
    } catch {
      setError('The files are not valid.');
    }
  });
  return source;
}

// For tests: forgets the error.
export const resetLiveError = (): void => setError(null);
