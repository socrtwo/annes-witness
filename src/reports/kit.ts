// Reader Verification Kit: the document with each claim opening onto its passages. No scripts.
import { CaseData, Id, STATUS_LABEL } from '../core/types';
import { StatusResult } from '../core/status';
import { sourceCitation } from './citation';
import { evidenceFor, htmlPage, h, badge, citeHtml } from './common';

export function readerKitHtml(d: CaseData, statuses: Record<Id, StatusResult>, documentId: Id, includeConfidential = false): string {
  const doc = d.sources[documentId];
  if (!doc) return htmlPage('Reader Verification Kit', '<p>No such document.</p>');
  const claims = Object.values(d.claims).filter((c) => c.doc?.documentId === documentId).sort((a, b) => a.doc!.start - b.doc!.start);
  const parts: string[] = [];
  let pos = 0;
  const notes: string[] = [];
  for (const c of claims) {
    if (c.doc!.start < pos) continue; // overlapping claims: keep the first
    parts.push(h(doc.text.slice(pos, c.doc!.start)));
    const st = statuses[c.id]?.status ?? 'open';
    const ev = [...evidenceFor(d, c.id, ['supports'], includeConfidential), ...evidenceFor(d, c.id, ['contradicts'], includeConfidential)];
    const inner = ev.length
      ? ev.map((e) => `<div class="ev ${e.tie.kind}"><div class="k">${e.tie.kind === 'supports' ? 'Supports' : 'Contradicts'}${e.where ? ' · ' + h(e.where) : ''}</div><blockquote>${h(e.anchor.exact)}</blockquote><div class="cite">${citeHtml(sourceCitation(e.source, d.settings.citationStyle))}</div></div>`).join('')
      : '<p class="muted">No confirmed passage yet.</p>';
    const rk = Object.values(d.reckonings).find((r) => r.claimId === c.id);
    const concl = rk?.conclusion ? `<p><strong>Conclusion:</strong> ${h(rk.conclusion)}</p>` : '';
    parts.push(`<details id="claim-${c.number}" class="claim s-${st}"><summary>${h(doc.text.slice(c.doc!.start, c.doc!.end))}<sup>${c.number}</sup></summary><div class="box">${badge(st)} ${inner}${concl}</div></details>`);
    notes.push(`<li><a href="#claim-${c.number}">Claim ${c.number}</a>: ${h(STATUS_LABEL[st])}</li>`);
    pos = c.doc!.end;
  }
  parts.push(h(doc.text.slice(pos)));
  const body = `<h1>${h(doc.title)}</h1>
<p class="muted">Each underlined passage opens to show the sources that back it. Prepared with Anne's Witness${d.settings.author ? ' by ' + h(d.settings.author) : ''}.</p>
<div class="doc">${parts.join('').replace(/\n\n+/g, '<br><br>')}</div>
<h2>Index of claims</h2><ol class="idx">${notes.join('')}</ol>`;
  return htmlPage(`${doc.title}: sources`, body, `
details.claim{display:inline} details.claim>summary{display:inline;cursor:pointer;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px;list-style:none}
details.claim>summary::-webkit-details-marker{display:none}
details.claim sup{font:10px system-ui;margin-left:1px}
.s-corroborated>summary,.s-supported>summary,.s-settled>summary{text-decoration-color:#1f7a3d}
.s-disputed>summary{text-decoration-color:#c0392b;text-decoration-style:wavy}
.s-open>summary,.s-stale>summary{text-decoration-color:#999;text-decoration-style:dotted}
.box{display:block;border:1px solid var(--line);border-radius:6px;padding:8px 12px;margin:6px 0;font-size:15px}
.ev{margin:6px 0}.ev .k{font:12px system-ui;color:var(--muted)}.ev.contradicts blockquote{border-left-color:#c0392b}.cite{font-size:13px}
ol.idx{list-style:none;padding:0}`);
}
