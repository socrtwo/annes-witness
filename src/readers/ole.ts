// OLE2 compound files: Word 97-2003 (.doc), Excel 5-2003 (.xls), Outlook (.msg); others best-effort.
import type { Segment } from '../core/types';
import type { ReadResult } from './index';
import { isOle2, readCfb, extractDoc97 } from './legacy/doc97';
import { readXlsCells, colName, formatXlsValue } from './legacy/xls';
import { stringsScan } from './legacy/salvage';

export { isOle2 };

function paragraphs(text: string, label: (n: number) => string, extra: Partial<Segment> = {}, offset = 0): Segment[] {
  const segs: Segment[] = [];
  let pos = 0, n = 0;
  for (const line of text.split('\n')) {
    if (line.trim()) segs.push({ start: offset + pos, end: offset + pos + line.length, label: label(++n), ...extra });
    pos += line.length + 1;
  }
  return segs;
}

export function readDoc(bytes: Uint8Array): ReadResult | null {
  const d = extractDoc97(bytes);
  if (!d) return null;
  if (d.encrypted) return { kind: 'document', mime: 'application/msword', text: '', segments: [], meta: { note: 'This Word document is password-protected; its text cannot be read.' } };
  let text = d.main.replace(/\f/g, '\n');
  const segments = paragraphs(text, (n) => `¶ ${n}`);
  const add = (label: string, body: string) => {
    if (!body.trim()) return;
    text += `\n\n${label}\n`;
    const start = text.length;
    text += body;
    segments.push(...paragraphs(body, (n) => `${label} ${n}`, {}, start));
  };
  add('Footnotes', d.footnotes);
  add('Endnotes', d.endnotes);
  add('Comments', d.comments);
  add('Text boxes', d.textboxes);
  const meta: Record<string, string> = { method: d.method };
  if (d.damaged.length) meta.damaged = d.damaged.join('; ');
  return { kind: 'document', mime: 'application/msword', text, segments, meta };
}

export function readXls(bytes: Uint8Array): ReadResult | null {
  const r = readXlsCells(bytes);
  if (!r) return null;
  if (r.encrypted) return { kind: 'workbook', mime: 'application/vnd.ms-excel', text: '', segments: [], meta: { note: 'This workbook is password-protected; its cells cannot be read.' } };
  let text = '';
  const segments: Segment[] = [];
  for (const sheet of r.sheets) {
    const cells = r.cells.filter((c) => c.sheet === sheet).sort((a, b) => a.row - b.row || a.col - b.col);
    if (!cells.length) continue;
    text += (text ? '\n\n' : '') + `${sheet}\n`;
    let row = -1;
    for (const c of cells) {
      if (c.row !== row) { if (row >= 0) text += '\n'; row = c.row; } else text += '\t';
      const v = formatXlsValue(c.value);
      const cell = `${colName(c.col)}${c.row + 1}`;
      segments.push({ start: text.length, end: text.length + v.length, label: `${sheet}!${cell}`, sheet, cell, row: c.row + 1, col: c.col + 1 });
      text += v;
    }
  }
  const meta: Record<string, string> = { biff: String(r.version) };
  if (r.warnings.length) meta.warnings = r.warnings.join('; ');
  return { kind: 'workbook', mime: 'application/vnd.ms-excel', text, segments, meta };
}

function msgString(streams: Map<string, Uint8Array>, prop: string): string | undefined {
  const u = streams.get(`__substg1.0_${prop}001F`);
  if (u) return new TextDecoder('utf-16le').decode(u).replace(/\0+$/, '');
  const a = streams.get(`__substg1.0_${prop}001E`);
  if (a) return new TextDecoder('windows-1252').decode(a).replace(/\0+$/, '');
  return undefined;
}

/** Read any OLE2 compound file. Returns null when the bytes are not OLE2. */
export function readOle(bytes: Uint8Array, ext: string): ReadResult | null {
  if (!isOle2(bytes)) return null;
  const cfb = readCfb(bytes);
  const has = (n: string) => !!cfb?.streams.has(n);
  if (has('WordDocument') || ext === 'doc' || ext === 'dot') { const r = readDoc(bytes); if (r) return r; }
  if (has('Workbook') || has('Book') || ext === 'xls' || ext === 'xlt') { const r = readXls(bytes); if (r) return r; }
  if (cfb && [...cfb.streams.keys()].some((k) => k.startsWith('__substg1.0_'))) {
    const subject = msgString(cfb.streams, '0037') ?? '';
    const from = msgString(cfb.streams, '0C1A') ?? msgString(cfb.streams, '0042');
    const body = msgString(cfb.streams, '1000') ?? '';
    const head = `Subject: ${subject}\n${from ? `From: ${from}\n` : ''}\n`;
    const text = head + body;
    return {
      kind: 'email', mime: 'application/vnd.ms-outlook', text, title: subject || undefined,
      segments: [{ start: 0, end: head.length - 1, label: 'header' }, ...paragraphs(body, (n) => `¶ ${n}`, {}, head.length)],
      citation: { type: 'letter', title: subject || undefined, authors: from ? [from] : undefined },
    };
  }
  // Other compound files (PowerPoint 97, Works, …): keep any readable text runs.
  const text = cfb ? [...cfb.streams.values()].map((s) => stringsScan(s, 6)).filter(Boolean).join('\n') : stringsScan(bytes, 6);
  return { kind: 'other', mime: 'application/x-ole-storage', text, segments: paragraphs(text, (n) => `run ${n}`), meta: { note: 'Text runs found by scanning; layout and order may be lost.' } };
}
