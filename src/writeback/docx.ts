// Write notes into a copy of a .docx: footnotes, endnotes or comments, placed right after the claim's
// words (splitting a run when the claim ends inside it), or at the end of the paragraph when the
// words cross a structure that cannot be split.
import JSZip from 'jszip';
import { escapeXml, decodeEntities } from '../readers/common';
import { paragraphText } from '../readers/ooxml';
import { ensureOverride, ensureRel, NS_W, REL } from './ooxml-parts';

type Kind = 'footnote' | 'endnote' | 'comment';

const PART: Record<Kind, { path: string; root: string; el: string; ct: string; rel: string }> = {
  footnote: { path: 'word/footnotes.xml', root: 'w:footnotes', el: 'w:footnote', ct: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml', rel: `${REL}/footnotes` },
  endnote: { path: 'word/endnotes.xml', root: 'w:endnotes', el: 'w:endnote', ct: 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml', rel: `${REL}/endnotes` },
  comment: { path: 'word/comments.xml', root: 'w:comments', el: 'w:comment', ct: 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml', rel: `${REL}/comments` },
};

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

const MARK = '\u0000AW_MARK\u0000';

/** Normalized text with a map from each normalized character back to its raw index. */
function normMap(raw: string): { norm: string; map: number[] } {
  let out = '';
  const map: number[] = [];
  let space = false;
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i])) { if (!space && out) { out += ' '; map.push(i); } space = true; continue; }
    space = false;
    out += raw[i].toLowerCase();
    map.push(i);
  }
  if (out.endsWith(' ')) { out = out.slice(0, -1); map.pop(); }
  return { norm: out, map };
}

/** Raw [start, end) of the target words in the paragraph's text, or null. */
function locateInParagraph(para: string, target: string): { start: number; end: number } | null {
  const raw = paragraphText(para);
  const { norm: n, map } = normMap(raw);
  const i = n.indexOf(target);
  if (i < 0) return null;
  return { start: map[i], end: map[i + target.length - 1] + 1 };
}

const CHILD = /<w:t(?=[\s>])([^>]*)>([\s\S]*?)<\/w:t>|<w:t(?=[\s/])[^>]*\/>|<w:(tab|br|cr|noBreakHyphen|softHyphen)\b[^>]*\/>|<(w:[A-Za-z]+)\b[^>]*?(?:\/>|>[\s\S]*?<\/\4>)/g;
const childLen = (m: RegExpExecArray) => (m[2] !== undefined ? decodeEntities(m[2]).length : m[3] ? (m[3] === 'softHyphen' ? 0 : 1) : 0);

/**
 * Put MARK into the paragraph so that it sits after `pos` characters of paragraph text, splitting the
 * run there if needed. Returns null when `pos` is not inside a plain run (fields, text boxes…).
 */
function markAt(para: string, pos: number): string | null {
  const runRe = /<w:r(?=[\s>])[^>]*>([\s\S]*?)<\/w:r>/g;
  let consumed = 0;
  let m: RegExpExecArray | null;
  while ((m = runRe.exec(para))) {
    const run = m[0];
    const openTag = /^<w:r(?=[\s>])[^>]*>/.exec(run)![0];
    let inner = m[1];
    const rPr = /^\s*<w:rPr>[\s\S]*?<\/w:rPr>/.exec(inner)?.[0] ?? '';
    inner = inner.slice(rPr.length);
    // Text before this run that is outside runs would desynchronize counting; paragraphText counts only w:t etc.
    const kids: { xml: string; len: number; t?: { attrs: string; text: string } }[] = [];
    CHILD.lastIndex = 0;
    let k: RegExpExecArray | null;
    while ((k = CHILD.exec(inner))) kids.push({ xml: k[0], len: childLen(k), t: k[2] !== undefined ? { attrs: k[1], text: decodeEntities(k[2]) } : undefined });
    const runLen = kids.reduce((a, c) => a + c.len, 0);
    if (pos > consumed + runLen) { consumed += runLen; continue; }
    if (pos === consumed && runLen > 0) {
      // Starts exactly at the start of this run: mark before it.
      return para.slice(0, m.index) + MARK + para.slice(m.index);
    }
    if (pos === consumed + runLen) {
      // Ends exactly at the end of this run: mark after it.
      return para.slice(0, m.index + run.length) + MARK + para.slice(m.index + run.length);
    }
    // Split inside this run.
    let at = pos - consumed;
    const first: string[] = [];
    const second: string[] = [];
    let split = false;
    for (const c of kids) {
      if (split) { second.push(c.xml); continue; }
      if (at >= c.len) { first.push(c.xml); at -= c.len; if (at === 0) split = true; continue; }
      if (!c.t) return null;
      const a = c.t.text.slice(0, at), b = c.t.text.slice(at);
      first.push(`<w:t xml:space="preserve">${escapeXml(a)}</w:t>`);
      second.push(`<w:t xml:space="preserve">${escapeXml(b)}</w:t>`);
      split = true;
    }
    const replacement = `${openTag}${rPr}${first.join('')}</w:r>${MARK}${openTag}${rPr}${second.join('')}</w:r>`;
    return para.slice(0, m.index) + replacement + para.slice(m.index + run.length);
  }
  return null;
}

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
      const loc = locateInParagraph(para, target);
      let out: string | null = null;
      if (kind === 'comment') {
        const withEnd = loc ? markAt(para, loc.end) : null;
        const endMarked = withEnd?.replace(MARK, `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`);
        const withStart = endMarked && loc ? markAt(endMarked, loc.start) : null;
        if (withStart) out = withStart.replace(MARK, `<w:commentRangeStart w:id="${id}"/>`);
        if (!out) {
          const afterPPr = /^<w:p(?:\s[^>]*)?>(?:\s*<w:pPr>[\s\S]*?<\/w:pPr>)?/.exec(para)![0];
          out = afterPPr + `<w:commentRangeStart w:id="${id}"/>` + para.slice(afterPPr.length, -6) +
            `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r></w:p>`;
        }
      } else {
        const ref = kind === 'footnote' ? 'w:footnoteReference' : 'w:endnoteReference';
        const refRun = `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><${ref} w:id="${id}"/></w:r>`;
        const marked = loc ? markAt(para, loc.end) : null;
        out = marked ? marked.replace(MARK, refRun) : para.slice(0, -6) + refRun + '</w:p>';
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
