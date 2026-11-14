import { describe, it, expect } from 'vitest';
import { splitSentences } from '../src/text/sentences';
import { parseNumbers, numbersAgree, mainFigure } from '../src/text/numbers';
import { parseDates, julianToGregorian, gregorianToJulian, toJdn, fromJdn, compareDates, dateRange } from '../src/text/dates';
import { soundex, jaroWinkler, normalizeName, nameVariants, findNames, sameName } from '../src/text/names';
import { captureNumbers, captureQuotes, captureDatesAndNames, checkWorthiness, atomize } from '../src/text/capture';

describe('sentences', () => {
  it('respects abbreviations, initials, decimals and paragraphs', () => {
    const t = 'Mr. J. R. Smith paid $3.50 at St. Mary’s. He left. “It was late,” she said. Then…\n\nNew paragraph without stop\nstill same. Last one?';
    const s = splitSentences(t).map((x) => x.text);
    expect(s[0]).toBe('Mr. J. R. Smith paid $3.50 at St. Mary’s.');
    expect(s[1]).toBe('He left.');
    expect(s[2]).toBe('“It was late,” she said.');
    expect(s).toContain('New paragraph without stop\nstill same.');
    expect(s[s.length - 1]).toBe('Last one?');
    for (const x of splitSentences(t)) expect(t.slice(x.start, x.end)).toBe(x.text);
  });
  it('handles e.g. and i.e. and quotes after periods', () => {
    const s = splitSentences('Some records, e.g. censuses, list ages. He wrote "done." Then he left.');
    expect(s).toHaveLength(3);
  });
});

describe('numbers', () => {
  it('parses formats, scale, currency, percent and precision', () => {
    const n = parseNumbers('Revenue was $1,234.56, costs (1,200) and margin 12.5%; about 1.2 million people; €3,4 bn; 1.234.567,89 total.');
    expect(n[0]).toMatchObject({ value: 1234.56, currency: 'USD', precision: 2 });
    expect(n[1]).toMatchObject({ value: -1200 });
    expect(n[2]).toMatchObject({ value: 12.5, percent: true, precision: 1 });
    expect(n[3]).toMatchObject({ value: 1.2e6, scale: 'million', approx: true, precision: -5 });
    expect(n[4]).toMatchObject({ currency: 'EUR', scale: 'billion' });
    expect(n[4].value).toBeCloseTo(3.4e9);
    expect(n[5].value).toBeCloseTo(1234567.89);
  });
  it('spelled-out and ordinals, negatives', () => {
    const n = parseNumbers('She had twenty-three children and was the third of nine. Loss of -5 and −7.');
    expect(n.find((x) => x.raw === 'twenty-three')?.value).toBe(23);
    expect(n.find((x) => x.raw === 'third')?.ordinal).toBe(true);
    expect(n.find((x) => x.raw === 'nine')?.value).toBe(9);
    expect(n.some((x) => x.value === -5)).toBe(true);
    expect(n.some((x) => x.value === -7)).toBe(true);
  });
  it('compares at the coarser precision', () => {
    const [a] = parseNumbers('1.2 million');
    const [b] = parseNumbers('1,234,567');
    expect(numbersAgree(a, b).agree).toBe(true);
    const [c] = parseNumbers('1,300,000');
    expect(numbersAgree(c, b).agree).toBe(false);
    const [p] = parseNumbers('12%');
    const [q] = parseNumbers('12');
    expect(numbersAgree(p, q).agree).toBe(false);
    const [x] = parseNumbers('$100');
    const [y] = parseNumbers('£100');
    expect(numbersAgree(x, y).reason).toMatch(/currencies/);
    expect(numbersAgree(parseNumbers('100.4')[0], parseNumbers('100.9')[0], 1).agree).toBe(true);
  });
  it('main figure skips years', () => {
    expect(mainFigure('In 1903 she owned 40 acres')?.value).toBe(40);
  });
});

