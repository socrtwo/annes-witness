// RFC 822 messages and mbox files.
import { collapse, decodeText, stripHtmlToBlocks, TextBuilder } from './common';
import { b64ToBytes, decodeTransfer } from './html';
import type { ReadResult } from './index';

function decodeWord(s: string): string {
  return s.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_m, cs: string, enc: string, data: string) => {
    let bytes: Uint8Array;
    if (enc.toLowerCase() === 'b') bytes = b64ToBytes(data);
    else {
      const t = data.replace(/_/g, ' ');
      const arr: number[] = [];
      for (let i = 0; i < t.length; i++) {
        if (t[i] === '=' && /^[0-9a-f]{2}$/i.test(t.slice(i + 1, i + 3))) { arr.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; }
        else arr.push(t.charCodeAt(i));
      }
      bytes = new Uint8Array(arr);
    }
    try {
      return new TextDecoder(cs.toLowerCase()).decode(bytes);
    } catch {
      return decodeText(bytes);
    }
  }).replace(/\?=\s+=\?/g, '');
}

export function parseHeaders(head: string): Record<string, string> {
  const out: Record<string, string> = {};
  const unfolded = head.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const m = /^([!-9;-~]+):\s*(.*)$/.exec(line);
    if (m) {
      const k = m[1].toLowerCase();
      out[k] = out[k] && k !== 'subject' ? out[k] + ', ' + m[2] : decodeWord(m[2]);
    }
  }
  return out;
}

interface Part { headers: Record<string, string>; body: string }

function splitParts(headers: Record<string, string>, body: string): Part[] {
  const ct = headers['content-type'] ?? 'text/plain';
  const boundary = /boundary="?([^";]+)"?/i.exec(ct)?.[1];
  if (!/^multipart\//i.test(ct) || !boundary) return [{ headers, body }];
  const out: Part[] = [];
  const chunks = body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?\\s*`));
  for (const ch of chunks) {
    const sep = ch.search(/\r?\n\r?\n/);
    if (sep < 0) continue;
    const h = parseHeaders(ch.slice(0, sep));
    if (!Object.keys(h).length) continue;
    out.push(...splitParts(h, ch.slice(sep).replace(/^\r?\n\r?\n/, '')));
  }
  return out;
}

export function messageText(raw: string): { headers: Record<string, string>; body: string; attachments: string[] } {
  const sep = raw.search(/\r?\n\r?\n/);
  const headers = parseHeaders(sep < 0 ? raw : raw.slice(0, sep));
  const body = sep < 0 ? '' : raw.slice(sep).replace(/^\r?\n\r?\n/, '');
  const parts = splitParts(headers, body);
  const attachments: string[] = [];
  let plain: string | undefined;
  let html: string | undefined;
  for (const p of parts) {
    const ct = (p.headers['content-type'] ?? 'text/plain').toLowerCase();
    const disp = p.headers['content-disposition'] ?? '';
    const fname = /filename="?([^";]+)"?/i.exec(disp)?.[1] ?? /name="?([^";]+)"?/i.exec(p.headers['content-type'] ?? '')?.[1];
    if (/attachment/i.test(disp) || (fname && !ct.startsWith('text/'))) {
      if (fname) attachments.push(fname);
      continue;
    }
    const txt = decodeTransfer(p.body, p.headers['content-transfer-encoding']);
    if (ct.startsWith('text/plain') && plain === undefined) plain = txt;
    else if (ct.startsWith('text/html') && html === undefined) html = txt;
  }
  const text = plain ?? (html ? stripHtmlToBlocks(html).blocks.join('\n\n') : '');
  return { headers, body: collapse(text.replace(/\r\n?/g, '\n')), attachments };
}

function headerBlock(h: Record<string, string>) {
  return ['from', 'to', 'cc', 'date', 'subject'].filter((k) => h[k]).map((k) => `${k[0].toUpperCase()}${k.slice(1)}: ${h[k]}`).join('\n');
}

function isoDate(d?: string) {
  if (!d) return undefined;
  const t = Date.parse(d);
  return Number.isNaN(t) ? d : new Date(t).toISOString().slice(0, 10);
}

export function readEml(bytes: Uint8Array): ReadResult {
  const { headers, body, attachments } = messageText(decodeText(bytes));
  const b = new TextBuilder();
  b.add(headerBlock(headers), { label: 'Headers' });
  b.add(body, { label: 'Body' });
  if (attachments.length) b.add('Attachments: ' + attachments.join(', '), { label: 'Attachments' });
  return {
    kind: 'email', mime: 'message/rfc822', text: b.text, segments: b.segments, title: headers.subject,
    citation: { type: 'letter', title: headers.subject, authors: headers.from ? [headers.from] : undefined, date: isoDate(headers.date) },
    meta: { from: headers.from ?? '', to: headers.to ?? '', messageId: headers['message-id'] ?? '' },
  };
}

export function readMbox(bytes: Uint8Array): ReadResult {
  const raw = decodeText(bytes).replace(/\r\n/g, '\n');
  const msgs = raw.split(/^From [^\n]*\n/m).filter((m) => m.trim());
  const b = new TextBuilder();
  msgs.forEach((m, i) => {
    const { headers, body } = messageText(m.replace(/^>From /gm, 'From '));
    b.add(headerBlock(headers) + '\n\n' + body, { label: `Message ${i + 1}${headers.subject ? ': ' + headers.subject : ''}`, page: i + 1 });
  });
  return { kind: 'email', mime: 'application/mbox', text: b.text, segments: b.segments, pageCount: msgs.length };
}
