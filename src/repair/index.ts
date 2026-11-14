// Repair Source File: tolerant recovery of damaged sources. The original is never changed;
// the caller adds the result as a new, derivative source. Methods follow the suite's recovery
// engines (Anne's Pen, Grid, Folio), reduced to what an evidence workbench needs: the text.
import JSZip from 'jszip';
import { readFile, ReadResult } from '../readers/index';
import { scanZipBytes, repairXmlPart, isWellFormed, extractTextFromWordXml, extractTextFromOdtXml, stringsScan, cp1252 } from '../readers/legacy/salvage';
import { immortalInflate } from '../readers/legacy/inflate';
import { isOle2, extractDoc97 } from '../readers/legacy/doc97';
import { readXlsCells } from '../readers/legacy/xls';
import { readOle } from '../readers/ole';
import type { Segment } from '../core/types';

export interface RepairResult { ok: boolean; result?: ReadResult; repairedBytes?: Uint8Array; repairedName?: string; report: string[] }

const ext = (n: string) => (n.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
const stem = (n: string) => n.replace(/\.[^.]+$/, '');
const hasText = (r?: ReadResult) => !!r && r.text.trim().length > 0;
const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;
const isPdf = (b: Uint8Array) => new TextDecoder('latin1').decode(b.subarray(0, 1024)).includes('%PDF-');
const ZIP_EXTS = ['docx', 'docm', 'dotx', 'xlsx', 'xlsm', 'pptx', 'pptm', 'odt', 'ods', 'odp', 'epub', 'zip'];

async function tryRead(name: string, bytes: Uint8Array, report: string[], label: string): Promise<ReadResult | undefined> {
  try {
    const r = await readFile(name, bytes);
    report.push(`${label}: ${hasText(r) ? `read ${r.text.length} characters` : 'no text'}`);
    return r;
  } catch (e: any) {
    report.push(`${label}: failed (${e?.message ?? e})`);
    return undefined;
  }
}

// --- ZIP-based formats ----------------------------------------------------------------------------
async function repairZip(name: string, bytes: Uint8Array, report: string[]): Promise<RepairResult> {
  const entries = scanZipBytes(bytes);
  report.push(`ZIP salvage: ${entries.size} entr${entries.size === 1 ? 'y' : 'ies'} found by their local headers${[...entries.values()].some((e) => e.isCorrupt) ? ' (some damaged)' : ''}`);
  if (!entries.size) return { ok: false, report };
  const zip = new JSZip();
  let fixed = 0;
  for (const [path, e] of entries) {
    let data = e.data;
    if (/\.(xml|rels)$/i.test(path)) {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(data);
      if (!isWellFormed(text)) {
        const r = repairXmlPart(path, text, e.isCorrupt);
        if (r) { data = new TextEncoder().encode(r.xml); fixed++; report.push(`  ${path}: ${r.steps.join(', ') || 'repaired'}`); }
        else report.push(`  ${path}: could not be repaired; kept as found`);
      }
    }
    if (path === 'mimetype') zip.file(path, data, { compression: 'STORE' });
    else zip.file(path, data);
  }
  if (fixed) report.push(`XML repair: ${fixed} part(s) repaired`);
  const repaired = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const repairedName = `${stem(name)} (repaired).${ext(name) || 'zip'}`;
  let result = await tryRead(repairedName, repaired, report, 'Reading the rebuilt package');
  if (!hasText(result)) {
    // Last resort: text straight from the main XML parts.
    const doc = entries.get('word/document.xml') ?? entries.get('content.xml');
    if (doc) {
      const xml = new TextDecoder().decode(doc.data);
      const text = entries.has('word/document.xml') ? extractTextFromWordXml(xml) : extractTextFromOdtXml(xml);
      report.push(`Text taken directly from ${entries.has('word/document.xml') ? 'word/document.xml' : 'content.xml'}: ${text.length} characters`);
      result = { kind: 'document', mime: 'text/plain', text, segments: paraSegments(text) };
    }
  }
  return { ok: hasText(result), result, repairedBytes: repaired, repairedName, report };
}

function paraSegments(text: string, prefix = '¶'): Segment[] {
  const segs: Segment[] = [];
  let pos = 0, n = 0;
  for (const line of text.split('\n')) {
    if (line.trim()) segs.push({ start: pos, end: pos + line.length, label: `${prefix} ${++n}` });
    pos += line.length + 1;
  }
  return segs;
}

// --- PDF stream scan ---------------------------------------------------------------------------------
const WIN_ANSI_EXTRA: Record<number, string> = {};
for (let b = 0x80; b <= 0x9f; b++) WIN_ANSI_EXTRA[b] = cp1252(b);
const winAnsi = (codes: number[]) => codes.map((c) => (c >= 0x80 && c <= 0x9f ? WIN_ANSI_EXTRA[c] : String.fromCharCode(c))).join('');

/** Decode a PDF literal string body (between the outer parentheses). */
export function pdfLiteral(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out.push(s.charCodeAt(i) & 0xff); continue; }
    const n = s[++i];
    if (n === undefined) break;
    const map: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
    if (n in map) out.push(map[n]);
    else if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(s[i + 1] ?? '')) oct += s[++i];
      out.push(parseInt(oct, 8) & 0xff);
    } else if (n === '\r') { if (s[i + 1] === '\n') i++; }
    else if (n !== '\n') out.push(n.charCodeAt(0) & 0xff);
  }
  return out;
}

