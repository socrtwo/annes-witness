// Check, Resolve, Report and Review commands.
import { register, run } from './registry';
import { app } from './app';
import { h, append as appendAll } from './dom';
import { form, alertBox, confirmBox, download, pickFiles, promptBox, showPanel, toast, choose, openHtmlWindow, modal } from './dialogs';
import { need, needClaim, needDoc, needSource, slug, UserError } from './common';
import { CHECKS } from '../checks/index';
import { Claim, Id, Reckoning, Tie, Source, TieKind, SignOff, CaseData } from '../core/types';
import { newId, nowIso, truncate } from '../core/util';
import { locate } from '../core/anchor';
import { loadCase } from '../io/container';
import { TEMPLATES } from './templates';

const title = () => slug(app.data.settings.title);

async function pickReviewTargets(): Promise<{ includeConfidential: boolean } | null> {
  if (!app.store.evidence.some((s) => s.confidential)) return { includeConfidential: false };
  const r = await form<{ inc: boolean }>('Confidential sources', [{ key: 'inc', label: 'Include confidential sources in this report', type: 'checkbox', value: false }]);
  return r ? { includeConfidential: r.inc } : null;
}

function ensureReckoning(c: Claim): Reckoning {
  const existing = Object.values(app.data.reckonings).find((r) => r.claimId === c.id);
  if (existing) return existing;
  const rows = app.store.tiesOf(c.id).filter((t) => t.state === 'confirmed' && t.anchorId && (t.kind === 'supports' || t.kind === 'contradicts')).map((t) => {
    const a = app.data.anchors[t.anchorId!];
    const s = app.data.sources[a.sourceId];
    return { sourceId: s.id, anchorId: a.id, says: a.exact || a.note || '', informant: a.informant ?? '', knowledge: a.knowledge, when: s.dateMade ?? '', classification: s.classification };
  });
  return { id: newId('rk'), claimId: c.id, rows, history: [] };
}

