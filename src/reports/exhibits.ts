// The Exhibit Bundle: one PDF with an index, a cover page per anchored passage, and the anchored pages themselves.
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import type { Anchor, CaseData, Id, Source } from '../core/types';

const PAGE: [number, number] = [612, 792]; // US Letter
const M = 54;

function makeSafe(font: PDFFont) {
  const cache = new Map<string, boolean>();
  const ok = (ch: string) => {
    if (!cache.has(ch)) {
      try {
        font.widthOfTextAtSize(ch, 10);
        cache.set(ch, true);
      } catch {
        cache.set(ch, false);
      }
    }
    return cache.get(ch)!;
  };
  return (s: string) =>
    [...s.replace(/\r/g, '').replace(/\t/g, '    ')]
      .map((ch) => {
        if (ch === '\n' || ok(ch)) return ch;
        const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
        if (base && [...base].every(ok)) return base;
        const map: Record<string, string> = { '−': '-', '→': '->', '←': '<-', '…': '...', ' ': ' ', ' ': ' ', '​': '' };
        return map[ch] ?? '?';
      })
      .join('');
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/ +/)) {
      const cand = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(cand, size) <= width) { line = cand; continue; }
      if (line) out.push(line);
      if (font.widthOfTextAtSize(word, size) > width) {
        let chunk = '';
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > width) { out.push(chunk); chunk = ''; }
          chunk += ch;
        }
        line = chunk;
      } else line = word;
    }
    out.push(line);
  }
  return out;
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont, private safe: (s: string) => string) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage(PAGE);
    this.y = PAGE[1] - M;
  }
  text(s: string, size = 10, opts: { bold?: boolean; indent?: number; color?: [number, number, number]; gap?: number } = {}) {
    const f = opts.bold ? this.bold : this.font;
    const indent = opts.indent ?? 0;
    for (const line of wrap(f, this.safe(s), size, PAGE[0] - 2 * M - indent)) {
      if (this.y - size < M + 20) this.newPage();
      this.y -= size * 1.3;
      this.page.drawText(line, { x: M + indent, y: this.y, size, font: f, color: opts.color ? rgb(...opts.color) : rgb(0, 0, 0) });
    }
    this.y -= opts.gap ?? 2;
  }
  space(n = 8) { this.y -= n; }
}

function sniff(bytes: Uint8Array): 'pdf' | 'png' | 'jpg' | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  // A PDF may start after some junk bytes
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-') ? 'pdf' : null;
}

function citationLine(s: Source): string {
  const c = s.citation;
  return [c.authors?.join('; '), c.title ?? s.title, c.container, c.publisher, c.date ?? c.year, c.repository, c.callNumber, c.url ?? s.url]
    .filter(Boolean)
    .join('. ');
}

function pagesOf(s: Source, a: Anchor): number[] {
  if (a.rect) return [a.rect.page];
  const pages = s.segments.filter((g) => g.page !== undefined && g.start < Math.max(a.end, a.start + 1) && g.end > a.start).map((g) => g.page!);
  return [...new Set(pages)].slice(0, 5);
}

function locLabel(s: Source, a: Anchor): string {
  const segs = s.segments.filter((g) => g.start < Math.max(a.end, a.start + 1) && g.end > a.start);
  if (a.rect) return `p. ${a.rect.page}`;
  if (!segs.length) return '';
  return segs.length === 1 ? segs[0].label : `${segs[0].label}–${segs[segs.length - 1].label}`;
}

