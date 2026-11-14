// The verification gate: no model involved. A proposal is shown only if the quoted words
// really are in the named source (at the named place, when one is given).
import { findPassage, normalize } from '../core/anchor';
import { Source } from '../core/types';

export interface GateResult {
  ok: boolean;
  start: number;
  end: number;
  how: 'at-location' | 'exact' | 'normalized' | 'failed';
  reason?: string;
}

const MIN_QUOTE = 3;

export function verifyQuote(source: Source, quote: string, at?: { start?: number; end?: number; page?: number }): GateResult {
  const fail = (reason: string): GateResult => ({ ok: false, start: -1, end: -1, how: 'failed', reason });
  const q = (quote ?? '').trim();
  if (normalize(q).length < MIN_QUOTE) return fail('The quoted passage is empty or too short.');
  const text = source.text;
  if (at?.start !== undefined && at.end !== undefined && at.start >= 0 && at.end <= text.length && at.end > at.start) {
    const there = text.slice(at.start, at.end);
    if (normalize(there) === normalize(q) || normalize(there).includes(normalize(q)))
      return { ok: true, start: at.start, end: at.end, how: 'at-location' };
  }
  let lo = 0;
  let hi = text.length;
  if (at?.page) {
    const segs = source.segments.filter((s) => s.page === at.page);
    if (segs.length) {
      lo = Math.min(...segs.map((s) => s.start));
      hi = Math.max(...segs.map((s) => s.end));
    }
  }
  // Exact or whitespace/quote-normalized only: fuzzy matches never pass the gate.
  const r = findPassage(text.slice(lo, hi), { exact: q }, 2);
  if (r && (r.how === 'exact' || r.how === 'normalized'))
    return { ok: true, start: lo + r.start, end: lo + r.end, how: r.how === 'exact' ? 'exact' : 'normalized' };
  return fail(`The quoted words were not found in “${source.title}”${at?.page ? ` on page ${at.page}` : ''}.`);
}

/** Every number in the claim that the passage states must appear in it. */
export function numbersPresent(passage: string, quote: string): boolean {
  const nums = (s: string) => (s.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,]/g, '').replace(/\.$/, ''));
  const p = new Set(nums(passage));
  return nums(quote).every((n) => p.has(n));
}
