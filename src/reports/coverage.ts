// Coverage report: the document with each sentence shaded by the strength of its claims.
import { CaseData, Id, Status, STATUS_LABEL } from '../core/types';
import { StatusResult } from '../core/status';
import { splitSentences } from '../text/sentences';
import { htmlPage, h, STATUS_COLOR, STATUS_ORDER, STRENGTH } from './common';

const PATTERN: Record<Status, string> = {
  corroborated: 'none', supported: 'none', settled: 'none',
  'set-aside': 'repeating-linear-gradient(90deg, transparent 0 6px, rgba(0,0,0,.08) 6px 7px)',
  disputed: 'repeating-linear-gradient(45deg, transparent 0 5px, rgba(0,0,0,.18) 5px 7px)',
  stale: 'repeating-linear-gradient(-45deg, transparent 0 5px, rgba(0,0,0,.14) 5px 7px)',
  open: 'none',
};

export function coverageHtml(d: CaseData, statuses: Record<Id, StatusResult>, documentId: Id): string {
  const doc = d.sources[documentId];
  if (!doc) return htmlPage('Coverage', '<p>No such document.</p>');
  const claims = Object.values(d.claims).filter((c) => c.doc?.documentId === documentId);
  let covered = 0;
  const sents = splitSentences(doc.text);
  const parts: string[] = [];
  let pos = 0;
  for (const s of sents) {
    parts.push(h(doc.text.slice(pos, s.start)).replace(/\n\n+/g, '</p><p>'));
    const over = claims.filter((c) => c.doc!.start < s.end && c.doc!.end > s.start);
    let html = h(s.text);
    if (over.length) {
      covered++;
      // The weakest status among the sentence's claims decides the shading.
      const st = over.map((c) => statuses[c.id]?.status ?? 'open').sort((a, b) => STRENGTH[a] - STRENGTH[b])[0];
      const alpha = 0.18 + 0.4 * STRENGTH[st];
      const col = STATUS_COLOR[st];
      const rgba = `rgba(${parseInt(col.slice(1, 3), 16)},${parseInt(col.slice(3, 5), 16)},${parseInt(col.slice(5, 7), 16)},${alpha.toFixed(2)})`;
      const nums = over.map((c) => c.number).join(', ');
      html = `<mark title="Claim ${nums}: ${h(STATUS_LABEL[st])}" class="s-${st}" style="background-color:${rgba};background-image:${PATTERN[st]}">${html}<sup>${nums}</sup></mark>`;
    } else html = `<span class="none">${html}</span>`;
    parts.push(html);
    pos = s.end;
  }
  parts.push(h(doc.text.slice(pos)));
  const legend = STATUS_ORDER.map((s) => `<span class="lg" style="background-color:${STATUS_COLOR[s]}33;background-image:${PATTERN[s]}">${h(STATUS_LABEL[s])}</span>`).join(' ') + ' <span class="lg none">No claim</span>';
  const body = `<h1>Coverage: ${h(doc.title)}</h1>
<p class="muted">${covered} of ${sents.length} sentences have at least one claim. Shading shows the weakest status among a sentence’s claims; disputed, stale and set-aside claims are also patterned.</p>
<p>${legend}</p><hr><p>${parts.join('')}</p>`;
  return htmlPage(`Coverage: ${doc.title}`, body, `mark{color:inherit;padding:0 1px;border-radius:2px} mark sup{font:10px system-ui;margin-left:2px} .none{text-decoration:underline dotted #999} .lg{display:inline-block;padding:2px 8px;border:1px solid #ccc;border-radius:4px;font:13px system-ui;margin:2px}`);
}
