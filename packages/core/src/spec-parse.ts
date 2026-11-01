// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// Reads a Markdown text into author text and marked regions. A region starts with
// `<!-- semspec:section name=value ... -->` or `<!-- semspec:node id=value ... -->` and ends with
// `<!-- semspec:end -->`. A marker inside a fenced code block is text of the author, not a marker.
import type { RawOptions } from './spec-options.js';

export interface SpecMarker {
  type: 'section' | 'node';
  // The line (from 1) of the start marker.
  line: number;
  options: RawOptions;
  // The index of the first character after the start marker.
  start: number;
  // The index of the first character of the end marker.
  end: number;
}

export interface SpecParseProblem {
  line: number;
  message: string;
}

const MARKER = /<!--\s*semspec:([A-Za-z-]+)([\s\S]*?)-->/g;
const OPTION = /\s*([A-Za-z][\w.-]*)=("([^"]*)"|'([^']*)'|[^\s"']+)/y;

// The ranges of the text inside fenced code blocks.
function fencedRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  let open: { char: string; length: number; from: number } | undefined;
  let offset = 0;
  for (const line of text.split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r$/, ''));
    if (m) {
      const char = m[1][0];
      if (!open) open = { char, length: m[1].length, from: offset };
      else if (char === open.char && m[1].length >= open.length && m[2].trim() === '') {
        ranges.push([open.from, offset + line.length]);
        open = undefined;
      }
    }
    offset += line.length + 1;
  }
  if (open) ranges.push([open.from, text.length]);
  return ranges;
}

const lineAt = (text: string, index: number): number => {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
};

// Reads the options of a marker. A value is a word, or text in single or double quotes.
function readOptions(source: string): { options: RawOptions; error?: string } {
  const options: RawOptions = {};
  let pos = 0;
  OPTION.lastIndex = 0;
  while (pos < source.length) {
    if (/^\s*$/.test(source.slice(pos))) break;
    OPTION.lastIndex = pos;
    const m = OPTION.exec(source);
    if (!m) {
      const bad = source.slice(pos).trim().split(/\s+/)[0];
      return { options, error: `The marker has the text "${bad}", which is not an option of the form name=value.` };
    }
    const name = m[1];
    if (Object.prototype.hasOwnProperty.call(options, name)) return { options, error: `The marker has the option "${name}" more than once.` };
    options[name] = m[3] ?? m[4] ?? m[2];
    pos = OPTION.lastIndex;
  }
  return { options };
}

// Finds the marked regions. A problem names the line. A text with a problem gives no regions.
export function parseSpecMarkers(text: string): { markers: SpecMarker[]; problems: SpecParseProblem[] } {
  const markers: SpecMarker[] = [];
  const problems: SpecParseProblem[] = [];
  const fenced = fencedRanges(text);
  const inFence = (i: number) => fenced.some(([a, b]) => i >= a && i <= b);
  let open: { type: 'section' | 'node'; line: number; options: RawOptions; start: number } | undefined;
  MARKER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER.exec(text))) {
    if (inFence(m.index)) continue;
    const line = lineAt(text, m.index);
    const word = m[1];
    if (m[2].includes('<!--')) {
      problems.push({ line, message: 'The marker comment is not closed with -->.' });
      MARKER.lastIndex = m.index + 4;
      continue;
    }
    if (word === 'end') {
      if (m[2].trim() !== '') problems.push({ line, message: 'The end marker takes no option.' });
      if (!open) problems.push({ line, message: 'The end marker has no start marker.' });
      else {
        markers.push({ ...open, end: m.index });
        open = undefined;
      }
    } else if (word === 'section' || word === 'node') {
      if (open) {
        problems.push({ line, message: `A marker cannot sit inside the marker of line ${open.line}.` });
        continue;
      }
      const read = readOptions(m[2]);
      if (read.error) problems.push({ line, message: read.error });
      open = { type: word, line, options: read.options, start: m.index + m[0].length };
    } else problems.push({ line, message: `The marker "semspec:${word}" is unknown. The markers are: section, node, end.` });
  }
  if (open) problems.push({ line: open.line, message: 'The marker is not closed. Add the end marker.' });
  return { markers: problems.length ? [] : markers, problems };
}
