// On-device passage selection (BM25 with boosts for exact numbers and capitalized names).
// Lets AI commands send a few passages instead of whole sources: the "Passages only" privacy level.
import { Source } from '../core/types';
import { locate } from '../core/anchor';

export interface Chunk { sourceId: string; start: number; end: number; text: string; label: string }

const STOP = new Set('a an and are as at be been but by for from had has have he her his i in into is it its of on or she that the their there they this to was were which who will with not no yes you your we our'.split(' '));

export function tokens(s: string): string[] {
  return (s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+(?:[.,][0-9]+)*/g) ?? [])
    .map((t) => t.replace(/,/g, ''))
    .filter((t) => !STOP.has(t) && (t.length > 1 || /\d/.test(t)));
}

/** Split a source into overlapping chunks of about `size` characters, cut at sentence or line ends. */
export function chunkSource(s: Source, size = 900, overlap = 200): Chunk[] {
  const out: Chunk[] = [];
  const t = s.text;
  if (!t.trim()) return out;
  let start = 0;
  while (start < t.length) {
    let end = Math.min(t.length, start + size);
    if (end < t.length) {
      const window = t.slice(start + Math.floor(size * 0.6), end);
      const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('\n'));
      if (cut > 0) end = start + Math.floor(size * 0.6) + cut + 1;
    }
    out.push({ sourceId: s.id, start, end, text: t.slice(start, end), label: locate(s, start, end) });
    if (end >= t.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out;
}

export class PassageIndex {
  chunks: Chunk[] = [];
  sources = new Map<string, Source>();
  private tf: Map<string, number>[] = [];
  private df = new Map<string, number>();
  private len: number[] = [];
  private avg = 1;
  constructor(sources: Source[], size?: number) {
    for (const s of sources) {
      this.sources.set(s.id, s);
      for (const c of chunkSource(s, size)) this.add(c);
    }
    this.avg = this.len.reduce((a, b) => a + b, 0) / Math.max(1, this.len.length);
  }
  private add(c: Chunk) {
    const tf = new Map<string, number>();
    const ts = tokens(c.text);
    for (const t of ts) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.chunks.push(c);
    this.tf.push(tf);
    this.len.push(ts.length);
  }
  search(query: string, k = 4): { chunk: Chunk; score: number }[] {
    const q = [...new Set(tokens(query))];
    const N = this.chunks.length;
    const k1 = 1.2, b = 0.75;
    const scored = this.chunks.map((chunk, i) => {
      let s = 0;
      for (const t of q) {
        const f = this.tf[i].get(t);
        if (!f) continue;
        const idf = Math.log(1 + (N - (this.df.get(t) ?? 0) + 0.5) / ((this.df.get(t) ?? 0) + 0.5));
        const w = /\d/.test(t) ? 2.5 : 1; // numbers and years matter most for checking facts
        s += w * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * this.len[i]) / this.avg)));
      }
      return { chunk, score: s };
    });
    return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
  }
}

/** The passages to send for a set of queries: top-k per query, merged per source where they overlap, within a size budget. */
export function selectPassages(index: PassageIndex, queries: string[], perQuery = 4, maxChars = 60_000): Chunk[] {
  const picked = new Map<string, Chunk>();
  const ranked = queries.map((q) => index.search(q, perQuery));
  // Round-robin so every query gets its best passages before any gets its fourth.
  let used = 0;
  for (let r = 0; r < perQuery; r++)
    for (const list of ranked) {
      const hit = list[r];
      if (!hit) continue;
      const key = `${hit.chunk.sourceId}:${hit.chunk.start}`;
      if (picked.has(key)) continue;
      if (used + hit.chunk.text.length > maxChars) continue;
      picked.set(key, hit.chunk);
      used += hit.chunk.text.length;
    }
  // Merge overlapping chunks of the same source.
  const bySource = new Map<string, Chunk[]>();
  for (const c of picked.values()) bySource.set(c.sourceId, [...(bySource.get(c.sourceId) ?? []), c]);
  const out: Chunk[] = [];
  for (const list of bySource.values()) {
    list.sort((a, b) => a.start - b.start);
    for (const c of list) {
      const last = out[out.length - 1];
      if (last && last.sourceId === c.sourceId && c.start <= last.end) {
        last.end = Math.max(last.end, c.end);
        const src = index.sources.get(c.sourceId)!;
        last.text = src.text.slice(last.start, last.end);
        last.label = locate(src, last.start, last.end);
      } else out.push({ ...c });
    }
  }
  return out;
}
