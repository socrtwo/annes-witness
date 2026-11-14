// File, Home, View, Tools, Developer and Help commands.
import { register, run, PLAN, commandMeta, allCommands, registeredIds, customBindings, setCustomBindings, shortcutOf } from './registry';
import { app } from './app';
import { h } from './dom';
import { form, alertBox, confirmBox, download, pickFiles, pickFolder, promptBox, showPanel, toast, choose, progress } from './dialogs';
import { need, needClaim, slug, UserError } from './common';
import { getQat, setQat, setMenusMode, getMenusMode, openSearch, setCustomTab, getCustomTab, openBackstage, DEFAULT_QAT } from './shell';
import { TEMPLATES, templateRules } from './templates';
import { emptyCase } from '../core/case';
import { Claim, Source, Status, STATUS_LABEL } from '../core/types';
import { newId, nowIso, truncate } from '../core/util';
import { verifySeal, exportTextFolder, importTextFolder, importTextFolderJournal } from '../io/container';
import { protect, unprotect, isProtected } from '../io/protect';
import { desktop, saveBytes, openBytesDialog, rememberWebFile } from '../platform/index';
import { findPassage } from '../core/anchor';
import { statusCounts } from '../core/status';
import { buildSample } from './sample';

let password: string | null = null;

async function writeFile(bytes: Uint8Array, saveAs: boolean) {
  const data = password ? await protect(bytes, password) : bytes;
  if (desktop()) {
    const p = await saveBytes(data, app.fileName, saveAs ? null : app.filePath);
    if (!p) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
    app.filePath = p;
    app.fileName = p.split(/[\\/]/).pop()!;
    return;
  }
  const w = window as any;
  if (w.showSaveFilePicker) {
    try {
      if (saveAs || !app.fileHandle)
        app.fileHandle = await w.showSaveFilePicker({ suggestedName: app.fileName, types: [{ description: "Anne's Witness case", accept: { 'application/x-annes-witness': ['.witness'] } }] });
      const ws = await app.fileHandle.createWritable();
      await ws.write(data);
      await ws.close();
      app.fileName = app.fileHandle.name ?? app.fileName;
      await rememberWebFile(app.fileName, app.fileHandle).catch(() => {});
      return;
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e;
    }
  }
  download(data, app.fileName, 'application/x-annes-witness');
}

export async function saveNow(saveAs = false) {
  if (app.data.settings.checkOnSave) app.runChecks();
  await writeFile(await app.serialize(), saveAs);
  app.store.dirty = false;
  app.render();
  toast(`Saved ${app.fileName}`);
}

async function openFromFile(repair = false) {
  let bytes: Uint8Array;
  let name: string;
  let handle: any = null;
  let path: string | undefined;
  const w = window as any;
  if (desktop()) {
    const r = await openBytesDialog();
    if (!r) return;
    bytes = r.bytes; name = r.name; path = r.path;
  } else if (w.showOpenFilePicker) {
    try {
      [handle] = await w.showOpenFilePicker({ types: [{ description: "Anne's Witness case", accept: { 'application/x-annes-witness': ['.witness'], 'application/zip': ['.zip'] } }] });
    } catch (e: any) { if (e?.name === 'AbortError') return; throw e; }
    const f = await handle.getFile();
    bytes = new Uint8Array(await f.arrayBuffer()); name = f.name;
  } else {
    const [f] = await pickFiles('.witness,.zip,application/zip', false);
    if (!f) return;
    bytes = new Uint8Array(await f.arrayBuffer()); name = f.name;
  }
  await openCaseBytes(bytes, name, repair, handle, path);
}

/** Open a case from bytes (also used by Recent Cases). */
export async function openCaseBytes(bytes: Uint8Array, name: string, repair = false, handle: any = null, path?: string) {
  if (isProtected(bytes)) {
    const p = await promptBox('Protected case', 'Password', '', 'password');
    if (p === null) return;
    bytes = await unprotect(bytes, p);
    password = p;
  } else password = null;
  const r = await app.openBytes(bytes, name);
  app.fileHandle = handle;
  app.filePath = path;
  if (handle) await rememberWebFile(name, handle).catch(() => {});
  if (r.report.length || repair) await alertBox(r.report.length ? 'Repair report' : 'Opened', r.report.length ? r.report.join('\n') : 'The case opened without problems.');
  if (r.sealed) toast('This case is sealed. Use File ▸ Verify Seal to confirm nothing changed.');
}

function applyTemplate(id: string) {
  const t = TEMPLATES.find((x) => x.id === id) ?? TEMPLATES[0];
  const d = emptyCase();
  d.settings = { ...d.settings, ...t.settings, template: t.id };
  for (const r of templateRules(t)) d.rules[r.id] = r;
  return d;
}

