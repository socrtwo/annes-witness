// Write notes into a copy of a .docx: footnotes, endnotes or comments, placed at the end of the paragraph that holds the claim.
import JSZip from 'jszip';
import { escapeXml } from '../readers/common';
import { paragraphText } from '../readers/ooxml';
import { ensureOverride, ensureRel, NS_W, REL } from './ooxml-parts';

type Kind = 'footnote' | 'endnote' | 'comment';

const PART: Record<Kind, { path: string; root: string; el: string; ct: string; rel: string }> = {
  footnote: { path: 'word/footnotes.xml', root: 'w:footnotes', el: 'w:footnote', ct: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml', rel: `${REL}/footnotes` },
  endnote: { path: 'word/endnotes.xml', root: 'w:endnotes', el: 'w:endnote', ct: 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml', rel: `${REL}/endnotes` },
  comment: { path: 'word/comments.xml', root: 'w:comments', el: 'w:comment', ct: 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml', rel: `${REL}/comments` },
};

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

function emptyPart(kind: Kind): string {
  const p = PART[kind];
  const seps =
    kind === 'comment'
      ? ''
      : `<${p.el} w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></${p.el}>` +
        `<${p.el} w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></${p.el}>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<${p.root} xmlns:w="${NS_W}" xmlns:r="${REL}">${seps}</${p.root}>`;
}

function nextId(xml: string, el: string): number {
  let max = 0;
  for (const m of xml.matchAll(new RegExp(`<${el}\\b[^>]*w:id="(-?\\d+)"`, 'g'))) max = Math.max(max, Number(m[1]));
  return max + 1;
}

function noteBody(kind: Kind, id: number, text: string): string {
  const t = `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
  if (kind === 'comment')
    return `<w:comment w:id="${id}" w:author="Anne's Witness" w:initials="AW" w:date="${new Date().toISOString().slice(0, 19)}Z"><w:p>${t}</w:p></w:comment>`;
  const el = PART[kind].el;
  const refTag = kind === 'footnote' ? 'w:footnoteRef' : 'w:endnoteRef';
  return `<${el} w:id="${id}"><w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><${refTag}/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>${t}</w:p></${el}>`;
}

export async function insertNotesIntoDocx(
  bytes: Uint8Array,
  notes: { find: string; note: string }[],
  kind: Kind = 'footnote',
): Promise<{ bytes: Uint8Array; placed: number; missed: string[] }> {
  const zip = await JSZip.loadAsync(bytes);
  let doc = await zip.file('word/document.xml')?.async('string');
  if (!doc) throw new Error('This file has no word/document.xml; it is not a Word document.');
  const p = PART[kind];
  let part = (await zip.file(p.path)?.async('string')) ?? emptyPart(kind);
  let id = nextId(part, p.el);
  let placed = 0;
  const missed: string[] = [];
  for (const n of notes) {
    const target = norm(n.find);
    if (!target) { missed.push(n.find); continue; }
    const re = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
    let m: RegExpExecArray | null;
    let done = false;
    while ((m = re.exec(doc))) {
      const para = m[0];
      if (!norm(paragraphText(para)).includes(target)) continue;
      let out: string;
      if (kind === 'comment') {
        const afterPPr = /^<w:p(?:\s[^>]*)?>(?:\s*<w:pPr>[\s\S]*?<\/w:pPr>)?/.exec(para)![0];
        out = afterPPr + `<w:commentRangeStart w:id="${id}"/>` + para.slice(afterPPr.length, -6) +
          `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r></w:p>`;
      } else {
        const ref = kind === 'footnote' ? 'w:footnoteReference' : 'w:endnoteReference';
        out = para.slice(0, -6) + `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><${ref} w:id="${id}"/></w:r></w:p>`;
      }
      doc = doc.slice(0, m.index) + out + doc.slice(m.index + para.length);
      part = part.replace(`</${p.root}>`, noteBody(kind, id, n.note) + `</${p.root}>`);
      id++;
      placed++;
      done = true;
      break;
    }
    if (!done) missed.push(n.find);
  }
  zip.file('word/document.xml', doc);
  if (placed) {
    zip.file(p.path, part);
    await ensureRel(zip, 'word/_rels/document.xml.rels', p.rel, p.path.replace('word/', ''));
    await ensureOverride(zip, '/' + p.path, p.ct);
  }
  return { bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), placed, missed };
}

/** Remove notes the app inserted (their text starts with "[W"). */
export async function removeWitnessNotes(bytes: Uint8Array): Promise<{ bytes: Uint8Array; removed: number }> {
  const zip = await JSZip.loadAsync(bytes);
  let doc = (await zip.file('word/document.xml')?.async('string')) ?? '';
  let removed = 0;
  for (const kind of ['footnote', 'endnote', 'comment'] as Kind[]) {
    const p = PART[kind];
    let part = await zip.file(p.path)?.async('string');
    if (!part) continue;
    const ids: string[] = [];
    part = part.replace(new RegExp(`<${p.el}\\b([^>]*)>([\\s\\S]*?)</${p.el}>`, 'g'), (whole, attrs: string, inner: string) => {
      const id = /w:id="(-?\d+)"/.exec(attrs)?.[1];
      const text = [...inner.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((x) => x[1]).join('').trim();
      if (id && Number(id) > 0 && text.startsWith('[W')) {
        ids.push(id);
        return '';
      }
      return whole;
    });
    for (const id of ids) {
      if (kind === 'comment') {
        doc = doc
          .replace(new RegExp(`<w:commentRangeStart w:id="${id}"/>`, 'g'), '')
          .replace(new RegExp(`<w:commentRangeEnd w:id="${id}"/>`, 'g'), '')
          .replace(new RegExp(`<w:r>(?:<w:rPr>[\\s\\S]*?</w:rPr>)?<w:commentReference w:id="${id}"/></w:r>`, 'g'), '');
      } else {
        const ref = kind === 'footnote' ? 'w:footnoteReference' : 'w:endnoteReference';
        doc = doc.replace(new RegExp(`<w:r>(?:<w:rPr>(?:(?!</w:rPr>)[\\s\\S])*</w:rPr>)?<${ref} w:id="${id}"/></w:r>`, 'g'), '');
      }
    }
    removed += ids.length;
    zip.file(p.path, part);
  }
  zip.file('word/document.xml', doc);
  return { bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), removed };
}
