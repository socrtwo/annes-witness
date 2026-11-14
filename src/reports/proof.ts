// Proof Summary: the question, each claim with its evidence, conflicts and how they were settled.
import { CaseData, STATUS_LABEL } from '../core/types';
import { StatusResult } from '../core/status';
import { sourceCitation, formatBibliography } from './citation';
import { claimsSorted, evidenceFor, htmlPage, h, badge, visible, citeHtml } from './common';

export interface ProofOptions { includeConfidential?: boolean; claimIds?: string[]; title?: string }

export function proofSummary(d: CaseData, statuses: Record<string, StatusResult>, opts: ProofOptions = {}): { markdown: string; html: string } {
  const style = d.settings.citationStyle;
  const title = opts.title ?? `Proof Summary: ${d.settings.title}`;
  const md: string[] = [`# ${title}`, ''];
  const html: string[] = [`<h1>${h(title)}</h1>`];
  if (d.settings.question) {
    md.push(`**Question.** ${d.settings.question}`, '');
    html.push(`<p><strong>Question.</strong> ${h(d.settings.question)}</p>`);
  }
  const meta = [d.settings.author && `Prepared by ${d.settings.author}`, d.settings.standard && `Practice followed: ${d.settings.standard}`].filter(Boolean).join('. ');
  if (meta) { md.push(`*${meta}.*`, ''); html.push(`<p class="muted">${h(meta)}.</p>`); }
  md.push('> Statuses describe how each claim is backed by the sources in this case. They do not establish truth.', '');
  html.push('<p class="muted">Statuses describe how each claim is backed by the sources in this case. They do not establish truth.</p>');

  const claims = claimsSorted(d).filter((c) => !opts.claimIds || opts.claimIds.includes(c.id));
  const open: string[] = [];
  const cited = new Set<string>();
  for (const c of claims) {
    const st = statuses[c.id];
    const status = st?.status ?? 'open';
    md.push(`## Claim ${c.number}: ${STATUS_LABEL[status]}`, '', c.kind === 'quotation' ? `> “${c.text}”${c.attributedTo ? ` — ${c.attributedTo}` : ''}` : c.text, '');
    html.push(`<h2>Claim ${c.number} ${badge(status)}</h2><p>${c.kind === 'quotation' ? `“${h(c.text)}”${c.attributedTo ? ' — ' + h(c.attributedTo) : ''}` : h(c.text)}</p>`);
    if (c.setAside) {
      md.push(`Set aside: ${c.setAside.reason}`, '');
      html.push(`<p><em>Set aside:</em> ${h(c.setAside.reason)}</p>`);
      continue;
    }
    for (const [kinds, head] of [[['supports'], 'Evidence for'], [['contradicts'], 'Evidence against'], [['absence'], 'Searches that found nothing']] as const) {
      const ev = evidenceFor(d, c.id, [...kinds], opts.includeConfidential);
      if (!ev.length) continue;
      md.push(`**${head}:**`, '');
      html.push(`<h3>${head}</h3>`);
      for (const e of ev) {
        cited.add(e.source.id);
        const cite = sourceCitation(e.source, style);
        const extra = [e.where, e.anchor.knowledge !== 'unknown' ? `${e.anchor.knowledge} information` : '', e.anchor.informant ? `informant: ${e.anchor.informant}` : '', e.tie.directness === 'indirect' ? 'indirect' : '', e.tie.tick ? `tick ${e.tie.tick}` : ''].filter(Boolean).join('; ');
        const passage = e.tie.kind === 'absence' ? e.tie.absenceSearch ?? '(search recorded)' : e.anchor.exact;
        md.push(`- ${cite}${extra ? ` (${extra})` : ''}`, `  > ${passage.replace(/\n/g, ' ')}`);
        html.push(`<p>${citeHtml(cite)}${extra ? ` <span class="muted">(${h(extra)})</span>` : ''}</p><blockquote>${h(passage)}</blockquote>`);
        if (e.tie.note) { md.push(`  Note: ${e.tie.note}`); html.push(`<p class="muted">Note: ${h(e.tie.note)}</p>`); }
      }
      md.push('');
    }
    const dep = Object.values(d.ties).filter((t) => t.claimId === c.id && t.state === 'confirmed' && (t.kind === 'claim' || t.kind === 'sum-of'));
    for (const t of dep) {
      const nums = (t.kind === 'claim' ? [t.targetClaimId] : t.partClaimIds ?? []).map((id) => d.claims[id!]?.number).filter(Boolean);
      const s = t.kind === 'claim' ? `Rests on claim ${nums.join(', ')}.` : `Equals the sum of claims ${nums.join(', ')}.`;
      md.push(s, '');
      html.push(`<p>${h(s)}</p>`);
    }
    const rk = Object.values(d.reckonings).find((r) => r.claimId === c.id);
    if (rk && (rk.conclusion || rk.unresolved)) {
      if (rk.conclusion) {
        const pref = rk.preferredAnchorId ? d.anchors[rk.preferredAnchorId] : undefined;
        const ps = pref && visible(d, pref.sourceId, opts.includeConfidential) ? d.sources[pref.sourceId] : undefined;
        md.push(`**Conclusion${ps ? ` (prefers ${ps.title})` : ''}:** ${rk.conclusion}${rk.author ? ` — ${rk.author}${rk.date ? ', ' + rk.date : ''}` : ''}`, '');
        html.push(`<p><strong>Conclusion${ps ? ` (prefers ${h(ps.title)})` : ''}:</strong> ${h(rk.conclusion)}</p>`);
      }
      if (rk.unresolved) { md.push(`**Unresolved:** ${rk.unresolved}`, ''); html.push(`<p><strong>Unresolved:</strong> ${h(rk.unresolved)}</p>`); }
    }
    if (st?.reasons.length) {
      md.push(`*${st.reasons.join(' ')}*`, '');
      html.push(`<p class="muted">${h(st.reasons.join(' '))}</p>`);
    }
    if (['open', 'disputed', 'stale'].includes(status)) open.push(`Claim ${c.number} (${STATUS_LABEL[status]})`);
  }
  if (open.length) {
    md.push('## Open items', '', ...open.map((o) => `- ${o}`), '');
    html.push(`<h2>Open items</h2><ul>${open.map((o) => `<li>${h(o)}</li>`).join('')}</ul>`);
  }
  const srcs = [...cited].map((id) => d.sources[id]);
  if (srcs.length) {
    const bib = formatBibliography(srcs, style);
    md.push('## Sources', '', ...bib.map((b) => `- ${b}`), '');
    html.push(`<h2>Sources</h2><ul>${bib.map((b) => `<li>${citeHtml(b)}</li>`).join('')}</ul>`);
  }
  return { markdown: md.join('\n'), html: htmlPage(title, html.join('\n')) };
}
