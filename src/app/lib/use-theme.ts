// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The theme store. It keeps the choice in localStorage and sets the dark class on the root element.
import { useCallback, useSyncExternalStore } from 'react';
import { THEME_KEY, parseChoice, resolveTheme, type ResolvedTheme, type ThemeChoice } from './theme';

const query = () => window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

let choice: ThemeChoice = parseChoice(readStored());

function apply() {
  document.documentElement.classList.toggle('dark', resolveTheme(choice, query().matches) === 'dark');
}

function notify() {
  apply();
  listeners.forEach((l) => l());
}

export function setThemeChoice(next: ThemeChoice) {
  choice = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Storage is blocked. The choice lasts until the page closes.
  }
  notify();
}

let watching = false;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!watching) {
    watching = true;
    query().addEventListener('change', notify);
  }
  apply();
  return () => {
    listeners.delete(listener);
  };
}

const getResolved = (): ResolvedTheme => resolveTheme(choice, query().matches);

export function useTheme(): { choice: ThemeChoice; resolved: ResolvedTheme; setChoice: (c: ThemeChoice) => void } {
  const current = useSyncExternalStore(subscribe, () => choice);
  const resolved = useSyncExternalStore(subscribe, getResolved);
  return { choice: current, resolved, setChoice: useCallback(setThemeChoice, []) };
}
