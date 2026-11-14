// Checks the app computes itself, without AI. Each returns findings; none changes the case.
import { CaseData, Claim, Id, Tie, Anchor, Source } from '../core/types';
import { TieTest } from '../core/status';
import { families, lineageCycles } from '../core/lineage';
import { normalize } from '../core/anchor';
import { parseNumbers, numbersAgree, mainFigure, NumberMention } from '../text/numbers';
import { parseDates, compareDates, dateRange, toJdn, DateMention } from '../text/dates';
import { findNames, nameVariants, sameName } from '../text/names';
import { splitSentences } from '../text/sentences';
import { checkWorthiness } from '../text/capture';
import { compareTranscriptions } from '../resolve/collate';

export interface Finding {
  id: string;
  check: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  claimId?: Id;
  tieId?: Id;
  sourceId?: Id;
  anchorId?: Id;
  command?: string;
}

export interface CheckOptions { only?: string[]; claimIds?: Id[]; today?: string }
type CheckFn = (data: CaseData, opts: CheckOptions) => Finding[];

// ---------- helpers ----------

let seq = 0;
function f(check: string, severity: Finding['severity'], message: string, rest: Partial<Finding> = {}): Finding {
  return { id: `${check}:${rest.claimId ?? ''}:${rest.tieId ?? rest.sourceId ?? ''}:${seq++}`, check, severity, message, ...rest };
}

const claimsOf = (d: CaseData) => Object.values(d.claims).sort((a, b) => a.number - b.number);
const confirmedTies = (d: CaseData, claimId: Id, kinds: Tie['kind'][] = ['supports']) =>
  Object.values(d.ties).filter((t) => t.claimId === claimId && t.state === 'confirmed' && kinds.includes(t.kind));
const anchorOf = (d: CaseData, t: Tie): Anchor | undefined => (t.anchorId ? d.anchors[t.anchorId] : undefined);
const label = (c: Claim) => `Claim ${c.number}`;

