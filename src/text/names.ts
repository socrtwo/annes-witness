// Personal names: normalization, sound-alike codes, similarity and clustering.
const TITLES = /\b(mr|mrs|ms|miss|dr|rev|sir|dame|lord|lady|capt|col|gen|lt|sgt|prof|hon|jr|sr|esq|ii|iii|iv)\.?(?=\s|$)/gi;

export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizeName(s: string): string {
  let t = stripDiacritics(s).trim();
  const comma = t.match(/^([^,]+),\s*(.+)$/);
  if (comma) t = `${comma[2]} ${comma[1]}`;
  return t.replace(TITLES, ' ').replace(/[^A-Za-z' -]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function soundex(s: string): string {
  const t = stripDiacritics(s).toUpperCase().replace(/[^A-Z]/g, '');
  if (!t) return '';
  const code: Record<string, string> = {
    B: '1', F: '1', P: '1', V: '1', C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2', D: '3', T: '3', L: '4', M: '5', N: '5', R: '6',
  };
  let out = t[0];
  let prev = code[t[0]] ?? '';
  for (let i = 1; i < t.length && out.length < 4; i++) {
    const c = t[i];
    const d = code[c] ?? '';
    if (d && d !== prev) out += d;
    if (c !== 'H' && c !== 'W') prev = d;
  }
  return out.padEnd(4, '0');
}

export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const win = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false);
  const bm = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - win); j < Math.min(b.length, i + win + 1); j++) {
      if (!bm[j] && a[i] === b[j]) { am[i] = bm[j] = true; matches++; break; }
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  return (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
}

export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let l = 0;
  while (l < 4 && l < a.length && l < b.length && a[l] === b[l]) l++;
  return j + l * 0.1 * (1 - j);
}

function initialsCompatible(a: string[], b: string[]): boolean {
  // Given names: each pair either equal-ish or one is the initial of the other.
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (x.length === 1 || y.length === 1) {
      if (x[0] !== y[0]) return false;
    } else if (jaroWinkler(x, y) < 0.8) return false;
  }
  return true;
}

/** Probably the same person? */
export function sameName(a: string, b: string): boolean {
  const na = normalizeName(a).split(' ').filter(Boolean);
  const nb = normalizeName(b).split(' ').filter(Boolean);
  if (!na.length || !nb.length) return false;
  const sa = na[na.length - 1];
  const sb = nb[nb.length - 1];
  if (soundex(sa) !== soundex(sb)) return false;
  if (na.length === 1 || nb.length === 1) return jaroWinkler(sa, sb) >= 0.88;
  const ga = na.slice(0, -1);
  const gb = nb.slice(0, -1);
  if (!initialsCompatible(ga, gb)) return false;
  const full = jaroWinkler(na.join(' '), nb.join(' '));
  const hasInitial = [...ga, ...gb].some((g) => g.length === 1);
  return full >= 0.88 || (hasInitial && jaroWinkler(sa, sb) >= 0.9);
}

/** Cluster names that probably refer to the same person; clusters with variant spellings only. */
export function nameVariants(names: string[]): string[][] {
  const uniq = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const groups: string[][] = [];
  for (const n of uniq) {
    const g = groups.find((gr) => gr.some((x) => sameName(x, n)));
    if (g) g.push(n);
    else groups.push([n]);
  }
  return groups.filter((g) => new Set(g.map(normalizeName)).size > 1);
}

const STOP = new Set([
  'The', 'A', 'An', 'In', 'On', 'At', 'Of', 'And', 'But', 'Or', 'For', 'To', 'From', 'By', 'With', 'This', 'That', 'These', 'Those',
  'He', 'She', 'They', 'We', 'I', 'It', 'His', 'Her', 'Their', 'Our', 'My', 'When', 'Where', 'After', 'Before', 'During', 'If',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'According', 'However', 'Although', 'As',
]);

/** Capitalized sequences of 2–4 words that look like names (not months, weekdays or sentence openers). */
export function findNames(text: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  const re = /\b([A-Z][a-z'’-]+|[A-Z]\.)(?:\s+(?:[A-Z][a-z'’-]+|[A-Z]\.|de|van|von|der|la|le|di|da|O'[A-Z][a-z]+|Mc[A-Z][a-z]+)){1,3}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let words = m[0].split(/\s+/);
    let start = m.index;
    while (words.length && STOP.has(words[0].replace(/\.$/, ''))) {
      start += text.slice(start).indexOf(words[0]) + words[0].length;
      while (/\s/.test(text[start])) start++;
      words = words.slice(1);
    }
    while (words.length && STOP.has(words[words.length - 1])) words = words.slice(0, -1);
    if (words.length < 2) continue;
    if (/^(de|van|von|der|la|le|di|da)$/.test(words[words.length - 1])) words = words.slice(0, -1);
    if (words.length < 2) continue;
    const s = text.indexOf(words[0], start);
    let e = s;
    for (const w of words) e = text.indexOf(w, e) + w.length;
    out.push({ start: s, end: e, text: text.slice(s, e) });
  }
  return out;
}
