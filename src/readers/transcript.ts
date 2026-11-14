// WebVTT and SRT transcripts: segments carry times.
import { decodeText, TextBuilder } from './common';
import type { ReadResult } from './index';

function secs(t: string): number {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(t);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

export function hms(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
}

export function readTranscript(bytes: Uint8Array, vtt: boolean): ReadResult {
  const raw = decodeText(bytes).replace(/\r\n?/g, '\n');
  const b = new TextBuilder('\n');
  for (const block of raw.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, z] = lines[ti].split('-->');
    const text = lines.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!text) continue;
    const ts = secs(a);
    b.add(text, { label: hms(ts), timeStart: ts, timeEnd: secs(z) });
  }
  return { kind: 'recording', mime: vtt ? 'text/vtt' : 'application/x-subrip', text: b.text, segments: b.segments };
}