export function registerCheckCommands() {
  // --- Check ----------------------------------------------------------------------------------
  const report = (n: number) => toast(n ? `${n} findings (Problems pane).` : 'No problems found.');
  register('check.all', () => report(app.runChecks().length));
  register('check.selection', () => {
    const ids = app.selectedClaims().map((c) => c.id);
    report(app.runChecks(undefined, ids.length ? ids : undefined).length);
  });
  register('check.onSave', { run: () => { app.store.transact('Check on save', () => { app.data.settings.checkOnSave = !app.data.settings.checkOnSave; }); app.store.touch(); }, checked: () => app.data.settings.checkOnSave });
  for (const id of Object.keys(CHECKS)) register(id, () => report(app.runChecks([id]).length));
  register('check.retractions', async () => {
    const withDoi = app.store.evidence.filter((s) => s.citation.doi);
    if (!withDoi.length) throw new UserError('No source has a DOI. Add DOIs in Citation or with Retrieve Citation Details.');
    if (!(await confirmBox('Retraction Check', `Look up ${withDoi.length} DOIs in the Crossref catalog for retractions and corrections? Only the DOIs are sent, from your browser.`, 'Look up'))) return;
    const out: string[] = [];
    for (const s of withDoi) {
      try {
        const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(s.citation.doi!)}`);
        const w: any = res.ok ? (await res.json()).message : null;
        const updates = [...(w?.['update-to'] ?? []), ...(w?.relation?.['is-retracted-by'] ?? []).map(() => ({ type: 'retraction' }))];
        const kinds = [...new Set(updates.map((u: any) => String(u.type)))];
        if (kinds.some((k) => /retract/i.test(k))) out.push(`RETRACTED: ${s.title}`);
        else if (kinds.length) out.push(`${kinds.join(', ')}: ${s.title}`);
      } catch { out.push(`Could not check: ${s.title}`); }
    }
    await alertBox('Retraction Check', out.length ? out.join('\n') : 'No retractions or corrections listed.');
  });

  // --- Resolve -----------------------------------------------------------------------------------
  register('resolve.open', async () => {
    const c = needClaim();
    const rk = ensureReckoning(c);
    const table = h('table.findings.reckon', h('thead', h('tr', h('th', 'Source'), h('th', 'Says'), h('th', 'Informant'), h('th', 'Knew it'), h('th', 'Made'), h('th', 'Original or copy'))),
      h('tbody', rk.rows.map((r) => h('tr', h('td', app.data.sources[r.sourceId]?.title ?? '?'), h('td', truncate(r.says, 200)), h('td', r.informant || '—'), h('td', r.knowledge), h('td', r.when || '—'), h('td', r.classification)))));
    const anchors = rk.rows.filter((r) => r.anchorId);
    const res = await form<any>(`Reckoning for claim ${c.number}`, [
      { key: 'preferred', label: 'Reading you accept', type: 'select', value: rk.preferredAnchorId ?? '', options: [{ value: '', label: '(not decided)' }, ...anchors.map((r) => ({ value: r.anchorId!, label: `${app.data.sources[r.sourceId]?.title}: “${truncate(r.says, 60)}”` }))] },
      { key: 'reason', label: 'Why that reading', type: 'textarea', rows: 3, value: rk.preferReason ?? '' },
      { key: 'conclusion', label: 'Written conclusion (required for Settled)', type: 'textarea', rows: 6, value: rk.conclusion ?? '' },
      { key: 'unresolved', label: 'If the evidence does not decide it: what would', type: 'textarea', rows: 2, value: rk.unresolved ?? '' },
    ], 'Save', h('div', h('p', c.text), table));
    if (!res) return;
    app.store.transact(`Reckoning for claim ${c.number}`, (tx) => tx.put('reckonings', { ...rk, preferredAnchorId: res.preferred || undefined, preferReason: res.reason || undefined, conclusion: res.conclusion || undefined, unresolved: res.unresolved || undefined, author: app.store.user, date: nowIso() }));
  });
  register('resolve.prefer', () => run('resolve.open'));
  register('resolve.conclusion', () => run('resolve.open'));
  register('resolve.leaveOpen', async () => {
    const c = needClaim();
    const rk = ensureReckoning(c);
    const t = await promptBox('Leave Unresolved', 'What would settle it?', rk.unresolved ?? '', 'textarea');
    if (t !== null) app.store.transact('Leave unresolved', (tx) => tx.put('reckonings', { ...rk, unresolved: t || undefined, preferredAnchorId: undefined, conclusion: undefined, history: rk.conclusion ? [...rk.history, { conclusion: rk.conclusion, preferredAnchorId: rk.preferredAnchorId, date: nowIso() }] : rk.history }));
  });
  register('resolve.reopen', async () => {
    const c = needClaim();
    const rk = need(Object.values(app.data.reckonings).find((r) => r.claimId === c.id), 'This claim has no reckoning.');
    const why = await promptBox('Reopen', 'What new evidence reopens the question?');
    if (why === null) return;
    app.store.transact('Reopen reckoning', (tx) => tx.put('reckonings', { ...rk, preferredAnchorId: undefined, conclusion: undefined, history: [...rk.history, { conclusion: rk.conclusion, preferredAnchorId: rk.preferredAnchorId, date: nowIso(), reopenedBecause: why }] }));
  });
  register('resolve.sideBySide', () => {
    const c = needClaim();
    const ts = app.store.tiesOf(c.id).filter((t) => t.state !== 'rejected' && t.anchorId);
    const sup = ts.find((t) => t.kind === 'supports'), con = ts.find((t) => t.kind === 'contradicts');
    if (!sup || !con) throw new UserError('Side by side needs one supporting and one contradicting tie.');
    const a = app.data.anchors[sup.anchorId!], b = app.data.anchors[con.anchorId!];
    app.view = 'workbench';
    app.splitSourceId = b.sourceId;
    app.select({ sourceId: a.sourceId, anchorId: a.id });
  });
  register('resolve.collate', async () => {
    const r = await form<any>('Collate Versions', [{ key: 'ids', label: 'Versions of the same text (the first is the base)', type: 'multiselect', value: [], options: app.store.evidence.filter((s) => s.text).map((s) => ({ value: s.id, label: `${s.siglum ? s.siglum + ' — ' : ''}${s.title}` })) }], 'Collate');
    if (!r || r.ids.length < 2) return;
    const srcs = (r.ids as Id[]).map((i) => app.data.sources[i]);
    const { alignTexts } = await import('../resolve/collate');
    const { apparatusMarkdown } = await import('../reports/apparatus');
    const col = alignTexts(srcs[0].text, srcs.slice(1).map((s) => s.text));
    const md = apparatusMarkdown(col, srcs.map((s, i) => s.siglum || String.fromCharCode(65 + i)));
    await showPanel('Variant readings', h('div', h('p', srcs.map((s, i) => `${s.siglum || String.fromCharCode(65 + i)} = ${s.title}`).join('; ')), h('pre.report', md), h('button', { onclick: () => download(md, `${title()} apparatus.md`, 'text/markdown') }, 'Download')));
  });
  register('report.apparatus', () => run('resolve.collate'));
  register('resolve.variantHeatmap', async () => {
    const r = await form<any>('Variant Heat Map', [{ key: 'ids', label: 'Versions (the first is the base)', type: 'multiselect', value: [], options: app.store.evidence.filter((s) => s.text).map((s) => ({ value: s.id, label: s.title })) }], 'Show');
    if (!r || r.ids.length < 2) return;
    const srcs = (r.ids as Id[]).map((i) => app.data.sources[i]);
    const { alignTexts, variantHeat } = await import('../resolve/collate');
    const col = alignTexts(srcs[0].text, srcs.slice(1).map((s) => s.text));
    const heat = variantHeat(col);
    const max = Math.max(1, ...heat);
    const body = h('div.heat', col.base.map((t, i) => { const alpha = ((heat[i] ?? 0) / max) * 0.8; return h('span', { style: { background: 'rgba(220,60,40,' + alpha.toFixed(3) + ')' } }, t.text + ' '); }));
    await showPanel(`Where the versions differ (base: ${srcs[0].title})`, body);
  });
  const logEntry = async (kind: 'search' | 'correspondence') => {
    const list = Object.values(app.data.log).filter((l) => (l.kind ?? 'search') === kind).sort((a, b) => (a.date < b.date ? 1 : -1));
    const r = await form<any>(kind === 'search' ? 'Research Log' : 'Correspondence Log', [
      { key: 'date', label: 'Date', type: 'date', value: nowIso().slice(0, 10) },
      { key: 'where', label: kind === 'search' ? 'Where (archive, database, book)' : 'To or from', required: true },
      { key: 'searched', label: kind === 'search' ? 'What was searched, how' : 'What was asked or received', type: 'textarea', required: true },
      { key: 'forWhat', label: 'For (claim or question)', value: app.claim?.text ?? '' },
      { key: 'result', label: 'Result', type: 'select', value: 'not-found', options: [{ value: 'found', label: 'Found' }, { value: 'partial', label: 'Partly' }, { value: 'not-found', label: 'Not found / no reply yet' }] },
    ], 'Add', h('div', h('p', `${list.length} earlier entries.`), list.length ? h('table.findings', h('tbody', list.slice(0, 30).map((l) => h('tr', h('td', l.date), h('td', l.where), h('td', truncate(l.searched, 80)), h('td', l.result))))) : null));
    if (r) app.store.transact(kind === 'search' ? 'Research log' : 'Correspondence log', (tx) => tx.put('log', { id: newId('l'), ...r, claimId: app.claim?.id, kind }));
  };
  register('resolve.log', () => logEntry('search'));
  register('resolve.correspondence', () => logEntry('correspondence'));
  register('resolve.todo', async () => {
    const t = await promptBox('Add To-Do', app.claim ? `For claim ${app.claim.number}` : 'To-do');
    if (t) app.store.transact('To-do', (tx) => tx.put('todos', { id: newId('td'), text: t, claimId: app.claim?.id, done: false, created: nowIso() }));
  });
  register('resolve.checklist', async () => {
    const tpl = TEMPLATES.find((t) => t.id === app.data.settings.template && t.checklist.length) ?? TEMPLATES.find((t) => t.id === 'family-history')!;
    const r = await form<any>('Search Checklist', [{ key: 'items', label: `Record types usually consulted (${tpl.label}). Checked items become to-dos.`, type: 'multiselect', value: [], options: tpl.checklist.map((x) => ({ value: x, label: x })) }], 'Add to-dos');
    if (r?.items.length) app.store.transact('Checklist to-dos', (tx) => { for (const it of r.items) tx.put('todos', { id: newId('td'), text: `Search: ${it}`, claimId: app.claim?.id, done: false, created: nowIso() }); });
  });
  register('resolve.applyCorrection', async () => {
    const c = needClaim();
    const doc = need(c.doc ? app.data.sources[c.doc.documentId] : undefined, 'This claim is not in a linked document.');
    const bytes = need(app.blobs.get(doc.id), 'The document file is not stored in this case.');
    if (!/\.docx$/i.test(doc.fileName ?? '')) throw new UserError('Corrections can be written into .docx documents. For other formats, copy the corrected wording.');
    const rk = Object.values(app.data.reckonings).find((r) => r.claimId === c.id);
    const t = await promptBox('Apply Correction', 'Corrected wording (inserted as a comment for the author to accept)', rk?.conclusion ? `${c.text}` : c.text, 'textarea');
    if (!t) return;
    const { insertNotesIntoDocx } = await import('../writeback/docx');
    const r = await insertNotesIntoDocx(bytes, [{ find: c.doc!.textAtCapture, note: `[W${c.number}] Suggested correction: ${t}${rk?.conclusion ? ` — Reason: ${rk.conclusion}` : ''}` }], 'comment');
    download(r.bytes, (doc.fileName ?? doc.title).replace(/\.docx$/i, '') + ' (corrections).docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    if (r.missed.length) toast('The claim’s sentence was not found in the document; nothing was placed.');
  });

  // --- Report --------------------------------------------------------------------------------------
  const notesFor = async () => {
    const { formatCitation } = await import('../reports/citation');
    return app.store.claims.filter((c) => c.doc && app.status(c.id)?.status !== 'open').map((c) => {
      const ev = app.store.tiesOf(c.id).filter((t) => t.state === 'confirmed' && t.anchorId && (t.kind === 'supports' || t.kind === 'contradicts')).map((t) => {
        const a = app.data.anchors[t.anchorId!];
        const s = app.data.sources[a.sourceId];
        if (s.confidential) return null;
        return `${t.kind === 'contradicts' ? 'But see ' : ''}${formatCitation(s.citation, 'notes', s.title).replace(/\*/g, '')}, ${locate(s, a.start, a.end)}`;
      }).filter(Boolean);
      return { claim: c, find: c.doc!.textAtCapture, note: `[W${c.number}] ${ev.join('; ')}.` };
    }).filter((n) => n.note.length > 8);
  };
  register('report.insertNotes', async () => {
    const d = needDoc();
    const bytes = need(app.blobs.get(d.id), 'The document file is not stored in this case.');
    if (!/\.docx$/i.test(d.fileName ?? '')) throw new UserError('Notes can be written into .docx documents.');
    const kind = (await choose('Insert Notes', [{ label: 'Footnotes', value: 'footnote' }, { label: 'Endnotes', value: 'endnote' }, { label: 'Comments', value: 'comment' }])) as any;
    if (!kind) return;
    const { insertNotesIntoDocx } = await import('../writeback/docx');
    const notes = await notesFor();
    const r = await insertNotesIntoDocx(bytes, notes.map((n) => ({ find: n.find, note: n.note })), kind);
    download(r.bytes, (d.fileName ?? d.title).replace(/\.docx$/i, '') + ' (with notes).docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    toast(`${r.placed} notes placed${r.missed.length ? `, ${r.missed.length} sentences not found` : ''}. Notes go at the end of each claim’s paragraph.`);
  });
  register('report.updateNotes', async () => {
    const d = needDoc();
    const bytes = need(app.blobs.get(d.id), 'The document file is not stored in this case.');
    const { removeWitnessNotes, insertNotesIntoDocx } = await import('../writeback/docx');
    const cleaned = await removeWitnessNotes(bytes);
    const notes = await notesFor();
    const r = await insertNotesIntoDocx(cleaned.bytes, notes.map((n) => ({ find: n.find, note: n.note })), 'footnote');
    download(r.bytes, (d.fileName ?? d.title).replace(/\.docx$/i, '') + ' (notes updated).docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });
  register('report.removeNotes', async () => {
    const d = needDoc();
    const bytes = need(app.blobs.get(d.id), 'The document file is not stored in this case.');
    const { removeWitnessNotes } = await import('../writeback/docx');
    const r = await removeWitnessNotes(bytes);
    download(r.bytes, (d.fileName ?? d.title).replace(/\.docx$/i, '') + ' (notes removed).docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    toast(`${r.removed} notes removed.`);
  });
  register('report.insertTicks', async () => {
    const d = needDoc();
    if (d.kind !== 'workbook') throw new UserError('The linked document is not a workbook.');
    const bytes = need(app.blobs.get(d.id), 'The workbook file is not stored in this case.');
    const { addTickSheet } = await import('../writeback/xlsx');
    const rows = app.store.claims.filter((c) => c.doc?.documentId === d.id).flatMap((c) => {
      const seg = d.segments.find((s) => s.start <= c.doc!.start && s.end >= c.doc!.end && s.cell);
      return app.store.tiesOf(c.id).filter((t) => t.state === 'confirmed').map((t) => {
        const a = t.anchorId ? app.data.anchors[t.anchorId] : undefined;
        const s = a ? app.data.sources[a.sourceId] : undefined;
        return { sheet: seg?.sheet ?? '', cell: seg?.cell ?? '', mark: t.tick ?? '✓', claim: `${c.number}. ${c.text}`, source: s ? `${s.title} ${locate(s, a!.start, a!.end)}` : t.kind, note: t.note };
      });
    });
    const out = await addTickSheet(bytes, rows, app.data.settings.tickLegend);
    download(out, (d.fileName ?? d.title).replace(/\.xlsx$/i, '') + ' (ticked).xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });
  register('report.proof', async () => {
    const o = await pickReviewTargets();
    if (!o) return;
    const { proofSummary } = await import('../reports/proof');
    const r = proofSummary(app.data, app.statuses(), { includeConfidential: o.includeConfidential, claimIds: app.sel.claimIds.size > 1 ? [...app.sel.claimIds] : undefined });
    const how = await choose('Proof Summary', [{ label: 'Open as a web page (print or save as PDF from there)', value: 'html' }, { label: 'Download as Markdown', value: 'md' }, { label: 'Download as HTML', value: 'dl' }]);
    if (how === 'html') openHtmlWindow(r.html);
    if (how === 'md') download(r.markdown, `${title()} proof.md`, 'text/markdown');
    if (how === 'dl') download(r.html, `${title()} proof.html`, 'text/html');
  });
  register('report.redact', async () => {
    const { proofSummary } = await import('../reports/proof');
    const { screenText, redact } = await import('../ai/privacy');
    const r = proofSummary(app.data, app.statuses(), { includeConfidential: false });
    const hits = screenText(r.markdown);
    const md = redact(r.markdown, hits);
    download(md, `${title()} proof (redacted).md`, 'text/markdown');
    toast(`Confidential sources left out; ${hits.length} private details redacted.`);
  });
  register('report.claimTable', async () => {
    const { claimTableCsv } = await import('../reports/tables');
    download(claimTableCsv(app.data, app.statuses()), `${title()} claims.csv`, 'text/csv');
  });
  register('report.sourceList', async () => {
    const how = await choose('Source List', [{ label: 'Formatted list (Markdown)', value: 'md' }, { label: 'BibTeX', value: 'bib' }, { label: 'RIS', value: 'ris' }, { label: 'CSL-JSON', value: 'csl' }]);
    if (!how) return;
    const srcs = app.store.evidence.filter((s) => !s.confidential);
    if (how === 'md') { const { sourceList } = await import('../reports/tables'); download(sourceList(app.data), `${title()} sources.md`, 'text/markdown'); return; }
    const f = await import('../io/formats');
    if (how === 'bib') download(f.toBibtex(srcs), `${title()}.bib`, 'application/x-bibtex');
    if (how === 'ris') download(f.toRis(srcs), `${title()}.ris`, 'application/x-research-info-systems');
    if (how === 'csl') download(f.toCslJson(srcs), `${title()}.json`, 'application/json');
  });
  register('report.style', async () => {
    const s = await choose('Citation Style', [{ label: 'Author-date', value: 'author-date' }, { label: 'Notes and bibliography', value: 'notes' }]);
    if (s) { app.store.transact('Citation style', () => { app.data.settings.citationStyle = s as any; }); app.store.touch(); }
  });
  register('report.openItems', async () => {
    const { openItems } = await import('../reports/tables');
    if (!app.findings.length) app.runChecks();
    download(openItems(app.data, app.statuses(), app.findings), `${title()} open items.md`, 'text/markdown');
  });
  register('report.map', async () => {
    const { evidenceMapSvg } = await import('../reports/map');
    const svg = evidenceMapSvg(app.data, app.statuses());
    const how = await choose('Evidence Map', [{ label: 'Show', value: 'show' }, { label: 'Download SVG (opens in Anne’s Chart and other editors)', value: 'svg' }]);
    if (how === 'show') await showPanel('Evidence Map', h('div.svgbox', { innerHTML: svg }));
    if (how === 'svg') download(svg, `${title()} evidence map.svg`, 'image/svg+xml');
  });
  register('report.coverage', async () => {
    const d = needDoc();
    const { coverageHtml } = await import('../reports/coverage');
    download(coverageHtml(app.data, app.statuses(), d.id), `${title()} coverage.html`, 'text/html');
  });
  register('report.log', async () => { const { researchLogReport } = await import('../reports/tables'); download(researchLogReport(app.data), `${title()} research log.md`, 'text/markdown'); });
  register('report.changes', async () => {
    const max = app.store.seq;
    const r = await form<any>('Change Report', [{ key: 'from', label: 'From step', type: 'number', value: 0 }, { key: 'to', label: `To step (latest is ${max})`, type: 'number', value: max }]);
    if (!r) return;
    const { changeReport } = await import('../reports/changes');
    download(changeReport(app.store.journal, r.from, r.to, app.data), `${title()} changes.md`, 'text/markdown');
  });
  register('report.exhibits', async () => {
    const r = await form<any>('Build Exhibit Bundle', [
      { key: 'bates', label: 'Number pages (Bates numbering)', type: 'checkbox', value: false },
      { key: 'prefix', label: 'Number prefix', value: 'WIT' }, { key: 'start', label: 'First number', type: 'number', value: 1 },
      { key: 'onlySel', label: 'Only the ties of the selected claims', type: 'checkbox', value: app.sel.claimIds.size > 0 },
      { key: 'conf', label: 'Include confidential sources', type: 'checkbox', value: false },
    ], 'Build PDF', 'One PDF: an index, then each anchored passage with its source page and the marked region.');
    if (!r) return;
    const { buildExhibitBundle } = await import('../reports/exhibits');
    const anchorIds = r.onlySel ? app.selectedClaims().flatMap((c) => app.store.tiesOf(c.id).filter((t) => t.state === 'confirmed' && t.anchorId).map((t) => t.anchorId!)) : undefined;
    const out = await buildExhibitBundle(app.data, app.blobs, { anchorIds, bates: r.bates ? { prefix: r.prefix, start: r.start } : undefined, includeConfidential: r.conf, title: app.data.settings.title });
    download(out.bytes, `${title()} exhibits.pdf`, 'application/pdf');
    toast(`${out.exhibits.length} exhibits.`);
  });
  register('report.numberExhibits', () => run('report.exhibits'));
  register('report.readerKit', async () => {
    const d = needDoc();
    const { readerKitHtml } = await import('../reports/kit');
    download(readerKitHtml(app.data, app.statuses(), d.id), `${title()} reader kit.html`, 'text/html');
  });
  register('report.claimReview', async () => {
    const r = await form<any>('ClaimReview Markup', [{ key: 'author', label: 'Publisher or author of the fact check', required: true, value: app.data.settings.author }, { key: 'url', label: 'Address of the published fact check' }], 'Create',
      'schema.org ClaimReview markup for claims that have an Editorial Verdict.');
    if (!r) return;
    const { claimReviewJsonLd } = await import('../reports/claimreview');
    download(claimReviewJsonLd(app.data, { author: r.author, url: r.url || undefined }), `${title()} claimreview.jsonld`, 'application/ld+json');
  });
  register('report.chronology', async () => { const { chronology } = await import('../reports/tables'); download(chronology(app.data), `${title()} chronology.md`, 'text/markdown'); });
  register('report.citationContext', async () => { const { citationContext } = await import('../reports/tables'); download(citationContext(app.data), `${title()} citation context.md`, 'text/markdown'); });
  register('report.hashes', async () => { const { hashReport } = await import('../reports/tables'); download(hashReport(app.data), `${title()} hashes.csv`, 'text/csv'); });
  register('report.confidentialLog', async () => { const { confidentialLog } = await import('../reports/tables'); download(confidentialLog(app.data), `${title()} withheld.md`, 'text/markdown'); });

  // --- Review ------------------------------------------------------------------------------------
  register('review.comment', async () => {
    const target = app.sel.tieId ? { type: 'tie' as const, id: app.sel.tieId } : app.claim ? { type: 'claim' as const, id: app.claim.id } : app.sel.anchorId ? { type: 'anchor' as const, id: app.sel.anchorId } : app.source ? { type: 'source' as const, id: app.source.id } : null;
    const t = need(target, 'Select a claim, tie, anchor or source.');
    const text = await promptBox('New Comment', 'Comment', '', 'textarea');
    if (text) app.store.transact('Comment', (tx) => tx.put('comments', { id: newId('cm'), target: t, text, author: app.store.user, created: nowIso(), resolved: false, replies: [] }));
  });
  register('review.showComments', async () => {
    const list = Object.values(app.data.comments).sort((a, b) => (a.created < b.created ? 1 : -1));
    await showPanel(`Comments (${list.filter((c) => !c.resolved).length} open)`, h('table.findings', h('tbody', list.map((c) => h('tr', { class: c.resolved ? 'resolved' : '', onclick: () => c.target.type === 'claim' ? app.select({ claimId: c.target.id }) : c.target.type === 'source' ? app.select({ sourceId: c.target.id }) : undefined },
      h('td', c.created.slice(0, 10)), h('td', c.author), h('td', `${c.target.type}`), h('td', c.text), h('td', c.resolved ? 'resolved' : h('button', { onclick: (e: Event) => { e.stopPropagation(); app.store.transact('Resolve comment', (tx) => tx.update('comments', c.id, { resolved: true } as any)); (e.target as HTMLButtonElement).replaceWith('resolved'); } }, 'Resolve')))))));
  });
  register('review.resolveComment', () => {
    const c = needClaim();
    const open = Object.values(app.data.comments).filter((x) => x.target.id === c.id && !x.resolved);
    need(open.length, 'No open comments on this claim.');
    app.store.transact('Resolve comments', (tx) => { for (const x of open) tx.update('comments', x.id, { resolved: true } as any); });
  });
  const sign = (kind: 'prepared' | 'reviewed') => () => {
    const list = app.selectedClaims().length ? app.selectedClaims() : [needClaim()];
    if (kind === 'reviewed' && list.some((c) => Object.values(app.data.signoffs).some((s) => s.claimId === c.id && s.kind === 'prepared' && s.by === app.store.user)))
      throw new UserError('A reviewer should be someone other than the preparer (set your name in File ▸ Options).');
    app.store.transact(kind === 'prepared' ? 'Mark prepared' : 'Mark reviewed', (tx) => { for (const c of list) tx.put('signoffs', { id: newId('so'), claimId: c.id, kind, by: app.store.user, at: nowIso(), seq: app.store.seq + 1 } as SignOff); });
  };
  register('review.prepared', sign('prepared'));
  register('review.reviewed', sign('reviewed'));
  const changedSince = (s: SignOff) => {
    const tieIds = new Set(app.store.tiesOf(s.claimId).map((t) => t.id));
    return app.store.journal.some((j) => j.seq > s.seq && j.ops.some((o) => (o.table === 'claims' && o.id === s.claimId) || (o.table === 'ties' && tieIds.has(o.id))));
  };
  register('review.queue', async () => {
    const so = Object.values(app.data.signoffs);
    const rows = app.store.claims.map((c) => {
      const p = so.filter((s) => s.claimId === c.id && s.kind === 'prepared').pop();
      const r = so.filter((s) => s.claimId === c.id && s.kind === 'reviewed').pop();
      const state = !p ? 'not prepared' : !r ? 'waiting for review' : changedSince(r) ? 'changed after review' : 'reviewed';
      return { c, state };
    }).filter((x) => x.state === 'waiting for review' || x.state === 'changed after review');
    await showPanel(`Review Queue (${rows.length})`, h('table.findings', h('tbody', rows.map((x) => h('tr', { onclick: () => app.select({ claimId: x.c.id }) }, h('td', `#${x.c.number}`), h('td', x.state), h('td', truncate(x.c.text, 140)))))));
  });
  register('review.blind', { run: () => { app.blind = !app.blind; app.render(); toast(app.blind ? 'Second Reader Mode: other reviewers’ confirmed ties are hidden. Find the support yourself, then use Reviewer Agreement.' : 'Second Reader Mode off.'); }, checked: () => app.blind });
  async function openOtherCase(): Promise<CaseData | null> {
    const [f] = await pickFiles('.witness,.zip', false);
    if (!f) return null;
    return (await loadCase(new Uint8Array(await f.arrayBuffer()))).data;
  }
  register('review.compare', async () => {
    const other = await openOtherCase();
    if (!other) return;
    const diff = (name: string, a: Record<string, any>, b: Record<string, any>) => {
      const ak = new Set(Object.keys(a)), bk = new Set(Object.keys(b));
      const added = [...bk].filter((k) => !ak.has(k)).length, removed = [...ak].filter((k) => !bk.has(k)).length;
      const changed = [...ak].filter((k) => bk.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k])).length;
      return `${name}: ${added} only in the other case, ${removed} only in this one, ${changed} changed`;
    };
    await alertBox('Compare Cases', ['sources', 'anchors', 'claims', 'ties', 'reckonings', 'comments'].map((t) => diff(t, (app.data as any)[t], (other as any)[t])).join('\n'));
  });
  register('review.merge', async () => {
    const other = await openOtherCase();
    if (!other) return;
    let added = 0, conflicts = 0;
    app.store.transact('Merge cases', (tx) => {
      for (const t of ['sources', 'anchors', 'claims', 'ties', 'reckonings', 'log', 'todos', 'comments', 'signoffs', 'rules'] as const) {
        for (const [id, rec] of Object.entries((other as any)[t] as Record<string, any>)) {
          const mine = (app.data as any)[t][id];
          if (!mine) { tx.put(t, rec); added++; }
          else if (JSON.stringify(mine) !== JSON.stringify(rec)) conflicts++;
        }
      }
    });
    await alertBox('Merge Cases', `${added} records brought in. ${conflicts} records exist in both with different content; this case’s version was kept. Source files of the other case are not copied; use Relink for those sources.`);
  });
  register('review.importTies', async () => {
    const other = await openOtherCase();
    if (!other) return;
    let n = 0;
    app.store.transact('Import ties', (tx) => {
      for (const t of Object.values(other.ties)) {
        if (app.data.ties[t.id] || !app.data.claims[t.claimId]) continue;
        const a = t.anchorId ? other.anchors[t.anchorId] : undefined;
        if (a && !app.data.sources[a.sourceId]) continue;
        if (a && !app.data.anchors[a.id]) tx.put('anchors', a);
        tx.put('ties', { ...t, state: 'proposed', proposedBy: { type: 'person', who: t.confirmedBy ?? t.proposedBy.who, command: 'review.importTies' } } as Tie);
        n++;
      }
    });
    toast(`${n} ties imported as proposals.`);
  });
  register('review.verifyDrafts', () => verifyDrafts());
  register('review.progress', async () => {
    const ties = app.store.ties.filter((t) => t.proposedBy.type !== 'person');
    const by = (pred: (t: Tie) => boolean) => ties.filter(pred).length;
    const perSource = new Map<string, number>();
    for (const t of ties.filter((x) => x.state === 'proposed')) {
      const a = t.anchorId ? app.data.anchors[t.anchorId] : undefined;
      const s = a ? app.data.sources[a.sourceId]?.title ?? '?' : '—';
      perSource.set(s, (perSource.get(s) ?? 0) + 1);
    }
    await alertBox('Verification Progress', [
      `Drafted by AI or Auto-Tie: ${ties.length}`,
      `Confirmed: ${by((t) => t.state === 'confirmed')}   Rejected: ${by((t) => t.state === 'rejected')}   Waiting: ${by((t) => t.state === 'proposed')}`,
      '', 'Waiting, by source:', ...[...perSource].sort((a, b) => b[1] - a[1]).map(([s, n]) => `  ${n}  ${s}`),
    ].join('\n'));
  });
  register('review.agreement', async () => {
    const people = [...new Set(app.store.ties.filter((t) => t.state === 'confirmed').map((t) => t.confirmedBy).filter(Boolean))] as string[];
    if (people.length < 2) throw new UserError('Agreement needs confirmed ties from two people (set each person’s name in File ▸ Options; use Second Reader Mode for the second pass).');
    const r = await form<any>('Reviewer Agreement', [{ key: 'a', label: 'First reviewer', type: 'select', value: people[0], options: people.map((p) => ({ value: p, label: p })) }, { key: 'b', label: 'Second reviewer', type: 'select', value: people[1], options: people.map((p) => ({ value: p, label: p })) }]);
    if (!r) return;
    const mk = (who: string) => Object.fromEntries(app.store.claims.map((c) => {
      const t = app.store.tiesOf(c.id).find((x) => x.state === 'confirmed' && x.confirmedBy === who);
      return [c.id, (t?.kind ?? null) as TieKind | null];
    }));
    const { agreement } = await import('../reports/review');
    const res = agreement(mk(r.a), mk(r.b));
    await alertBox('Reviewer Agreement', `Claims compared: ${res.n}\nObserved agreement: ${(res.observed * 100).toFixed(1)}%\nAgreement expected by chance: ${(res.expected * 100).toFixed(1)}%\nCohen’s kappa: ${res.kappa.toFixed(3)}\n\n(Each claim is classed by the kind of the reviewer’s first confirmed tie, or “none”.)`);
  });
  register('review.sample', async () => {
    const r = await form<any>('Sample Claims for Review', [{ key: 'n', label: 'How many', type: 'number', value: Math.min(25, app.store.claims.length) }, { key: 'method', label: 'Method', type: 'radio', value: 'random', options: [{ value: 'random', label: 'Random' }, { value: 'monetary', label: 'Weighted by amount (larger figures more likely)' }] }, { key: 'seed', label: 'Seed (record it to repeat the sample)', type: 'number', value: Math.floor(Math.random() * 1e6) }]);
    if (!r) return;
    const { sampleClaims } = await import('../reports/review');
    const ids = sampleClaims(app.data, r.n, r.method, r.seed);
    app.store.transact('Sample for review', (tx) => { for (const id of ids) tx.update<Claim>('claims', id, { tags: [...new Set([...app.data.claims[id].tags, `sample ${r.seed}`])] }); });
    app.filter.tag = `sample ${r.seed}`;
    app.render();
    toast(`${ids.length} claims tagged “sample ${r.seed}” and shown.`);
  });
}

