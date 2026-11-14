// PDF text through pdf.js: one segment per page.
import type { ReadResult } from './index';

const isNode = typeof window === 'undefined';

async function pdfjs(): Promise<any> {
  if (isNode) return import(/* @vite-ignore */ 'pdfjs-dist/legacy/build/pdf.mjs');
  const lib: any = await import('pdfjs-dist');
  if (!lib.GlobalWorkerOptions.workerSrc)
    lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  return lib;
}

export async function openPdf(bytes: Uint8Array): Promise<any> {
  const lib = await pdfjs();
  const data = new Uint8Array(bytes); // pdf.js may transfer the buffer
  return lib.getDocument({ data, isEvalSupported: false, useSystemFonts: true, disableFontFace: isNode, verbosity: 0 }).promise;
}

/** Text of a page, rebuilt in reading order with line breaks. */
export function pageItemsToText(items: any[]): string {
  let out = '';
  let lastY: number | undefined;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const y = it.transform?.[5];
    if (lastY !== undefined && y !== undefined && Math.abs(y - lastY) > 2 && !out.endsWith('\n')) out += '\n';
    out += it.str;
    if (it.hasEOL) out += '\n';
    lastY = y;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function readPdf(bytes: Uint8Array): Promise<ReadResult> {
  const doc = await openPdf(bytes);
  let text = '';
  const segments: ReadResult['segments'] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const t = pageItemsToText(tc.items);
    if (text) text += '\n\n';
    const start = text.length;
    text += t;
    segments.push({ start, end: text.length, label: `p. ${p}`, page: p });
    page.cleanup?.();
  }
  let title: string | undefined;
  let author: string | undefined;
  let date: string | undefined;
  try {
    const md = await doc.getMetadata();
    title = md?.info?.Title || undefined;
    author = md?.info?.Author || undefined;
    const cd = md?.info?.CreationDate as string | undefined;
    const m = cd ? /D:(\d{4})(\d{2})?(\d{2})?/.exec(cd) : null;
    if (m) date = [m[1], m[2], m[3]].filter(Boolean).join('-');
  } catch {
    /* metadata is optional */
  }
  const pageCount = doc.numPages;
  await doc.destroy?.();
  return {
    kind: 'pdf', mime: 'application/pdf', text, segments, pageCount, title,
    citation: { title, authors: author ? [author] : undefined, date },
    meta: { textLayer: text.trim() ? 'yes' : 'no (scanned? run OCR)' },
  };
}

/** Draw one page on a canvas (browser). Returns the canvas size in pixels. */
export async function renderPdfPage(bytes: Uint8Array, pageNo: number, canvas: HTMLCanvasElement, scale: number): Promise<{ width: number; height: number }> {
  const doc = await openPdf(bytes);
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale });
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
  await doc.destroy?.();
  return { width: canvas.width, height: canvas.height };
}

/** Rectangles (fractions of the page, origin top-left) covering text items that overlap [start, end) of the page's text. */
export async function pdfTextRects(bytes: Uint8Array, pageNo: number, start: number, end: number): Promise<{ x: number; y: number; w: number; h: number }[]> {
  const doc = await openPdf(bytes);
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  let pos = 0;
  let lastY: number | undefined;
  for (const it of tc.items as any[]) {
    if (typeof it.str !== 'string') continue;
    const y = it.transform?.[5];
    if (lastY !== undefined && Math.abs(y - lastY) > 2) pos += 1;
    const s = pos;
    pos += it.str.length;
    if (it.hasEOL) pos += 1;
    lastY = y;
    if (pos <= start || s >= end) continue;
    const h = Math.abs(it.transform[3]) || it.height || 10;
    rects.push({ x: it.transform[4] / vp.width, y: (vp.height - y - h) / vp.height, w: (it.width || 0) / vp.width, h: (h * 1.2) / vp.height });
  }
  await doc.destroy?.();
  return rects;
}