const STOP = new Set(
  'a an the of to in on at by for from with and or but is was were are be been being has have had it its this that these those as he she they his her their them we our i you not no do did does said which who whom whose than then there here into onto about over under per'.split(' '),
);
export const contentWords = (s: string) =>
  new Set(normalize(s).split(/[^a-z0-9']+/).filter((w) => w.length > 2 && !STOP.has(w)));

function stripQuotes(s: string) {
  return s.trim().replace(/^["“‘']+|["”’']+$/g, '');
}

/** Does a quotation appear letter for letter in a passage, allowing … omissions and [insertions]? */
export function quoteMatches(quote: string, passage: string): { ok: boolean; differences: string[] } {
  const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();
  const q = norm(stripQuotes(quote));
  const p = norm(passage);
  const frags = q.split(/\s*(?:\.\.\.|…|\[[^\]]*\])\s*/).map((x) => x.trim()).filter(Boolean);
  let pos = 0;
  let ok = frags.length > 0;
  for (const fr of frags) {
    let i = p.indexOf(fr, pos);
    if (i < 0) {
      // Allow a changed capital at the start of a fragment.
      const alt = fr.charAt(0).toLowerCase() === fr.charAt(0) ? fr.charAt(0).toUpperCase() + fr.slice(1) : fr.charAt(0).toLowerCase() + fr.slice(1);
      i = p.indexOf(alt, pos);
    }
    if (i < 0) { ok = false; break; }
    pos = i + fr.length;
  }
  if (ok) return { ok, differences: [] };
  const cmp = compareTranscriptions(frags.join(' '), p);
  // Only differences where the quote has words, or where the quote is missing words between its own words
  const differences = cmp.changes
    .filter((c) => c.aText)
    .slice(0, 5)
    .map((c) => (c.bText ? `quote “${c.aText}” / source “${c.bText}”` : `“${c.aText}” is not in the source`));
  return { ok: false, differences: differences.length ? differences : ['The quotation differs from the passage.'] };
}

function figures(text: string): NumberMention[] {
  const dates = parseDates(text);
  return parseNumbers(text).filter(
    (n) => !n.ordinal && !dates.some((d) => n.start >= d.start && n.end <= d.end && !n.currency && !n.percent && !n.scale),
  );
}

function closest(target: NumberMention, list: NumberMention[]): NumberMention | undefined {
  let best: NumberMention | undefined;
  for (const n of list) if (!best || Math.abs(n.value - target.value) < Math.abs(best.value - target.value)) best = n;
  return best;
}

const yearOf = (s?: string): number | undefined => {
  if (!s) return undefined;
  const d = parseDates(s)[0];
  return d?.year;
};
const sourceYear = (s?: Source) => yearOf(s?.dateMade) ?? (s?.citation.year ? +s.citation.year : undefined);

// ---------- words ----------

export const checkQuote: CheckFn = (d) => {
  const out: Finding[] = [];
  for (const c of claimsOf(d)) {
    if (c.kind !== 'quotation') continue;
    for (const t of confirmedTies(d, c.id)) {
      const a = anchorOf(d, t);
      if (!a) continue;
      const r = quoteMatches(c.text, a.exact);
      if (!r.ok)
        out.push(f('check.quote', 'error', `${label(c)}: the quotation does not match the passage. ${r.differences.join('; ')}`, { claimId: c.id, tieId: t.id, anchorId: a.id, sourceId: a.sourceId, command: 'tie.details' }));
    }
  }
  return out;
};

export const checkParaphrase: CheckFn = (d) => {
  const out: Finding[] = [];
  for (const c of claimsOf(d)) {
    const cw = contentWords(c.text);
    for (const t of confirmedTies(d, c.id)) {
      const a = anchorOf(d, t);
      if (!a || !a.exact) continue;
      const aw = contentWords(a.exact);
      const shared = [...cw].filter((w) => aw.has(w));
      const numsShared = figures(c.text).some((n) => figures(a.exact).some((m) => numbersAgree(n, m).agree));
      if (!shared.length && !numsShared)
        out.push(f('check.paraphrase', 'info', `${label(c)}: the tied passage shares no words with the claim. Worth a human look.`, { claimId: c.id, tieId: t.id, anchorId: a.id }));
    }
  }
  return out;
};

export const checkNames: CheckFn = (d) => {
  const where = new Map<string, Id[]>();
  for (const c of claimsOf(d))
    for (const n of findNames(c.text)) where.set(n.text, [...(where.get(n.text) ?? []), c.id]);
  return nameVariants([...where.keys()]).map((g) =>
    f('check.names', 'warning', `Name spelled different ways across claims: ${g.map((n) => `“${n}”`).join(', ')}. (Variants in the sources themselves are kept as they are.)`, { claimId: where.get(g[0])?.[0] }),
  );
};

const REQUIRED: Record<string, (keyof Source['citation'])[]> = {
  book: ['title', 'authors', 'year', 'publisher'],
  article: ['title', 'authors', 'year', 'container'],
  chapter: ['title', 'authors', 'year', 'container'],
  web: ['title', 'url', 'accessed'],
  record: ['title', 'repository', 'date'],
  interview: ['title', 'date'],
  letter: ['title', 'authors', 'date'],
  report: ['title', 'authors', 'year'],
  dataset: ['title', 'year', 'url'],
  other: ['title'],
};

export const checkCitations: CheckFn = (d) => {
  const out: Finding[] = [];
  for (const s of Object.values(d.sources)) {
    if (s.role !== 'source') continue;
    const type = s.citation.type ?? 'other';
    const missing = (REQUIRED[type] ?? ['title']).filter((k) => {
      const v = s.citation[k];
      if (k === 'title') return !(v || s.title);
      if (k === 'year') return !(v || s.citation.date || s.dateMade);
      if (k === 'date') return !(v || s.citation.year || s.dateMade);
      if (k === 'repository') return !(v || s.citation.callNumber);
      return Array.isArray(v) ? !v.length : !v;
    });
    if (missing.length)
      out.push(f('check.citations', 'warning', `“${s.title}” (${type}): citation lacks ${missing.join(', ')}.`, { sourceId: s.id, command: 'source.citation' }));
  }
  return out;
};

// ---------- numbers ----------

export const checkNumber: CheckFn = (d) => {
  const out: Finding[] = [];
  const tol = d.settings.numberTolerance ?? 0;
  const mat = d.settings.materiality;
  for (const c of claimsOf(d)) {
    const cf = figures(c.text);
    if (!cf.length) continue;
    const ties = confirmedTies(d, c.id);
    const anchored = ties.flatMap((t) => {
      const a = anchorOf(d, t);
      return a ? figures(a.exact).map((n) => ({ n, t, a })) : [];
    });
    if (!anchored.length) continue;
    for (const n of cf) {
      if (anchored.some((x) => numbersAgree(n, x.n, tol).agree)) continue;
      const near = closest(n, anchored.map((x) => x.n));
      const x = anchored.find((y) => y.n === near)!;
      const r = numbersAgree(n, near!, tol);
      const trivial = mat !== undefined && Number.isFinite(r.difference) && r.difference <= mat;
      out.push(
        f('check.number', trivial ? 'info' : 'error', `${label(c)}: ${n.raw} not found in the tied passages. Nearest: ${r.reason}${trivial ? ' Trivial (within materiality).' : ''}`, {
          claimId: c.id, tieId: x.t.id, anchorId: x.a.id, sourceId: x.a.sourceId,
        }),
      );
    }
  }
  return out;
};

export const checkSum: CheckFn = (d) => {
  const out: Finding[] = [];
  for (const t of Object.values(d.ties)) {
    if (t.kind !== 'sum-of' || t.state !== 'confirmed') continue;
    const c = d.claims[t.claimId];
    if (!c) continue;
    const total = mainFigure(c.text);
    const parts = (t.partClaimIds ?? []).map((id) => d.claims[id]).filter(Boolean).map((p) => ({ p, n: mainFigure(p.text) }));
    if (!total || parts.some((x) => !x.n)) {
      out.push(f('check.sum', 'warning', `${label(c)}: Sum Check cannot find a figure in the total or in every part.`, { claimId: c.id, tieId: t.id }));
      continue;
    }
    const sum = parts.reduce((s, x) => s + x.n!.value, 0);
    const prec = Math.min(total.precision, ...parts.map((x) => x.n!.precision));
    const sumM: NumberMention = { ...total, value: sum, raw: String(+sum.toFixed(Math.max(0, prec))), precision: prec, approx: false };
    const r = numbersAgree(total, sumM, d.settings.numberTolerance ?? 0);
    if (!r.agree)
      out.push(f('check.sum', 'error', `${label(c)}: total ${total.raw} does not equal the sum of claims ${parts.map((x) => x.p.number).join(', ')} (${sumM.raw}).`, { claimId: c.id, tieId: t.id }));
  }
  // Percentages stated with their base and result: "20% of $500 ($100)"
  for (const c of claimsOf(d)) {
    const ns = figures(c.text);
    const pct = ns.find((n) => n.percent);
    if (!pct || ns.length < 3 || !/%\s*of|per ?cent of/i.test(c.text)) continue;
    const others = ns.filter((n) => n !== pct);
    let ok = false;
    for (const base of others)
      for (const res of others) {
        if (base === res) continue;
        const calc: NumberMention = { ...res, value: (pct.value / 100) * base.value, raw: '' };
        if (numbersAgree(res, calc, d.settings.numberTolerance ?? 0).agree) ok = true;
        const pc: NumberMention = { ...pct, value: (res.value / base.value) * 100 };
        if (numbersAgree(pct, pc).agree) ok = true;
      }
    if (!ok) out.push(f('check.sum', 'warning', `${label(c)}: the percentage does not recompute from the other figures in the sentence.`, { claimId: c.id }));
  }
  return out;
};

export const checkPeriod: CheckFn = (d) => {
  const out: Finding[] = [];
  for (const c of claimsOf(d)) {
    if (!figures(c.text).length) continue;
    const years = new Set(parseDates(c.text).map((x) => x.year));
    if (!years.size) continue;
    for (const t of confirmedTies(d, c.id)) {
      const a = anchorOf(d, t);
      if (!a) continue;
      const passageYears = new Set(parseDates(a.exact + ' ' + a.prefix + ' ' + a.suffix).map((x) => x.year));
      const sy = sourceYear(d.sources[a.sourceId]);
      const candidates = passageYears.size ? passageYears : sy ? new Set([sy]) : new Set<number>();
      if (!candidates.size) continue;
      if (![...years].some((y) => candidates.has(y) || candidates.has(y + 1) && passageYears.size === 0))
        out.push(f('check.period', 'warning', `${label(c)}: the claim is about ${[...years].join(', ')} but the tied figure comes from ${[...candidates].join(', ')}.`, { claimId: c.id, tieId: t.id, anchorId: a.id }));
    }
  }
  return out;
};

export const checkUnits: CheckFn = (d) => {
  const out: Finding[] = [];
  for (const c of claimsOf(d)) {
    const cf = figures(c.text);
    for (const t of confirmedTies(d, c.id)) {
      const a = anchorOf(d, t);
      if (!a) continue;
      const af = figures(a.exact);
      for (const n of cf) {
        const m = closest(n, af);
        if (!m) continue;
        if (n.currency && m.currency && n.currency !== m.currency)
          out.push(f('check.units', 'error', `${label(c)}: ${n.raw} is in ${n.currency}, the source figure ${m.raw} in ${m.currency}. State the rate and date used.`, { claimId: c.id, tieId: t.id }));
        else if (n.unit && m.unit && n.unit.replace(/s$/, '') !== m.unit.replace(/s$/, ''))
          out.push(f('check.units', 'warning', `${label(c)}: unit “${n.unit}” in the claim, “${m.unit}” in the source.`, { claimId: c.id, tieId: t.id }));
        else if (n.percent !== m.percent && Math.abs(n.value - m.value) < 1e-9)
          out.push(f('check.units', 'warning', `${label(c)}: ${n.raw} vs ${m.raw}: percentage and plain number.`, { claimId: c.id, tieId: t.id }));
      }
    }
  }
  return out;
};

// ---------- dates ----------

const BIRTH = /\b(born|birth|b\.|baptized|baptised|christened|bapt\.?)\s/i;
const DEATH = /\b(died|death|d\.|buried|burial|deceased)\s/i;

interface PersonFacts { name: string; birth?: { d: DateMention; c: Claim }; death?: { d: DateMention; c: Claim }; parents: { name: string; c: Claim }[] }

function personFacts(d: CaseData): PersonFacts[] {
  const people: PersonFacts[] = [];
  const get = (name: string) => {
    let p = people.find((x) => sameName(x.name, name));
    if (!p) { p = { name, parents: [] }; people.push(p); }
    return p;
  };
  for (const c of claimsOf(d)) {
    const names = findNames(c.text);
    if (!names.length) continue;
    const subject = get(names[0].text);
    const dates = parseDates(c.text);
    const bm = c.text.match(BIRTH);
    const dm = c.text.match(DEATH);
    const dateAfter = (idx: number) => dates.find((x) => x.start >= idx) ?? dates[0];
    if (bm && dates.length) { const x = dateAfter(bm.index!); if (x) subject.birth = { d: x, c }; }
    if (dm && dates.length) { const x = dateAfter(dm.index!); if (x && (!bm || x !== subject.birth?.d)) subject.death = { d: x, c }; }
    const rel = c.text.match(/\b(?:son|daughter|child)\s+of\s+([A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+){0,3})/);
    if (rel) subject.parents.push({ name: rel[1], c });
  }
  return people;
}

const YEAR = 365.25;

export const checkDates: CheckFn = (d) => {
  const out: Finding[] = [];
  const people = personFacts(d);
  for (const p of people) {
    if (p.birth && p.death && compareDates(p.death.d, p.birth.d) === -1)
      out.push(f('check.dates', 'error', `${p.name}: died (${p.death.d.raw}, claim ${p.death.c.number}) before being born (${p.birth.d.raw}, claim ${p.birth.c.number}).`, { claimId: p.death.c.id }));
    for (const par of p.parents) {
      const parent = people.find((x) => x !== p && sameName(x.name, par.name));
      if (!parent || !p.birth) continue;
      const cb = dateRange(p.birth.d);
      if (parent.birth) {
        const pb = dateRange(parent.birth.d);
        if (cb.max < pb.min + 12 * YEAR)
          out.push(f('check.dates', 'error', `${p.name} (born ${p.birth.d.raw}) is claimed as a child of ${parent.name} (born ${parent.birth.d.raw}): the parent would be under 12.`, { claimId: par.c.id }));
      }
      if (parent.death) {
        const pd = dateRange(parent.death.d);
        if (cb.min > pd.max + YEAR)
          out.push(f('check.dates', 'warning', `${p.name} (born ${p.birth.d.raw}) was born more than a year after the death of ${parent.name} (${parent.death.d.raw}).`, { claimId: par.c.id }));
      }
    }
  }
  // A record dated before the event it reports.
  for (const c of claimsOf(d)) {
    const cd = parseDates(c.text)[0];
    if (!cd) continue;
    for (const t of confirmedTies(d, c.id)) {
      const a = anchorOf(d, t);
      const s = a ? d.sources[a.sourceId] : undefined;
      const sd = s?.dateMade ? parseDates(s.dateMade)[0] : undefined;
      if (sd && compareDates(sd, cd) === -1)
        out.push(f('check.dates', 'warning', `${label(c)}: “${s!.title}” is dated ${s!.dateMade}, before the event it is tied to (${cd.raw}).`, { claimId: c.id, tieId: t.id, sourceId: s!.id }));
    }
  }
  return out;
};

export const checkCalendar: CheckFn = (d) => {
  const out: Finding[] = [];
  for (const c of claimsOf(d)) {
    const cds = parseDates(c.text);
    if (!cds.length) continue;
    for (const t of confirmedTies(d, c.id)) {
      const a = anchorOf(d, t);
      if (!a) continue;
      for (const ad of parseDates(a.exact)) {
        for (const cd of cds) {
          if (ad.dual && (cd.year === ad.dual.oldYear || cd.year === ad.dual.newYear) && !cd.dual && cd.year !== ad.year)
            out.push(f('check.calendar', 'info', `${label(c)}: the source dual-dates ${ad.raw}; the claim's ${cd.raw} uses the ${cd.year === ad.dual.oldYear ? 'old-style (year began 25 March)' : 'new-style'} year.`, { claimId: c.id, tieId: t.id }));
          else if (ad.dual && cd.year === ad.dual.oldYear && ad.dual.oldYear !== ad.dual.newYear)
            out.push(f('check.calendar', 'info', `${label(c)}: ${cd.raw} is the old-style year of the source's ${ad.raw}; on today's calendar the year is ${ad.dual.newYear}.`, { claimId: c.id, tieId: t.id }));
          if (cd.day && ad.day && cd.month && ad.month) {
            const calA = ad.calendar ?? (ad.dual ? 'julian' : 'gregorian');
            const calC = cd.calendar ?? 'gregorian';
            const literal = cd.year === ad.year && cd.month === ad.month && cd.day === ad.day;
            const ja = toJdn(ad.dual?.newYear ?? ad.year, ad.month, ad.day, calA);
            const jc = toJdn(cd.year, cd.month, cd.day, calC);
            if (literal && calA !== calC)
              out.push(f('check.calendar', 'info', `${label(c)}: same day and month as the source, but the source is ${calA} and the claim ${calC}; they are ${Math.abs(ja - jc)} days apart.`, { claimId: c.id, tieId: t.id }));
            else if (!literal && ja === jc)
              out.push(f('check.calendar', 'info', `${label(c)}: ${cd.raw} (${calC}) is the same day as the source's ${ad.raw} (${calA}).`, { claimId: c.id, tieId: t.id }));
          }
        }
      }
    }
  }
  return out;
};

export const checkAges: CheckFn = (d) => {
  const out: Finding[] = [];
  for (const c of claimsOf(d)) {
    if (!BIRTH.test(c.text + ' ')) continue;
    const by = parseDates(c.text)[0];
    if (!by) continue;
    for (const t of Object.values(d.ties).filter((x) => x.claimId === c.id && x.state === 'confirmed')) {
      const a = anchorOf(d, t);
      if (!a) continue;
      const am = a.exact.match(/\b(?:age|aged)\s*:?\s*(\d{1,3})\b|\b(\d{1,3})\s*(?:years?|yrs?\.?)\s*(?:old|of age)\b/i);
      if (!am) continue;
      const age = +(am[1] ?? am[2]);
      const s = d.sources[a.sourceId];
      const ref = parseDates(a.exact).find((x) => x.year > 1000) ?? (s?.dateMade ? parseDates(s.dateMade)[0] : undefined);
      if (!ref) continue;
      const implied = ref.year - age;
      const r = dateRange(by);
      const minY = Math.floor((r.min - toJdn(0, 1, 1)) / YEAR);
      const maxY = Math.floor((r.max - toJdn(0, 1, 1)) / YEAR);
      if (implied < minY - 1 || implied - 1 > maxY)
        out.push(f('check.ages', 'warning', `${label(c)}: age ${age} in ${ref.year} implies birth about ${implied - 1}–${implied}, not ${by.raw}.`, { claimId: c.id, tieId: t.id, anchorId: a.id }));
    }
  }
  return out;
};

// ---------- evidence ----------

export const checkIndependence: CheckFn = (d) => {
  const out: Finding[] = [];
  for (const c of claimsOf(d)) {
    const srcs = [...new Set(confirmedTies(d, c.id).map((t) => anchorOf(d, t)?.sourceId).filter(Boolean) as Id[])];
    if (srcs.length < 2) continue;
    const fam = families(d, srcs);
    if (fam.length < srcs.length)
      out.push(f('check.independence', fam.length === 1 ? 'warning' : 'info', `${label(c)}: ${srcs.length} supporting sources, but only ${fam.length} independent (${fam.filter((g) => g.length > 1).map((g) => g.map((id) => d.sources[id]?.title).join(' ← ')).join('; ')}).`, { claimId: c.id }));
  }
  return out;
};

export const checkCircular: CheckFn = (d) => {
  const out = lineageCycles(d).map((cyc) =>
    f('check.circular', 'error', `Circular lineage: ${cyc.map((id) => d.sources[id]?.title ?? id).join(' → ')} → back to the first.`, { sourceId: cyc[0] }),
  );
  // Two sources each mentioning the other's title in notes (citing each other).
  const ss = Object.values(d.sources).filter((s) => s.role === 'source' && s.title.length > 4);
  for (let i = 0; i < ss.length; i++)
    for (let j = i + 1; j < ss.length; j++) {
      const a = ss[i];
      const b = ss[j];
      const aCitesB = (a.notes ?? '').includes(b.title) || a.derivedFrom.some((x) => x.sourceId === b.id);
      const bCitesA = (b.notes ?? '').includes(a.title) || b.derivedFrom.some((x) => x.sourceId === a.id);
      if (aCitesB && bCitesA && !out.some((x) => x.sourceId === a.id || x.sourceId === b.id))
        out.push(f('check.circular', 'warning', `“${a.title}” and “${b.title}” cite each other.`, { sourceId: a.id }));
    }
  return out;
};

export const checkStale: CheckFn = (d) => {
  const out: Finding[] = [];
  for (const t of Object.values(d.ties)) {
    if (t.state !== 'confirmed') continue;
    const c = d.claims[t.claimId];
    const a = anchorOf(d, t);
    if (!c) continue;
    if (t.claimTextAtConfirm !== undefined && t.claimTextAtConfirm !== c.text)
      out.push(f('check.stale', 'warning', `${label(c)}: wording changed after a tie was confirmed. Re-confirm it.`, { claimId: c.id, tieId: t.id, command: 'tie.confirm' }));
    if (a?.broken) out.push(f('check.stale', 'error', `${label(c)}: an anchor could not be found again in its source.`, { claimId: c.id, tieId: t.id, anchorId: a.id, command: 'anchor.reanchor' }));
    const s = a ? d.sources[a.sourceId] : undefined;
    if (s?.contentHash && t.sourceHashAtConfirm && s.contentHash !== t.sourceHashAtConfirm)
      out.push(f('check.stale', 'warning', `${label(c)}: “${s.title}” changed after the tie was confirmed.`, { claimId: c.id, tieId: t.id, sourceId: s.id, command: 'anchor.reanchor' }));
  }
  for (const c of claimsOf(d)) {
    if (!c.doc) continue;
    const doc = d.sources[c.doc.documentId];
    if (!doc) out.push(f('check.stale', 'warning', `${label(c)}: its linked document is no longer in the case.`, { claimId: c.id }));
    else if (doc.text.slice(c.doc.start, c.doc.end) !== c.doc.textAtCapture)
      out.push(f('check.stale', 'warning', `${label(c)}: its wording in “${doc.title}” changed since capture.`, { claimId: c.id, command: 'claim.refresh' }));
  }
  return out;
};

export const checkCoverage: CheckFn = (d) => {
  const out: Finding[] = [];
  for (const doc of Object.values(d.sources).filter((s) => s.role === 'document')) {
    const claims = Object.values(d.claims).filter((c) => c.doc?.documentId === doc.id);
    for (const s of splitSentences(doc.text)) {
      if (claims.some((c) => c.doc!.start < s.end && c.doc!.end > s.start)) continue;
      const w = checkWorthiness(s.text);
      if (w.score < 0.25) continue;
      out.push(f('check.coverage', w.score >= 0.45 ? 'warning' : 'info', `“${doc.title}”: no claim covers “${s.text.length > 90 ? s.text.slice(0, 89) + '…' : s.text}” (${w.reasons.join(', ') || 'statement'}).`, { sourceId: doc.id, command: 'claim.capture' }));
    }
  }
  for (const c of claimsOf(d)) {
    if (c.setAside) continue;
    if (!Object.values(d.ties).some((t) => t.claimId === c.id && t.state !== 'rejected'))
      out.push(f('check.coverage', 'warning', `${label(c)} has no tie.`, { claimId: c.id, command: 'nav.nextOpen' }));
  }
  return out;
};

export const checkLinks: CheckFn = (d) =>
  Object.values(d.sources)
    .filter((s) => s.url && !s.capturedAt && (s.kind === 'web' || s.citation.type === 'web'))
    .map((s) => f('check.links', 'warning', `“${s.title}” is a web source with no saved capture; the page may change or disappear.`, { sourceId: s.id, command: 'source.captureWeb' }));

export const checkWeakPoints: CheckFn = (d) => {
  const out: Finding[] = [];
  for (const c of claimsOf(d)) {
    if (c.setAside) continue;
    const ties = confirmedTies(d, c.id);
    if (!ties.length) continue;
    const anchors = ties.map((t) => anchorOf(d, t)).filter(Boolean) as Anchor[];
    const srcs = [...new Set(anchors.map((a) => a.sourceId))].map((id) => d.sources[id]).filter(Boolean);
    const weak: string[] = [];
    if (srcs.length === 1) weak.push('rests on one source');
    if (srcs.length && srcs.every((s) => s.classification === 'derivative')) weak.push('only derivative sources');
    if (anchors.length && anchors.every((a) => a.knowledge === 'second-hand')) weak.push('only second-hand information');
    const bad = srcs.filter((s) => /unreliable|not reliable|doubtful/i.test(s.reliability ?? ''));
    if (bad.length) weak.push(`source marked unreliable (${bad.map((s) => s.title).join(', ')})`);
    if (weak.length)
      out.push(f('check.weakPoints', c.importance === 'high' ? 'warning' : 'info', `${label(c)}: ${weak.join('; ')}.`, { claimId: c.id }));
  }
  return out;
};

export const checkRules: CheckFn = (d) => {
  const out: Finding[] = [];
  for (const r of Object.values(d.rules)) {
    if (!r.enabled) continue;
    let re: RegExp;
    try { re = new RegExp(r.pattern, 'i'); } catch { out.push(f('check.rules', 'error', `Rule “${r.name}”: invalid pattern.`)); continue; }
    for (const c of claimsOf(d)) {
      if (c.setAside || !re.test(c.text)) continue;
      const ties = confirmedTies(d, c.id);
      const anchors = ties.map((t) => anchorOf(d, t)).filter(Boolean) as Anchor[];
      const fam = families(d, anchors.map((a) => a.sourceId)).length;
      let ok = true;
      switch (r.condition) {
        case 'minSupports': ok = ties.length >= r.value; break;
        case 'minIndependent': ok = fam >= r.value; break;
        case 'requiresTick': ok = ties.length > 0 && ties.every((t) => !!t.tick); break;
        case 'requiresFirstHand': ok = anchors.some((a) => a.knowledge === 'first-hand'); break;
        case 'numberAbove': {
          const n = mainFigure(c.text);
          ok = !n || Math.abs(n.value) <= r.value || fam >= 2;
          break;
        }
      }
      if (!ok) out.push(f('check.rules', 'warning', `${label(c)}: ${r.message || r.name}`, { claimId: c.id }));
    }
  }
  return out;
};

// ---------- new checks ----------

const LABEL_STOP = new Set([...STOP, 'about', 'around', 'approximately', 'nearly', 'some', 'over', 'total', 'just', 'only', 'roughly', 'almost', 'up', 'down', 'reached', 'stood', 'came', 'amounted', 'totaled', 'totalled', 'rose', 'fell', 'grew', 'increased', 'decreased', 'reported', 'had', 'were', 'was', 'of']);

function labelBefore(text: string, start: number): string | undefined {
  const words = text.slice(Math.max(0, start - 60), start).toLowerCase().split(/[^a-z']+/).filter(Boolean);
  for (let i = words.length - 1; i >= Math.max(0, words.length - 4); i--) if (!LABEL_STOP.has(words[i]) && words[i].length > 2) return words[i];
  return undefined;
}

export const checkNumberConsistency: CheckFn = (d) => {
  const out: Finding[] = [];
  for (const doc of Object.values(d.sources).filter((s) => s.role === 'document')) {
    const groups = new Map<string, { n: NumberMention; years: string; sent: string }[]>();
    for (const s of splitSentences(doc.text)) {
      const years = parseDates(s.text).map((x) => x.year).sort().join(',');
      for (const n of figures(s.text)) {
        const l = labelBefore(s.text, n.start);
        if (!l) continue;
        const key = `${l}|${n.percent ? '%' : n.currency ?? n.unit ?? ''}`;
        groups.set(key, [...(groups.get(key) ?? []), { n, years, sent: s.text }]);
      }
    }
    for (const [key, list] of groups) {
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          if (a.years !== b.years) continue;
          if (numbersAgree(a.n, b.n).agree) continue;
          out.push(f('check.numberConsistency', 'warning', `“${doc.title}” states ${key.split('|')[0]} as ${a.n.raw} and as ${b.n.raw}.`, { sourceId: doc.id }));
          i = list.length;
          break;
        }
    }
  }
  return out;
};

export const checkSelfContradiction: CheckFn = (d) => {
  const out: Finding[] = [];
  const people = new Map<string, { c: Claim; birth?: DateMention; death?: DateMention }[]>();
  for (const c of claimsOf(d)) {
    const n = findNames(c.text)[0];
    if (!n) continue;
    const key = [...people.keys()].find((k) => sameName(k, n.text)) ?? n.text;
    const dates = parseDates(c.text);
    const entry = { c, birth: BIRTH.test(c.text + ' ') ? dates[0] : undefined, death: DEATH.test(c.text + ' ') ? dates[0] : undefined };
    people.set(key, [...(people.get(key) ?? []), entry]);
  }
  for (const [name, list] of people)
    for (const kind of ['birth', 'death'] as const) {
      const xs = list.filter((x) => x[kind]);
      for (let i = 0; i < xs.length; i++)
        for (let j = i + 1; j < xs.length; j++)
          if (compareDates(xs[i][kind]!, xs[j][kind]!) !== 0)
            out.push(f('check.selfContradiction', 'warning', `${name}: claims ${xs[i].c.number} and ${xs[j].c.number} give different ${kind} dates (${xs[i][kind]!.raw}, ${xs[j][kind]!.raw}).`, { claimId: xs[j].c.id }));
    }
  // Same labelled quantity across claims
  const q = new Map<string, { c: Claim; n: NumberMention; years: string }[]>();
  for (const c of claimsOf(d)) {
    const years = parseDates(c.text).map((x) => x.year).sort().join(',');
    for (const n of figures(c.text)) {
      const l = labelBefore(c.text, n.start);
      if (l) q.set(l, [...(q.get(l) ?? []), { c, n, years }]);
    }
  }
  for (const [l, list] of q)
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        if (list[i].c.id !== list[j].c.id && list[i].years === list[j].years && list[i].n.percent === list[j].n.percent && !numbersAgree(list[i].n, list[j].n).agree)
          out.push(f('check.selfContradiction', 'warning', `Claims ${list[i].c.number} and ${list[j].c.number} give ${l} as ${list[i].n.raw} and ${list[j].n.raw}.`, { claimId: list[j].c.id }));
  return out;
};

export const checkPrecision: CheckFn = (d) => {
  const out: Finding[] = [];
  for (const c of claimsOf(d)) {
    for (const t of confirmedTies(d, c.id)) {
      const a = anchorOf(d, t);
      if (!a) continue;
      const af = figures(a.exact);
      for (const n of figures(c.text)) {
        const m = closest(n, af);
        if (!m || !numbersAgree(n, m).agree) continue;
        if (n.precision > m.precision || (m.approx && !n.approx && n.precision >= m.precision))
          out.push(f('check.precision', 'warning', `${label(c)}: states ${n.raw}${n.approx ? '' : ' as exact'}, but the source says ${m.approx ? 'about ' : ''}${m.raw}.`, { claimId: c.id, tieId: t.id }));
      }
    }
  }
  return out;
};

const CERTAIN = /\b(proves?|proven|always|never|will|definitely|certainly|undoubtedly|clearly|conclusively|all|every|must|confirms?)\b/i;
const HEDGE = /\b(may|might|possibly|perhaps|suggests?|about|approximately|probably|likely|appears?|seems?|could|estimated|reportedly|alleged(ly)?|believed)\b/i;

export const checkHedging: CheckFn = (d) => {
  const out: Finding[] = [];
  for (const c of claimsOf(d)) {
    const cm = c.text.match(CERTAIN);
    if (!cm || HEDGE.test(c.text)) continue;
    for (const t of confirmedTies(d, c.id)) {
      const a = anchorOf(d, t);
      const hm = a?.exact.match(HEDGE);
      if (hm)
        out.push(f('check.hedging', 'warning', `${label(c)}: says “${cm[0]}” but the source hedges (“${hm[0]}”).`, { claimId: c.id, tieId: t.id }));
    }
  }
  return out;
};

export const checkRecency: CheckFn = (d, opts) => {
  const out: Finding[] = [];
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const nowY = +today.slice(0, 4);
  const limit = d.settings.recencyYears ?? 5;
  for (const c of claimsOf(d)) {
    if (!/\b(currently|now|today|latest|as of|at present|presently|this year|recent(ly)?)\b/i.test(c.text)) continue;
    const srcs = confirmedTies(d, c.id).map((t) => anchorOf(d, t)).filter(Boolean).map((a) => d.sources[a!.sourceId]).filter(Boolean);
    if (!srcs.length) continue;
    const years = srcs.map(sourceYear);
    if (years.every((y) => y !== undefined && nowY - y! > limit))
      out.push(f('check.recency', 'warning', `${label(c)}: speaks of the present, but its newest source is from ${Math.max(...(years as number[]))}.`, { claimId: c.id }));
  }
  return out;
};

export const checkMateriality: CheckFn = (d) => {
  const mat = d.settings.materiality;
  if (mat === undefined) return [];
  const diffs = checkNumber(d, {}).filter((x) => x.severity === 'error');
  if (!diffs.length) return [];
  return [f('check.materiality', 'warning', `${diffs.length} figure difference(s) exceed the materiality threshold of ${mat}: claims ${[...new Set(diffs.map((x) => d.claims[x.claimId!]?.number))].join(', ')}.`)];
};

export const CHECKS: Record<string, CheckFn> = {
  'check.quote': checkQuote,
  'check.paraphrase': checkParaphrase,
  'check.names': checkNames,
  'check.citations': checkCitations,
  'check.number': checkNumber,
  'check.sum': checkSum,
  'check.period': checkPeriod,
  'check.units': checkUnits,
  'check.dates': checkDates,
  'check.calendar': checkCalendar,
  'check.ages': checkAges,
  'check.independence': checkIndependence,
  'check.circular': checkCircular,
  'check.stale': checkStale,
  'check.coverage': checkCoverage,
  'check.links': checkLinks,
  'check.weakPoints': checkWeakPoints,
  'check.rules': checkRules,
  'check.numberConsistency': checkNumberConsistency,
  'check.selfContradiction': checkSelfContradiction,
  'check.precision': checkPrecision,
  'check.hedging': checkHedging,
  'check.recency': checkRecency,
  'check.materiality': checkMateriality,
};

export function runChecks(data: CaseData, opts: CheckOptions = {}): Finding[] {
  seq = 0;
  const ids = opts.only?.length ? opts.only : Object.keys(CHECKS);
  let out: Finding[] = [];
  for (const id of ids) {
    const fn = CHECKS[id];
    if (!fn) continue;
    try {
      out.push(...fn(data, opts));
    } catch (e) {
      out.push(f(id, 'error', `${id} failed: ${(e as Error).message}`));
    }
  }
  if (opts.claimIds?.length) {
    const set = new Set(opts.claimIds);
    out = out.filter((x) => x.claimId && set.has(x.claimId));
  }
  const rank = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Fails a confirmed supporting tie whose quotation or figure does not match its passage. */
export const quickTieTest: TieTest = (tie, data) => {
  if (tie.state !== 'confirmed' || tie.kind !== 'supports' || !tie.anchorId) return null;
  const c = data.claims[tie.claimId];
  const a = data.anchors[tie.anchorId];
  if (!c || !a) return null;
  if (c.kind === 'quotation') {
    const r = quoteMatches(c.text, a.exact);
    if (!r.ok) return `Quote Check: claim ${c.number} differs from the passage in “${data.sources[a.sourceId]?.title ?? '?'}”.`;
    return null;
  }
  if (c.kind === 'number') {
    const n = mainFigure(c.text);
    const af = figures(a.exact);
    if (n && af.length && !af.some((m) => numbersAgree(n, m, data.settings.numberTolerance ?? 0).agree))
      return `Number Check: ${n.raw} in claim ${c.number} is not in the tied passage.`;
  }
  return null;
};
