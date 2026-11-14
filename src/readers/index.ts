// Read any supported file into extracted text with a segment map. Formats are recognized by content first.
import JSZip from 'jszip';
import type { CitationFields, Segment, SourceKind } from '../core/types';
import { ascii, decodeText, ext, startsWith } from './common';
import { readPlainText } from './text';
import { readCsv } from './csv';
import { readHtml, readMhtml } from './html';
import { readDocx, readEpub, readOdf, readPptx, readXlsx } from './ooxml';
import { readPdf } from './pdf';
import { imageMime, readImage } from './image';
import { readEml, readMbox } from './email';
import { readGedcom } from './gedcom';
import { readTranscript } from './transcript';

export interface ReadResult {
  kind: SourceKind;
  mime: string;
  text: string;
  segments: Segment[];
  title?: string;
  pageCount?: number;
  citation?: Partial<CitationFields>;
  meta?: Record<string, string>;
}

export { renderPdfPage, pdfTextRects } from './pdf';
export { readExif } from './image';

const MEDIA: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
};

function mediaMime(bytes: Uint8Array, e: string): string | null {
  if (ascii(bytes, 0, 3) === 'ID3' || startsWith(bytes, [0xff, 0xfb]) || startsWith(bytes, [0xff, 0xf3])) return 'audio/mpeg';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return 'audio/wav';
  if (ascii(bytes, 0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(bytes, 0, 4) === 'fLaC') return 'audio/flac';
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return e === 'mkv' ? 'video/x-matroska' : 'video/webm';
  if (ascii(bytes, 4, 4) === 'ftyp' && !/^(heic|mif1|heix)/.test(ascii(bytes, 8, 4))) return /m4a/.test(ascii(bytes, 8, 4).toLowerCase()) ? 'audio/mp4' : MEDIA[e] ?? 'video/mp4';
  return MEDIA[e] ?? null;
}

async function readZip(bytes: Uint8Array, e: string): Promise<ReadResult | null> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return null;
  }
  const mimetype = (await zip.file('mimetype')?.async('string'))?.trim();
  if (zip.file('word/document.xml')) return readDocx(zip);
  if (zip.file('xl/workbook.xml')) return readXlsx(zip);
  if (zip.file('ppt/presentation.xml')) return readPptx(zip);
  if (mimetype === 'application/epub+zip' || zip.file('META-INF/container.xml') && e === 'epub') return readEpub(zip);
  if (mimetype?.startsWith('application/vnd.oasis.opendocument')) return readOdf(zip, mimetype);
  // A plain ZIP: list its contents.
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  return readPlainText(new TextEncoder().encode(names.join('\n')), 'application/zip');
}

function looksText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 4096);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff]);
    if (b < 9 || (b > 13 && b < 32)) bad++;
  }
  return bad < n * 0.02;
}

export async function readFile(name: string, bytes: Uint8Array, mime?: string): Promise<ReadResult> {
  const e = ext(name);
  // 1. Magic numbers
  if (ascii(bytes, 0, 5) === '%PDF-' || ascii(bytes, 0, 1024).includes('%PDF-')) return readPdf(bytes);
  const img = imageMime(bytes);
  if (img) return readImage(bytes, img);
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const z = await readZip(bytes, e);
    if (z) return z;
  }
  const med = mediaMime(bytes, e);
  if (med && !looksText(bytes)) return { kind: 'recording', mime: med, text: '', segments: [] };
  if (!looksText(bytes)) {
    return { kind: 'other', mime: mime ?? 'application/octet-stream', text: '', segments: [], meta: { note: 'No readable text in this file type.' } };
  }
  // 2. Text formats by content, then extension
  const head = decodeText(bytes.subarray(0, 2048));
  if (/^WEBVTT/.test(head.trimStart())) return readTranscript(bytes, true);
  if (/^0 HEAD\b/m.test(head.slice(0, 200)) || e === 'ged') return readGedcom(bytes);
  if (/^MIME-Version:/im.test(head) && /multipart\/related/i.test(head) || e === 'mhtml' || e === 'mht') return readMhtml(bytes);
  if (e === 'mbox' || /^From \S+ /.test(head)) return readMbox(bytes);
  if (e === 'eml' || /^(Received|Return-Path|From|Message-ID|Delivered-To):/im.test(head.split(/\r?\n\r?\n/)[0] ?? '') && /^Subject:/im.test(head)) return readEml(bytes);
  if (e === 'srt' || /^\d+\r?\n\d{2}:\d{2}:\d{2},\d{3} -->/.test(head.trimStart())) return readTranscript(bytes, false);
  if (e === 'vtt') return readTranscript(bytes, true);
  if (['html', 'htm', 'xhtml'].includes(e) || /^\s*(<!doctype html|<html)/i.test(head)) return readHtml(bytes);
  if (e === 'csv') return readCsv(bytes, name);
  if (e === 'tsv' || e === 'tab') return readCsv(bytes, name, true);
  const kind = e === 'json' ? 'application/json' : e === 'xml' ? 'application/xml' : e === 'md' ? 'text/markdown' : mime ?? 'text/plain';
  return readPlainText(bytes, kind);
}

/** Decode a text file without format detection. */
export function readAsText(bytes: Uint8Array): string {
  return decodeText(bytes);
}
