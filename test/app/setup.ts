// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Setup of the DOM tests. jsdom lacks what React Flow and the app need, so this file adds small stubs.
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no layout. Each element gets a fixed size, and the observer reports it once, so React Flow measures its nodes.
const SIZE = { width: 800, height: 600 };
for (const [prop, value] of [['offsetWidth', SIZE.width], ['offsetHeight', SIZE.height], ['clientWidth', SIZE.width], ['clientHeight', SIZE.height]] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
}

class ResizeObserverStub {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    const entry = { target, contentRect: { width: SIZE.width, height: SIZE.height }, borderBoxSize: [{ inlineSize: SIZE.width, blockSize: SIZE.height }], contentBoxSize: [{ inlineSize: SIZE.width, blockSize: SIZE.height }] } as unknown as ResizeObserverEntry;
    queueMicrotask(() => this.callback([entry], this as unknown as ResizeObserver));
  }
  unobserve() {}
  disconnect() {}
}

class DOMMatrixStub {
  m22 = 1;
  constructor(_init?: string) {}
}

globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
globalThis.DOMMatrixReadOnly ??= DOMMatrixStub as unknown as typeof DOMMatrixReadOnly;
globalThis.DOMMatrix ??= DOMMatrixStub as unknown as typeof DOMMatrix;
// Base UI and React Flow call these on elements.
(SVGElement.prototype as unknown as { getBBox: () => object }).getBBox ??= () => ({ x: 0, y: 0, width: 40, height: 12 });
Element.prototype.getAnimations ??= () => [];
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

// The media queries that a test sets. A query matches when its string is in the set, or when it is the phone query and the flag is on.
let phone = false;
const listeners = new Set<() => void>();

export function setPhone(on: boolean) {
  phone = on;
  listeners.forEach((l) => l());
}

window.matchMedia = ((query: string) => {
  const matches = () => (query.includes('max-width: 767px') ? phone : false);
  const mq = {
    media: query,
    onchange: null,
    get matches() {
      return matches();
    },
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    addListener: (l: () => void) => listeners.add(l),
    removeListener: (l: () => void) => listeners.delete(l),
    dispatchEvent: () => false,
  };
  return mq as unknown as MediaQueryList;
}) as typeof window.matchMedia;

afterEach(() => {
  cleanup();
  setPhone(false);
  try {
    window.localStorage.clear();
  } catch {
    // Storage is not available in this runtime.
  }
});
