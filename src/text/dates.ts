// Dates in records: approximate, qualified, dual-dated and Julian/Gregorian.
export type Calendar = 'julian' | 'gregorian';

export interface DateMention {
  start: number;
  end: number;
  raw: string;
  year: number;
  month?: number;
  day?: number;
  approx: boolean;
  dual?: { oldYear: number; newYear: number };
  calendar?: Calendar;
  qualifier?: 'before' | 'after' | 'about' | 'between';
  /** For 3/5/1903: the other reading (day and month swapped). */
  alt?: { month: number; day: number };
  /** For "between X and Y": the end year/month/day. */
  to?: { year: number; month?: number; day?: number };
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const MON = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\\.?';

export function toJdn(y: number, m: number, d: number, cal: Calendar = 'gregorian'): number {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  if (cal === 'gregorian')
    return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - 32083;
}

export function fromJdn(jdn: number, cal: Calendar = 'gregorian'): { year: number; month: number; day: number } {
  let c: number;
  let d: number;
  if (cal === 'gregorian') {
    const a = jdn + 32044;
    const b = Math.floor((4 * a + 3) / 146097);
    c = a - Math.floor((146097 * b) / 4);
    d = Math.floor((4 * c + 3) / 1461);
    const e = c - Math.floor((1461 * d) / 4);
    const m = Math.floor((5 * e + 2) / 153);
    return { day: e - Math.floor((153 * m + 2) / 5) + 1, month: m + 3 - 12 * Math.floor(m / 10), year: 100 * b + d - 4800 + Math.floor(m / 10) };
  }
  c = jdn + 32082;
  d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return { day: e - Math.floor((153 * m + 2) / 5) + 1, month: m + 3 - 12 * Math.floor(m / 10), year: d - 4800 + Math.floor(m / 10) };
}

export const julianToGregorian = (y: number, m: number, d: number) => fromJdn(toJdn(y, m, d, 'julian'), 'gregorian');
export const gregorianToJulian = (y: number, m: number, d: number) => fromJdn(toJdn(y, m, d, 'gregorian'), 'julian');

function daysIn(y: number, m: number, cal: Calendar) {
  return toJdn(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1, cal) - toJdn(y, m, 1, cal);
}

/** The range of Gregorian day numbers a mention can mean. */
export function dateRange(dm: Pick<DateMention, 'year' | 'month' | 'day' | 'approx' | 'dual' | 'calendar' | 'qualifier' | 'alt' | 'to'>): { min: number; max: number } {
  const cal = dm.calendar ?? 'gregorian';
  const span = (y: number, m?: number, d?: number) => {
    if (m && d) {
      const j = toJdn(y, m, d, cal);
      return { min: j, max: j };
    }
    if (m) return { min: toJdn(y, m, 1, cal), max: toJdn(y, m, daysIn(y, m, cal), cal) };
    return { min: toJdn(y, 1, 1, cal), max: toJdn(y, 12, 31, cal) };
  };
  let y = dm.year;
  if (dm.dual) y = dm.dual.newYear;
  let r = span(y, dm.month, dm.day);
  if (dm.alt) {
    const r2 = span(y, dm.alt.month, dm.alt.day);
    r = { min: Math.min(r.min, r2.min), max: Math.max(r.max, r2.max) };
  }
  if (dm.to) {
    const r2 = span(dm.to.year, dm.to.month, dm.to.day);
    r = { min: Math.min(r.min, r2.min), max: Math.max(r.max, r2.max) };
  }
  if (dm.approx || dm.qualifier === 'about') r = { min: r.min - 2 * 366, max: r.max + 2 * 366 };
  if (dm.qualifier === 'before') r = { min: r.min - 100 * 366, max: r.max };
  if (dm.qualifier === 'after') r = { min: r.min, max: r.max + 100 * 366 };
  return r;
}

/** Negative if a is surely before b, positive if surely after, 0 if they can overlap, null if unknown. */
export function compareDates(a: DateMention, b: DateMention): number | null {
  if (!a || !b) return null;
  const ra = dateRange(a);
  const rb = dateRange(b);
  if (ra.max < rb.min) return -1;
  if (ra.min > rb.max) return 1;
  return 0;
}

function qualifierBefore(text: string, idx: number): { qualifier?: DateMention['qualifier']; approx: boolean; cut: number } {
  const pre = text.slice(Math.max(0, idx - 16), idx);
  const m = pre.match(/\b(about|abt\.?|circa|c\.|ca\.|approximately|around|before|bef\.?|after|aft\.?|between|bet\.?)\s*$/i);
  if (!m) return { approx: false, cut: idx };
  const w = m[1].toLowerCase().replace('.', '');
  const qualifier = ['before', 'bef'].includes(w) ? 'before' : ['after', 'aft'].includes(w) ? 'after' : ['between', 'bet'].includes(w) ? 'between' : 'about';
  return { qualifier, approx: qualifier === 'about', cut: idx - m[0].length };
}

function calendarAfter(text: string, end: number): { calendar?: Calendar; len: number } {
  const m = text.slice(end, end + 16).match(/^\s*(\(?(O\.S\.|Old Style|N\.S\.|New Style|Julian|Gregorian)\)?)/i);
  if (!m) return { len: 0 };
  const w = m[2].toLowerCase();
  return { calendar: w.startsWith('o') || w === 'julian' ? 'julian' : 'gregorian', len: m[0].length };
}

export function parseDates(text: string): DateMention[] {
  const out: DateMention[] = [];
  const taken: [number, number][] = [];
  const free = (s: number, e: number) => !taken.some(([a, b]) => s < b && e > a);
  const add = (s: number, e: number, dm: Omit<DateMention, 'start' | 'end' | 'raw' | 'approx'> & { approx?: boolean }) => {
    if (!free(s, e)) return;
    const q = qualifierBefore(text, s);
    const cal = calendarAfter(text, e);
    const end = e + cal.len;
    const start = q.cut;
    const mention: DateMention = {
      start, end, raw: text.slice(start, end).trim(), approx: dm.approx || q.approx, ...dm,
      qualifier: dm.qualifier ?? q.qualifier, calendar: dm.calendar ?? cal.calendar,
    };
    if (mention.qualifier === 'between') {
      const rest = text.slice(end, end + 30).match(/^\s*(and|-|–|to)\s*(\d{3,4})/);
      if (rest) {
        mention.to = { year: +rest[2] };
        mention.end = end + rest[0].length;
        mention.raw = text.slice(start, mention.end).trim();
      }
    }
    taken.push([start, mention.end]);
    out.push(mention);
  };
  const yearPart = '(\\d{3,4})(?:\\/(\\d{1,2}))?';
  const dual = (y: string, d?: string) => {
    const year = +y;
    if (!d) return { year };
    const nd = +d;
    const newYear = d.length === 1 ? Math.floor(year / 10) * 10 + nd : Math.floor(year / 100) * 100 + nd;
    return { year: newYear, dual: { oldYear: year, newYear }, calendar: 'julian' as Calendar };
  };
  let m: RegExpExecArray | null;
  // ISO 1903-05-03
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = iso.exec(text))) add(m.index, m.index + m[0].length, { year: +m[1], month: +m[2], day: +m[3] });
  // 3 May 1903
  const dmy = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON},?\\s+${yearPart}\\b`, 'gi');
  while ((m = dmy.exec(text))) add(m.index, m.index + m[0].length, { day: +m[1], month: MONTHS[m[2].toLowerCase()], ...dual(m[3], m[4]) });
  // May 3, 1903
  const mdy = new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+${yearPart}\\b`, 'gi');
  while ((m = mdy.exec(text))) add(m.index, m.index + m[0].length, { day: +m[2], month: MONTHS[m[1].toLowerCase()], ...dual(m[3], m[4]) });
  // 3/5/1903
  const num = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g;
  while ((m = num.exec(text))) {
    const a = +m[1];
    const b = +m[2];
    if (a > 31 || b > 31 || (a > 12 && b > 12)) continue;
    if (a > 12) add(m.index, m.index + m[0].length, { year: +m[3], day: a, month: b });
    else if (b > 12) add(m.index, m.index + m[0].length, { year: +m[3], month: a, day: b });
    else add(m.index, m.index + m[0].length, { year: +m[3], month: a, day: b, alt: a === b ? undefined : { month: b, day: a } });
  }
  // May 1903
  const my = new RegExp(`\\b${MON},?\\s+${yearPart}\\b`, 'gi');
  while ((m = my.exec(text))) add(m.index, m.index + m[0].length, { month: MONTHS[m[1].toLowerCase()], ...dual(m[2], m[3]) });
  // Year alone (1000-2199), with dual dating
  const y = /\b(1[0-9]\d{2}|20\d{2}|21\d{2})(?:\/(\d{1,2}))?\b/g;
  while ((m = y.exec(text))) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 2);
    const before = text.slice(Math.max(0, m.index - 1), m.index);
    if (/^[,.]\d/.test(after) || /[$€£\d,.]/.test(before)) continue; // amounts
    if (/^\s?%/.test(after)) continue;
    add(m.index, m.index + m[0].length, dual(m[1], m[2]));
  }
  return out.sort((a, b) => a.start - b.start);
}

export function formatDate(d: { year: number; month?: number; day?: number }): string {
  const mn = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return [d.day, d.month ? mn[d.month] : undefined, d.year].filter((x) => x !== undefined).join(' ');
}

/** A sort key for any date-ish string (Gregorian day number of its earliest reading), or null. */
export function dateKey(s: string | undefined): number | null {
  if (!s) return null;
  const d = parseDates(s)[0];
  return d ? dateRange(d).min : null;
}
