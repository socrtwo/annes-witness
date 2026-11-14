// Spelling with nspell and the SCOWL-based English dictionaries (as in Anne's Pen).
import nspell from 'nspell';

export const SPELL_LANGS: Record<string, string> = { 'en-US': 'English (United States)', 'en-GB': 'English (United Kingdom)', 'en-CA': 'English (Canada)', 'en-AU': 'English (Australia)' };

const loaders: Record<string, () => Promise<[string, string]>> = {
  'en-US': async () => [(await import('../../node_modules/dictionary-en/index.aff?raw')).default, (await import('../../node_modules/dictionary-en/index.dic?raw')).default],
  'en-GB': async () => [(await import('../../node_modules/dictionary-en-gb/index.aff?raw')).default, (await import('../../node_modules/dictionary-en-gb/index.dic?raw')).default],
  'en-CA': async () => [(await import('../../node_modules/dictionary-en-ca/index.aff?raw')).default, (await import('../../node_modules/dictionary-en-ca/index.dic?raw')).default],
  'en-AU': async () => [(await import('../../node_modules/dictionary-en-au/index.aff?raw')).default, (await import('../../node_modules/dictionary-en-au/index.dic?raw')).default],
};

export interface Speller { correct(w: string): boolean; suggest(w: string): string[]; add(w: string): void }

const cache = new Map<string, Promise<Speller>>();

export function makeSpeller(aff: string, dic: string): Speller {
  return nspell(aff, dic) as unknown as Speller;
}

export function loadSpeller(lang = 'en-US'): Promise<Speller> {
  const load = loaders[lang] ?? loaders['en-US'];
  if (!cache.has(lang)) cache.set(lang, load().then(([aff, dic]) => makeSpeller(aff, dic)));
  return cache.get(lang)!;
}

export interface Misspelling { word: string; start: number; end: number; suggestions: string[] }

/** Words not in the dictionary. Skips numbers, words with digits, all-capital abbreviations and web addresses. */
export function checkText(sp: Speller, text: string, extra: Set<string> = new Set(), suggest = true): Misspelling[] {
  const out: Misspelling[] = [];
  const re = /[\p{L}][\p{L}'’-]*[\p{L}]|[\p{L}]/gu;
  const urls: [number, number][] = [];
  for (const m of text.matchAll(/https?:\/\/\S+|\b[\w.+-]+@[\w-]+\.[\w.-]+/g)) urls.push([m.index!, m.index! + m[0].length]);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const w = m[0].replace(/[’]/g, "'").replace(/^'+|'+$/g, '');
    const start = m.index;
    if (urls.some(([a, b]) => start >= a && start < b)) continue;
    if (w.length < 2 || /^[A-Z]{2,}$/.test(w) || extra.has(w.toLowerCase())) continue;
    if (sp.correct(w) || sp.correct(w.toLowerCase())) continue;
    if (w.includes('-') && w.split('-').every((p) => !p || sp.correct(p) || sp.correct(p.toLowerCase()))) continue;
    out.push({ word: w, start, end: start + m[0].length, suggestions: suggest ? sp.suggest(w).slice(0, 5) : [] });
  }
  return out;
}