export async function buildExhibitBundle(
  data: CaseData,
  blobs: Map<Id, Uint8Array>,
  opts: { anchorIds?: Id[]; bates?: { prefix: string; start: number }; includeConfidential?: boolean; title?: string } = {},
): Promise<{ bytes: Uint8Array; exhibits: { number: number; anchorId: Id; sourceId: Id; claims: number[] }[] }> {
  const ties = Object.values(data.ties).filter((t) => t.anchorId && t.state !== 'rejected');
  let anchorIds = opts.anchorIds ?? [...new Set(ties.filter((t) => t.state === 'confirmed').map((t) => t.anchorId!))];
  anchorIds = anchorIds.filter((id) => {
    const a = data.anchors[id];
    const s = a ? data.sources[a.sourceId] : undefined;
    return a && s && (opts.includeConfidential || !s.confidential);
  });
  anchorIds.sort((x, y) => {
    const a = data.anchors[x];
    const b = data.anchors[y];
    const ta = data.sources[a.sourceId].title;
    const tb = data.sources[b.sourceId].title;
    return ta === tb ? a.start - b.start : ta.localeCompare(tb);
  });

  const doc = await PDFDocument.create();
  doc.setTitle(opts.title ?? `${data.settings.title} — Exhibits`);
  doc.setCreator("Anne's Witness");
  doc.setProducer("Anne's Witness (pdf-lib)");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const safe = makeSafe(font);

  const exhibits = anchorIds.map((id, i) => {
    const a = data.anchors[id];
    const tl = ties.filter((t) => t.anchorId === id);
    const claims = [...new Set(tl.map((t) => data.claims[t.claimId]?.number).filter((n): n is number => n !== undefined))].sort((x, y) => x - y);
    return { number: i + 1, anchorId: id, sourceId: a.sourceId, claims };
  });

  // Index
  const w = new Writer(doc, font, bold, safe);
  w.text(opts.title ?? `${data.settings.title} — Exhibits`, 16, { bold: true, gap: 6 });
  if (data.settings.question) w.text(data.settings.question, 10, { color: [0.3, 0.3, 0.3], gap: 8 });
  w.text(`${exhibits.length} exhibit${exhibits.length === 1 ? '' : 's'}. Prepared ${new Date().toISOString().slice(0, 10)} with Anne's Witness.`, 9, { color: [0.3, 0.3, 0.3], gap: 10 });
  for (const e of exhibits) {
    const s = data.sources[e.sourceId];
    const a = data.anchors[e.anchorId];
    w.text(`Exhibit ${e.number}.  ${s.title}${locLabel(s, a) ? ', ' + locLabel(s, a) : ''}`, 10, { bold: true, gap: 0 });
    w.text(`Claims: ${e.claims.join(', ') || '—'}`, 9, { indent: 18, color: [0.25, 0.25, 0.25], gap: 4 });
  }

  for (const e of exhibits) {
    const s = data.sources[e.sourceId];
    const a = data.anchors[e.anchorId];
    const ew = new Writer(doc, font, bold, safe);
    ew.text(`Exhibit ${e.number}`, 18, { bold: true, gap: 8 });
    ew.text(s.title, 12, { bold: true, gap: 4 });
    const cit = citationLine(s);
    if (cit) ew.text(cit, 9, { color: [0.25, 0.25, 0.25], gap: 4 });
    const loc = locLabel(s, a);
    if (loc) ew.text(`Location: ${loc}`, 9, { gap: 8 });
    if (a.exact) {
      ew.text('Passage', 10, { bold: true, gap: 2 });
      ew.text(`“${a.exact}”`, 10, { indent: 12, gap: 8 });
    }
    if (a.informant) ew.text(`Informant: ${a.informant} (${a.knowledge})`, 9, { gap: 6 });
    ew.text('Tied to', 10, { bold: true, gap: 2 });
    for (const t of ties.filter((x) => x.anchorId === e.anchorId)) {
      const c = data.claims[t.claimId];
      if (!c) continue;
      ew.text(`Claim ${c.number} (${t.kind}${t.state !== 'confirmed' ? ', ' + t.state : ''}${t.tick ? ', ' + t.tick : ''}): ${c.text}`, 9, { indent: 12, gap: 3 });
    }

    const blob = blobs.get(s.id);
    const type = blob ? sniff(blob) : null;
    const red = rgb(0.85, 0.1, 0.1);
    if (blob && type === 'pdf') {
      try {
        const src = await PDFDocument.load(blob, { ignoreEncryption: true });
        const pages = pagesOf(s, a).filter((p) => p >= 1 && p <= src.getPageCount());
        const copied = await doc.copyPages(src, pages.map((p) => p - 1));
        copied.forEach((pg, i) => {
          doc.addPage(pg);
          const { width, height } = pg.getSize();
          if (a.rect && a.rect.page === pages[i])
            pg.drawRectangle({ x: a.rect.x * width, y: height - (a.rect.y + a.rect.h) * height, width: a.rect.w * width, height: a.rect.h * height, borderColor: red, borderWidth: 2 });
          pg.drawText(safe(`Exhibit ${e.number}`), { x: 12, y: height - 18, size: 9, font: bold, color: red });
        });
      } catch (err) {
        ew.text(`The source PDF could not be copied: ${(err as Error).message}`, 9, { color: [0.6, 0, 0] });
      }
    } else if (blob && (type === 'png' || type === 'jpg')) {
      try {
        const img = type === 'png' ? await doc.embedPng(blob) : await doc.embedJpg(blob);
        const pg = doc.addPage(PAGE);
        const maxW = PAGE[0] - 2 * M;
        const maxH = PAGE[1] - 2 * M - 20;
        const sc = Math.min(maxW / img.width, maxH / img.height, 1);
        const iw = img.width * sc;
        const ih = img.height * sc;
        const x0 = (PAGE[0] - iw) / 2;
        const y0 = M + (maxH - ih) / 2;
        pg.drawImage(img, { x: x0, y: y0, width: iw, height: ih });
        if (a.rect) pg.drawRectangle({ x: x0 + a.rect.x * iw, y: y0 + ih - (a.rect.y + a.rect.h) * ih, width: a.rect.w * iw, height: a.rect.h * ih, borderColor: red, borderWidth: 2 });
        pg.drawText(safe(`Exhibit ${e.number} — ${s.title}`), { x: M, y: PAGE[1] - M + 10, size: 10, font: bold, color: red });
      } catch (err) {
        ew.text(`The picture could not be embedded: ${(err as Error).message}`, 9, { color: [0.6, 0, 0] });
      }
    }
  }

  if (opts.bates) {
    doc.getPages().forEach((pg, i) => {
      const label = `${opts.bates!.prefix}${String(opts.bates!.start + i).padStart(6, '0')}`;
      const { width } = pg.getSize();
      pg.drawText(safe(label), { x: width - M - font.widthOfTextAtSize(label, 9), y: 20, size: 9, font });
    });
  }
  return { bytes: await doc.save(), exhibits };
}
