// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The theme choice: pure functions with no framework dependency.
export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

// The localStorage key. The inline script in the page head uses the same key.
export const THEME_KEY = 'semspec-theme';

// Returns the choice for a stored value. An unknown or missing value means "system".
export function parseChoice(stored: unknown): ThemeChoice {
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

// Returns the theme to show, from the stored value and the system colour scheme.
export function resolveTheme(stored: unknown, systemDark: boolean): ResolvedTheme {
  const choice = parseChoice(stored);
  return choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;
}
