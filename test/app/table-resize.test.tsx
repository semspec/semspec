// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// DOM tests of the column resize in the Table. jsdom has no layout, so the tests read the widths in the styles.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, createEvent, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { pickInTree, renderApp } from './harness';

const OLD_KEY = 'semspec.table-widths.';
const KEY = 'semspec:';

async function openTable(name = 'product') {
  renderApp(name);
  await pickInTree(name === 'product' ? 'epic-checkout' : (null as never));
  await userEvent.setup().click(screen.getByRole('tab', { name: 'Table' }));
}

const view = () => within(screen.getByTestId('table-view'));
const col = (id: string) => document.querySelector(`[data-testid="table-view"] col[data-col="${id}"]`) as HTMLElement;
const handle = (title: string) => view().getByRole('separator', { name: `Resize the ${title} column` });
// This runtime may have no working localStorage, so the tests install a small one.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() },
  });
});
const keyOf = () => [...store.keys()].find((x) => x.startsWith(KEY));

describe('the column resize of the Table', () => {
  it('gives Title its default width and a handle', async () => {
    await openTable();
    expect(col('title').style.width).toBe('320px');
    expect(col('id').style.width).toBe('160px');
    expect(handle('Title').getAttribute('tabindex')).toBe('0');
    const table = view().getByRole('table');
    const sum = [...table.querySelectorAll('col')].reduce((t, c) => t + parseInt((c as HTMLElement).style.width, 10), 0);
    expect(table.style.width).toBe(`${sum}px`);
    expect(table.className).toMatch(/\btable-fixed\b/);
  });

  it('resizes with the arrow keys and holds the minimum', async () => {
    await openTable();
    const h = handle('Title');
    fireEvent.keyDown(h, { key: 'ArrowRight' });
    expect(col('title').style.width).toBe('336px');
    for (let i = 0; i < 30; i++) fireEvent.keyDown(handle('Title'), { key: 'ArrowLeft' });
    expect(col('title').style.width).toBe('160px');
  });

  it('resets a column with a double click', async () => {
    await openTable();
    fireEvent.keyDown(handle('Title'), { key: 'ArrowRight' });
    expect(col('title').style.width).toBe('336px');
    fireEvent.doubleClick(handle('Title'));
    expect(col('title').style.width).toBe('320px');
  });

  it('saves the widths in the store and loads them again', async () => {
    await openTable();
    fireEvent.keyDown(handle('Title'), { key: 'ArrowRight' });
    // The unmount writes the state at once.
    cleanup();
    const key = keyOf()!;
    expect(JSON.parse(window.localStorage.getItem(key)!).graphs.product.widths).toEqual({ title: 336 });
    expect([...store.keys()].some((k) => k.startsWith(OLD_KEY))).toBe(false);
    const saved = JSON.parse(window.localStorage.getItem(key)!);
    saved.graphs.product.widths = { title: 400, id: 10, nothing: 300 };
    window.localStorage.setItem(key, JSON.stringify(saved));
    await openTable();
    expect(col('title').style.width).toBe('400px');
    // A width below the minimum and a width of an unknown column are ignored.
    expect(col('id').style.width).toBe('160px');
  });

  it('reads the widths of the old key once and removes the old key', async () => {
    window.localStorage.setItem(`${OLD_KEY}Shop product`, JSON.stringify({ title: 420 }));
    await openTable();
    expect(col('title').style.width).toBe('420px');
    expect([...store.keys()].some((k) => k.startsWith(OLD_KEY))).toBe(false);
    cleanup();
    expect(JSON.parse(window.localStorage.getItem(keyOf()!)!).graphs.product.widths).toEqual({ title: 420 });
  });
});

describe('the text selection during a handle drag', () => {
  it('stops the text selection during a handle drag and restores it after', async () => {
    await openTable();
    const removed = vi.spyOn(window.getSelection()!, 'removeAllRanges');
    const ev = createEvent.mouseDown(handle('Title'), { clientX: 100, cancelable: true });
    fireEvent(handle('Title'), ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(removed).toHaveBeenCalled();
    expect(document.body.style.userSelect).toBe('none');
    expect(document.body.style.getPropertyValue('-webkit-user-select')).toBe('none');
    expect(document.body.style.cursor).toBe('col-resize');
    fireEvent.mouseUp(window);
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.getPropertyValue('-webkit-user-select')).toBe('');
    expect(document.body.style.cursor).toBe('');
    // The header and the handle also carry select-none.
    expect(handle('Title').className).toMatch(/\bselect-none\b/);
    expect(handle('Title').closest('th')!.className).toMatch(/\bselect-none\b/);
    // The pointer leaving the window also ends the lock.
    fireEvent.mouseDown(handle('Title'), { clientX: 100 });
    expect(document.body.style.userSelect).toBe('none');
    fireEvent.mouseLeave(document);
    expect(document.body.style.userSelect).toBe('');
  });

  it('restores the body styles when the touch ends', async () => {
    await openTable();
    fireEvent.touchStart(handle('Title'), { touches: [{ clientX: 100 }] });
    expect(document.body.style.userSelect).toBe('none');
    fireEvent.touchCancel(window);
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');
  });
});
