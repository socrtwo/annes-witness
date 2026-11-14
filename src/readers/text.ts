import { decodeText, TextBuilder } from './common';
import type { ReadResult } from './index';

export function readPlainText(bytes: Uint8Array, mime = 'text/plain'): ReadResult {
  const raw = decodeText(bytes).replace(/\r\n?/g, '\n');
  const b = new TextBuilder();
  let n = 0;
  // Keep the text exactly, segmenting paragraphs separated by blank lines.
  const re = /\n{2,}/g;
  let last = 0;
  const pieces: [number, number][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    pieces.push([last, m.index]);
    last = m.index + m[0].length;
  }
  pieces.push([last, raw.length]);
  b.text = raw;
  for (const [s, e] of pieces) {
    if (raw.slice(s, e).trim()) b.segments.push({ start: s, end: e, label: `¶ ${++n}` });
  }
  const md = /^#\s+(.+)$/m.exec(raw);
  return { kind: 'text', mime, text: b.text, segments: b.segments, title: md?.[1].trim() };
}