describe('dates and calendars', () => {
  it('converts Julian and Gregorian (1752 change)', () => {
    expect(julianToGregorian(1752, 9, 2)).toEqual({ year: 1752, month: 9, day: 13 });
    expect(gregorianToJulian(1752, 9, 14)).toEqual({ year: 1752, month: 9, day: 3 });
    expect(fromJdn(toJdn(2000, 1, 1))).toEqual({ year: 2000, month: 1, day: 1 });
    expect(toJdn(2000, 1, 1)).toBe(2451545);
  });
  it('parses formats, qualifiers, dual dates and calendar marks', () => {
    const d = parseDates('Born 3 May 1903, baptized May 10, 1903; abt 1850; bef. 1900; 1903-05-03; 5 Feb 1710/11 O.S.; March 1820; between 1840 and 1845; 3/5/1903; 25/12/1900.');
    expect(d[0]).toMatchObject({ year: 1903, month: 5, day: 3 });
    expect(d[1]).toMatchObject({ year: 1903, month: 5, day: 10 });
    expect(d.find((x) => x.year === 1850)).toMatchObject({ approx: true, qualifier: 'about' });
    expect(d.find((x) => x.year === 1900 && !x.month)).toMatchObject({ qualifier: 'before' });
    const dual = d.find((x) => x.dual)!;
    expect(dual).toMatchObject({ year: 1711, dual: { oldYear: 1710, newYear: 1711 }, calendar: 'julian', month: 2, day: 5 });
    expect(d.find((x) => x.year === 1820)).toMatchObject({ month: 3 });
    expect(d.find((x) => x.qualifier === 'between')).toMatchObject({ year: 1840, to: { year: 1845 } });
    expect(d.find((x) => x.raw === '3/5/1903')).toMatchObject({ month: 3, day: 5, alt: { month: 5, day: 3 } });
    expect(d.find((x) => x.raw === '25/12/1900')).toMatchObject({ month: 12, day: 25 });
  });
  it('compares on a common scale', () => {
    const [a, b] = parseDates('1 Jan 1900 and abt 1901');
    expect(compareDates(a, b)).toBe(0);
    const [c, e] = parseDates('1850 then 1900');
    expect(compareDates(c, e)).toBe(-1);
    const [j] = parseDates('2 September 1752 O.S.');
    const [g] = parseDates('13 September 1752');
    expect(dateRange(j)).toEqual(dateRange(g));
  });
  it('does not mistake amounts for years', () => {
    expect(parseDates('$1,900 and 1900.50')).toHaveLength(0);
  });
});

describe('names', () => {
  it('soundex, jaro-winkler and normalization', () => {
    expect(soundex('Robert')).toBe('R163');
    expect(soundex('Rupert')).toBe('R163');
    expect(soundex('Ashcraft')).toBe('A261');
    expect(soundex('Tymczak')).toBe('T522');
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 2);
    expect(normalizeName('Smith, Mary Ann')).toBe('mary ann smith');
    expect(normalizeName('Dr. José Núñez Jr.')).toBe('jose nunez');
  });
  it('clusters variants and keeps different people apart', () => {
    const g = nameVariants(['Mary Ann Smith', 'Mary Anne Smyth', 'M. A. Smith', 'John Smith', 'Mary Ann Smith']);
    expect(g).toHaveLength(1);
    expect(g[0]).toEqual(expect.arrayContaining(['Mary Ann Smith', 'Mary Anne Smyth', 'M. A. Smith']));
    expect(sameName('John Smith', 'Mary Smith')).toBe(false);
  });
  it('finds names but not months or sentence openers', () => {
    const n = findNames('In May 1903 Mary Ann Smith met John Henry Brown in Monday Street. The Parish Register says so.').map((x) => x.text);
    expect(n).toContain('Mary Ann Smith');
    expect(n).toContain('John Henry Brown');
    expect(n.some((x) => x.startsWith('May'))).toBe(false);
  });
});

describe('capture', () => {
  const t = 'Revenue rose to $5.2 million in 2020. “We will grow again next year,” said Jane Doe. Mary Smith was born 3 May 1903. Nice weather.';
  it('captures numbers by sentence, quotes with attribution, dates and names', () => {
    const n = captureNumbers(t);
    expect(n).toHaveLength(1);
    expect(n[0].text).toBe('Revenue rose to $5.2 million in 2020.');
    const q = captureQuotes(t);
    expect(q[0]).toMatchObject({ text: 'We will grow again next year,', attributedTo: 'Jane Doe', kind: 'quotation' });
    expect(t.slice(q[0].start, q[0].end)).toBe(q[0].text);
    const dn = captureDatesAndNames(t);
    expect(dn.map((x) => x.text)).toContain('Mary Smith was born 3 May 1903.');
    expect(dn.every((x) => x.text !== 'Nice weather.')).toBe(true);
    expect(captureQuotes('According to the Times, "prices fell sharply last month".')[0].attributedTo).toBe('Times');
  });
  it('scores check-worthiness and atomizes conservatively', () => {
    expect(checkWorthiness('The plant produced 40% more steel in 1950 than any other.').score).toBeGreaterThan(0.6);
    expect(checkWorthiness('I think it is lovely.').score).toBeLessThan(0.2);
    expect(atomize('She was born in Ohio in 1902, and she moved to Iowa in 1920.')).toEqual(['She was born in Ohio in 1902.', 'She moved to Iowa in 1920.']);
    expect(atomize('Bread and butter were served.')).toEqual(['Bread and butter were served.']);
  });
});
