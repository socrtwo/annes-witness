// Tabular and list reports.
import { CaseData, STATUS_LABEL, Id } from '../core/types';
import { StatusResult } from '../core/status';
import { locate } from '../core/anchor';
import { toCsv } from '../core/util';
import { families } from '../core/lineage';
import { Finding } from '../checks';
import { formatBibliography, sourceCitation } from './citation';
import { claimsSorted } from './common';
import { dateKey } from '../text/dates';

export function claimTableCsv(d: CaseData, statuses: Record<Id, StatusResult>, includeConfidential = false): string {
  const rows: unknown[][] = [['Claim', 'Text', 'Kind', 'Status', 'Supporting sources', 'Contradicting sources', 'Independent families', 'Ticks', 'Owner', 'Importance', 'Document', 'Location in document', 'Verdict', 'Reviewed']];
  for (const c of claimsSorted(d)) {
    const st = statuses[c.id];
    const ties = Object.values(d.ties).filter((t) => t.claimId === c.id && t.state === 'confirmed');
    const names = (ids: Id[]) => ids.filter((id) => includeConfidential || !d.sources[id]?.confidential).map((id) => d.sources[id]?.title).join('; ');
    const doc = c.doc ? d.sources[c.doc.documentId] : undefined;
    const reviewed = Object.values(d.signoffs).filter((s) => s.claimId === c.id && s.kind === 'reviewed').map((s) => `${s.by} ${s.at.slice(0, 10)}`).join('; ');
    rows.push([
      c.number, c.text, c.kind, st ? STATUS_LABEL[st.status] : 'Open', names(st?.supportingSources ?? []), names(st?.contradictingSources ?? []),
      st?.independentFamilies ?? 0, ties.map((t) => t.tick).filter(Boolean).join(' '), c.owner ?? '', c.importance, doc?.title ?? '',
      doc && c.doc ? locate(doc, c.doc.start, c.doc.end) : '', c.verdict ?? '', reviewed,
    ]);
  }
  return toCsv(rows);
}

export function openItems(d: CaseData, statuses: Record<Id, StatusResult>, findings: Finding[]): string {
  const md = [`# Open items: ${d.settings.title}`, ''];
  for (const s of ['open', 'disputed', 'stale'] as const) {
    const cs = claimsSorted(d).filter((c) => statuses[c.id]?.status === s);
    if (!cs.length) continue;
    md.push(`## ${STATUS_LABEL[s]} (${cs.length})`, '', ...cs.map((c) => `- Claim ${c.number}: ${c.text}${c.owner ? ` (owner: ${c.owner})` : ''}${c.due ? ` (due ${c.due})` : ''}`), '');
  }
  const errs = findings.filter((f) => f.severity !== 'info');
  if (errs.length) md.push(`## Failing checks (${errs.length})`, '', ...errs.map((f) => `- [${f.severity}] ${f.message}`), '');
  const todos = Object.values(d.todos).filter((t) => !t.done);
  if (todos.length) md.push(`## To-do (${todos.length})`, '', ...todos.map((t) => `- ${t.text}${t.claimId && d.claims[t.claimId] ? ` (claim ${d.claims[t.claimId].number})` : ''}${t.ai ? ' [AI suggestion]' : ''}`), '');
  const comments = Object.values(d.comments).filter((c) => !c.resolved);
  if (comments.length) md.push(`## Unresolved comments (${comments.length})`, '', ...comments.map((c) => `- ${c.author}: ${c.text}`), '');
  if (md.length === 2) md.push('Nothing is open.');
  return md.join('\n');
}

export function sourceList(d: CaseData, style: 'author-date' | 'notes' = d.settings.citationStyle, includeConfidential = false): string {
  const srcs = Object.values(d.sources).filter((s) => s.role === 'source' && (includeConfidential || !s.confidential));
  return [`# Sources: ${d.settings.title}`, '', ...formatBibliography(srcs, style).map((b) => `- ${b}`)].join('\n');
}

export function researchLogReport(d: CaseData): string {
  const entries = Object.values(d.log).sort((a, b) => a.date.localeCompare(b.date));
  const md = [`# Research log: ${d.settings.title}`, '', '| Date | Kind | Searched | Where | For | Result | Claim | Note |', '|---|---|---|---|---|---|---|---|'];
  const cell = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  for (const e of entries)
    md.push(`| ${cell(e.date)} | ${cell(e.kind ?? 'search')} | ${cell(e.searched)} | ${cell(e.where)} | ${cell(e.forWhat)} | ${cell(e.result)} | ${e.claimId && d.claims[e.claimId] ? d.claims[e.claimId].number : ''} | ${cell(e.note)} |`);
  if (!entries.length) md.push('', 'No searches recorded.');
  return md.join('\n');
}

