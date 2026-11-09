// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The live mode of serve: a watcher of the input files and a channel of Server-Sent Events to the open pages.
import { existsSync, statSync, watch, type FSWatcher } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { basename, dirname } from 'node:path';

// A burst of changes within this time gives 1 call of `onChange`.
export const DEBOUNCE_MS = 100;

interface Target {
  dir: string;
  // A folder is watched with all folders below it. A file is watched through its folder.
  recursive: boolean;
  // The name of the file in the folder. Other names in the folder are ignored.
  only?: string;
}

// The nearest folder that exists, from a path up.
function nearestFolder(path: string): string {
  let dir = path;
  while (!existsSync(dir) || !statSync(dir).isDirectory()) {
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return dir;
}

// What to watch for 1 path. A path that does not exist yet is watched through its nearest folder.
function targetOf(path: string): Target {
  if (!existsSync(path)) return { dir: nearestFolder(path), recursive: false };
  if (statSync(path).isDirectory()) return { dir: path, recursive: true };
  return { dir: dirname(path), recursive: false, only: basename(path) };
}

// The identity of a target. A folder that is deleted and made again has a new inode, so the key changes.
const keyOf = (t: Target) => {
  let ino = 0;
  try {
    ino = statSync(t.dir).ino;
  } catch {
    // The folder is gone. The next call of `paths` finds a new target.
  }
  return `${t.dir}\0${t.recursive}\0${t.only ?? ''}\0${ino}`;
};

// Watches the paths that `paths` returns, and calls `onChange` once after a burst of changes.
// After a change, the function reads the list again, so a folder that a restage replaced is watched again.
// `rewatch` reads the list on demand.
export function watchFiles(paths: () => string[], onChange: () => void, delay = DEBOUNCE_MS): { rewatch: () => void; close: () => void } {
  let watchers: FSWatcher[] = [];
  let signature = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const trigger = (only: string | undefined) => (_event: string, name: string | Buffer | null) => {
    if (closed || (only !== undefined && name && String(name) !== only)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (closed) return;
      rebuild();
      onChange();
    }, delay);
  };

  const rebuild = () => {
    const targets = new Map<string, Target>();
    for (const p of paths()) {
      const t = targetOf(p);
      targets.set(keyOf(t), t);
    }
    const next = [...targets.keys()].sort().join('\n');
    if (next === signature) return;
    signature = next;
    watchers.forEach((w) => w.close());
    watchers = [];
    for (const t of targets.values()) {
      const open = (recursive: boolean) => watch(t.dir, { recursive }, trigger(t.only));
      let w: FSWatcher;
      try {
        w = open(t.recursive);
      } catch {
        try {
          // A platform with no recursive watch watches the top folder only.
          w = open(false);
        } catch {
          continue;
        }
      }
      w.on('error', () => undefined);
      watchers.push(w);
    }
  };

  rebuild();
  return {
    // Reads the list again. The caller uses it when the list changes with no file event.
    rewatch: () => {
      if (!closed) rebuild();
    },
    close: () => {
      closed = true;
      clearTimeout(timer);
      watchers.forEach((w) => w.close());
      watchers = [];
    },
  };
}

// The channel of Server-Sent Events to the open pages.
// Event `reload` tells the page to read the new data. Event `invalid` carries the error as JSON `{ message }`.
export class Channel {
  private clients = new Set<ServerResponse>();
  // The error of the last change. A page that connects while it is set gets it at once.
  private error: string | undefined;

  get size(): number {
    return this.clients.size;
  }

  add(res: ServerResponse): void {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-content-type-options': 'nosniff' });
    res.write(': semspec\n\n');
    if (this.error !== undefined) res.write(frame('invalid', { message: this.error }));
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  reload(): void {
    this.error = undefined;
    this.send(frame('reload', 1));
  }

  invalid(message: string): void {
    // The pages show this error already.
    if (message === this.error) return;
    this.error = message;
    this.send(frame('invalid', { message }));
  }

  close(): void {
    this.clients.forEach((c) => c.end());
    this.clients.clear();
  }

  private send(text: string): void {
    this.clients.forEach((c) => c.write(text));
  }
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
