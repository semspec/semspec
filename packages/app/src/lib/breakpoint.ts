// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The width below which the app uses the phone layout. It equals the Tailwind `md:` breakpoint.
export const PHONE_BREAKPOINT = 768;

// The media query that matches the phone layout.
export const PHONE_QUERY = `(max-width: ${PHONE_BREAKPOINT - 1}px)`;

// True when a viewport of this width in px uses the phone layout.
export function isPhoneWidth(width: number): boolean {
  return width < PHONE_BREAKPOINT;
}
