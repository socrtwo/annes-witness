// Rule-based capture of checkable statements. No AI.
import { ClaimKind } from '../core/types';
import { splitSentences, Span } from './sentences';
import { parseNumbers } from './numbers';
import { parseDates } from './dates';
import { findNames } from './names';

export interface CaptureItem {
  start: number;
  end: number;
  text: string;
  kind: ClaimKind;
  attributedTo?: string;
}

function sentenceOf(sents: Span[], pos: number): Span | undefined {
  return sents.find((s) => pos >= s.start && pos < s.end);
}

function bySentence(text: string, positions: number[], kind: ClaimKind): CaptureItem[] {
  const sents = splitSentences(text);
  const seen = new Set<number>();
  const out: CaptureItem[] = [];
  for (const p of positions) {
    const s = sentenceOf(sents, p);
    if (!s || seen.has(s.start)) continue;
    seen.add(s.start);
    out.push({ start: s.start, end: s.end, text: s.text, kind });
  }
  return out;
}

export function captureNumbers(text: string): CaptureItem[] {
  const nums = parseNumbers(text).filter((n) => !n.ordinal);
  const dates = parseDates(text);
  // A number that is only a year inside a date is not a figure.
  const figs = nums.filter((n) => !dates.some((d) => n.start >= d.start && n.end <= d.end && !n.currency && !n.percent));
  return bySentence(text, figs.map((n) => n.start), 'number');
}

const SPEECH = '(?:said|says|wrote|writes|stated|states|told|declared|added|noted|argued|claimed|recalled|remarked|explained)';

function attribution(text: string, qStart: number, qEnd: number): string | undefined {
  const r = attribution0(text, qStart, qEnd);
  return r?.replace(/[.,;:]+$/, '');
}

function attribution0(text: string, qStart: number, qEnd: number): string | undefined {
  const NAME = "((?:[A-Z]\\.|[A-Z][\\w'’-]*)(?:\\s+(?:[A-Z]\\.|[A-Z][\\w'’-]*)){0,3})";
  const after = text.slice(qEnd, qEnd + 80);
  let m = after.match(new RegExp(`^[,\\s]*${SPEECH}\\s+${NAME}`));
  if (m) return m[1];
  m = after.match(new RegExp(`^[,\\s]*${NAME}\\s+${SPEECH}`));
  if (m) return m[1];
  const before = text.slice(Math.max(0, qStart - 100), qStart);
  m = before.match(new RegExp(`${NAME}\\s+${SPEECH}(?:\\s+that)?[,:\\s]*$`));
  if (m) return m[1];
  m = before.match(new RegExp(`(?:[Aa]ccording to|[Ii]n the words of)\\s+(?:the\\s+)?${NAME}[,:\\s]*$`));
  if (m) return m[1];
  m = before.match(new RegExp(`${SPEECH}\\s+${NAME}[,:\\s]*$`));
  if (m) return m[1];
  return undefined;
}

export function captureQuotes(text: string): CaptureItem[] {
  const out: CaptureItem[] = [];
  const re = /“([^”]{3,})”|"([^"\n]{3,})"|‘([^’]{12,})’/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const inner = m[1] ?? m[2] ?? m[3];
    const start = m.index + 1;
    const end = start + inner.length;
    // Skip scare quotes of one or two words.
    if (inner.trim().split(/\s+/).length < 3) continue;
    out.push({ start, end, text: inner, kind: 'quotation', attributedTo: attribution(text, m.index, m.index + m[0].length) });
  }
  return out;
}

export function captureDatesAndNames(text: string): CaptureItem[] {
  const dates = parseDates(text).map((d) => d.start);
  const names = findNames(text).map((n) => n.start);
  const d = bySentence(text, dates, 'date');
  const n = bySentence(text, names, 'identity').filter((x) => !d.some((y) => y.start === x.start));
  return [...d, ...n].sort((a, b) => a.start - b.start);
}

/** How much a sentence is worth checking (0..1), with the reasons. Rule-based. */
export function checkWorthiness(sentence: string): { score: number; reasons: string[] } {
  let score = 0.1;
  const reasons: string[] = [];
  const nums = parseNumbers(sentence).filter((n) => !n.ordinal);
  if (nums.length) { score += 0.3; reasons.push('contains a figure'); }
  if (parseDates(sentence).length) { score += 0.2; reasons.push('contains a date'); }
  if (findNames(sentence).length) { score += 0.15; reasons.push('names a person, place or organization'); }
  if (/\b(\w+est|most|least|more\b[^.]*\bthan|less than|fewer than|largest|smallest|first|only|never|always|record|highest|lowest|doubled|tripled|half)\b/i.test(sentence)) {
    score += 0.15; reasons.push('comparison or superlative');
  }
  if (/\b(because|caused|led to|resulted in|due to|therefore|so that|increase[sd]?|decrease[sd]?|rose|fell|grew)\b/i.test(sentence)) {
    score += 0.1; reasons.push('cause or change');
  }
  if (/[“"]/.test(sentence)) { score += 0.15; reasons.push('quotation'); }
  if (/\b(may|might|perhaps|possibly|probably|seems?|appears?|suggests?|could)\b/i.test(sentence)) {
    score -= 0.1; reasons.push('hedged');
  }
  if (/\b(I|we)\s+(think|believe|feel|hope|suppose)\b|\b(in my (view|opinion)|beautiful|wonderful|terrible|should)\b/i.test(sentence)) {
    score -= 0.2; reasons.push('opinion');
  }
  if (sentence.trim().endsWith('?')) { score -= 0.2; reasons.push('question'); }
  return { score: Math.max(0, Math.min(1, +score.toFixed(2))), reasons };
}

const VERB = /\b(is|was|were|are|be|been|had|has|have|did|does|do|died|born|married|moved|lived|worked|became|went|made|said|wrote|bought|sold|built|won|lost|rose|fell|grew|reported|founded|served|left|returned|arrived|owned|paid|received|\w+ed)\b/i;

/** Split a compound sentence into simpler statements, conservatively. */
export function atomize(sentence: string): string[] {
  const s = sentence.trim().replace(/[.!]+$/, '');
  const parts = s.split(/;\s+|,\s+and\s+|,\s+but\s+|\s+and\s+(?=(?:he|she|they|it|we|the|his|her|their)\b)/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2 || !parts.every((p) => VERB.test(p) && p.split(/\s+/).length >= 3)) return [sentence.trim()];
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1) + '.');
}
