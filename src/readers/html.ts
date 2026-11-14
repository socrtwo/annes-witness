import { decodeText, stripHtmlToBlocks, TextBuilder } from './common';
import type { ReadResult } from './index';

export function readHtmlString(html: string, mime = 'text/html'): ReadResult {
  const { title, blocks } = stripHtmlToBlocks(html);
  const b = new TextBuilder();
  blocks.forEach((t, i) => b.add(t, { label: `¶ ${i + 1}` }));
  const meta: Record<string, string> = {};
  const desc = /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html);
  if (desc) meta.description = desc[1];
  const canon = /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']*)["']/i.exec(html);
  if (canon) meta.canonical = canon[1];
  const author = /<meta[^>]+name=["']author["'][^>]*content=["']([^"']*)["']/i.exec(html);
  return {
    kind: 'web', mime, text: b.text, segments: b.segments, title, meta,
    citation: { type: 'web', title, authors: author ? [author[1]] : undefined, url: canon?.[1] },
  };
}

export function readHtml(bytes: Uint8Array): ReadResult {
  return readHtmlString(decodeText(bytes));
}

function decodeQP(s: string): string {
  const bytes: number[] = [];
  const t = s.replace(/=\r?\n/g, '');
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '=' && /^[0-9A-F]{2}$/i.test(t.slice(i + 1, i + 3))) {
      bytes.push(parseInt(t.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const enc = new TextEncoder().encode(t[i]);
      bytes.push(...enc);
    }
  }
  return decodeText(new Uint8Array(bytes));
}

export function b64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodeTransfer(body: string, encoding: string | undefined): string {
  const e = (encoding ?? '').toLowerCase().trim();
  if (e === 'quoted-printable') return decodeQP(body);
  if (e === 'base64') return decodeText(b64ToBytes(body));
  return body;
}

/** MHTML: take the first text/html part. */
export function readMhtml(bytes: Uint8Array): ReadResult {
  const raw = decodeText(bytes);
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(raw)?.[1];
  const loc = /^Snapshot-Content-Location:\s*(.+)$/im.exec(raw)?.[1]?.trim();
  if (boundary) {
    for (const part of raw.split('--' + boundary)) {
      const sep = part.search(/\r?\n\r?\n/);
      if (sep < 0) continue;
      const head = part.slice(0, sep);
      if (!/content-type:\s*text\/html/i.test(head)) continue;
      const enc = /content-transfer-encoding:\s*(\S+)/i.exec(head)?.[1];
      const res = readHtmlString(decodeTransfer(part.slice(sep).replace(/^\r?\n\r?\n/, ''), enc), 'multipart/related');
      if (loc) {
        res.meta = { ...res.meta, url: loc };
        res.citation = { ...res.citation, url: loc };
      }
      return res;
    }
  }
  return readHtmlString(raw, 'multipart/related');
}
