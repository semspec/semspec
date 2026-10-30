// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The theme store of the site. It uses the same localStorage key as the explorer, so a choice in
// the site or in a demo page of the same origin applies to both.
import { useCallback, useSyncExternalStore } from 'react';
import { THEME_KEY, choiceFromStorageEvent, parseChoice, resolveTheme, type ThemeChoice } from '../../../src/app/lib/theme';

const listeners = new Set<() => void>();
let choice: ThemeChoice = 'system';
let started = false;

function readStored(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function apply() {
  const dark = resolveTheme(choice, window.matchMedia('(prefers-color-scheme: dark)').matches) === 'dark';
  document.documentElement.classList.toggle('dark', dark);
}

function notify() {
  apply();
  listeners.forEach((l) => l());
}

// Starts on the first use in a browser. The server render never calls it.
function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  choice = parseChoice(readStored());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', notify);
  // Another tab, or a demo page in an iframe, changed the stored choice. The store does not write it back.
  window.addEventListener('storage', (e) => {
    const next = choiceFromStorageEvent(e.key, e.newValue);
    if (next === undefined) return;
    choice = next;
    notify();
  });
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

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ThemeChoice {
  start();
  return choice;
}

// The server render and the first client render use "system", so hydration finds the same markup.
export function useTheme(): { choice: ThemeChoice; setChoice: (c: ThemeChoice) => void } {
  const current = useSyncExternalStore(subscribe, getSnapshot, () => 'system' as ThemeChoice);
  return { choice: current, setChoice: useCallback(setThemeChoice, []) };
}
