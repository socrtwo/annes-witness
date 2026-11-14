// Review statistics: agreement between two readers, and sampling claims for review.
import { CaseData, Id, TieKind } from '../core/types';
import { mainFigure } from '../text/numbers';

export function agreement(a: Record<Id, TieKind | null>, b: Record<Id, TieKind | null>) {
  const ids = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const lab = (v: TieKind | null | undefined) => v ?? 'none';
  const cats = [...new Set(ids.flatMap((id) => [lab(a[id]), lab(b[id])]))].sort();
  const table: Record<string, Record<string, number>> = {};
  for (const x of cats) { table[x] = {}; for (const y of cats) table[x][y] = 0; }
  for (const id of ids) table[lab(a[id])][lab(b[id])]++;
  const n = ids.length;
  if (!n) return { kappa: NaN, observed: NaN, expected: NaN, n, table };
  const observed = cats.reduce((s, c) => s + table[c][c], 0) / n;
  const expected = cats.reduce((s, c) => {
    const ra = cats.reduce((t, y) => t + table[c][y], 0) / n;
    const rb = cats.reduce((t, x) => t + table[x][c], 0) / n;
    return s + ra * rb;
  }, 0);
  const kappa = expected === 1 ? 1 : (observed - expected) / (1 - expected);
  return { kappa, observed, expected, n, table };
}

/** Mulberry32: a small seeded PRNG so a sample can be reproduced. */
export function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleClaims(d: CaseData, n: number, method: 'random' | 'monetary', seed: number): Id[] {
  const rand = prng(seed);
  const claims = Object.values(d.claims).filter((c) => !c.setAside).sort((a, b) => a.number - b.number);
  if (method === 'random') {
    const ids = claims.map((c) => c.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids.slice(0, n);
  }
  // Monetary-unit sampling: systematic selection over cumulative absolute amounts, random start.
  const items = claims.map((c) => ({ id: c.id, w: Math.abs(mainFigure(c.text)?.value ?? 0) })).filter((x) => x.w > 0);
  const total = items.reduce((s, x) => s + x.w, 0);
  if (!total || n <= 0) return [];
  const interval = total / n;
  let next = rand() * interval;
  let cum = 0;
  const out: Id[] = [];
  for (const it of items) {
    cum += it.w;
    while (next < cum) {
      if (!out.includes(it.id)) out.push(it.id);
      next += interval;
    }
  }
  return out;
}
