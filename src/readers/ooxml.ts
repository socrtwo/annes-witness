// Office Open XML and OpenDocument readers (docx, xlsx, pptx, odt, ods, odp).
import JSZip from 'jszip';
import { attr, collapse, decodeEntities, elements, texts, TextBuilder } from './common';
import type { ReadResult } from './index';

async function file(zip: JSZip, path: string): Promise<string | undefined> {
  return zip.file(path)?.async('string');
}

function coreTitle(core?: string) {
  if (!core) return {};
  const title = texts(core, 'dc:title')[0]?.trim();
  const creator = texts(core, 'dc:creator')[0]?.trim();
  const created = texts(core, 'dcterms:created')[0]?.trim();
  return { title: title || undefined, creator: creator || undefined, created: created || undefined };
}

/** Text of a WordprocessingML paragraph, with tabs and breaks. */
export function paragraphText(p: string): string {
  let out = '';
  const re = /<w:(t|tab|br|cr|noBreakHyphen|softHyphen)\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:t>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p))) {
    if (m[1] === 't') out += decodeEntities(m[2] ?? '');
    else if (m[1] === 'tab') out += '\t';
    else if (m[1] === 'br' || m[1] === 'cr') out += '\n';
    else if (m[1] === 'noBreakHyphen') out += '-';
  }
  return out;
}

export async function readDocx(zip: JSZip): Promise<ReadResult> {
  const doc = (await file(zip, 'word/document.xml')) ?? '';
  const b = new TextBuilder();
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(doc)?.[1] ?? doc;
  let n = 0;
  for (const p of elements(body, 'w:p')) {
    const t = paragraphText(p.inner);
    n++;
    if (t.trim()) b.add(t, { label: `¶ ${n}` });
  }
  for (const [part, name, tag] of [['word/footnotes.xml', 'Footnote', 'w:footnote'], ['word/endnotes.xml', 'Endnote', 'w:endnote']] as const) {
    const xml = await file(zip, part);
    if (!xml) continue;
    for (const fn of elements(xml, tag)) {
      const id = attr(fn.attrs, 'w:id');
      if (!id || Number(id) <= 0) continue;
      const t = elements(fn.inner, 'w:p').map((p) => paragraphText(p.inner)).join('\n').trim();
      if (t) b.add(t, { label: `${name} ${id}` });
    }
  }
  const core = coreTitle(await file(zip, 'docProps/core.xml'));
  return {
    kind: 'document',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    text: b.text, segments: b.segments, title: core.title,
    citation: { title: core.title, authors: core.creator ? [core.creator] : undefined, date: core.created },
  };
}

function colToNum(col: string) {
  let n = 0;
  for (const c of col) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

export async function readXlsx(zip: JSZip): Promise<ReadResult> {
  const wb = (await file(zip, 'xl/workbook.xml')) ?? '';
  const rels = (await file(zip, 'xl/_rels/workbook.xml.rels')) ?? '';
  const relMap: Record<string, string> = {};
  for (const r of elements(rels, 'Relationship')) {
    const id = attr(r.attrs, 'Id');
    const target = attr(r.attrs, 'Target');
    if (id && target) relMap[id] = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  }
  const ssXml = await file(zip, 'xl/sharedStrings.xml');
  const shared = ssXml ? elements(ssXml, 'si').map((si) => texts(si.inner, 't').join('')) : [];
  const b = new TextBuilder('\n');
  for (const s of elements(wb, 'sheet')) {
    const name = attr(s.attrs, 'name') ?? 'Sheet';
    const rid = attr(s.attrs, 'r:id');
    const path = rid ? relMap[rid] : undefined;
    const xml = path ? await file(zip, path) : undefined;
    if (!xml) continue;
    let rowNo = 0;
    for (const row of elements(xml, 'row')) {
      rowNo = Number(attr(row.attrs, 'r') ?? rowNo + 1);
      let first = true;
      let colNo = 0;
      for (const c of elements(row.inner, 'c')) {
        const ref = attr(c.attrs, 'r') ?? '';
        const t = attr(c.attrs, 't');
        let v: string | undefined;
        if (t === 's') v = shared[Number(texts(c.inner, 'v')[0])];
        else if (t === 'inlineStr') v = texts(c.inner, 't').join('');
        else v = texts(c.inner, 'v')[0];
        colNo++;
        if (v === undefined || v === '') continue;
        const m = /^([A-Z]+)(\d+)$/.exec(ref);
        const cell = ref || `R${rowNo}C${colNo}`;
        b.add(v, { label: `${name}!${cell}`, sheet: name, cell, row: m ? Number(m[2]) : rowNo, col: m ? colToNum(m[1]) : colNo }, first ? '\n' : '\t');
        first = false;
      }
    }
  }
  const core = coreTitle(await file(zip, 'docProps/core.xml'));
  return { kind: 'workbook', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', text: b.text, segments: b.segments, title: core.title };
}

export async function readPptx(zip: JSZip): Promise<ReadResult> {
  const slides = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(/(\d+)\.xml/.exec(a)![1]) - Number(/(\d+)\.xml/.exec(b)![1]));
  const b = new TextBuilder();
  for (const p of slides) {
    const n = Number(/(\d+)\.xml/.exec(p)![1]);
    const xml = (await file(zip, p)) ?? '';
    const paras = elements(xml, 'a:p').map((ap) => texts(ap.inner, 'a:t').join('')).filter((t) => t.trim());
    b.add(paras.join('\n'), { label: `Slide ${n}`, page: n });
    const notes = await file(zip, `ppt/notesSlides/notesSlide${n}.xml`);
    if (notes) {
      const nt = elements(notes, 'a:p').map((ap) => texts(ap.inner, 'a:t').join('')).filter((t) => t.trim() && !/^\d+$/.test(t.trim()));
      if (nt.length) b.add(nt.join('\n'), { label: `Slide ${n} notes`, page: n });
    }
  }
  const core = coreTitle(await file(zip, 'docProps/core.xml'));
  return { kind: 'presentation', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', text: b.text, segments: b.segments, title: core.title, pageCount: slides.length };
}

function odfText(xml: string): string {
  return collapse(
    decodeEntities(
      xml
        .replace(/<text:tab\s*\/>/g, '\t')
        .replace(/<text:line-break\s*\/>/g, '\n')
        .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_m, c) => ' '.repeat(Number(c ?? 1)))
        .replace(/<text:note\b[\s\S]*?<\/text:note>/g, '')
        .replace(/<[^>]+>/g, ''),
    ),
  );
}

