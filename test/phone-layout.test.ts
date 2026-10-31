// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Tests of the phone breakpoint. The layout itself is checked in a browser.
import { describe, expect, it } from 'vitest';
import { PHONE_BREAKPOINT, PHONE_QUERY, isPhoneWidth } from '../packages/app/src/lib/breakpoint';

describe('the phone breakpoint', () => {
  it('equals the Tailwind md breakpoint of 768 px', () => {
    expect(PHONE_BREAKPOINT).toBe(768);
  });

  it('uses the phone layout below 768 px only', () => {
    expect(isPhoneWidth(375)).toBe(true);
    expect(isPhoneWidth(390)).toBe(true);
    expect(isPhoneWidth(767)).toBe(true);
    expect(isPhoneWidth(768)).toBe(false);
    expect(isPhoneWidth(1280)).toBe(false);
  });

  it('gives a media query that ends at 767 px', () => {
    expect(PHONE_QUERY).toBe('(max-width: 767px)');
  });
});