export function registerFileCommands() {
  // --- File ---------------------------------------------------------------------------------
  register('file.new', async () => {
    if (app.store.dirty && !(await confirmBox('New case', 'Start a new case? Unsaved changes in this one stay only in this browser’s recovery copy until replaced.', 'New case'))) return;
    app.newCase();
    password = null;
  });
  register('file.newFromTemplate', async () => {
    const id = await choose('New Case from Template', TEMPLATES.map((t) => ({ label: t.label, value: t.id, detail: t.description })));
    if (!id) return;
    app.newCase(applyTemplate(id));
    const t = TEMPLATES.find((x) => x.id === id)!;
    if (t.checklist.length) toast(`Template “${t.label}”: Resolve ▸ Search Checklist lists ${t.checklist.length} record types to consult.`);
  });
  register('file.newFromDocument', async () => {
    const files = await pickFiles('*/*', false);
    if (!files.length) return;
    app.newCase();
    const [doc] = await app.addFiles(files, 'document');
    app.select({ documentId: doc.id });
    app.view = 'document';
    const r = await choose('Capture claims', [
      { label: 'Capture all numbers, quotations, dates and names', value: 'rules', detail: 'by pattern rules, no AI' },
      { label: 'Draft sources for every fact with AI', value: 'ai', detail: 'after adding sources' },
      { label: 'Capture by hand', value: 'none' },
    ]);
    if (r === 'rules') { await run('claim.captureNumbers'); await run('claim.captureQuotes'); await run('claim.captureFacts'); }
    if (r === 'ai') toast('Add the sources (Sources ▸ Add Files), then AI ▸ Draft Sources for Every Fact.');
  });
  register('file.newFromFolder', async () => {
    const files = await pickFolder();
    if (!files.length) return;
    app.newCase();
    const p = progress('Adding sources');
    try {
      let i = 0;
      for (const f of files) {
        if (p.signal.aborted) break;
        p.update(f.webkitRelativePath || f.name, i++, files.length);
        const group = (f.webkitRelativePath || '').split('/').slice(1, -1).join('/') || undefined;
        await app.addFile(f.name, new Uint8Array(await f.arrayBuffer()), 'source', { group });
      }
    } finally { p.close(); }
  });
  register('file.rollForward', async () => {
    const r = await form<{ title: string }>('New Period from This Case', [{ key: 'title', label: 'Title of the new case', value: app.data.settings.title + ' (next period)' }], 'Create',
      'Copies the claims, groups and tick legend. Sources and ties are not copied: tie each claim again to the new period’s documents.');
    if (!r) return;
    const old = app.data;
    const d = emptyCase();
    d.settings = { ...old.settings, title: r.title };
    d.rules = structuredClone(old.rules);
    let n = 1;
    for (const c of Object.values(old.claims).sort((a, b) => a.number - b.number)) {
      const nc: Claim = { ...c, id: newId('c'), number: n++, doc: undefined, dependsOn: [], parentId: undefined, verdict: undefined, setAside: c.setAside, notes: `Carried forward from claim ${c.number}.`, created: nowIso() };
      d.claims[nc.id] = nc;
    }
    app.newCase(d);
    toast('New period created. Link the new document and add the new sources.');
  });
  register('file.open', () => openFromFile(false));
  register('file.openReadOnly', async () => {
    await openFromFile(false);
    app.store.readOnly = true;
    app.render();
    toast('Opened read-only: changes are refused. File ▸ Save As makes an editable copy.');
  });
  register('file.versions', async () => {
    const vs = Object.values(app.data.views).filter((v) => v.filter.kind === 'version').sort((a, b) => Number(b.filter.seq) - Number(a.filter.seq));
    const id = await choose('Versions', [{ label: 'Save a named version of the case as it is now…', value: '__new' }, ...vs.map((v) => ({ label: v.name, value: v.id, detail: `step ${v.filter.seq}, ${v.filter.at?.slice(0, 16).replace('T', ' ')}` }))]);
    if (!id) return;
    if (id === '__new') {
      const name = await promptBox('Save Version', 'Name', `Version ${vs.length + 1}`);
      if (name) app.store.transact(`Version: ${name}`, (tx) => tx.put('views', { id: newId('ver'), name, filter: { kind: 'version', seq: String(app.store.seq + 1), at: nowIso() } }));
      return;
    }
    const v = app.data.views[id];
    const what = await choose(v.name, [{ label: 'Change report since this version', value: 'report' }, { label: 'Restore the case to this version', value: 'restore', detail: 'one step you can undo' }]);
    if (what === 'report') { const { changeReport } = await import('../reports/changes'); download(changeReport(app.store.journal, Number(v.filter.seq), app.store.seq, app.data), `${slug(app.data.settings.title)} changes since ${slug(v.name)}.md`, 'text/markdown'); }
    if (what === 'restore' && (await confirmBox('Restore Version', `Return the case to “${v.name}”?`, 'Restore'))) app.store.restoreTo(Number(v.filter.seq));
  });
  register('file.openRepair', () => openFromFile(true));
  register('file.importTextFolder', async () => {
    const [f] = await pickFiles('.zip', false);
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const data = await importTextFolder(bytes);
    app.newCase(data);
    app.store.journal = await importTextFolderJournal(bytes);
    toast('Text folder opened. Original files of sources are not part of a text folder.');
  });
  register('file.save', () => saveNow(false));
  register('file.saveAs', () => saveNow(true));
  register('file.saveCopy', async () => download(await app.serialize(), app.fileName.replace(/\.witness$/, '') + ' copy.witness', 'application/x-annes-witness'));
  register('file.savePortable', async () => {
    const missing = app.store.sources.filter((s) => !app.blobs.get(s.id) && s.kind !== 'reference' && s.kind !== 'testimony');
    if (missing.length) await alertBox('Portable case', `These sources have no stored file and travel as text only:\n${missing.map((s) => s.title).join('\n')}`);
    download(await app.serialize(), app.fileName.replace(/\.witness$/, '') + ' (portable).witness', 'application/x-annes-witness');
  });
  register('file.seal', async () => {
    const r = await form<{ by: string }>('Seal Case', [{ key: 'by', label: 'Sealed by', value: app.data.settings.author || app.store.user, required: true }], 'Seal and save',
      'Writes a read-only copy with a fingerprint of every source and every record. A reader can confirm with Verify Seal that nothing changed afterward. A seal does not prove who sealed it or when.');
    if (!r) return;
    const bytes = await app.serialize({ by: r.by });
    download(bytes, app.fileName.replace(/\.witness$/, '') + ' (sealed).witness', 'application/x-annes-witness');
  });
  register('file.verifySeal', async () => {
    const [f] = await pickFiles('.witness,.zip', false);
    if (!f) return;
    const v = await verifySeal(new Uint8Array(await f.arrayBuffer()));
    await alertBox('Verify Seal', !v.sealed ? 'This file is not sealed.' : v.ok ? 'The seal is intact: nothing changed since the case was sealed.' : `The seal is broken. Differences:\n${v.differences.join('\n')}`);
  });
  register('file.print', () => window.print());
  register('file.printPreview', () => window.print());
  register('file.export', async () => {
    const id = await choose('Export', [
      { label: 'Proof Summary', value: 'report.proof' }, { label: 'Claim Table (CSV)', value: 'report.claimTable' }, { label: 'Source List / BibTeX / RIS / CSL-JSON', value: 'report.sourceList' },
      { label: 'Reader Verification Kit (HTML)', value: 'report.readerKit' }, { label: 'Exhibit Bundle (PDF)', value: 'report.exhibits' }, { label: 'Evidence Map (SVG)', value: 'report.map' },
      { label: 'Case as Text Folder', value: 'dev.exportText' },
    ]);
    if (id) await run(id);
  });
  register('file.send', async () => {
    const bytes = await app.serialize();
    const file = new File([bytes as BlobPart], app.fileName, { type: 'application/x-annes-witness' });
    const nav = navigator as any;
    if (nav.canShare?.({ files: [file] })) await nav.share({ files: [file], title: app.data.settings.title });
    else download(bytes, app.fileName);
  });
  register('file.properties', async () => {
    const s = app.data.settings;
    const r = await form<any>('Case Properties', [
      { key: 'title', label: 'Title', value: s.title },
      { key: 'question', label: 'Question this case answers', type: 'textarea', rows: 3, value: s.question },
      { key: 'author', label: 'Author', value: s.author },
      { key: 'standard', label: 'Standard of proof in use (your words)', type: 'textarea', rows: 3, value: s.standard },
    ]);
    if (r) app.store.transact('Case properties', () => { Object.assign(app.data.settings, r); });
    app.store.touch();
  });
  register('file.statistics', () => {
    const c = statusCounts(app.statuses());
    const t = app.store.ties;
    return alertBox('Case Statistics', [
      `Sources: ${app.store.evidence.length} (${app.store.evidence.filter((s) => s.confidential).length} confidential); documents: ${app.store.documents.length}`,
      `Anchors: ${app.store.anchors.length} (${app.store.anchors.filter((a) => a.broken).length} broken)`,
      `Claims: ${app.store.claims.length} — ${(Object.keys(c) as Status[]).map((k) => `${STATUS_LABEL[k]} ${c[k]}`).join(', ')}`,
      `Ties: ${t.filter((x) => x.state === 'confirmed').length} confirmed, ${t.filter((x) => x.state === 'proposed').length} proposed, ${t.filter((x) => x.state === 'rejected').length} rejected`,
      `By kind: ${['supports', 'contradicts', 'mentions', 'absence', 'sum-of', 'claim'].map((k) => `${k} ${t.filter((x) => x.kind === k && x.state === 'confirmed').length}`).join(', ')}`,
      `Journal: ${app.store.journal.length} steps`,
    ].join('\n'));
  });
  register('file.protect', async () => {
    const r = await form<{ p1: string; p2: string }>('Protect Case', [
      { key: 'p1', label: 'Password (empty to remove protection)', type: 'password' },
      { key: 'p2', label: 'Repeat password', type: 'password' },
    ], 'Set', 'The saved file is encrypted with this password (AES-256). There is no way to recover a lost password.');
    if (!r) return;
    if (r.p1 !== r.p2) throw new UserError('The passwords differ.');
    password = r.p1 || null;
    toast(password ? 'The case will be encrypted when saved.' : 'Protection removed.');
  });
  register('file.options', async () => {
    const s = app.data.settings;
    const r = await form<any>('Options', [
      { key: 'user', label: 'Your name (recorded on confirmations and sign-offs)', value: app.store.user },
      { key: 'citationStyle', label: 'Citation style', type: 'select', value: s.citationStyle, options: [{ value: 'author-date', label: 'Author-date' }, { value: 'notes', label: 'Notes and bibliography' }] },
      { key: 'numberTolerance', label: 'Number tolerance (absolute)', type: 'number', value: s.numberTolerance },
      { key: 'materiality', label: 'Materiality threshold (differences at or below are trivial)', type: 'number', value: s.materiality ?? 0 },
      { key: 'recencyYears', label: 'Sources older than this many years are old for claims about the present', type: 'number', value: s.recencyYears },
      { key: 'calendarDefault', label: 'Calendar for dates without a stated calendar', type: 'select', value: s.calendarDefault, options: [{ value: 'gregorian', label: 'Gregorian' }, { value: 'julian', label: 'Julian' }] },
      { key: 'checkOnSave', label: 'Run all checks when saving', type: 'checkbox', value: s.checkOnSave },
      { key: 'statusPatterns', label: 'Show status with patterns as well as colors', type: 'checkbox', value: s.statusPatterns },
    ]);
    if (!r) return;
    app.store.user = r.user || 'me';
    localStorage.setItem('annes-witness.user', app.store.user);
    app.store.transact('Options', () => Object.assign(app.data.settings, { ...r, user: undefined, materiality: r.materiality || undefined }));
    app.store.touch();
  });
  register('file.close', () => run('file.new'));
  register('file.exit', async () => { await app.autosave(); window.close(); toast('Close the browser tab or window to exit.'); });

  // --- Home -----------------------------------------------------------------------------------
  register('edit.copy', async () => {
    const a = app.sel.anchorId ? app.data.anchors[app.sel.anchorId] : undefined;
    const text = a?.exact || app.claim?.text || '';
    need(text, 'Select a claim or an anchor.');
    await navigator.clipboard.writeText(text);
    toast('Copied.');
  });
  register('edit.cut', async () => {
    const c = needClaim();
    await navigator.clipboard.writeText(c.text);
    app.store.transact(`Cut claim ${c.number}`, (tx) => { for (const t of app.store.tiesOf(c.id)) tx.delete('ties', t.id); tx.delete('claims', c.id); });
    app.select({ claimId: undefined });
  });
  register('edit.paste', async () => {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) throw new UserError('The clipboard has no text.');
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    app.store.transact(lines.length > 1 ? `Paste ${lines.length} claims` : 'Paste claim', (tx) => { let n = app.store.nextClaimNumber(); for (const l of lines) tx.put('claims', { ...app.newClaim(l), number: n++ }); });
  });
  register('edit.copyCitation', async () => {
    const { sourceCitation } = await import('../reports/citation');
    const s = need(app.source, 'Select a source.');
    const a = app.sel.anchorId ? app.data.anchors[app.sel.anchorId] : undefined;
    const { locate } = await import('../core/anchor');
    const cite = sourceCitation(s, app.data.settings.citationStyle).replace(/\*/g, '') + (a ? `, ${locate(s, a.start, a.end)}` : '');
    await navigator.clipboard.writeText(cite);
    toast('Citation copied.');
  });
  register('edit.copyAnchorLink', async () => {
    const a = need(app.sel.anchorId, 'Select an anchor.');
    await navigator.clipboard.writeText(`annes-witness://case/${app.data.id}/anchor/${a}`);
    toast('Anchor link copied.');
  });
  register('edit.undo', { run: () => app.store.undo(), enabled: () => app.store.canUndo() });
  register('edit.redo', { run: () => app.store.redo(), enabled: () => app.store.canRedo() });
  register('edit.history', async () => {
    const j = [...app.store.journal].reverse().slice(0, 500);
    let pick: number | null = null;
    const list = h('table.history', h('thead', h('tr', h('th', 'Step'), h('th', 'When'), h('th', 'Who'), h('th', 'What'), h('th', 'Records'), h('th', ''))),
      h('tbody', j.map((e) => h('tr', h('td', String(e.seq)), h('td', e.at.replace('T', ' ').slice(0, 19)), h('td', e.by), h('td', e.label), h('td', String(e.ops.length)),
        h('td', h('button', { onclick: () => { pick = e.seq; (list.closest('.dialog')?.querySelector('.dialog-buttons button') as HTMLButtonElement)?.click(); } }, 'Restore to here'))))));
    await showPanel('History', list);
    if (pick !== null && (await confirmBox('Restore', `Return the case to how it was after step ${pick}? This is itself one step you can undo.`, 'Restore'))) app.store.restoreTo(pick);
  });
  register('edit.find', () => (document.querySelector('.claims input[type=search]') as HTMLInputElement)?.focus());
  register('edit.findAll', async () => {
    const q = await promptBox('Find in Whole Case', 'Find');
    if (!q) return;
    const ql = q.toLowerCase();
    const hits: { label: string; go: () => void }[] = [];
    for (const c of app.store.claims) if (c.text.toLowerCase().includes(ql) || c.notes?.toLowerCase().includes(ql)) hits.push({ label: `Claim ${c.number}: ${truncate(c.text, 100)}`, go: () => app.select({ claimId: c.id }) });
    for (const s of app.store.sources) {
      let i = s.text.toLowerCase().indexOf(ql), n = 0;
      while (i >= 0 && n < 50) {
        const at = i;
        hits.push({ label: `${s.title}: …${truncate(s.text.slice(Math.max(0, at - 40), at + q.length + 40).replace(/\s+/g, ' '), 120)}…`, go: () => { app.view = s.role === 'document' ? 'document' : 'workbench'; app.select({ [s.role === 'document' ? 'documentId' : 'sourceId']: s.id, text: { sourceId: s.id, start: at, end: at + q.length } } as any); } });
        i = s.text.toLowerCase().indexOf(ql, i + 1); n++;
      }
      for (const field of [s.transcription, s.notes]) if (field?.toLowerCase().includes(ql)) hits.push({ label: `${s.title} (transcription or notes)`, go: () => app.select({ sourceId: s.id }) });
    }
    const list = h('div.hits', hits.length ? hits.slice(0, 400).map((x) => h('button.choice', { onclick: () => { x.go(); (list.closest('.dialog')?.querySelector('.dialog-buttons button') as HTMLButtonElement)?.click(); } }, x.label)) : h('p', 'Nothing found.'));
    await showPanel(`Find “${q}” (${hits.length})`, list);
  });
  register('edit.replace', async () => {
    const r = await form<{ find: string; repl: string }>('Replace in claims and notes', [{ key: 'find', label: 'Find', required: true }, { key: 'repl', label: 'Replace with' }], 'Replace all',
      'Source text is never changed. Claims whose wording changes become Stale until their ties are confirmed again.');
    if (!r) return;
    let n = 0;
    app.store.transact('Replace', (tx) => {
      for (const c of app.store.claims) {
        const text = c.text.split(r.find).join(r.repl), notes = c.notes?.split(r.find).join(r.repl);
        if (text !== c.text || notes !== c.notes) { tx.update<Claim>('claims', c.id, { text, notes }); n++; }
      }
    });
    toast(`${n} claims changed.`);
  });
  register('edit.goTo', async () => {
    const q = await promptBox('Go To', 'Claim number, source title, or “p. 3” in the current source');
    if (!q) return;
    const n = Number(q);
    const c = Number.isFinite(n) ? app.store.claims.find((x) => x.number === n) : undefined;
    if (c) return app.select({ claimId: c.id });
    const pg = q.match(/p\.?\s*(\d+)/i);
    if (pg && app.source) {
      const seg = app.source.segments.find((s) => s.page === Number(pg[1]));
      if (seg) return app.select({ text: { sourceId: app.source.id, start: seg.start, end: seg.start + 1 } });
    }
    const s = app.store.sources.find((x) => x.title.toLowerCase().includes(q.toLowerCase()));
    if (s) return app.select(s.role === 'document' ? { documentId: s.id } : { sourceId: s.id });
    throw new UserError('Nothing matches.');
  });
  const step = (dir: 1 | -1, pred: (c: Claim) => boolean) => () => {
    const list = app.store.claims;
    const i = list.findIndex((c) => c.id === app.sel.claimId);
    for (let k = 1; k <= list.length; k++) {
      const c = list[(i + dir * k + list.length * 2) % list.length];
      if (c && pred(c)) return app.select({ claimId: c.id });
    }
    toast('None left.');
  };
  const isOpen = (c: Claim) => app.status(c.id)?.status === 'open';
  const isProblem = (c: Claim) => ['disputed', 'stale'].includes(app.status(c.id)?.status) || app.findings.some((f) => f.claimId === c.id && f.severity !== 'info');
  register('nav.nextOpen', step(1, isOpen));
  register('nav.prevOpen', step(-1, isOpen));
  register('nav.nextProblem', step(1, isProblem));
  register('nav.prevProblem', step(-1, isProblem));
  register('nav.followTie', () => {
    if (app.sel.anchorId) {
      const t = app.store.ties.find((x) => x.anchorId === app.sel.anchorId && x.claimId !== app.sel.claimId) ?? app.store.ties.find((x) => x.anchorId === app.sel.anchorId);
      if (t && t.claimId !== app.sel.claimId) return app.select({ claimId: t.claimId, tieId: t.id });
    }
    const c = needClaim();
    const ties = app.store.tiesOf(c.id).filter((t) => t.anchorId && t.state !== 'rejected');
    if (!ties.length) {
      if (c.doc) { app.view = 'document'; return app.select({ documentId: c.doc.documentId }); }
      throw new UserError('This claim has no ties to follow.');
    }
    const i = ties.findIndex((t) => t.id === app.sel.tieId);
    const t = ties[(i + 1) % ties.length];
    const a = app.data.anchors[t.anchorId!];
    if (app.view !== 'workbench') app.view = 'workbench';
    app.select({ tieId: t.id, anchorId: a.id, sourceId: a.sourceId });
  });
  register('nav.back', () => app.back());
  register('nav.forward', () => app.forward());

  // --- View ------------------------------------------------------------------------------------
  const views: [string, any][] = [['view.workbench', 'workbench'], ['view.document', 'document'], ['view.source', 'source'], ['view.matrix', 'matrix'], ['view.coverage', 'coverage'], ['view.lineage', 'lineage'], ['view.timeline', 'timeline'], ['view.people', 'people'], ['view.chronology', 'chronology'], ['view.wordFrequency', 'wordfreq']];
  for (const [id, v] of views) register(id, { run: () => { app.view = v; app.render(); }, checked: () => app.view === v });
  register('source.lineage', () => { app.view = 'lineage'; app.render(); });
  register('resolve.timeline', () => { app.view = 'timeline'; app.render(); });
  register('view.split', async () => {
    if (app.splitSourceId) { app.splitSourceId = undefined; return app.render(); }
    const id = await choose('Split Source View', app.store.sources.filter((s) => s.id !== app.sel.sourceId).map((s) => ({ label: s.title, value: s.id })));
    if (id) { app.splitSourceId = id; app.view = 'workbench'; app.render(); }
  });
  register('view.problems', { run: () => { app.showProblems = !app.showProblems; app.render(); }, checked: () => app.showProblems });
  register('view.details', { run: () => { app.showDetails = !app.showDetails; app.render(); }, checked: () => app.showDetails });
  register('view.statusColors', { run: () => { app.store.transact('Status patterns', () => { app.data.settings.statusPatterns = !app.data.settings.statusPatterns; }); app.store.touch(); }, checked: () => app.data.settings.statusPatterns });
  register('view.zoomIn', () => { app.zoom = Math.min(3, app.zoom + 0.1); app.render(); });
  register('view.zoomOut', () => { app.zoom = Math.max(0.5, app.zoom - 0.1); app.render(); });
  register('view.fitPage', () => { app.zoom = 1; app.render(); });
  register('view.fullScreen', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()));
  register('view.menus', async () => {
    const m = await choose('Menus', [{ label: 'Ribbon', value: 'ribbon' }, { label: 'Classic menu bar', value: 'menus' }, { label: 'Both', value: 'both' }], `Now: ${getMenusMode()}`);
    if (m) setMenusMode(m as any);
  });
  register('view.customizeQat', async () => {
    const ids = registeredIds();
    const r = await form<{ ids: string[] }>('Customize Quick Access Bar', [{ key: 'ids', label: 'Commands on the bar', type: 'multiselect', value: getQat(), options: ids.map((i) => ({ value: i, label: `${commandMeta(i)!.label} (${commandMeta(i)!.tab})` })) }], 'Save');
    if (r) setQat(r.ids.length ? r.ids : DEFAULT_QAT);
  });
  register('view.qatAddAll', async () => {
    if (await confirmBox('Add All Choices', `Put all ${registeredIds().length} available commands on the Quick Access Bar?`, 'Add all')) setQat(registeredIds());
  });
  register('view.customizeRibbon', async () => {
    const cur = getCustomTab();
    const r = await form<{ name: string; ids: string[] }>('Customize Ribbon: your own tab', [
      { key: 'name', label: 'Tab name (empty removes the tab)', value: cur?.name ?? 'My Tab' },
      { key: 'ids', label: 'Commands', type: 'multiselect', value: cur?.ids ?? [], options: allCommands().map((c) => ({ value: c.id, label: `${c.label} (${c.tab})` })) },
    ], 'Save');
    if (r) setCustomTab(r.name ? { name: r.name, ids: r.ids } : null);
  });
  register('view.customizeKeyboard', async () => {
    const id = await promptBox('Customize Keyboard', 'Command (name or id)');
    if (!id) return;
    const c = allCommands().find((x) => x.id === id || x.label.toLowerCase().replace('…', '') === id.toLowerCase());
    if (!c) throw new UserError('No such command.');
    const k = await promptBox('Customize Keyboard', `Shortcut for “${c.label}” (for example Ctrl+Alt+J; empty to remove)`, shortcutOf(c.id));
    if (k === null) return;
    const b = customBindings();
    b[c.id] = k;
    setCustomBindings(b);
    toast(k ? `${c.label}: ${k}` : `${c.label}: no shortcut`);
  });
  register('view.commandSearch', () => openSearch());
  register('view.theme', async () => {
    const t = await choose('Theme', [{ label: 'System', value: 'system' }, { label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }, { label: 'High contrast', value: 'contrast' }]);
    if (t) { localStorage.setItem('annes-witness.theme', t); document.documentElement.dataset.theme = t; }
  });

  // --- Tools ------------------------------------------------------------------------------------
  let recording: string[] | null = null;
  const MACROS = 'annes-witness.macros';
  const macros = (): Record<string, string[]> => { try { return JSON.parse(localStorage.getItem(MACROS) ?? '{}'); } catch { return {}; } };
  (window as any).__recordCommand = (id: string) => { if (recording && id !== 'tools.recordMacro') recording.push(id); };
  register('tools.recordMacro', {
    run: async () => {
      if (!recording) { recording = []; toast('Recording: run commands, then Record Macro again to stop.'); return; }
      const steps = recording;
      recording = null;
      if (!steps.length) return toast('Nothing recorded.');
      const name = await promptBox('Save macro', `Name for these ${steps.length} steps`, 'Macro ' + (Object.keys(macros()).length + 1));
      if (name) localStorage.setItem(MACROS, JSON.stringify({ ...macros(), [name]: steps }));
    },
    checked: () => !!recording,
  });
  register('tools.macros', async () => {
    const m = macros();
    const name = await choose('Macros', Object.entries(m).map(([k, v]) => ({ label: k, value: k, detail: v.map((i) => commandMeta(i)?.label ?? i).join(' → ') })), Object.keys(m).length ? 'Run a macro' : 'No macros yet: Tools ▸ Record Macro.');
    if (name) for (const id of m[name]) await run(id);
  });
  register('tools.rules', async () => {
    const rules = Object.values(app.data.rules);
    const id = await choose('Rules', [...rules.map((r) => ({ label: `${r.enabled ? '✓' : '○'} ${r.name}`, value: r.id, detail: r.message })), { label: 'New rule…', value: '__new' }]);
    if (!id) return;
    const r = id === '__new' ? undefined : app.data.rules[id];
    const v = await form<any>('Rule', [
      { key: 'name', label: 'Name', value: r?.name ?? '', required: true },
      { key: 'pattern', label: 'Applies to claims matching (regular expression)', value: r?.pattern ?? '\\d' },
      { key: 'condition', label: 'Condition', type: 'select', value: r?.condition ?? 'minSupports', options: [
        { value: 'minSupports', label: 'At least N supporting ties' }, { value: 'minIndependent', label: 'At least N independent sources' },
        { value: 'requiresTick', label: 'Every confirmed tie has a tick mark' }, { value: 'requiresFirstHand', label: 'At least one first-hand anchor' },
        { value: 'numberAbove', label: 'Figures above N need two supports' }] },
      { key: 'value', label: 'N', type: 'number', value: r?.value ?? 1 },
      { key: 'message', label: 'Message when the rule fails', value: r?.message ?? '' },
      { key: 'enabled', label: 'Enabled', type: 'checkbox', value: r?.enabled ?? true },
      { key: 'remove', label: 'Delete this rule', type: 'checkbox', value: false },
    ]);
    if (!v) return;
    app.store.transact('Rule', (tx) => {
      if (v.remove && r) tx.delete('rules', r.id);
      else tx.put('rules', { id: r?.id ?? newId('r'), name: v.name, pattern: v.pattern, condition: v.condition, value: v.value, message: v.message || v.name, enabled: v.enabled });
    });
  });
  register('tools.openSourceInApp', () => {
    const s = need(app.source ?? app.document, 'Select a source.');
    const b = need(app.blobs.get(s.id), 'The file is not stored in this case.');
    download(b, s.fileName ?? s.title, s.mime);
  });
  register('tools.toGrid', async () => {
    const { claimTableCsv } = await import('../reports/tables');
    download(claimTableCsv(app.data, app.statuses()), slug(app.data.settings.title) + ' claims.csv', 'text/csv');
  });
  register('tools.toBase', async () => {
    const { toCsv } = await import('../core/util');
    const rows = [['id', 'claim', 'kind', 'source', 'start', 'end', 'passage', 'state', 'confirmedBy']];
    for (const t of app.store.ties) {
      const a = t.anchorId ? app.data.anchors[t.anchorId] : undefined;
      rows.push([t.id, String(app.data.claims[t.claimId]?.number ?? ''), t.kind, a ? app.data.sources[a.sourceId]?.title : '', String(a?.start ?? ''), String(a?.end ?? ''), a?.exact ?? '', t.state, t.confirmedBy ?? '']);
    }
    download(toCsv(rows), slug(app.data.settings.title) + ' ties.csv', 'text/csv');
  });
  register('tools.import', async () => {
    const id = await choose('Import', [
      { label: 'Sources (files)', value: 'source.addFiles' }, { label: 'References (BibTeX, RIS, CSL-JSON)', value: 'source.importReferences' },
      { label: 'Web annotations', value: 'source.importAnnotations' }, { label: 'Claims from CSV', value: 'claim.importCsv' },
      { label: 'Citations from a GEDCOM file', value: 'tools.gedcomCitations' }, { label: 'Case text folder', value: 'file.importTextFolder' },
    ]);
    if (id) await run(id);
  });
  register('tools.gedcomCitations', async () => {
    const [f] = await pickFiles('.ged,.gedcom', false);
    if (!f) return;
    const { parseGedcomCitations } = await import('./gedcomCitations');
    const r = parseGedcomCitations(await f.text());
    app.store.transact('Citations from GEDCOM', (tx) => {
      const srcIds = new Map<string, string>();
      for (const s of r.sources) {
        const src: Source = { id: newId('s'), role: 'source', title: s.title, kind: 'reference', embedded: false, added: nowIso(), citation: { title: s.title, authors: s.author ? [s.author] : undefined, publisher: s.publication, repository: s.repository }, classification: 'unknown', derivedFrom: [], confidential: false, tags: ['GEDCOM'], text: s.text ?? '', segments: [], notes: s.note };
        tx.put('sources', src);
        srcIds.set(s.xref, src.id);
      }
      let n = app.store.nextClaimNumber();
      for (const c of r.claims) {
        const claim: Claim = { id: newId('c'), number: n++, text: c.text, kind: c.kind as any, importance: 'normal', dependsOn: [], tags: ['GEDCOM'], notes: c.citations.map((x) => `${x.page ? `${x.page}: ` : ''}${x.quality ? `quality ${x.quality}` : ''}`).filter(Boolean).join('; ') || undefined, created: nowIso() };
        tx.put('claims', claim);
        for (const x of c.citations) {
          const sid = srcIds.get(x.xref);
          if (!sid) continue;
          const src = tx.ops.find((o) => o.id === sid)?.after as Source;
          const anchor = { id: newId('a'), sourceId: sid, start: 0, end: 0, exact: '', prefix: '', suffix: '', knowledge: 'unknown' as const, note: x.page ? `Cited at: ${x.page}` : undefined, created: nowIso(), sourceHash: src?.contentHash };
          tx.put('anchors', anchor);
          tx.put('ties', { id: newId('t'), claimId: claim.id, anchorId: anchor.id, kind: 'mentions', directness: 'direct', state: 'proposed', proposedBy: { type: 'auto', who: app.store.user, command: 'tools.gedcomCitations' }, note: 'Imported citation from the family tree file. Open the record and tie the exact passage to confirm.', created: nowIso() });
        }
      }
    });
    toast(`Imported ${r.sources.length} sources and ${r.claims.length} claims. Citations arrive as proposed mentions to verify.`);
  });

  // --- Developer -----------------------------------------------------------------------------------
  register('dev.scriptEditor', async () => {
    const r = await form<{ code: string }>('Script Editor', [{ key: 'code', label: 'JavaScript. Available: witness.data (read-only copy), witness.claims(), witness.run(commandId), witness.transact(label, fn(tx)), witness.toast(text).', type: 'textarea', rows: 14, value: localStorage.getItem('annes-witness.script') ?? "// Example: flag every claim with no ties\nwitness.transact('Flag unsupported', tx => {\n  for (const c of witness.claims())\n    if (!witness.ties(c.id).length) tx.update('claims', c.id, { flagged: true });\n});" }], 'Run');
    if (!r) return;
    localStorage.setItem('annes-witness.script', r.code);
    await runScript(r.code);
  });
  register('dev.runScript', async () => {
    const [f] = await pickFiles('.js,.txt', false);
    if (f && (await confirmBox('Run Script', `Run “${f.name}”? Scripts can change this case. Run only scripts you trust.`, 'Run'))) await runScript(await f.text());
  });
  register('dev.commandLine', () => alertBox('Command Line', [
    'From a copy of the source code (Node.js):',
    '  npm run witness -- check  case.witness      run all checks; exit code 1 when there are errors',
    '  npm run witness -- status case.witness      claim counts by status',
    '  npm run witness -- report case.witness out.md   write the proof summary',
    '  npm run witness -- verify case.witness      verify a sealed case',
  ].join('\n')));
  register('dev.query', async () => {
    const q = await form<{ sql: string }>('Query Case (read-only SQL)', [{ key: 'sql', label: 'Tables: sources, anchors, claims, ties, reckonings, log, todos, comments, signoffs', type: 'textarea', rows: 6, value: localStorage.getItem('annes-witness.sql') ?? "SELECT c.number, c.text, count(t.id) AS ties\nFROM claims c LEFT JOIN ties t ON t.claimId = c.id AND t.state = 'confirmed'\nGROUP BY c.id ORDER BY ties, c.number;" }], 'Run');
    if (!q) return;
    localStorage.setItem('annes-witness.sql', q.sql);
    const { queryCase } = await import('./query');
    const r = await queryCase(app.data, q.sql);
    await showPanel(`${r.rows.length} rows`, h('table.findings', h('thead', h('tr', r.columns.map((c) => h('th', c)))), h('tbody', r.rows.slice(0, 2000).map((row) => h('tr', row.map((v) => h('td', truncate(String(v ?? ''), 200))))))));
  });
  register('dev.exportText', async () => download(await exportTextFolder(app.data, app.store.journal), slug(app.data.settings.title) + ' (text).zip', 'application/zip'));
  register('dev.anchorData', () => {
    const a = need(app.sel.anchorId ? app.data.anchors[app.sel.anchorId] : null, 'Select an anchor.');
    return alertBox('Anchor data', JSON.stringify(a, null, 2));
  });
  register('dev.validate', async () => {
    const problems: string[] = [];
    for (const t of app.store.ties) {
      if (!app.data.claims[t.claimId]) problems.push(`Tie ${t.id} points at a missing claim.`);
      if (t.anchorId && !app.data.anchors[t.anchorId]) problems.push(`Tie ${t.id} points at a missing anchor.`);
    }
    for (const a of app.store.anchors) {
      const s = app.data.sources[a.sourceId];
      if (!s) problems.push(`Anchor ${a.id} points at a missing source.`);
      else if (a.exact && s.text.slice(a.start, a.end) !== a.exact) problems.push(`Anchor ${a.id} no longer matches its passage in “${s.title}”.`);
    }
    const nums = new Set<number>();
    for (const c of app.store.claims) { if (nums.has(c.number)) problems.push(`Two claims are numbered ${c.number}.`); nums.add(c.number); }
    await alertBox('Validate Case File', problems.length ? problems.join('\n') : 'No structural problems found.');
  });

  // --- Help ----------------------------------------------------------------------------------
  register('help.contents', () => window.open('https://github.com/socrtwo/annes-witness#readme', '_blank'));
  register('help.tutorial', async () => {
    if (app.store.claims.length && !(await confirmBox('Guided Example', 'Open the guided example in place of the current case? Save first if you need it.', 'Open example'))) return;
    app.newCase(buildSample());
    app.view = 'workbench';
    app.select({ claimId: app.store.claims[0]?.id });
    await alertBox('Guided Example', [
      'This made-up case asks: when was Mary Ann Smith born?',
      '1. The document on the right says 1902. Claim 1 is that statement.',
      '2. Three sources are loaded: a census page, a parish register and a later index copied from the census.',
      '3. Select “born about 1902” in the census and press Ctrl+L: claim 1 becomes Supported.',
      '4. Tie the index too: it stays Supported, because the index descends from the census (Sources ▸ Derived From).',
      '5. Select “born 20 April 1903” in the register and use Ties ▸ Tie as Contradiction: claim 1 becomes Disputed.',
      '6. Resolve ▸ Open Reckoning: choose the reading you accept and write why. The claim becomes Settled.',
      'Or try AI ▸ Draft Sources for Every Fact, then Review ▸ Verify Drafts.',
    ].join('\n'));
  });
  register('help.shortcuts', () => showPanel('Keyboard Shortcuts', h('table.findings', h('tbody', allCommands().filter((c) => shortcutOf(c.id)).map((c) => h('tr', h('td', shortcutOf(c.id)), h('td', c.label), h('td', c.tab)))))));
  register('help.statuses', () => alertBox('What Each Status Means', [
    'Open — nothing confirmed is tied yet, or ties only mention.',
    'Supported — at least one confirmed tie supports it and none contradicts it.',
    'Corroborated — supported by two or more independent sources (sources copied from one original count once).',
    'Disputed — confirmed ties both support and contradict it.',
    'Settled — disputed, with a preferred reading and a written conclusion (Resolve).',
    'Stale — the claim’s wording or a tied source changed after the tie was confirmed. Confirm again.',
    'Set Aside — an opinion or assumption a person chose not to prove, with the reason.',
    '',
    'Statuses are computed from confirmed ties. AI and Auto-Tie proposals never change a status until a person confirms them.',
  ].join('\n')));
  register('help.standards', () => alertBox('Standards of Proof', TEMPLATES.filter((t) => t.settings.standard).map((t) => `${t.label}: ${t.settings.standard}`).join('\n\n')));
  register('help.report', () => window.open('https://github.com/socrtwo/annes-witness/issues/new/choose', '_blank'));
  register('help.updates', () => window.open('https://github.com/socrtwo/annes-witness/releases', '_blank'));
  register('help.notices', async () => {
    const res = await fetch('third-party-notices.txt').catch(() => null);
    await alertBox('Third-Party Notices', res?.ok ? await res.text() : 'Anne’s Witness uses: Anthropic TypeScript SDK (MIT), JSZip (MIT or GPLv3, used under MIT), pdf.js (Apache 2.0), pdf-lib (MIT), sql.js (MIT), Tesseract.js (Apache 2.0), Material Symbols (Apache 2.0).');
  });
  register('help.about', () => alertBox("About Anne's Witness", `Anne's Witness 0.2.0 — an evidence workbench. Part of the Anne's Office suite.\nMIT License. Copyright (c) 2026 Paul D Pruitt.\n${registeredIds().length} of ${allCommands().length} planned commands are available in this version.`));
  void PLAN; void openBackstage; void findPassage;
}

async function runScript(code: string) {
  const witness = {
    get data() { return structuredClone(app.data); },
    claims: () => app.store.claims,
    sources: () => app.store.sources,
    ties: (claimId?: string) => (claimId ? app.store.tiesOf(claimId) : app.store.ties),
    run: (id: string) => run(id),
    transact: (label: string, fn: (tx: any) => void) => app.store.transact(label, fn),
    toast,
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('witness', `"use strict"; return (async () => { ${code}\n })();`);
  await fn(witness);
}