/** Review ▸ Verify Drafts: step through every proposed tie with its passage. */
export async function verifyDrafts(filter?: (t: Tie) => boolean) {
  const queue = () => app.store.ties.filter((t) => t.state === 'proposed' && (!filter || filter(t))).sort((a, b) => (app.data.claims[a.claimId]?.number ?? 0) - (app.data.claims[b.claimId]?.number ?? 0));
  const total = queue().length;
  if (!total) return alertBox('Verify Drafts', 'No proposed ties are waiting.');
  let idx = 0;
  const body = h('div.verify');
  const draw = () => {
    const q = queue();
    body.replaceChildren();
    if (!q.length) { body.append(h('p', 'All drafts are verified.')); return; }
    idx = Math.min(idx, q.length - 1);
    const t = q[idx];
    const c = app.data.claims[t.claimId];
    const a = t.anchorId ? app.data.anchors[t.anchorId] : undefined;
    const s = a ? app.data.sources[a.sourceId] : undefined;
    const ctx = (s && a) ? [s.text.slice(Math.max(0, a.start - 240), a.start), s.text.slice(a.start, a.end), s.text.slice(a.end, a.end + 240)] : ['', '', ''];
    const doc = c.doc ? app.data.sources[c.doc.documentId] : undefined;
    appendAll(body, [
      h('div.vprogress', `${total - q.length + 1} of ${total} · ${q.length} waiting`, h('progress', { max: total, value: total - q.length })),
      h('div.vclaim', h('div.meta', `Claim ${c.number}${doc ? ` · in “${doc.title}”` : ''}`), h('p.claimtext', c.text),
        doc && c.doc ? h('p.meta', 'Sentence: ', doc.text.slice(Math.max(0, c.doc.start - 60), c.doc.end + 60).replace(/\s+/g, ' ')) : null),
      h('div.vkind', { class: `vkind k-${t.kind}` }, `Proposed: ${t.kind.toUpperCase()} — by ${t.proposedBy.type === 'ai' ? `AI (${t.proposedBy.model})` : t.proposedBy.type === 'auto' ? 'Auto-Tie' : t.proposedBy.who}`),
      s && a ? h('div.vpassage', h('div.meta', `${s.title} · ${locate(s, a.start, a.end)}`), h('p', h('span.ctx', '…' + ctx[0]), h('mark', ctx[1]), h('span.ctx', ctx[2] + '…'))) : h('p', 'No passage.'),
      t.rationale ? h('div.ai-note', `AI note (not evidence): ${t.rationale}`) : null,
      t.note ? h('div.note', t.note) : null,
      h('div.vbuttons',
        h('button.primary', { title: 'Ctrl+Enter or Y', onclick: () => act('confirm') }, 'Confirm (Y)'),
        h('button', { title: 'N', onclick: () => act('reject') }, 'Reject (N)'),
        h('button', { title: 'S', onclick: () => act('supports') }, 'Confirm as Supports (S)'),
        h('button', { title: 'C', onclick: () => act('contradicts') }, 'Confirm as Contradicts (C)'),
        h('button', { title: 'M', onclick: () => act('mentions') }, 'Confirm as Mentions (M)'),
        h('button', { title: 'Right arrow', onclick: () => { idx++; draw(); } }, 'Skip (→)'),
        h('button', { title: 'Left arrow', onclick: () => { idx = Math.max(0, idx - 1); draw(); } }, 'Back (←)'),
        h('button', { onclick: () => { app.select({ claimId: c.id, tieId: t.id, anchorId: a?.id, sourceId: s?.id }); (body.closest('.dialog')?.querySelector('.dialog-buttons button') as HTMLButtonElement)?.click(); } }, 'Open in workbench')),
    ]);
    const act = (what: 'confirm' | 'reject' | TieKind) => {
      if (what === 'reject') app.store.transact(`Reject tie for claim ${c.number}`, (tx) => tx.update<Tie>('ties', t.id, { state: 'rejected' }));
      else app.store.transact(`Confirm tie for claim ${c.number}`, (tx) => tx.put('ties', { ...app.confirmTie(t.id), kind: what === 'confirm' ? t.kind : what }));
      draw();
    };
    (body as any).__act = act;
  };
  draw();
  await modal('Verify Drafts', body, [{ label: 'Close', value: null }], {
    wide: true,
    onKey: (e) => {
      const act = (body as any).__act;
      if (!act) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey && e.key === 'Enter') || k === 'y') { act('confirm'); e.preventDefault(); }
      else if ((e.ctrlKey && e.key === 'Backspace') || k === 'n') { act('reject'); e.preventDefault(); }
      else if (k === 's') { act('supports'); e.preventDefault(); }
      else if (k === 'c') { act('contradicts'); e.preventDefault(); }
      else if (k === 'm') { act('mentions'); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { idx++; draw(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { idx = Math.max(0, idx - 1); draw(); e.preventDefault(); }
    },
  });
}

void needSource; void (null as unknown as Source);
