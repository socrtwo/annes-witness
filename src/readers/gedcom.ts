// GEDCOM 5.5, 5.5.1 and 7.0: readable lines, one segment per record.
import { decodeText, TextBuilder } from './common';
import type { ReadResult } from './index';

export function readGedcom(bytes: Uint8Array): ReadResult {
  let raw = decodeText(bytes);
  if (/1 CHAR ANSEL/.test(raw)) raw = raw; // ANSEL is decoded as Latin-1; diacritics may show as separate marks
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const b = new TextBuilder('\n');
  let cur: string[] = [];
  let label = 'Header';
  const flush = () => {
    if (cur.length) b.add(cur.join('\n'), { label });
    cur = [];
  };
  for (const line of lines) {
    const m = /^\s*(\d+)\s+(@[^@]+@\s+)?(\w+)\s?(.*)$/.exec(line);
    if (!m) continue;
    const level = Number(m[1]);
    if (level === 0) {
      flush();
      label = m[2] ? `${m[2].trim()} ${m[3]}` : m[3];
      if (m[3] === 'TRLR') continue;
    }
    const indent = '  '.repeat(level);
    if (m[3] === 'CONC') { cur[cur.length - 1] = (cur[cur.length - 1] ?? '') + m[4]; continue; }
    if (m[3] === 'CONT') { cur.push(indent + m[4]); continue; }
    cur.push(`${indent}${m[2] ? m[2].trim() + ' ' : ''}${m[3]}${m[4] ? ' ' + m[4] : ''}`);
  }
  flush();
  const title = /^1 FILE (.+)$/m.exec(raw)?.[1] ?? /^1 SOUR (.+)$/m.exec(raw)?.[1];
  return { kind: 'gedcom', mime: 'text/vnd.familysearch.gedcom', text: b.text, segments: b.segments, title };
}