function pdfHex(h: string): number[] {
  const t = h.replace(/[^0-9a-fA-F]/g, '');
  const out: number[] = [];
  for (let i = 0; i < t.length; i += 2) out.push(parseInt((t[i] + (t[i + 1] ?? '0')), 16));
  return out;
}

function decodeCodes(codes: number[]): string {
  // UTF-16BE with BOM, or two-byte codes that look like UTF-16 text; otherwise WinAnsi.
  if (codes[0] === 0xfe && codes[1] === 0xff) { let s = ''; for (let i = 2; i + 1 < codes.length; i += 2) s += String.fromCharCode((codes[i] << 8) | codes[i + 1]); return s; }
  return winAnsi(codes);
}

/** Text from content-stream text operators: Tj, TJ, ' and ". */
export function textFromContent(content: string): string {
  let out = '';
  // Tokenize strings and operators; keep the strings shown since the last operator.
  const tokens: (string | { s: number[] })[] = [];
  let i = 0;
  while (i < content.length) {
    const c = content[i];
    if (c === '(') {
      let depth = 1, j = i + 1, body = '';
      while (j < content.length && depth > 0) {
        const d = content[j];
        if (d === '\\') { body += d + (content[j + 1] ?? ''); j += 2; continue; }
        if (d === '(') depth++;
        if (d === ')') { depth--; if (!depth) break; }
        body += d;
        j++;
      }
      tokens.push({ s: pdfLiteral(body) });
      i = j + 1;
    } else if (c === '<' && content[i + 1] !== '<') {
      const j = content.indexOf('>', i);
      if (j < 0) break;
      tokens.push({ s: pdfHex(content.slice(i + 1, j)) });
      i = j + 1;
    } else if (/[A-Za-z'"]/.test(c)) {
      let j = i;
      while (j < content.length && /[A-Za-z*'"]/.test(content[j])) j++;
      tokens.push(content.slice(i, j));
      i = j;
    } else if (c === '[' || c === ']') { tokens.push(c); i++; }
    else if (c === '-' || c === '.' || /\d/.test(c)) {
      let j = i + 1;
      while (j < content.length && /[\d.]/.test(content[j])) j++;
      const num = Number(content.slice(i, j));
      tokens.push(`#${num}`);
      i = j;
    } else i++;
  }
  let pending: (number[] | number)[] = [];
  let inArray = false;
  for (const t of tokens) {
    if (typeof t !== 'string') { pending.push(t.s); continue; }
    if (t === '[') { inArray = true; pending = []; continue; }
    if (t === ']') { inArray = false; continue; }
    if (t.startsWith('#')) { if (inArray) pending.push(Number(t.slice(1))); continue; }
    if (t === 'Tj' || t === 'TJ' || t === "'" || t === '"') {
      if (t === "'" || t === '"') out += '\n';
      for (const p of pending) {
        if (typeof p === 'number') { if (p < -200) out += ' '; }
        else out += decodeCodes(p);
      }
      pending = [];
    } else if (t === 'Td' || t === 'TD' || t === 'T*') { if (out && !out.endsWith('\n') && !out.endsWith(' ')) out += t === 'T*' ? '\n' : ' '; pending = []; }
    else if (t === 'ET') { if (out && !out.endsWith('\n')) out += '\n'; pending = []; }
    else if (!inArray) pending = [];
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Scan raw PDF bytes for stream objects, inflate them tolerantly, and pull their text. */
export function scanPdfStreams(bytes: Uint8Array): { text: string; segments: Segment[]; streams: number; decoded: number } {
  const latin = new TextDecoder('latin1').decode(bytes);
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  let text = '';
  const segments: Segment[] = [];
  let streams = 0, decoded = 0;
  while ((m = re.exec(latin))) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) break;
    streams++;
    const dict = latin.slice(Math.max(0, m.index - 600), m.index);
    const lastDict = dict.slice(dict.lastIndexOf('<<'));
    if (/\/Subtype\s*\/Image|\/Type\s*\/XObject/.test(lastDict) && /\/Image/.test(lastDict)) { re.lastIndex = end; continue; }
    let data = bytes.subarray(start, end);
    if (/\/FlateDecode/.test(lastDict)) {
      // Skip a 2-byte zlib header when present.
      const raw = data[0] === 0x78 ? data.subarray(2) : data;
      const r = immortalInflate(raw, { resync: true });
      if (!r.data.length) { re.lastIndex = end; continue; }
      data = r.data;
    } else if (/\/Filter/.test(lastDict)) { re.lastIndex = end; continue; }
    const content = new TextDecoder('latin1').decode(data);
    if (!/T[jJ]|['"]\s/.test(content)) { re.lastIndex = end; continue; }
    const t = textFromContent(content);
    if (t.trim()) {
      decoded++;
      const s = text.length + (text ? 2 : 0);
      text += (text ? '\n\n' : '') + t;
      segments.push({ start: s, end: text.length, label: `stream ${decoded}`, page: decoded });
    }
    re.lastIndex = end;
  }
  return { text, segments, streams, decoded };
}

// --- main entry ----------------------------------------------------------------------------------------
export async function repairSourceFile(name: string, bytes: Uint8Array): Promise<RepairResult> {
  const report: string[] = [`Repairing “${name}” (${bytes.length} bytes). The original file is not changed.`];
  const e = ext(name);

  if (isPdf(bytes) || e === 'pdf') {
    const first = await tryRead(name, bytes, report, 'Normal PDF reading');
    if (hasText(first)) { report.push('The PDF reads normally; nothing to repair.'); return { ok: true, result: first, report }; }
    const s = scanPdfStreams(bytes);
    report.push(`Stream scan: ${s.streams} stream(s) found, text recovered from ${s.decoded}`);
    if (!s.text.trim()) return { ok: false, report: [...report, 'No text could be recovered (the pages may be scanned pictures: try Recognize Text).'] };
    return { ok: true, result: { kind: 'pdf', mime: 'text/plain', text: s.text, segments: s.segments, meta: { repaired: 'stream scan; page order follows the file and may differ from the original' } }, report };
  }

  if (isZip(bytes) || ZIP_EXTS.includes(e)) {
    const first = await tryRead(name, bytes, report, 'Normal reading');
    if (hasText(first)) { report.push('The file reads normally; nothing to repair.'); return { ok: true, result: first, report }; }
    return repairZip(name, bytes, report);
  }

  if (isOle2(bytes) || ['doc', 'dot', 'xls', 'xlt', 'msg', 'ppt'].includes(e)) {
    const d = extractDoc97(bytes);
    if (d && (d.main || d.footnotes)) {
      report.push(`Word binary: text recovered by ${d.method}${d.damaged.length ? `; damaged: ${d.damaged.join('; ')}` : ''}`);
      const r = readOle(bytes, 'doc') ?? undefined;
      if (hasText(r)) return { ok: true, result: r, report };
    }
    const x = readXlsCells(bytes);
    if (x && x.cells.length) {
      report.push(`Excel binary: ${x.cells.length} cells recovered${x.warnings.length ? `; ${x.warnings.join('; ')}` : ''}`);
      const r = readOle(bytes, 'xls') ?? undefined;
      if (hasText(r)) return { ok: true, result: r, report };
    }
    const text = stringsScan(bytes, 6);
    report.push(`Strings scan: ${text.length} characters of text runs`);
    return { ok: !!text.trim(), result: text.trim() ? { kind: 'other', mime: 'text/plain', text, segments: paraSegments(text, 'run') } : undefined, report };
  }

  // Text and everything else: decode with replacement, strip NULs and control characters.
  const first = await tryRead(name, bytes, report, 'Normal reading');
  if (hasText(first) && !/�|\0/.test(first!.text)) { report.push('The file reads normally; nothing to repair.'); return { ok: true, result: first, report }; }
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const bad = (decoded.match(/�/g) ?? []).length;
  // Mostly invalid UTF-8: the file is probably in a single-byte code page.
  const text = (bad > decoded.length * 0.05 ? [...bytes].map((b) => cp1252(b)).join('') : decoded)
    .replace(/\0/g, '').replace(/[\x01-\x08\x0b\x0c\x0e-\x1f]/g, '');
  report.push(`Text decoding: ${bad} invalid byte sequence(s) ${bad > decoded.length * 0.05 ? 'decoded as Windows-1252' : 'replaced with �'}; NULs and control characters removed`);
  return { ok: !!text.trim(), result: { kind: 'text', mime: 'text/plain', text, segments: paraSegments(text) }, report };
}
