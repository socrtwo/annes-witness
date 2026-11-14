// GEDCOM 5.5.1 export of a case's sources and claim citations, for genealogy programs.
// One SOUR record per evidence source; one NOTE record per claim, citing the sources whose
// confirmed ties support it (PAGE = location, DATA TEXT = the quoted passage, QUAY = confidence).
import { CaseData, Confidence, Source } from '../core/types';
import { locate } from '../core/anchor';

const MAX_LINE = 255;
const CHUNK = 200;
const QUAY: Record<Confidence, string> = { 'very-low': '0', low: '1', normal: '2', high: '3', 'very-high': '3' };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Emit one tag with a value, using CONT for line breaks and CONC for long lines (never splitting at a space). */
export function gedLines(level: number, tag: string, value: string | undefined, xref?: string): string[] {
  const head = `${level}${xref ? ` ${xref}` : ''} ${tag}`;
  if (value === undefined || value === '') return [head];
  const clean = value.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/@/g, '@@');
  const out: string[] = [];
  clean.split('\n').forEach((para, pi) => {
    let rest = para;
    let first = true;
    const leadTag = pi === 0 ? null : 'CONT';
    do {
      let take = rest.length <= CHUNK ? rest.length : CHUNK;
      // Do not split on or next to a space (GEDCOM readers may trim it).
      while (take < rest.length && take > 20 && (rest[take] === ' ' || rest[take - 1] === ' ')) take--;
      if (take < rest.length && (rest[take] === '@' && rest[take - 1] === '@')) take--;
      const piece = rest.slice(0, take);
      rest = rest.slice(take);
      if (pi === 0 && first) out.push(`${head} ${piece}`.trimEnd());
      else out.push(`${level + 1} ${first && leadTag ? leadTag : 'CONC'}${piece ? ` ${piece}` : ''}`);
      first = false;
    } while (rest.length);
  });
  for (const l of out) if (new TextEncoder().encode(l).length > MAX_LINE) throw new Error(`GEDCOM line too long: ${l.slice(0, 40)}…`);
  return out;
}

function gedDate(d = new Date()): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function exportGedcomCitations(data: CaseData, opts: { includeConfidential?: boolean; date?: Date } = {}): string {
  const L: string[] = [];
  const push = (...ls: string[]) => L.push(...ls);
  push('0 HEAD', '1 SOUR ANNES_WITNESS', '2 VERS 0.2.0', "2 NAME Anne's Witness", `1 DATE ${gedDate(opts.date)}`, '1 SUBM @U1@',
    '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8');
  if (data.settings.title) push(...gedLines(1, 'NOTE', `Exported from the case “${data.settings.title}”.`));
  push('0 @U1@ SUBM', ...gedLines(1, 'NAME', data.settings.author || "Anne's Witness user"));

  const visible = (s: Source | undefined): s is Source => !!s && s.role === 'source' && (opts.includeConfidential || !s.confidential);
  const sources = Object.values(data.sources).filter(visible);
  const xref = new Map<string, string>();
  sources.forEach((s, i) => xref.set(s.id, `@S${i + 1}@`));
  for (const s of sources) {
    const c = s.citation;
    push(`0 ${xref.get(s.id)} SOUR`);
    push(...gedLines(1, 'TITL', c.title || s.title));
    if (c.authors?.length) push(...gedLines(1, 'AUTH', c.authors.join('; ')));
    const publ = [c.container, c.place, c.publisher, c.year ?? c.date].filter(Boolean).join(', ');
    if (publ) push(...gedLines(1, 'PUBL', publ));
    if (c.repository || c.callNumber) {
      push('1 REPO');
      if (c.repository) push(...gedLines(2, 'NOTE', c.repository));
      if (c.callNumber) push(...gedLines(2, 'CALN', c.callNumber));
    }
    if (s.text.trim()) push(...gedLines(1, 'TEXT', s.text.trim().slice(0, 248)));
    if (c.url) push(...gedLines(1, 'NOTE', `Address: ${c.url}`));
  }

  const claims = Object.values(data.claims).sort((a, b) => a.number - b.number);
  claims.forEach((cl, i) => {
    push(...gedLines(0, 'NOTE', `Claim ${cl.number}: ${cl.text}`, `@N${i + 1}@`));
    for (const t of Object.values(data.ties)) {
      if (t.claimId !== cl.id || t.state !== 'confirmed' || t.kind !== 'supports' || !t.anchorId) continue;
      const a = data.anchors[t.anchorId];
      const s = a ? data.sources[a.sourceId] : undefined;
      if (!a || !visible(s)) continue;
      push(`1 SOUR ${xref.get(s.id)}`);
      const page = locate(s, a.start, a.end);
      if (page) push(...gedLines(2, 'PAGE', page));
      const quote = a.exact || (a.note ?? '');
      if (quote) push('2 DATA', ...gedLines(3, 'TEXT', quote));
      if (t.confidence) push(`2 QUAY ${QUAY[t.confidence]}`);
    }
  });
  push('0 TRLR');
  return L.join('\n') + '\n';
}
