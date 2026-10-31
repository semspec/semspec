// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The link between the store and the hash of the page address.
// The page writes the hash when the graph, the scope or the selection changes. It reads the hash when
// the reader or the browser changes it.
import { formatLink, parseLink } from './link';
import { applyLink, linkOf, useAppStore } from './store';

// A hashchange event that follows a hash write of the page can arrive late. It then carries an older hash
// than the state. The page ignores such an event for this time, in milliseconds.
const OWN_WINDOW = 5000;

// True when the hash names what the state already shows.
function same(hash: string): boolean {
  const link = parseLink(hash);
  const now = linkOf();
  return (link.graph === undefined || link.graph === now.graph) && (link.scope === undefined || link.scope === now.scope) && (link.node === undefined || link.node === now.node);
}

// Writes the address on each change of the state and reads it on each change of the hash. The returned
// function stops both.
export function attachAddress(): () => void {
  // The hashes that a fallback write set. The browser fires a hashchange event for each of them.
  const own = new Map<string, number>();

  const write = () => {
    let hash = '';
    try {
      hash = formatLink(linkOf());
      if (window.location.hash === hash) return;
      window.history.replaceState(null, '', window.location.pathname + window.location.search + hash);
    } catch {
      // Some browsers refuse replaceState on a file: address. A hash-only replace adds no history entry either.
      try {
        const now = Date.now();
        for (const [h, until] of own) if (until <= now) own.delete(h);
        own.set(hash, now + OWN_WINDOW);
        window.location.replace(hash || '#');
      } catch {
        // The page may not change its address, for example in a sandbox. The link is optional.
      }
    }
  };

  const read = () => {
    const hash = window.location.hash;
    const until = own.get(hash);
    // An event of the own write brings no news, and a late one brings an older hash.
    if (until !== undefined && until > Date.now()) return;
    own.clear();
    // A hash that names what the state shows changes nothing, so no later read brings back an old value.
    if (same(hash)) return;
    applyLink(parseLink(hash));
  };

  write();
  const unsubscribe = useAppStore.subscribe(write);
  window.addEventListener('hashchange', read);
  return () => {
    window.removeEventListener('hashchange', read);
    unsubscribe();
  };
}