export async function readOdf(zip: JSZip, mimetype: string): Promise<ReadResult> {
  const content = (await file(zip, 'content.xml')) ?? '';
  const metaXml = await file(zip, 'meta.xml');
  const title = metaXml ? texts(metaXml, 'dc:title')[0] : undefined;
  const b = new TextBuilder(mimetype.includes('spreadsheet') ? '\n' : '\n\n');
  if (mimetype.includes('spreadsheet')) {
    for (const t of elements(content, 'table:table')) {
      const sheet = attr(t.attrs, 'table:name') ?? 'Sheet';
      let r = 0;
      for (const row of elements(t.inner, 'table:table-row')) {
        r++;
        let c = 0;
        let first = true;
        for (const cell of elements(row.inner, 'table:table-cell')) {
          const rep = Number(attr(cell.attrs, 'table:number-columns-repeated') ?? 1);
          const v = elements(cell.inner, 'text:p').map((p) => odfText(p.inner)).join('\n');
          c++;
          if (v) {
            let col = '';
            let n = c;
            while (n > 0) { col = String.fromCharCode(65 + ((n - 1) % 26)) + col; n = Math.floor((n - 1) / 26); }
            b.add(v, { label: `${sheet}!${col}${r}`, sheet, cell: `${col}${r}`, row: r, col: c }, first ? '\n' : '\t');
            first = false;
          }
          c += Math.min(rep, 1000) - 1;
        }
      }
    }
    return { kind: 'workbook', mime: mimetype, text: b.text, segments: b.segments, title };
  }
  const notes: string[] = [];
  for (const nb of elements(content, 'text:note-body')) notes.push(odfText(nb.inner));
  let n = 0;
  for (const p of elements(content.replace(/<text:note\b[\s\S]*?<\/text:note>/g, ''), '(?:text:p|text:h)')) {
    n++;
    const t = odfText(p.inner);
    if (t) b.add(t, { label: `¶ ${n}` });
  }
  notes.forEach((t, i) => b.add(t, { label: `Note ${i + 1}` }));
  const kind = mimetype.includes('presentation') ? 'presentation' : 'document';
  return { kind, mime: mimetype, text: b.text, segments: b.segments, title };
}

export async function readEpub(zip: JSZip): Promise<ReadResult> {
  const container = (await file(zip, 'META-INF/container.xml')) ?? '';
  const opfPath = /full-path="([^"]+)"/.exec(container)?.[1] ?? Object.keys(zip.files).find((p) => p.endsWith('.opf'))!;
  const opf = (await file(zip, opfPath)) ?? '';
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest: Record<string, string> = {};
  for (const it of elements(opf, 'item')) {
    const id = attr(it.attrs, 'id');
    const href = attr(it.attrs, 'href');
    if (id && href) manifest[id] = base + decodeURIComponent(href);
  }
  const { stripHtmlToBlocks } = await import('./common');
  const b = new TextBuilder();
  let ch = 0;
  for (const ref of elements(opf, 'itemref')) {
    const id = attr(ref.attrs, 'idref');
    const path = id ? manifest[id] : undefined;
    const html = path ? await file(zip, path) : undefined;
    if (!html) continue;
    const { title, blocks } = stripHtmlToBlocks(html);
    if (!blocks.length) continue;
    ch++;
    b.add(blocks.join('\n'), { label: title ? `Ch. ${ch}: ${title}` : `Ch. ${ch}`, page: ch });
  }
  const title = texts(opf, 'dc:title')[0];
  const creator = texts(opf, 'dc:creator')[0];
  return {
    kind: 'ebook', mime: 'application/epub+zip', text: b.text, segments: b.segments, title,
    citation: { type: 'book', title, authors: creator ? [creator] : undefined, publisher: texts(opf, 'dc:publisher')[0], date: texts(opf, 'dc:date')[0] },
  };
}
