// Read source records and citations from a GEDCOM file (5.5, 5.5.1, 7.0).
export interface GedSource { xref: string; title: string; author?: string; publication?: string; repository?: string; text?: string; note?: string }
export interface GedClaim { text: string; kind: string; citations: { xref: string; page?: string; quality?: string }[] }

interface Line { level: number; xref?: string; tag: string; value: string }

function parse(text: string): Line[] {
  return text.replace(/^﻿/, '').split(/\r?\n|\r/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/);
    return m ? { level: Number(m[1]), xref: m[2], tag: m[3], value: m[4] ?? '' } : { level: 99, tag: 'BAD', value: l };
  });
}

const EVENTS: Record<string, string> = { BIRT: 'was born', DEAT: 'died', MARR: 'married', BAPM: 'was baptized', CHR: 'was christened', BURI: 'was buried', RESI: 'lived', OCCU: 'worked as' };

export function parseGedcomCitations(text: string): { sources: GedSource[]; claims: GedClaim[] } {
  const lines = parse(text);
  const sources: GedSource[] = [];
  const claims: GedClaim[] = [];
  const names = new Map<string, string>();
  // First pass: names and sources.
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.level !== 0) continue;
    const kids: Line[] = [];
    for (let j = i + 1; j < lines.length && lines[j].level > 0; j++) kids.push(lines[j]);
    if (l.tag === 'INDI' && l.xref) {
      const nm = kids.find((k) => k.level === 1 && k.tag === 'NAME')?.value.replace(/\//g, '').replace(/\s+/g, ' ').trim();
      if (nm) names.set(l.xref, nm);
    }
    if (l.tag === 'SOUR' && l.xref) {
      const get = (t: string) => kids.filter((k) => k.level === 1 && k.tag === t).map((k) => k.value).join(' ') || undefined;
      sources.push({ xref: l.xref, title: get('TITL') ?? get('ABBR') ?? l.xref, author: get('AUTH'), publication: get('PUBL'), repository: get('REPO'), text: get('TEXT'), note: get('NOTE') });
    }
  }
  // Second pass: facts with citations.
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.level !== 0 || l.tag !== 'INDI' || !l.xref) continue;
    const who = names.get(l.xref) ?? l.xref;
    for (let j = i + 1; j < lines.length && lines[j].level > 0; j++) {
      const ev = lines[j];
      if (ev.level !== 1 || !(ev.tag in EVENTS || ev.tag === 'NAME')) continue;
      let date = '', place = '';
      const cits: GedClaim['citations'] = [];
      for (let k = j + 1; k < lines.length && lines[k].level > 1; k++) {
        const x = lines[k];
        if (x.level === 2 && x.tag === 'DATE') date = x.value;
        if (x.level === 2 && x.tag === 'PLAC') place = x.value;
        if (x.level === 2 && x.tag === 'SOUR' && /^@.+@$/.test(x.value)) {
          const c: GedClaim['citations'][number] = { xref: x.value };
          for (let m = k + 1; m < lines.length && lines[m].level > 2; m++) {
            if (lines[m].tag === 'PAGE') c.page = lines[m].value;
            if (lines[m].tag === 'QUAY') c.quality = lines[m].value;
          }
          cits.push(c);
        }
      }
      if (!cits.length) continue;
      const textOut = ev.tag === 'NAME' ? `${who}'s name is recorded as ${ev.value.replace(/\//g, '')}.` : `${who} ${EVENTS[ev.tag]}${ev.tag === 'OCCU' && ev.value ? ` ${ev.value}` : ''}${date ? ` ${/^\d/.test(date) ? 'on' : ''} ${date}`.replace('  ', ' ') : ''}${place ? ` in ${place}` : ''}.`;
      claims.push({ text: textOut.replace(/\s+/g, ' '), kind: ev.tag === 'NAME' ? 'identity' : date ? 'date' : 'fact', citations: cits });
    }
  }
  return { sources, claims };
}