export function confidentialLog(d: CaseData): string {
  const srcs = Object.values(d.sources).filter((s) => s.confidential);
  const md = [`# Confidential sources withheld: ${d.settings.title}`, '', 'These sources are left out of exports, exhibits and every AI request.', ''];
  for (const s of srcs) {
    const uses = Object.values(d.anchors).filter((a) => a.sourceId === s.id).length;
    md.push(`- ${s.title}${s.dateMade ? ` (${s.dateMade})` : ''}: ${uses} anchor(s)${s.reliability ? `; ${s.reliability}` : ''}`);
  }
  if (!srcs.length) md.push('None.');
  return md.join('\n');
}

export function hashReport(d: CaseData): string {
  const rows: unknown[][] = [['Source', 'Role', 'File', 'Size', 'File SHA-256', 'Content SHA-256', 'Embedded', 'Added']];
  for (const s of Object.values(d.sources)) rows.push([s.title, s.role, s.fileName ?? '', s.size ?? '', s.fileHash ?? '', s.contentHash ?? '', s.embedded ? 'yes' : 'no', s.added]);
  return toCsv(rows);
}

export function chronology(d: CaseData): string {
  const items: { key: number; label: string; text: string }[] = [];
  for (const c of claimsSorted(d)) {
    const k = dateKey(c.text);
    if (k !== null) items.push({ key: k, label: `Claim ${c.number}`, text: c.text });
  }
  for (const s of Object.values(d.sources)) {
    const k = dateKey(s.dateMade ?? s.citation.date ?? s.citation.year);
    if (k !== null) items.push({ key: k, label: `Source made`, text: `${s.title} (${s.dateMade ?? s.citation.date ?? s.citation.year})` });
  }
  items.sort((a, b) => a.key - b.key);
  return [`# Chronology: ${d.settings.title}`, '', ...items.map((i) => `- **${i.label}**: ${i.text}`)].join('\n');
}

export function citationContext(d: CaseData, style: 'author-date' | 'notes' = d.settings.citationStyle): string {
  const md = [`# How each source is used: ${d.settings.title}`, ''];
  for (const s of Object.values(d.sources).filter((x) => x.role === 'source')) {
    const ties = Object.values(d.ties).filter((t) => t.state === 'confirmed' && t.anchorId && d.anchors[t.anchorId]?.sourceId === s.id);
    const count = (k: string) => ties.filter((t) => t.kind === k).length;
    md.push(`## ${s.title}`, '', sourceCitation(s, style), '', `Supporting ${count('supports')} · Contradicting ${count('contradicts')} · Mentioning ${count('mentions')} · Absence ${count('absence')}`, '');
    for (const t of ties) {
      const c = d.claims[t.claimId];
      const a = d.anchors[t.anchorId!];
      if (c) md.push(`- ${t.kind} claim ${c.number} (${locate(s, a.start, a.end) || 'passage'}): ${c.text}`);
    }
    md.push('');
  }
  return md.join('\n');
}

const FREQ_STOP = new Set('the of and a to in is was that for on with as by at it be this from or an were are which his her their had has have not but he she they its been also than'.split(' '));

export function wordFrequency(texts: string[], top = 100): { word: string; count: number }[] {
  const m = new Map<string, number>();
  for (const t of texts)
    for (const w of t.toLowerCase().match(/[\p{L}][\p{L}'’-]+/gu) ?? []) {
      if (w.length < 3 || FREQ_STOP.has(w)) continue;
      m.set(w, (m.get(w) ?? 0) + 1);
    }
  return [...m.entries()].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)).slice(0, top);
}

export function independenceSummary(d: CaseData, claimId: Id): string[][] {
  const srcs = [...new Set(Object.values(d.ties).filter((t) => t.claimId === claimId && t.state === 'confirmed' && t.anchorId).map((t) => d.anchors[t.anchorId!]?.sourceId).filter(Boolean))] as Id[];
  return families(d, srcs).map((g) => g.map((id) => d.sources[id]?.title ?? id));
}
