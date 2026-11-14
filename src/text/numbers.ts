// Numbers in prose and figures: value, precision, scale, unit and currency.
export interface NumberMention {
  start: number;
  end: number;
  raw: string;
  value: number;
  unit?: string;
  currency?: string;
  percent: boolean;
  /** Decimal places shown; negative = rounded to tens (-1), hundreds (-2), thousands (-3)… */
  precision: number;
  approx: boolean;
  scale?: 'thousand' | 'million' | 'billion' | 'trillion';
  ordinal?: boolean;
  spelled?: boolean;
}

const SCALE: Record<string, { mult: number; name: NumberMention['scale'] }> = {
  thousand: { mult: 1e3, name: 'thousand' }, k: { mult: 1e3, name: 'thousand' },
  million: { mult: 1e6, name: 'million' }, m: { mult: 1e6, name: 'million' }, mn: { mult: 1e6, name: 'million' },
  billion: { mult: 1e9, name: 'billion' }, bn: { mult: 1e9, name: 'billion' }, b: { mult: 1e9, name: 'billion' },
  trillion: { mult: 1e12, name: 'trillion' }, tn: { mult: 1e12, name: 'trillion' },
};
const CURRENCY: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', US$: 'USD', 'C$': 'CAD', 'A$': 'AUD' };
const CODES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR'];
const UNITS = [
  'km', 'kilometers', 'kilometres', 'miles', 'mi', 'm', 'meters', 'metres', 'feet', 'ft', 'inches', 'in', 'kg', 'kilograms', 'lb', 'lbs',
  'pounds', 'tons', 'tonnes', 'acres', 'hectares', 'ha', 'years', 'year', 'months', 'days', 'hours', 'minutes', 'people', 'persons',
  'children', 'votes', 'dollars', 'euros', 'cents', 'percent', 'percentage points',
];
const APPROX = /\b(about|around|approximately|approx\.?|roughly|nearly|almost|some|circa|c\.|ca\.|abt\.?|over|under|more than|less than|fewer than|up to|estimated)\s*$/i;

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORD: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
  twentieth: 20, hundredth: 100,
};

function parseDigits(s: string): { value: number; precision: number } | null {
  let t = s;
  // European 1.234,56 when unambiguous
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
  else t = t.replace(/,/g, '');
  if (!/^\d*\.?\d+$/.test(t)) return null;
  const dot = t.indexOf('.');
  return { value: parseFloat(t), precision: dot >= 0 ? t.length - dot - 1 : 0 };
}

function trailingZeros(n: number): number {
  if (!Number.isInteger(n) || n === 0) return 0;
  let z = 0;
  while (n % 10 === 0) { n /= 10; z++; }
  return z;
}

