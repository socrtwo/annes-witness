// Sentence splitting that respects abbreviations, initials, decimals and quotes.
export interface Span { start: number; end: number; text: string }

const ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'no', 'nos', 'vs', 'etc', 'e.g', 'i.e', 'prof', 'rev', 'gen', 'col', 'lt',
  'capt', 'sgt', 'gov', 'sen', 'rep', 'hon', 'mt', 'ft', 'co', 'corp', 'inc', 'ltd', 'bros', 'vol', 'p', 'pp', 'ch',
  'fig', 'figs', 'ed', 'eds', 'cf', 'al', 'approx', 'ca', 'c', 'abt', 'bef', 'aft', 'b', 'd', 'm', 'bapt', 'bur',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'u.s', 'u.k', 'a.m', 'p.m', 'n.s', 'o.s',
]);

export function splitSentences(text: string): Span[] {
  const out: Span[] = [];
  let start = 0;
  const push = (end: number) => {
    let s = start;
    let e = end;
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e > s) out.push({ start: s, end: e, text: text.slice(s, e) });
    start = end;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    // Paragraph break ends a sentence.
    if (c === '\n') {
      let j = i + 1;
      while (j < text.length && (text[j] === ' ' || text[j] === '\t' || text[j] === '\r')) j++;
      if (text[j] === '\n' || j >= text.length) {
        push(i);
        continue;
      }
      continue;
    }
    if (c !== '.' && c !== '!' && c !== '?' && c !== '…') continue;
    // Ellipsis inside a sentence: "..." followed by lowercase continues.
    let j = i;
    while (j + 1 < text.length && /[.!?…]/.test(text[j + 1])) j++;
    // Closing quotes/brackets after the punctuation belong to the sentence.
    let k = j + 1;
    while (k < text.length && /["'”’)\]]/.test(text[k])) k++;
    if (k < text.length && !/\s/.test(text[k])) { i = j; continue; } // decimals, e.g. 3.14, URLs
    // Next non-space char
    let n = k;
    while (n < text.length && /\s/.test(text[n])) n++;
    if (n >= text.length) { push(k); i = k - 1; continue; }
    const next = text[n];
    if (c === '.' || (c === '…' && j === i)) {
      if (j > i || c === '…') {
        // ellipsis: end only if next starts uppercase
        if (!/[A-Z“"‘]/.test(next)) { i = j; continue; }
      } else {
        // word before the period
        let w = i - 1;
        while (w >= 0 && /[A-Za-z.]/.test(text[w])) w--;
        const word = text.slice(w + 1, i).toLowerCase();
        if (ABBREV.has(word) || ABBREV.has(word.replace(/\.$/, ''))) { i = j; continue; }
        if (/^[a-z]$/i.test(word) && /[A-Z]/.test(text[i - 1])) { i = j; continue; } // initials J. R.
        if (/^([a-z]\.)+[a-z]$/i.test(word)) { i = j; continue; } // U.S.A.
        if (/[a-z,;:]/.test(next)) { i = j; continue; }
      }
    } else if (/[,;:]/.test(next)) { i = j; continue; }
    push(k);
    i = k - 1;
  }
  push(text.length);
  return out;
}
