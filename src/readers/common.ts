// Shared helpers for readers: text decoding, XML text extraction, building text with segments.
import type { Segment } from '../core/types';

export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('windows-1252').decode(bytes);
    } catch {
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      return s;
    }
  }
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', deg: '°', middot: '·', bull: '•',
  eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', ouml: 'ö', uuml: 'ü', auml: 'ä', szlig: 'ß', ccedil: 'ç', ntilde: 'ñ',
  pound: '£', euro: '€', yen: '¥', cent: '¢', sect: '§', para: '¶', times: '×', divide: '÷', frac12: '½', frac14: '¼',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export function escapeXml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Text of all elements matching `tag` (e.g. "w:t") inside an XML fragment, in order. */
export function texts(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(decodeEntities(m[1] ?? ''));
  return out;
}

/** Inner XML of each element matching `tag`. */
export function elements(xml: string, tag: string): { inner: string; attrs: string; index: number }[] {
  const re = new RegExp(`<${tag}(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
  const out: { inner: string; attrs: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push({ inner: m[2] ?? '', attrs: m[1] ?? '', index: m.index });
  return out;
}

export function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name.replace(':', '\\:')}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : undefined;
}

export function collapse(s: string): string {
  return s.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

/** Builds extracted text and its segment map. */
export class TextBuilder {
  text = '';
  segments: Segment[] = [];
  constructor(private sep = '\n\n') {}
  add(chunk: string, seg: Omit<Segment, 'start' | 'end'>, sep = this.sep) {
    if (!chunk) return;
    if (this.text) this.text += sep;
    const start = this.text.length;
    this.text += chunk;
    this.segments.push({ ...seg, start, end: this.text.length });
  }
}

export function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

export function ascii(bytes: Uint8Array, start: number, len: number): string {
  let s = '';
  for (let i = start; i < Math.min(bytes.length, start + len); i++) s += String.fromCharCode(bytes[i]);
  return s;
}

export function ext(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export function stripHtmlToBlocks(html: string): { title?: string; blocks: string[] } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  let body = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n');
  body = body.replace(/<\/?(p|div|h[1-6]|li|tr|td|th|blockquote|pre|section|article|header|footer|figcaption|dt|dd|table|ul|ol|nav|main|aside|caption)(\s[^>]*)?>/gi, '\u0001');
  body = body.replace(/<[^>]+>/g, '');
  const blocks = body
    .split('\u0001')
    .map((b) => collapse(decodeEntities(b)))
    .filter((b) => b.length > 0);
  return { title: title ? collapse(decodeEntities(title.replace(/<[^>]+>/g, ''))) : undefined, blocks };
}
