import { describe, it, expect } from 'vitest';
import { alignTexts, variants, compareTranscriptions, variantHeat, tokenize } from '../src/resolve/collate';
import { apparatusMarkdown } from '../src/reports/apparatus';

describe('collation', () => {
  it('aligns versions and lists variant readings', () => {
    const base = 'In the beginning was the Word';
    const r = alignTexts(base, ['In the begynnyng was the word', 'In beginning was the Word and']);
    const v = variants(r);
    expect(v.find((x) => x.readings.some((y) => y.text === 'begynnyng'))?.readings).toEqual(
      expect.arrayContaining([{ witness: 0, text: 'beginning' }, { witness: 1, text: 'begynnyng' }]),
    );
    expect(v.some((x) => x.readings.some((y) => y.witness === 2 && y.text === ''))).toBe(true); // omission of "the"
    expect(v.some((x) => x.readings.some((y) => y.witness === 2 && y.text === 'and'))).toBe(true);
    const heat = variantHeat(r);
    expect(heat).toHaveLength(tokenize(base).length);
    expect(heat[2]).toBeGreaterThan(0);
    expect(heat[0]).toBe(0);
    const app = apparatusMarkdown(r, ['A', 'B', 'C']);
    expect(app).toMatch(/beginning A \] .*begynnyng B/);
  });
  it('compares two transcriptions word by word', () => {
    const c = compareTranscriptions('Mary Ann Smith, aged 8, born Ohio', 'Mary Anne Smith, aged 3, born Ohio');
    expect(c.changes.map((x) => [x.aText, x.bText])).toEqual([['Ann', 'Anne'], ['8', '3']]);
    expect(c.same).toBe(5);
  });
});
