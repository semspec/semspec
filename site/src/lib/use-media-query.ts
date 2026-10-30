// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
import { useSyncExternalStore } from 'react';

// Returns whether a media query matches. The server render and the first client render return false,
// so hydration finds the same markup. The value changes after the mount.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
