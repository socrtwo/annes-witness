// Citation and annotation formats: BibTeX, RIS, CSL-JSON, W3C Web Annotation, CSV lists, identifiers.
import type { CitationFields, Source } from '../core/types';
import { parseCsv } from '../core/util';

// ---------- BibTeX ----------

const BIB_TYPE: Record<string, CitationFields['type']> = {
  article: 'article', book: 'book', inbook: 'chapter', incollection: 'chapter', inproceedings: 'chapter',
  techreport: 'report', report: 'report', online: 'web', misc: 'other', dataset: 'dataset', letter: 'letter', thesis: 'report', phdthesis: 'report', mastersthesis: 'report',
};

function unbrace(s: string): string {
  return s
    .replace(/\\[`'^"~=.uvHcdbtk]\{?([a-zA-Z])\}?/g, (_m, c) => c)
    .replace(/[{}]/g, '')
    .replace(/\\&/g, '&')
    .replace(/~/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitNames(s: string): string[] {
  return s
    .split(/\s+and\s+/i)
    .map((n) => unbrace(n))
    .filter(Boolean);
}

export function parseBibtex(text: string): CitationFields[] {
  const out: CitationFields[] = [];
  let i = 0;
  while ((i = text.indexOf('@', i)) >= 0) {
    const m = /^@(\w+)\s*[{(]/.exec(text.slice(i));
    if (!m) { i++; continue; }
    const type = m[1].toLowerCase();
    let j = i + m[0].length;
    let depth = 1;
    const start = j;
    while (j < text.length && depth > 0) {
      if (text[j] === '{' || text[j] === '(') depth++;
      else if (text[j] === '}' || text[j] === ')') depth--;
      j++;
    }
    const body = text.slice(start, j - 1);
    i = j;
    if (['comment', 'preamble', 'string'].includes(type)) continue;
    const fields: Record<string, string> = {};
    const comma = body.indexOf(',');
    let k = comma + 1;
    while (k < body.length) {
      const fm = /^\s*([\w-]+)\s*=\s*/.exec(body.slice(k));
      if (!fm) break;
      k += fm[0].length;
      let val = '';
      if (body[k] === '{') {
        let d = 0;
        const s0 = k;
        do {
          if (body[k] === '{') d++;
          else if (body[k] === '}') d--;
          k++;
        } while (k < body.length && d > 0);
        val = body.slice(s0 + 1, k - 1);
      } else if (body[k] === '"') {
        const e = body.indexOf('"', k + 1);
        val = body.slice(k + 1, e < 0 ? body.length : e);
        k = e < 0 ? body.length : e + 1;
      } else {
        const e = body.slice(k).search(/[,\n]/);
        val = body.slice(k, e < 0 ? body.length : k + e);
        k = e < 0 ? body.length : k + e;
      }
      fields[fm[1].toLowerCase()] = val;
      const c = body.indexOf(',', k);
      if (c < 0) break;
      k = c + 1;
    }
    const f = (n: string) => (fields[n] !== undefined ? unbrace(fields[n]) : undefined);
    out.push(clean({
      type: BIB_TYPE[type] ?? 'other',
      authors: fields.author ? splitNames(fields.author) : fields.editor ? splitNames(fields.editor) : undefined,
      title: f('title'),
      container: f('journal') ?? f('booktitle') ?? f('journaltitle'),
      publisher: f('publisher') ?? f('institution') ?? f('school'),
      place: f('address') ?? f('location'),
      year: f('year') ?? f('date')?.slice(0, 4),
      date: f('date'),
      volume: f('volume'),
      issue: f('number') ?? f('issue'),
      pages: f('pages')?.replace(/--/g, '–'),
      url: f('url'),
      doi: f('doi'),
      isbn: f('isbn'),
      accessed: f('urldate'),
      note: f('note'),
    }));
  }
  return out;
}

function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined || o[k] === '') delete o[k];
  return o;
}

function bibKey(c: CitationFields, used: Set<string>): string {
  const last = (c.authors?.[0] ?? c.title ?? 'source').split(/[ ,]/).filter(Boolean)[0] ?? 'source';
  const base = (last.replace(/[^A-Za-z0-9]/g, '') || 'source') + (c.year ?? '');
  let key = base;
  let n = 1;
  while (used.has(key)) key = base + String.fromCharCode(96 + ++n);
  used.add(key);
  return key;
}

const TO_BIB: Record<string, string> = { article: 'article', book: 'book', chapter: 'incollection', report: 'techreport', web: 'online', dataset: 'misc', letter: 'misc', record: 'misc', interview: 'misc', other: 'misc' };

export function toBibtex(sources: Source[]): string {
  const used = new Set<string>();
  const esc = (s: string) => s.replace(/([&%$#_])/g, '\\$1');
  return sources
    .map((s) => {
      const c = { title: s.title, ...s.citation };
      const lines: [string, string | undefined][] = [
        ['author', c.authors?.join(' and ')], ['title', c.title], [c.type === 'article' ? 'journal' : 'booktitle', c.container],
        ['publisher', c.publisher], ['address', c.place], ['year', c.year ?? c.date?.slice(0, 4)], ['volume', c.volume],
        ['number', c.issue], ['pages', c.pages?.replace(/–/g, '--')], ['doi', c.doi], ['isbn', c.isbn], ['url', c.url ?? s.url],
        ['urldate', c.accessed], ['note', c.note],
      ];
      const body = lines.filter(([, v]) => v).map(([k, v]) => `  ${k} = {${esc(v!)}}`).join(',\n');
      return `@${TO_BIB[c.type ?? 'other'] ?? 'misc'}{${bibKey(c, used)},\n${body}\n}`;
    })
    .join('\n\n') + '\n';
}

// ---------- RIS ----------

const RIS_TYPE: Record<string, CitationFields['type']> = {
  JOUR: 'article', BOOK: 'book', CHAP: 'chapter', RPRT: 'report', ELEC: 'web', WEB: 'web', DATA: 'dataset', PCOMM: 'letter', LETT: 'letter', INTV: 'interview', MANSCPT: 'record', GEN: 'other',
};
const TO_RIS: Record<string, string> = { article: 'JOUR', book: 'BOOK', chapter: 'CHAP', report: 'RPRT', web: 'ELEC', dataset: 'DATA', letter: 'PCOMM', interview: 'INTV', record: 'MANSCPT', other: 'GEN' };

export function parseRis(text: string): CitationFields[] {
  const out: CitationFields[] = [];
  let cur: Record<string, string[]> | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9])  - ?(.*)$/.exec(line);
    if (!m) continue;
    const [, tag, val] = m;
    if (tag === 'TY') { cur = { TY: [val.trim()] }; continue; }
    if (!cur) continue;
    if (tag === 'ER') {
      const g = (t: string) => cur![t]?.[0]?.trim();
      const sp = g('SP');
      const ep = g('EP');
      out.push(clean({
        type: RIS_TYPE[g('TY') ?? 'GEN'] ?? 'other',
        authors: [...(cur.AU ?? []), ...(cur.A1 ?? [])].map((a) => a.trim()).filter(Boolean),
        title: g('TI') ?? g('T1'),
        container: g('JO') ?? g('T2') ?? g('JF') ?? g('BT'),
        publisher: g('PB'), place: g('CY'),
        year: (g('PY') ?? g('Y1') ?? g('DA'))?.slice(0, 4),
        date: g('DA'), volume: g('VL'), issue: g('IS'),
        pages: sp ? (ep ? `${sp}–${ep}` : sp) : undefined,
        url: g('UR'), doi: g('DO'), isbn: g('SN'), note: g('N1'), accessed: g('Y2'),
        repository: g('AV'), callNumber: g('CN'),
      }));
      cur = null;
      continue;
    }
    (cur[tag] ??= []).push(val);
  }
  return out.map((c) => (c.authors && !c.authors.length ? (delete c.authors, c) : c));
}

export function toRis(sources: Source[]): string {
  return sources
    .map((s) => {
      const c = { title: s.title, ...s.citation };
      const [sp, ep] = (c.pages ?? '').split(/[–-]/);
      const rows: [string, string | undefined][] = [
        ['TY', TO_RIS[c.type ?? 'other'] ?? 'GEN'], ...(c.authors ?? []).map((a): [string, string] => ['AU', a]),
        ['TI', c.title], ['T2', c.container], ['PB', c.publisher], ['CY', c.place], ['PY', c.year ?? c.date?.slice(0, 4)],
        ['DA', c.date], ['VL', c.volume], ['IS', c.issue], ['SP', sp || undefined], ['EP', ep || undefined], ['DO', c.doi],
        ['SN', c.isbn], ['UR', c.url ?? s.url], ['Y2', c.accessed], ['AV', c.repository], ['CN', c.callNumber], ['N1', c.note],
      ];
      return rows.filter(([, v]) => v).map(([k, v]) => `${k}  - ${v}`).join('\r\n') + '\r\nER  - ';
    })
    .join('\r\n\r\n') + '\r\n';
}

// ---------- CSL-JSON ----------

const CSL_TYPE: Record<string, CitationFields['type']> = {
  'article-journal': 'article', article: 'article', 'article-magazine': 'article', 'article-newspaper': 'article', book: 'book', chapter: 'chapter',
  report: 'report', webpage: 'web', 'post-weblog': 'web', dataset: 'dataset', personal_communication: 'letter', interview: 'interview', manuscript: 'record', document: 'other',
};
const TO_CSL: Record<string, string> = { article: 'article-journal', book: 'book', chapter: 'chapter', report: 'report', web: 'webpage', dataset: 'dataset', letter: 'personal_communication', interview: 'interview', record: 'manuscript', other: 'document' };

function cslDate(d: any): string | undefined {
  const parts = d?.['date-parts']?.[0];
  if (Array.isArray(parts) && parts.length) return parts.map((p: number, i: number) => (i ? String(p).padStart(2, '0') : String(p))).join('-');
  return d?.raw ?? d?.literal;
}

export function parseCslJson(text: string): CitationFields[] {
  const j = JSON.parse(text);
  const items = Array.isArray(j) ? j : j.items ?? [j];
  return items.map((it: any) => {
    const date = cslDate(it.issued);
    return clean({
      type: CSL_TYPE[it.type] ?? 'other',
      authors: (it.author ?? it.editor)?.map((a: any) => a.literal ?? [a.family, a.given].filter(Boolean).join(', ')),
      title: it.title, container: it['container-title'], publisher: it.publisher, place: it['publisher-place'],
      year: date?.slice(0, 4), date, volume: it.volume?.toString(), issue: it.issue?.toString(), pages: it.page,
      url: it.URL, doi: it.DOI, isbn: it.ISBN, accessed: cslDate(it.accessed), repository: it.archive, callNumber: it.call_number ?? it['archive_location'], note: it.note,
    } as CitationFields);
  });
}

export function toCslJson(sources: Source[]): string {
  const dateParts = (d?: string) => {
    if (!d) return undefined;
    const p = d.split(/[-/]/).map(Number).filter((n) => Number.isFinite(n));
    return p.length ? { 'date-parts': [p] } : { raw: d };
  };
  return JSON.stringify(
    sources.map((s) => {
      const c = { title: s.title, ...s.citation };
      return clean({
        id: s.id, type: TO_CSL[c.type ?? 'other'] ?? 'document', title: c.title,
        author: c.authors?.map((a) => (a.includes(',') ? { family: a.split(',')[0].trim(), given: a.split(',').slice(1).join(',').trim() } : { literal: a })),
        'container-title': c.container, publisher: c.publisher, 'publisher-place': c.place,
        issued: dateParts(c.date ?? c.year), volume: c.volume, issue: c.issue, page: c.pages, URL: c.url ?? s.url, DOI: c.doi, ISBN: c.isbn,
        accessed: dateParts(c.accessed), archive: c.repository, archive_location: c.callNumber, note: c.note,
      } as any);
    }),
    null,
    2,
  );
}

// ---------- W3C Web Annotation (and Hypothes.is exports) ----------

export function parseWebAnnotations(json: string): { url: string; exact: string; prefix?: string; suffix?: string; note?: string }[] {
  const j = JSON.parse(json);
  const items: any[] = Array.isArray(j) ? j : j.rows ?? j.items ?? j.first?.items ?? (j.type === 'AnnotationCollection' ? [] : [j]);
  const out: { url: string; exact: string; prefix?: string; suffix?: string; note?: string }[] = [];
  for (const a of items) {
    const targets = Array.isArray(a.target) ? a.target : [a.target];
    for (const t of targets) {
      if (!t) continue;
      const url = typeof t === 'string' ? t : t.source ?? a.uri ?? '';
      const sels = Array.isArray(t.selector) ? t.selector : t.selector ? [t.selector] : [];
      const q = sels.find((s: any) => s.type === 'TextQuoteSelector');
      if (!q?.exact) continue;
      const bodies = Array.isArray(a.body) ? a.body : a.body ? [a.body] : [];
      const note = a.text ?? bodies.map((b: any) => (typeof b === 'string' ? b : b.value)).filter(Boolean).join('\n') ?? undefined;
      out.push(clean({ url, exact: q.exact, prefix: q.prefix, suffix: q.suffix, note: note || undefined }));
    }
  }
  return out;
}

// ---------- CSV lists ----------

function headerIndex(header: string[], names: string[]): number {
  const h = header.map((x) => x.trim().toLowerCase());
  for (const n of names) {
    const i = h.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

export function parseClaimsCsv(text: string): { text: string; kind?: string; group?: string; tags?: string[] }[] {
  const delim = text.split('\n')[0].includes('\t') ? '\t' : ',';
  const rows = parseCsv(text, delim);
  if (!rows.length) return [];
  let ti = headerIndex(rows[0], ['text', 'claim', 'statement', 'sentence']);
  const hasHeader = ti >= 0;
  if (!hasHeader) ti = 0;
  const ki = hasHeader ? headerIndex(rows[0], ['kind', 'type']) : -1;
  const gi = hasHeader ? headerIndex(rows[0], ['group', 'chapter', 'section']) : -1;
  const tg = hasHeader ? headerIndex(rows[0], ['tags', 'tag']) : -1;
  return rows
    .slice(hasHeader ? 1 : 0)
    .filter((r) => (r[ti] ?? '').trim())
    .map((r) => clean({
      text: r[ti].trim(),
      kind: ki >= 0 ? r[ki]?.trim() || undefined : undefined,
      group: gi >= 0 ? r[gi]?.trim() || undefined : undefined,
      tags: tg >= 0 && r[tg]?.trim() ? r[tg].split(/[;|,]/).map((t) => t.trim()).filter(Boolean) : undefined,
    }));
}

export function parseSourcesCsv(text: string): { title: string; url?: string; date?: string; author?: string }[] {
  const delim = text.split('\n')[0].includes('\t') ? '\t' : ',';
  const rows = parseCsv(text, delim);
  if (!rows.length) return [];
  let ti = headerIndex(rows[0], ['title', 'source', 'name']);
  const hasHeader = ti >= 0;
  if (!hasHeader) ti = 0;
  const ui = hasHeader ? headerIndex(rows[0], ['url', 'link', 'address']) : -1;
  const di = hasHeader ? headerIndex(rows[0], ['date', 'year']) : -1;
  const ai = hasHeader ? headerIndex(rows[0], ['author', 'authors', 'creator']) : -1;
  return rows
    .slice(hasHeader ? 1 : 0)
    .filter((r) => (r[ti] ?? '').trim())
    .map((r) => clean({
      title: r[ti].trim(),
      url: ui >= 0 ? r[ui]?.trim() || undefined : undefined,
      date: di >= 0 ? r[di]?.trim() || undefined : undefined,
      author: ai >= 0 ? r[ai]?.trim() || undefined : undefined,
    }));
}

// ---------- Identifiers ----------

function isbnValid(d: string): boolean {
  if (d.length === 10) {
    let s = 0;
    for (let i = 0; i < 10; i++) s += (d[i] === 'X' || d[i] === 'x' ? 10 : Number(d[i])) * (10 - i);
    return s % 11 === 0;
  }
  if (d.length === 13) {
    let s = 0;
    for (let i = 0; i < 13; i++) s += Number(d[i]) * (i % 2 ? 3 : 1);
    return s % 10 === 0;
  }
  return false;
}

export function parseIdentifier(s: string): { type: 'doi' | 'isbn' | 'pmid' | 'url'; value: string } | null {
  const t = s.trim();
  const doi = /(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[^\s"<>]+)/i.exec(t);
  if (doi) return { type: 'doi', value: doi[1].replace(/[.,;]+$/, '') };
  const pmid = /^(?:pmid:?\s*)(\d{1,9})$/i.exec(t) ?? /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i.exec(t);
  if (pmid) return { type: 'pmid', value: pmid[1] };
  const isbnDigits = t.replace(/^isbn(?:-1[03])?:?\s*/i, '').replace(/[\s-]/g, '');
  if (/^(\d{9}[\dXx]|\d{13})$/.test(isbnDigits) && isbnValid(isbnDigits)) return { type: 'isbn', value: isbnDigits.toUpperCase() };
  if (/^https?:\/\/\S+$/i.test(t)) return { type: 'url', value: t };
  if (/^\d{1,8}$/.test(t)) return { type: 'pmid', value: t };
  return null;
}
