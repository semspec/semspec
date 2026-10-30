// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the theme choice that another document of the same origin writes to localStorage.
import { describe, expect, it } from 'vitest';
import { THEME_KEY, choiceFromStorageEvent } from '../packages/app/src/lib/theme';

describe('the theme storage event', () => {
  it('takes a light or dark value that another document writes', () => {
    expect(choiceFromStorageEvent(THEME_KEY, 'light')).toBe('light');
    expect(choiceFromStorageEvent(THEME_KEY, 'dark')).toBe('dark');
    expect(choiceFromStorageEvent(THEME_KEY, 'system')).toBe('system');
  });
  it('sets the choice to system for a removed or unknown value', () => {
    expect(choiceFromStorageEvent(THEME_KEY, null)).toBe('system');
    expect(choiceFromStorageEvent(THEME_KEY, 'other')).toBe('system');
  });
  it('sets the choice to system when another document clears the storage', () => {
    expect(choiceFromStorageEvent(null, null)).toBe('system');
  });
  it('ignores an event for another key', () => {
    expect(choiceFromStorageEvent('other-key', 'dark')).toBeUndefined();
    expect(choiceFromStorageEvent('', 'dark')).toBeUndefined();
  });
});