export function parseNumbers(text: string): NumberMention[] {
  const out: NumberMention[] = [];
  const re = /(\()?(?:(US\$|C\$|A\$|[$€£¥])\s?)?([-−–]?)(\d[\d,.]*\d|\d)(\))?(\s?(%|per ?cent|percent))?(\s?(thousand|million|billion|trillion|bn|mn|tn|k|m|b)\b)?(\s?(st|nd|rd|th)\b)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const full = m[0];
    const numStr = m[4];
    // Skip dates like 1903-05-03 parts and times handled loosely: skip if preceded by letter-digit
    const before = text.slice(Math.max(0, m.index - 1), m.index);
    if (/[A-Za-z]/.test(before) && !m[2]) continue;
    const p = parseDigits(numStr.replace(/\.$/, ''));
    if (!p) continue;
    let rawEnd = m.index + full.length;
    let raw = full;
    if (numStr.endsWith('.')) { raw = raw.replace(/\.(?=[^.]*$)/, ''); }
    let value = p.value;
    let precision = p.precision;
    const paren = !!m[1] && !!m[5];
    const neg = !!m[3] || paren;
    if (neg) value = -value;
    if (m[1] && !m[5]) { /* stray paren */ }
    let scale: NumberMention['scale'];
    const scaleWord = m[9]?.toLowerCase();
    const isPct = !!m[6];
    if (scaleWord) {
      // single-letter m/b only after currency
      if ((scaleWord === 'm' || scaleWord === 'b' || scaleWord === 'k') && !m[2]) {
        // could be meters: treat 'm' as unit, k/b ignore
        raw = full.slice(0, full.length - (m[8]?.length ?? 0));
        rawEnd = m.index + raw.length;
      } else {
        const sc = SCALE[scaleWord];
        scale = sc.name;
        value *= sc.mult;
        precision -= Math.log10(sc.mult);
      }
    }
    const ordinal = !!m[11];
    const after = text.slice(rawEnd, rawEnd + 25);
    let unit: string | undefined;
    if (!isPct) {
      const um = after.match(/^\s?([A-Za-z]+(?: points)?)/);
      if (um && UNITS.includes(um[1].toLowerCase())) unit = um[1].toLowerCase();
    }
    let currency = m[2] ? CURRENCY[m[2]] : undefined;
    const code = after.match(/^\s?([A-Z]{3})\b/);
    if (!currency && code && CODES.includes(code[1])) currency = code[1];
    const prevCode = text.slice(Math.max(0, m.index - 4), m.index).match(/([A-Z]{3})\s?$/);
    if (!currency && prevCode && CODES.includes(prevCode[1])) currency = prevCode[1];
    if (unit === 'dollars') currency = currency ?? 'USD';
    const approx = APPROX.test(text.slice(Math.max(0, m.index - 20), m.index));
    out.push({
      start: m.index + (m[1] && !paren ? 1 : 0), end: rawEnd, raw: raw.trim(), value, unit, currency, percent: isPct,
      // A round figure is read as rounded only when the text says it is approximate.
      precision: approx && !scale && precision === 0 && Number.isInteger(value) ? -trailingZeros(Math.abs(value)) : precision,
      approx, scale, ordinal: ordinal || undefined,
    });
  }
  // Spelled-out numbers
  const words = /\b((?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)(?:\s+(hundred|thousand|million|billion))?(?:\s+(?:and\s+)?((?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen))?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|twentieth|hundredth)\b/gi;
  const small = (w: string): number => {
    const parts = w.toLowerCase().split(/[- ]/);
    let v = 0;
    for (const p of parts) v += ONES[p] ?? TENS[p] ?? 0;
    return v;
  };
  while ((m = words.exec(text))) {
    const w = m[0].toLowerCase();
    if (w === 'one' && /^\s+(of|another|day|time)\b/i.test(text.slice(m.index + 3, m.index + 12))) continue;
    if (w === 'second' && /^\s+(half|thought|time)/.test(text.slice(m.index + 6, m.index + 14))) { /* still ordinal */ }
    if (ORD[w] !== undefined) {
      out.push({ start: m.index, end: m.index + m[0].length, raw: m[0], value: ORD[w], percent: false, precision: 0, approx: false, ordinal: true, spelled: true });
      continue;
    }
    let v = small(m[1].replace(/\s+(hundred|thousand|million|billion).*$/i, ''));
    const mult = m[2]?.toLowerCase();
    if (mult) v *= mult === 'hundred' ? 100 : mult === 'thousand' ? 1e3 : mult === 'million' ? 1e6 : 1e9;
    if (m[3]) v += small(m[3]);
    const approx = APPROX.test(text.slice(Math.max(0, m.index - 20), m.index));
    out.push({ start: m.index, end: m.index + m[0].length, raw: m[0], value: v, percent: false, precision: approx || mult ? -trailingZeros(v) : 0, approx, spelled: true,
      scale: mult === 'million' ? 'million' : mult === 'billion' ? 'billion' : mult === 'thousand' ? 'thousand' : undefined });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Do two figures agree, compared at the coarser of their precisions? */
export function numbersAgree(a: NumberMention, b: NumberMention, tolerance = 0): { agree: boolean; reason: string; difference: number } {
  if (a.percent !== b.percent) return { agree: false, reason: 'One figure is a percentage and the other is not.', difference: NaN };
  if (a.currency && b.currency && a.currency !== b.currency)
    return { agree: false, reason: `Different currencies (${a.currency}, ${b.currency}).`, difference: NaN };
  if (a.unit && b.unit && a.unit !== b.unit && a.unit.replace(/s$/, '') !== b.unit.replace(/s$/, ''))
    return { agree: false, reason: `Different units (${a.unit}, ${b.unit}).`, difference: NaN };
  const prec = Math.min(a.precision, b.precision);
  const round = (v: number) => {
    const f = Math.pow(10, prec);
    return Math.round(v * f) / f;
  };
  const diff = Math.abs(a.value - b.value);
  const ra = round(a.value);
  const rb = round(b.value);
  const half = 0.5 * Math.pow(10, -prec);
  const approxOk = (a.approx || b.approx) && diff <= half * 2 + 1e-9;
  if (Math.abs(ra - rb) <= tolerance + 1e-9 || approxOk || diff <= tolerance + 1e-9) {
    const exact = diff < 1e-9;
    return { agree: true, reason: exact ? 'Figures match.' : `Figures match at ${prec >= 0 ? prec + ' decimal places' : 'the nearest ' + Math.pow(10, -prec)}.`, difference: diff };
  }
  return { agree: false, reason: `${a.raw} vs ${b.raw}: differ by ${+diff.toPrecision(6)}.`, difference: diff };
}

/** The main figure of a text: the first non-ordinal, non-year number. */
export function mainFigure(text: string): NumberMention | undefined {
  return parseNumbers(text).find((n) => !n.ordinal && !(Number.isInteger(n.value) && n.value >= 1000 && n.value <= 2100 && !n.currency && !n.percent && !n.scale && !/,/.test(n.raw)));
}
