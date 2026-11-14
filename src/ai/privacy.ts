// Screen for Private Information. Runs on the device only; nothing is sent anywhere.
export interface PrivacyHit { start: number; end: number; kind: string; text: string }

const PATTERNS: [string, RegExp][] = [
  ['Email address', /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g],
  ['Phone number', /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g],
  ['US Social Security number', /\b\d{3}-\d{2}-\d{4}\b/g],
  ['Card or account number', /\b(?:\d[ -]?){13,19}\b/g],
  ['IBAN', /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}\b/g],
  ['Street address', /\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Court|Ct|Boulevard|Blvd|Way)\b\.?/g],
  ['Health information', /\b(?:diagnos\w+|HIV|cancer|pregnan\w+|psychiatric|medication|prescription|disabilit\w+)\b/gi],
];

/** Birth years after this are treated as possibly living (about 100 years ago). */
export function livingCutoff(today = new Date()): number {
  return today.getFullYear() - 100;
}

export function screenText(text: string, today = new Date()): PrivacyHit[] {
  const hits: PrivacyHit[] = [];
  for (const [kind, re] of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) hits.push({ start: m.index, end: m.index + m[0].length, kind, text: m[0] });
  }
  const cut = livingCutoff(today);
  const born = /\b(?:born|b\.|birth|DOB|date of birth)[:\s]+(?:[A-Za-z]+\.?\s+)?(?:\d{1,2}[\s,/.-]+)?(?:[A-Za-z]+\.?\s+)?(\d{4})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = born.exec(text))) if (Number(m[1]) > cut) hits.push({ start: m.index, end: m.index + m[0].length, kind: 'Birth date of a possibly living person', text: m[0] });
  return hits.sort((a, b) => a.start - b.start);
}

export function redact(text: string, hits: PrivacyHit[]): string {
  let out = '';
  let pos = 0;
  for (const h of [...hits].sort((a, b) => a.start - b.start)) {
    if (h.start < pos) continue;
    out += text.slice(pos, h.start) + '█'.repeat(Math.min(12, h.end - h.start));
    pos = h.end;
  }
  return out + text.slice(pos);
}
