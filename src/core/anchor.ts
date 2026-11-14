// Anchors: exact passage with prefix and suffix, found again after a source changes.
import { Anchor, Source } from './types';

export const CONTEXT = 32;

export function makeSelector(text: string, start: number, end: number) {
  return {
    start,
    end,
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
  };
}

/** Collapse whitespace and unify quotes and dashes, keeping a map back to original offsets. */
export function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < s.length; i++) {
    let c = s[i];
    if (/\s/.test(c)) {
      if (prevSpace) continue;
      c = ' ';
      prevSpace = true;
    } else prevSpace = false;
    c = c.replace(/[‘’‛′]/, "'").replace(/[“”„″]/, '"').replace(/[‐‑‒–—―]/, '-').replace(/­/, '');
    if (!c) continue; // a removed character (soft hyphen) must not add an entry to the offset map
    norm += c.toLowerCase();
    map.push(i);
  }
  map.push(s.length);
  return { norm, map };
}

export function normalize(s: string): string {
  return normalizeWithMap(s).norm.trim();
}

function allIndexes(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    out.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return out;
}

function commonSuffixLen(a: string, b: string) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function commonPrefixLen(a: string, b: string) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

export interface FindResult {
  start: number;
  end: number;
  how: 'unchanged' | 'exact' | 'normalized' | 'fuzzy';
  score: number;
}

/** Bigram Dice similarity (0..1). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let inter = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) { grams.set(g, n - 1); inter++; }
  }
  return (2 * inter) / (a.length + b.length - 2);
}

/**
 * Find an anchored passage in (possibly changed) text.
 * Order: same offsets; exact text (best context if several); normalized text; fuzzy window.
 */
export function findPassage(
  text: string,
  sel: { start?: number; end?: number; exact: string; prefix?: string; suffix?: string },
  fuzzyThreshold = 0.8,
): FindResult | null {
  const { exact } = sel;
  if (!exact) return null;
  if (sel.start !== undefined && text.slice(sel.start, sel.end) === exact)
    return { start: sel.start, end: sel.end!, how: 'unchanged', score: 1 };
  const pick = (cands: number[], len: number, how: FindResult['how'], hay: string, pre: string, suf: string) => {
    let best = cands[0];
    let bestScore = -1;
    for (const c of cands) {
      const s =
        commonSuffixLen(hay.slice(Math.max(0, c - pre.length), c), pre) +
        commonPrefixLen(hay.slice(c + len, c + len + suf.length), suf) -
        (sel.start !== undefined ? Math.min(Math.abs(c - sel.start) / 1e6, 0.5) : 0);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return { pos: best, how };
  };
  const ex = allIndexes(text, exact);
  if (ex.length) {
    const p = pick(ex, exact.length, 'exact', text, sel.prefix ?? '', sel.suffix ?? '');
    return { start: p.pos, end: p.pos + exact.length, how: 'exact', score: 1 };
  }
  const { norm, map } = normalizeWithMap(text);
  const nx = normalize(exact);
  if (!nx) return null;
  const nc = allIndexes(norm, nx);
  if (nc.length) {
    const p = pick(nc, nx.length, 'normalized', norm, normalize(sel.prefix ?? ''), normalize(sel.suffix ?? ''));
    return { start: map[p.pos], end: map[p.pos + nx.length - 1] + 1, how: 'normalized', score: 1 };
  }
  // Fuzzy: slide a window of the passage's length over the normalized text, seeded by rare words.
  const words = nx.split(' ').filter((w) => w.length > 3).sort((a, b) => b.length - a.length).slice(0, 4);
  const seeds = new Set<number>();
  for (const w of words) for (const i of allIndexes(norm, w)) seeds.add(i);
  let best: { pos: number; score: number; len: number } | null = null;
  const L = nx.length;
  for (const s of seeds) {
    for (let off = -L; off <= 0; off += Math.max(1, Math.floor(L / 12))) {
      const pos = Math.max(0, s + off);
      for (const len of [L, Math.round(L * 0.9), Math.round(L * 1.1)]) {
        const cand = norm.slice(pos, pos + len);
        const sc = similarity(cand, nx);
        if (!best || sc > best.score) best = { pos, score: sc, len };
      }
    }
  }
  if (best && best.score >= fuzzyThreshold) {
    const endIdx = Math.min(best.pos + best.len, norm.length);
    return { start: map[best.pos], end: map[Math.max(best.pos, endIdx - 1)] + 1, how: 'fuzzy', score: best.score };
  }
  return null;
}

export interface ReanchorResult {
  anchorId: string;
  from: { start: number; end: number };
  to: { start: number; end: number } | null;
  how: FindResult['how'] | 'broken';
  score: number;
}

/** Re-find every anchor of a source in its new text. Pure: returns proposed moves. */
export function reanchor(anchors: Anchor[], newText: string): ReanchorResult[] {
  return anchors
    .filter((a) => a.exact)
    .map((a) => {
      const r = findPassage(newText, a);
      return {
        anchorId: a.id,
        from: { start: a.start, end: a.end },
        to: r ? { start: r.start, end: r.end } : null,
        how: r ? r.how : 'broken',
        score: r?.score ?? 0,
      };
    });
}

/** The segment label(s) an anchor falls in ("p. 3", "Sheet1!B4"). */
export function locate(source: Source, start: number, end = start): string {
  const segs = source.segments.filter((s) => s.start < Math.max(end, start + 1) && s.end > start);
  if (!segs.length) return '';
  if (segs.length === 1) return segs[0].label;
  return `${segs[0].label}–${segs[segs.length - 1].label}`;
}

export function segmentAt(source: Source, pos: number) {
  return source.segments.find((s) => pos >= s.start && pos < s.end);
}
