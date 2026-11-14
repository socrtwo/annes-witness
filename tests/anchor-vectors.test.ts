import { describe, it, expect } from 'vitest';
import vectors from './anchor-vectors.json';
import { findPassage } from '../src/core/anchor';
import { verifyQuote } from '../src/ai/gate';

type V = { name: string; text: string; selector: { start?: number; end?: number; exact: string; prefix?: string; suffix?: string }; expect: null | { start?: number; end?: number; how: string; contains?: string } };

describe('anchor test vectors (docs/ANCHORS.md)', () => {
  for (const v of (vectors as { vectors: V[] }).vectors) {
    it(v.name, () => {
      const r = findPassage(v.text, v.selector);
      if (v.expect === null) { expect(r).toBeNull(); return; }
      expect(r).not.toBeNull();
      expect(r!.how).toBe(v.expect.how);
      if (v.expect.start !== undefined) expect([r!.start, r!.end]).toEqual([v.expect.start, v.expect.end]);
      if (v.expect.contains) expect(v.text.slice(r!.start, r!.end)).toContain(v.expect.contains);
    });
  }
  it('the verification gate accepts exact and normalized matches but never fuzzy ones', () => {
    for (const v of (vectors as { vectors: V[] }).vectors) {
      if (!v.selector.exact || v.selector.exact.length < 3) continue;
      const src = { id: 's', role: 'source', title: 't', kind: 'text', embedded: true, added: '', citation: {}, classification: 'unknown', derivedFrom: [], confidential: false, tags: [], text: v.text, segments: [] } as any;
      const g = verifyQuote(src, v.selector.exact);
      const r = findPassage(v.text, { exact: v.selector.exact });
      expect(g.ok).toBe(!!r && (r.how === 'exact' || r.how === 'normalized'));
    }
  });
});
