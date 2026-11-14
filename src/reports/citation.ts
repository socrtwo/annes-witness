// Citation formatting: an author-date style and a notes style, written for this app.
import { CitationFields, Source } from '../core/types';
import { parseCsl, cslBibliography, cslCitation, CslStyle } from './csl';

// A CSL style loaded by the user (Report ▸ Citation Style) replaces the two built-in styles.
let active: { xml: string; style: CslStyle } | null = null;
export function setCslStyle(xml: string | undefined | null) {
  if (!xml) { active = null; return; }
  if (active?.xml === xml) return;
  try { active = { xml, style: parseCsl(xml) }; } catch { active = null; }
}

function authorList(a: string[] | undefined, inverted: boolean): string {
  if (!a?.length) return '';
  const inv = (n: string) => {
    if (n.includes(',')) return n;
    const parts = n.trim().split(/\s+/);
    return parts.length > 1 ? `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}` : n;
  };
  const names = a.map((n, i) => (inverted && i === 0 ? inv(n) : n.includes(',') ? n.split(',').reverse().map((x) => x.trim()).join(' ') : n));
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length > 3) return `${names[0]} et al.`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

const dot = (s: string) => (s && !/[.?!]$/.test(s) ? s + '.' : s);

export function formatCitation(f: CitationFields, style: 'author-date' | 'notes', fallbackTitle = ''): string {
  if (active) {
    const ff = f.title ? f : { ...f, title: fallbackTitle || 'Untitled' };
    try { return style === 'notes' ? cslCitation(active.style, ff) : cslBibliography(active.style, ff); } catch { /* fall back to the built-in style */ }
  }
  const title = f.title || fallbackTitle || 'Untitled';
  const year = f.year || f.date?.match(/\d{4}/)?.[0] || 'n.d.';
  const quoted = ['article', 'chapter', 'web', 'record', 'letter', 'interview'].includes(f.type ?? '');
  const t = quoted ? `“${title}”` : `*${title}*`;
  const parts: string[] = [];
  if (style === 'author-date') {
    const au = authorList(f.authors, true);
    if (au) parts.push(dot(`${au} (${year})`), dot(t));
    else parts.push(dot(`${t} (${year})`));
    if (f.container) parts.push(dot(`*${f.container}*${f.volume ? ` ${f.volume}` : ''}${f.issue ? `(${f.issue})` : ''}${f.pages ? `: ${f.pages}` : ''}`));
    const pub = [f.place, f.publisher].filter(Boolean).join(': ');
    if (pub) parts.push(dot(pub));
    if (f.repository) parts.push(dot([f.repository, f.callNumber].filter(Boolean).join(', ')));
    if (f.doi) parts.push(`https://doi.org/${f.doi.replace(/^https?:\/\/doi.org\//, '')}`);
    else if (f.url) parts.push(f.url + (f.accessed ? ` (accessed ${f.accessed})` : ''));
    if (f.note) parts.push(dot(f.note));
  } else {
    const au = authorList(f.authors, false);
    const seg: string[] = [];
    if (au) seg.push(au);
    seg.push(t);
    if (f.container) seg.push(`*${f.container}*${f.volume ? ` ${f.volume}` : ''}${f.issue ? `, no. ${f.issue}` : ''}`);
    const pub = [f.place, f.publisher].filter(Boolean).join(': ');
    seg.push(`(${[pub, f.date || f.year].filter(Boolean).join(', ') || 'n.d.'})`);
    if (f.pages) seg.push(f.pages);
    if (f.repository) seg.push([f.repository, f.callNumber].filter(Boolean).join(', '));
    if (f.doi) seg.push(`https://doi.org/${f.doi}`);
    else if (f.url) seg.push(f.url + (f.accessed ? `, accessed ${f.accessed}` : ''));
    parts.push(dot(seg.join(', ').replace(/, \(/, ' (')));
    if (f.note) parts.push(dot(f.note));
  }
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function sourceCitation(s: Source, style: 'author-date' | 'notes'): string {
  return formatCitation({ ...s.citation, title: s.citation.title || s.title, date: s.citation.date || s.dateMade }, style, s.title);
}

export function formatBibliography(sources: Source[], style: 'author-date' | 'notes'): string[] {
  const key = (s: Source) => ((s.citation.authors?.[0] ?? '').split(/\s+/).pop() ?? '') + (s.citation.title || s.title);
  return [...sources].sort((a, b) => key(a).localeCompare(key(b))).map((s) => sourceCitation(s, style));
}
