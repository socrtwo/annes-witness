// Sources, Claims and Ties commands.
import { register, run } from './registry';
import { app } from './app';
import { h } from './dom';
import { form, alertBox, confirmBox, pickFiles, pickFolder, promptBox, showPanel, toast, choose, progress, download } from './dialogs';
import { need, needClaim, needSource, needDoc, UserError } from './common';
import { Anchor, Claim, ClaimKind, Classification, DerivationHow, Id, Source, Tie, TieKind, Confidence, Knowledge } from '../core/types';
import { newId, nowIso, sha256, truncate, parseCsv } from '../core/util';
import { findPassage, makeSelector, locate } from '../core/anchor';
import { captureNumbers, captureQuotes, captureDatesAndNames, checkWorthiness, atomize } from '../text/capture';
import { splitSentences } from '../text/sentences';
import { parseNumbers } from '../text/numbers';
import { readFile, readExif } from '../readers/index';

const KINDS: ClaimKind[] = ['fact', 'number', 'date', 'identity', 'relationship', 'quotation', 'opinion', 'other'];
const kindOpts = KINDS.map((k) => ({ value: k, label: k }));

const RECORD_TEMPLATES: Record<string, { type: any; fields: string[]; note: string }> = {
  census: { type: 'record', fields: ['Year', 'Place (state, county, town)', 'Page or sheet', 'Household or line', 'Enumeration district'], note: 'Population schedule' },
  register: { type: 'record', fields: ['Church or office', 'Register volume', 'Page', 'Entry number', 'Event date'], note: 'Church or civil register' },
  deed: { type: 'record', fields: ['Recorder office', 'Book', 'Page', 'Grantor', 'Grantee', 'Recording date'], note: 'Land record' },
  will: { type: 'record', fields: ['Court', 'Will book', 'Page', 'Testator', 'Probate date'], note: 'Probate record' },
  newspaper: { type: 'article', fields: ['Newspaper', 'Place', 'Date', 'Page', 'Column', 'Headline'], note: 'Newspaper item' },
  ledger: { type: 'dataset', fields: ['Entity', 'Account', 'Period', 'Report run date', 'System'], note: 'Ledger or schedule' },
  statement: { type: 'record', fields: ['Bank', 'Account (last 4 digits)', 'Period', 'Page'], note: 'Bank or account statement' },
  interview: { type: 'interview', fields: ['Interviewee', 'Interviewer', 'Date', 'Place', 'Recording or notes'], note: 'Interview' },
};

function anchorFromSelection(): Anchor | null {
  if (app.sel.text && app.sel.text.end > app.sel.text.start) return app.makeAnchor(app.sel.text.sourceId, app.sel.text.start, app.sel.text.end);
  return null;
}

async function regionTranscription(): Promise<string | undefined> {
  if (!app.sel.rect) return undefined;
  const t = await promptBox('Region', 'What does the marked region say? (optional; used to search and in reports)');
  return t ?? undefined;
}

async function tieWith(kind: TieKind) {
  needClaim();
  if (!app.sel.text && !app.sel.rect && !app.sel.anchorId) throw new UserError('Select a passage in a source, or draw a region on a page, then tie it.');
  const sel = app.sel.text;
  if (sel && app.data.sources[sel.sourceId]?.role === 'document') throw new UserError('That selection is in the linked document. Ties point into sources; use Capture Claim from Selection for the document.');
  const tr = await regionTranscription();
  const t = app.tieSelection(kind, tr);
  if (!t) throw new UserError('Nothing to tie.');
  app.select({ tieId: t.id, anchorId: t.anchorId }, false);
}

function captureInto(items: { start: number; end: number; text: string; kind: ClaimKind; attributedTo?: string }[], doc: Source, label: string) {
  const exists = (s: number, e: number) => app.store.claims.some((c) => c.doc?.documentId === doc.id && c.doc.start === s && c.doc.end === e);
  const seen = new Set<string>();
  let n = 0;
  app.store.transact(label, (tx) => {
    let num = app.store.nextClaimNumber();
    for (const it of items) {
      const key = `${it.start}:${it.end}`;
      if (seen.has(key) || exists(it.start, it.end)) continue;
      seen.add(key);
      tx.put('claims', { ...app.newClaim(it.text, it.kind, { documentId: doc.id, start: it.start, end: it.end }, { attributedTo: it.attributedTo }), number: num++ });
      n++;
    }
  });
  toast(`${n} claims captured.`);
}

function selectionRange(doc: Source) {
  return app.sel.text?.sourceId === doc.id && app.sel.text.end > app.sel.text.start ? app.sel.text : { start: 0, end: doc.text.length };
}

function shift<T extends { start: number; end: number }>(items: T[], by: number): T[] {
  return items.map((i) => ({ ...i, start: i.start + by, end: i.end + by }));
}

async function crossref(query: { doi?: string; title?: string }) {
  const url = query.doi ? `https://api.crossref.org/works/${encodeURIComponent(query.doi)}` : `https://api.crossref.org/works?rows=1&query.bibliographic=${encodeURIComponent(query.title ?? '')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The catalog answered ${res.status}.`);
  const j: any = await res.json();
  const w = j.message?.items?.[0] ?? j.message;
  if (!w) return null;
  return {
    type: w.type?.includes('book') ? 'book' : 'article',
    title: w.title?.[0], container: w['container-title']?.[0], publisher: w.publisher,
    authors: (w.author ?? []).map((a: any) => [a.family, a.given].filter(Boolean).join(', ')),
    year: String(w.issued?.['date-parts']?.[0]?.[0] ?? ''), volume: w.volume, issue: w.issue, pages: w.page, doi: w.DOI, url: w.URL,
    retracted: (w['update-to'] ?? []).some((u: any) => /retract/i.test(u.type ?? '')) || (w.relation?.['is-retracted-by'] ?? []).length > 0,
  };
}

export function registerCaseCommands() {
  // --- Sources: Add -----------------------------------------------------------------------------
  register('source.addFiles', async () => { const f = await pickFiles(); if (f.length) await app.addFiles(f, 'source'); });
  register('source.addFolder', async () => {
    const files = await pickFolder();
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
  register('source.scan', async () => {
    const inp = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' } }) as HTMLInputElement;
    const files = await new Promise<File[]>((res) => { inp.onchange = () => res([...(inp.files ?? [])]); document.body.appendChild(inp); inp.click(); });
    inp.remove();
    if (files.length) await app.addFiles(files, 'source');
  });
  register('source.addRecording', async () => { const f = await pickFiles('audio/*,video/*,.vtt,.srt'); if (f.length) await app.addFiles(f, 'source'); });
  register('source.captureWeb', async () => {
    const url = await promptBox('Capture Web Page', 'Address (https://…)');
    if (!url) return;
    const { captureWebPage } = await import('../readers/web');
    const { platformFetch, desktop } = await import('../platform/index');
    let cap;
    try {
      cap = await captureWebPage(url, platformFetch());
    } catch (e: any) {
      throw new UserError(desktop()
        ? `The page could not be fetched (${e?.message ?? e}).`
        : `The page could not be fetched from here (${e?.message ?? e}). Many sites block fetching from another site’s page in a browser; the desktop app does not have this limit. Or save the page in your browser (Save Page As, “Web page, complete” or .mhtml) and add the saved file instead.`);
    }
    const bytes = new TextEncoder().encode(cap.html);
    await app.addFile(new URL(url).hostname + '.html', bytes, 'source', { url, capturedAt: cap.capturedAt, kind: 'web', citation: { ...(cap.result.citation ?? {}), url, accessed: cap.capturedAt.slice(0, 10) } });
  });
  register('source.fromClipboard', async () => {
    const items = await (navigator.clipboard as any).read?.().catch(() => null);
    if (items) for (const it of items) {
      const type = it.types.find((t: string) => t.startsWith('image/'));
      if (type) {
        const b = new Uint8Array(await (await it.getType(type)).arrayBuffer());
        await app.addFile(`clipboard-${Date.now()}.${type.split('/')[1]}`, b, 'source', { notes: `Pasted from the clipboard on ${nowIso()}.` });
        return;
      }
    }
    const text = await navigator.clipboard.readText();
    if (!text) throw new UserError('The clipboard is empty.');
    const where = await promptBox('Add from Clipboard', 'Where did this text come from?');
    await app.addFile(`clipboard-${Date.now()}.txt`, new TextEncoder().encode(text), 'source', { notes: `Pasted from the clipboard on ${nowIso()}. Origin: ${where ?? 'not stated'}.` });
  });
  register('source.addTestimony', async () => {
    const r = await form<any>('Add Interview or Recollection', [
      { key: 'title', label: 'Title', value: 'Interview', required: true },
      { key: 'informant', label: 'Who said it', required: true }, { key: 'heardBy', label: 'Who heard or recorded it' },
      { key: 'when', label: 'When', type: 'date' }, { key: 'present', label: 'Who else was present' },
      { key: 'consent', label: 'Consent to record was given', type: 'checkbox' },
      { key: 'text', label: 'What was said (typed record)', type: 'textarea', rows: 10, required: true },
    ]);
    if (!r) return;
    const s = await app.addFile(r.title + '.txt', new TextEncoder().encode(r.text), 'source', {
      kind: 'testimony', title: r.title, testimony: { informant: r.informant, heardBy: r.heardBy, when: r.when, present: r.present, consent: r.consent },
      dateMade: r.when, citation: { type: 'interview', title: r.title, authors: [r.informant], date: r.when },
    });
    app.select({ sourceId: s.id });
  });
  register('source.addReference', async () => {
    const r = await form<any>('Add Reference Work', [
      { key: 'title', label: 'Title', required: true }, { key: 'authors', label: 'Authors (separate with ;)' }, { key: 'container', label: 'Journal, book or site' },
      { key: 'publisher', label: 'Publisher' }, { key: 'year', label: 'Year' }, { key: 'pages', label: 'Pages' }, { key: 'doi', label: 'DOI' }, { key: 'url', label: 'Address' },
      { key: 'text', label: 'Passages you rely on (optional, typed or pasted)', type: 'textarea', rows: 5 },
    ]);
    if (!r) return;
    const s: Source = {
      id: newId('s'), role: 'source', title: r.title, kind: 'reference', embedded: false, added: nowIso(),
      citation: { type: 'book', title: r.title, authors: r.authors ? r.authors.split(';').map((x: string) => x.trim()) : undefined, container: r.container, publisher: r.publisher, year: r.year, pages: r.pages, doi: r.doi, url: r.url },
      classification: 'authored', derivedFrom: [], confidential: false, tags: [], text: r.text ?? '', segments: [], contentHash: await sha256(r.text ?? ''),
    };
    app.store.transact('Add reference work', (tx) => tx.put('sources', s));
    app.select({ sourceId: s.id });
  });
  register('source.addByIdentifier', async () => {
    const { parseIdentifier } = await import('../io/formats');
    const q = await promptBox('Add by Identifier', 'DOI, ISBN or PubMed id');
    if (!q) return;
    const id = need(parseIdentifier(q), 'That is not a DOI, ISBN or PubMed id.');
    let fields: any = { title: q };
    if (id.type === 'doi') fields = (await crossref({ doi: id.value })) ?? fields;
    else if (id.type === 'isbn') {
      const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${id.value}&format=json&jscmd=data`);
      const j: any = res.ok ? await res.json() : {};
      const b = j[`ISBN:${id.value}`];
      if (b) fields = { type: 'book', title: b.title, authors: (b.authors ?? []).map((a: any) => a.name), publisher: b.publishers?.[0]?.name, year: String(b.publish_date ?? '').match(/\d{4}/)?.[0], isbn: id.value, url: b.url };
    } else if (id.type === 'pmid') {
      const res = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${id.value}`);
      const j: any = res.ok ? await res.json() : {};
      const b = j.result?.[id.value];
      if (b) fields = { type: 'article', title: b.title, authors: (b.authors ?? []).map((a: any) => a.name), container: b.fulljournalname, year: String(b.pubdate ?? '').slice(0, 4), volume: b.volume, issue: b.issue, pages: b.pages };
    } else fields = { type: 'web', title: q, url: id.value };
    const { retracted, ...citation } = fields;
    const s: Source = { id: newId('s'), role: 'source', title: citation.title ?? q, kind: 'reference', embedded: false, added: nowIso(), citation, classification: 'authored', derivedFrom: [], confidential: false, tags: retracted ? ['retracted'] : [], text: '', segments: [], reliability: retracted ? 'The catalog lists a retraction for this work.' : undefined };
    app.store.transact('Add by identifier', (tx) => tx.put('sources', s));
    app.select({ sourceId: s.id });
    if (retracted) await alertBox('Retracted', 'The catalog lists a retraction for this work.');
  });
  register('source.importReferences', async () => {
    const [f] = await pickFiles('.bib,.ris,.json,.txt', false);
    if (!f) return;
    const text = await f.text();
    const fm = await import('../io/formats');
    const refs = /^\s*[\[{]/.test(text) ? fm.parseCslJson(text) : /^TY {2}-/m.test(text) ? fm.parseRis(text) : fm.parseBibtex(text);
    app.store.transact('Import references', (tx) => {
      for (const c of refs) tx.put('sources', { id: newId('s'), role: 'source', title: c.title ?? 'Untitled reference', kind: 'reference', embedded: false, added: nowIso(), citation: c, classification: 'authored', derivedFrom: [], confidential: false, tags: ['imported'], text: '', segments: [] } as Source);
    });
    toast(`${refs.length} references imported.`);
  });
  register('source.importAnnotations', async () => {
    const [f] = await pickFiles('.json,.jsonld', false);
    if (!f) return;
    const { parseWebAnnotations } = await import('../io/formats');
    const anns = parseWebAnnotations(await f.text());
    let placed = 0, missed = 0;
    app.store.transact('Import web annotations', (tx) => {
      for (const a of anns) {
        const s = app.store.evidence.find((x) => x.url && (x.url === a.url || x.citation.url === a.url));
        const r = s ? findPassage(s.text, a) : null;
        if (!s || !r) { missed++; continue; }
        tx.put('anchors', { ...app.makeAnchor(s.id, r.start, r.end), note: a.note });
        placed++;
      }
    });
    await alertBox('Import Web Annotations', `${placed} anchors placed on captured pages. ${missed} could not be placed (capture those pages first with Capture Web Page).`);
  });
  register('source.archivePublic', async () => {
    const s = needSource();
    const url = need(s.url ?? s.citation.url, 'This source has no web address.');
    if (await confirmBox('Archive Page', `Ask the Internet Archive to save ${url}? Only the address is sent, from your browser.`, 'Open archive')) window.open(`https://web.archive.org/save/${url}`, '_blank');
  });
  register('source.waybackLookup', () => {
    const s = needSource();
    const url = need(s.url ?? s.citation.url, 'This source has no web address.');
    window.open(`https://web.archive.org/web/*/${url}`, '_blank');
  });

  // --- Sources: Describe ---------------------------------------------------------------------------
  register('source.details', async () => {
    const s = needSource();
    const r = await form<any>('Source Details', [
      { key: 'title', label: 'Title', value: s.title, required: true },
      { key: 'dateMade', label: 'Date the record was made', value: s.dateMade ?? '' },
      { key: 'place', label: 'Place made', value: s.place ?? '' },
      { key: 'repository', label: 'Repository', value: s.citation.repository ?? '' },
      { key: 'callNumber', label: 'Call number or reference', value: s.citation.callNumber ?? '' },
      { key: 'obtained', label: 'How you got it', value: s.obtained ?? '' },
      { key: 'url', label: 'Web address', value: s.url ?? s.citation.url ?? '' },
      { key: 'notes', label: 'Notes', type: 'textarea', value: s.notes ?? '' },
    ]);
    if (r) app.store.transact('Source details', (tx) => tx.update<Source>('sources', s.id, { title: r.title, dateMade: r.dateMade || undefined, place: r.place || undefined, obtained: r.obtained || undefined, url: r.url || undefined, notes: r.notes || undefined, citation: { ...s.citation, repository: r.repository || undefined, callNumber: r.callNumber || undefined, url: r.url || s.citation.url } }));
  });
  register('source.citation', async () => {
    const s = needSource();
    const c = s.citation;
    const r = await form<any>('Citation', [
      { key: 'type', label: 'Type', type: 'select', value: c.type ?? 'other', options: ['book', 'article', 'chapter', 'web', 'record', 'interview', 'letter', 'report', 'dataset', 'other'].map((x) => ({ value: x, label: x })) },
      { key: 'authors', label: 'Authors (separate with ;)', value: (c.authors ?? []).join('; ') }, { key: 'title', label: 'Title', value: c.title ?? s.title },
      { key: 'container', label: 'Journal, book, site or collection', value: c.container ?? '' }, { key: 'publisher', label: 'Publisher', value: c.publisher ?? '' },
      { key: 'place', label: 'Place of publication', value: c.place ?? '' }, { key: 'year', label: 'Year', value: c.year ?? '' }, { key: 'date', label: 'Full date', value: c.date ?? '' },
      { key: 'volume', label: 'Volume', value: c.volume ?? '' }, { key: 'issue', label: 'Issue', value: c.issue ?? '' }, { key: 'pages', label: 'Pages', value: c.pages ?? '' },
      { key: 'doi', label: 'DOI', value: c.doi ?? '' }, { key: 'isbn', label: 'ISBN', value: c.isbn ?? '' }, { key: 'url', label: 'Address', value: c.url ?? '' },
      { key: 'accessed', label: 'Accessed', value: c.accessed ?? '' }, { key: 'note', label: 'Note', value: c.note ?? '' },
    ]);
    if (!r) return;
    const clean: any = {};
    for (const [k, v] of Object.entries(r)) if (v) clean[k] = k === 'authors' ? String(v).split(';').map((x) => x.trim()).filter(Boolean) : v;
    app.store.transact('Citation', (tx) => tx.update<Source>('sources', s.id, { citation: { ...c, ...clean, repository: c.repository, callNumber: c.callNumber } }));
  });
  register('source.classify', async () => {
    const s = needSource();
    const a = app.sel.anchorId ? app.data.anchors[app.sel.anchorId] : undefined;
    const r = await form<any>('Classify Source', [
      { key: 'classification', label: 'The source is', type: 'radio', value: s.classification, options: [{ value: 'original', label: 'Original (first recording)' }, { value: 'derivative', label: 'Derivative (copy, index, abstract, translation)' }, { value: 'authored', label: 'Authored (a compiled narrative or analysis)' }, { value: 'unknown', label: 'Unknown' }] },
      ...(a ? [
        { key: 'knowledge', label: `The selected passage’s information is`, type: 'radio' as const, value: a.knowledge, options: [{ value: 'first-hand', label: 'First-hand (informant saw or did it)' }, { value: 'second-hand', label: 'Second-hand' }, { value: 'unknown', label: 'Unknown' }] },
        { key: 'informant', label: 'Informant for this passage', value: a.informant ?? '' },
      ] : [{ key: 'x', label: 'Select an anchor to record the informant and how they knew.', type: 'info' as const }]),
    ]);
    if (!r) return;
    app.store.transact('Classify source', (tx) => {
      tx.update<Source>('sources', s.id, { classification: r.classification as Classification });
      if (a) tx.update<Anchor>('anchors', a.id, { knowledge: r.knowledge as Knowledge, informant: r.informant || undefined });
    });
  });
  register('source.derivedFrom', async () => {
    const s = needSource();
    const others = app.store.evidence.filter((x) => x.id !== s.id);
    const r = await form<any>('Derived From', [
      { key: 'parents', label: `“${s.title}” was made from`, type: 'multiselect', value: s.derivedFrom.map((d) => d.sourceId), options: others.map((o) => ({ value: o.id, label: o.title })) },
      { key: 'how', label: 'How', type: 'select', value: s.derivedFrom[0]?.how ?? 'copy', options: ['copy', 'index', 'abstract', 'translation', 'transcription', 'quotation', 'other'].map((x) => ({ value: x, label: x })) },
    ], 'Save', 'Sources that descend from a common original count once when deciding whether a claim is corroborated.');
    if (!r) return;
    app.store.transact('Derived from', (tx) => tx.update<Source>('sources', s.id, { derivedFrom: (r.parents as Id[]).map((p) => ({ sourceId: p, how: r.how as DerivationHow })), classification: r.parents.length ? 'derivative' : s.classification }));
    const { lineageCycles } = await import('../core/lineage');
    if (lineageCycles(app.data).length) toast('Warning: the lines of descent now form a loop. Check Derived From.');
  });
  register('source.reliability', async () => {
    const s = needSource();
    const r = await promptBox('Reliability Notes', 'Bias, legibility, damage, known errors (include the word “unreliable” to flag it in Weak Points)', s.reliability ?? '', 'textarea');
    if (r !== null) app.store.transact('Reliability notes', (tx) => tx.update<Source>('sources', s.id, { reliability: r || undefined }));
  });
  register('source.confidential', { run: () => { const s = needSource(); app.store.transact('Confidential', (tx) => tx.update<Source>('sources', s.id, { confidential: !s.confidential })); }, checked: () => !!app.source?.confidential });
  register('source.flagKey', { run: () => { const s = needSource(); app.store.transact('Key document', (tx) => tx.update<Source>('sources', s.id, { key: !s.key })); }, checked: () => !!app.source?.key });
  register('source.group', async () => {
    const s = needSource();
    const r = await form<any>('Group Sources', [{ key: 'group', label: 'Group', value: s.group ?? '' }, { key: 'tags', label: 'Tags (separate with ,)', value: s.tags.join(', ') }]);
    if (r) app.store.transact('Group', (tx) => tx.update<Source>('sources', s.id, { group: r.group || undefined, tags: r.tags.split(',').map((x: string) => x.trim()).filter(Boolean) }));
  });
  register('source.siglum', async () => {
    const s = needSource();
    const r = await promptBox('Siglum', 'Short label for this witness (for example A, B, MS1)', s.siglum ?? '');
    if (r !== null) app.store.transact('Siglum', (tx) => tx.update<Source>('sources', s.id, { siglum: r || undefined }));
  });
  register('source.template', async () => {
    const s = needSource();
    const t = await choose('Source Template', Object.entries(RECORD_TEMPLATES).map(([k, v]) => ({ label: v.note, value: k })));
    if (!t) return;
    const tpl = RECORD_TEMPLATES[t];
    const meta = s.meta ?? {};
    const r = await form<any>(tpl.note, tpl.fields.map((f) => ({ key: f, label: f, value: meta[f] ?? '' })));
    if (!r) return;
    const note = tpl.fields.map((f) => r[f] && `${f}: ${r[f]}`).filter(Boolean).join('; ');
    app.store.transact('Source template', (tx) => tx.update<Source>('sources', s.id, { meta: { ...meta, ...r }, citation: { ...s.citation, type: tpl.type, note } }));
  });
  register('source.exif', async () => {
    const s = needSource();
    const b = need(app.blobs.get(s.id), 'The picture file is not stored in this case.');
    const ex = readExif(b);
    await alertBox('Picture Metadata', Object.keys(ex).length ? Object.entries(ex).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n\nMetadata can be edited by anyone; treat it as a lead, not proof.' : 'No metadata found in this file.');
  });

  // --- Sources: Read -------------------------------------------------------------------------------
  register('source.ocr', async () => {
    const s = needSource();
    const b = need(app.blobs.get(s.id), 'The file is not stored in this case.');
    const { ocrImage } = await import('../readers/ocr');
    const p = progress(`Recognizing text in “${s.title}”`);
    try {
      let text = '';
      const segments: Source['segments'] = [];
      if (s.kind === 'image') {
        text = (await ocrImage(b, (app.data.settings.language?.ocr ?? 'eng'), (x: any) => p.update(`Recognizing… ${Math.round((x?.progress ?? 0) * 100)}%`, x?.progress ?? 0, 1))).text;
        segments.push({ start: 0, end: text.length, label: 'p. 1', page: 1 });
      } else if (s.kind === 'pdf') {
        const { renderPdfPage } = await import('../readers/index');
        for (let pg = 1; pg <= (s.pageCount ?? 1); pg++) {
          if (p.signal.aborted) break;
          p.update(`Page ${pg} of ${s.pageCount}`, pg - 1, s.pageCount ?? 1);
          const canvas = document.createElement('canvas');
          await renderPdfPage(b, pg, canvas, 2);
          const blob: Blob = await new Promise((res) => canvas.toBlob((x) => res(x!), 'image/png'));
          const r = await ocrImage(new Uint8Array(await blob.arrayBuffer()), app.data.settings.language?.ocr ?? 'eng');
          const start = text.length;
          text += r.text + '\n';
          segments.push({ start, end: text.length, label: `p. ${pg}`, page: pg });
        }
      } else throw new UserError('Recognize Text works on pictures and PDF pages.');
      if (s.text && !(await confirmBox('Recognize Text', 'This source already has text. Replace it with the recognized text? Anchors are re-found in the new text.', 'Replace'))) return;
      await app.replaceSourceContent(s.id, null, text, segments, 'Recognize text (OCR)');
      app.store.transact('OCR flag', (tx) => tx.update<Source>('sources', s.id, { ocr: true }));
    } finally { p.close(); }
  });
  register('tools.batchOcr', async () => {
    const list = app.store.evidence.filter((s) => !s.text && (s.kind === 'image' || s.kind === 'pdf') && app.blobs.get(s.id));
    if (!list.length) throw new UserError('No pictures or scanned PDFs without text.');
    for (const s of list) { app.select({ sourceId: s.id }, false); await run('source.ocr'); }
  });
  register('source.transcribe', async () => {
    const s = needSource();
    const r = await form<any>('Transcribe', [
      { key: 't', label: 'Transcription, line by line. Marks: [illegible], [word?] uncertain, [-struck-], [supplied]', type: 'textarea', rows: 18, value: s.transcription ?? '' },
      { key: 'useAsText', label: 'Use as the source’s searchable text (when the source has no text)', type: 'checkbox', value: !s.text },
    ]);
    if (!r) return;
    app.store.transact('Transcribe', (tx) => tx.update<Source>('sources', s.id, { transcription: r.t, transcriptionStatus: r.t ? (s.transcriptionStatus === 'reviewed' ? 'reviewed' : 'started') : 'none' }));
    if (r.useAsText && r.t) {
      let pos = 0;
      const segs = r.t.split('\n').map((l: string, i: number) => { const x = { start: pos, end: pos + l.length, label: `line ${i + 1}`, page: 1 }; pos += l.length + 1; return x; });
      await app.replaceSourceContent(s.id, null, r.t, segs, 'Transcription as text');
    }
    app.sourceMode = 'transcription';
  });
  register('source.regionTools', async () => {
    const f = app.pageFilter;
    const r = await form<any>('Page and Region Tools', [
      { key: 'rotate', label: 'Rotate', type: 'select', value: String(f.rotate), options: ['0', '90', '180', '270'].map((x) => ({ value: x, label: `${x}°` })) },
      { key: 'contrast', label: 'Contrast', type: 'select', value: String(f.contrast), options: ['1', '1.5', '2', '3'].map((x) => ({ value: x, label: `${x}×` })) },
      { key: 'invert', label: 'Invert (light text on dark)', type: 'checkbox', value: f.invert },
    ], 'Apply', 'For reading only: nothing is saved into the source. Draw regions with rotation at 0°.');
    if (r) { app.pageFilter = { rotate: Number(r.rotate), contrast: Number(r.contrast), invert: r.invert }; app.sourceMode = 'page'; app.render(); }
  });
  register('source.transcriptionStatus', async () => {
    const s = needSource();
    const v = await choose('Transcription Status', ['none', 'started', 'done', 'reviewed'].map((x) => ({ label: x, value: x })), `Now: ${s.transcriptionStatus ?? 'none'}`);
    if (v) app.store.transact('Transcription status', (tx) => tx.update<Source>('sources', s.id, { transcriptionStatus: v as any }));
  });
  register('source.compareTranscriptions', async () => {
    const s = needSource();
    const opts = [{ label: 'Source text (OCR or extracted)', value: 'text', t: s.text }, { label: 'Your transcription', value: 'tr', t: s.transcription }, { label: 'AI transcription', value: 'ai', t: s.aiTranscription }].filter((o) => o.t);
    if (opts.length < 2) throw new UserError('This source needs at least two readings (text, your transcription, AI transcription).');
    const r = await form<any>('Compare Transcriptions', [
      { key: 'a', label: 'First reading', type: 'select', value: opts[0].value, options: opts }, { key: 'b', label: 'Second reading', type: 'select', value: opts[1].value, options: opts }]);
    if (!r) return;
    const { compareTranscriptions } = await import('../resolve/collate');
    const A = opts.find((o) => o.value === r.a)!.t!, B = opts.find((o) => o.value === r.b)!.t!;
    const c = compareTranscriptions(A, B);
    await showPanel(`${c.changes.length} differences (${c.same} words agree)`, h('table.findings', h('thead', h('tr', h('th', opts.find((o) => o.value === r.a)!.label), h('th', opts.find((o) => o.value === r.b)!.label))), h('tbody', c.changes.map((x) => h('tr', h('td', x.aText || '—'), h('td', x.bText || '—'))))));
  });
  register('source.translationNote', async () => {
    const sel = need(app.sel.text, 'Select a passage in a source.');
    const s = app.data.sources[sel.sourceId];
    const t = await promptBox('Translation Note', `Your translation of “${truncate(s.text.slice(sel.start, sel.end), 80)}”`, '', 'textarea');
    if (t) app.store.transact('Translation note', (tx) => tx.update<Source>('sources', s.id, { translationNotes: [...(s.translationNotes ?? []), { start: sel.start, end: sel.end, text: t }] }));
  });
  register('source.reverseImageSearch', async () => {
    const s = needSource();
    const url = need(s.url ?? s.citation.url, 'Reverse image search needs the picture’s web address (a captured web picture). For a local file, upload it to the search service yourself.');
    const which = await choose('Reverse Image Search', [{ label: 'TinEye', value: `https://tineye.com/search?url=${encodeURIComponent(url)}` }, { label: 'Google Lens', value: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(url)}` }, { label: 'Bing Visual Search', value: `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${encodeURIComponent(url)}` }], 'Opens the service in a new tab; it receives the picture’s address.');
    if (which) window.open(which, '_blank');
  });

  // --- Sources: Maintain -------------------------------------------------------------------------------
  register('source.verify', async () => {
    const out: string[] = [];
    for (const s of app.store.sources) {
      const b = app.blobs.get(s.id);
      if (b) { if ((await sha256(b)) !== s.fileHash) out.push(`CHANGED file: ${s.title}`); }
      else if (s.fileHash) out.push(`MISSING file: ${s.title} (only its text is in the case)`);
      if (s.contentHash && (await sha256(s.text)) !== s.contentHash) out.push(`CHANGED text: ${s.title}`);
    }
    await alertBox('Check Fingerprints', out.length ? out.join('\n') : `All ${app.store.sources.length} sources match their fingerprints.`);
  });
  register('source.relink', async () => {
    const s = needSource();
    const [f] = await pickFiles('*/*', false);
    if (!f) return;
    const b = new Uint8Array(await f.arrayBuffer());
    if ((await sha256(b)) === s.fileHash) { app.blobs.set(s.id, b); app.store.touch(); app.scheduleAutosave(); return toast('Relinked: the file matches its fingerprint.'); }
    if (await confirmBox('Relink Source', 'This file differs from the one originally added. Replace the source with it? Anchors will be re-found and listed for review.', 'Replace')) {
      app.select({ sourceId: s.id }, false);
      await replaceWith(s, f.name, b);
    }
  });
  async function replaceWith(s: Source, name: string, b: Uint8Array) {
    const r = await readFile(name, b);
    const moves = await app.replaceSourceContent(s.id, b, r.text, r.segments, `Replace ${s.title} with a better copy`);
    app.store.transact('File info', (tx) => tx.update<Source>('sources', s.id, { fileName: name, pageCount: r.pageCount, mime: r.mime }));
    const broken = moves.filter((m) => m.how === 'broken').length, fuzzy = moves.filter((m) => m.how === 'fuzzy').length;
    await alertBox('Re-anchoring', `${moves.length} anchors: ${moves.length - broken - fuzzy} found exactly, ${fuzzy} found approximately (check them), ${broken} not found. Ties on changed sources are Stale until confirmed again.`);
  }
  register('source.replace', async () => {
    const s = needSource();
    const [f] = await pickFiles('*/*', false);
    if (f) await replaceWith(s, f.name, new Uint8Array(await f.arrayBuffer()));
  });
  register('anchor.reanchor', async () => {
    const s = needSource();
    const moves = await app.replaceSourceContent(s.id, null, s.text, s.segments, 'Re-anchor');
    toast(`${moves.filter((m) => m.how !== 'broken').length} of ${moves.length} anchors found.`);
  });
  register('source.remove', async () => {
    const s = needSource();
    const anchors = app.store.anchorsOf(s.id).map((a) => a.id);
    const ties = app.store.ties.filter((t) => t.anchorId && anchors.includes(t.anchorId));
    if (!(await confirmBox('Remove Source', `Remove “${s.title}”${ties.length ? ` and its ${ties.length} ties` : ''}? You can undo this.`, 'Remove'))) return;
    app.store.transact(`Remove ${s.title}`, (tx) => { for (const t of ties) tx.delete('ties', t.id); for (const a of anchors) tx.delete('anchors', a); tx.delete('sources', s.id); });
    app.select({ sourceId: undefined, anchorId: undefined });
  });
  register('source.findDuplicates', async () => {
    const { similarity, normalize } = await import('../core/anchor');
    const out: string[] = [];
    const list = app.store.evidence;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.fileHash && a.fileHash === b.fileHash) out.push(`Identical files: ${a.title} = ${b.title}`);
      else if (a.text.length > 50 && b.text.length > 50 && Math.abs(a.text.length - b.text.length) / Math.max(a.text.length, b.text.length) < 0.2) {
        const sim = similarity(normalize(a.text.slice(0, 5000)), normalize(b.text.slice(0, 5000)));
        if (sim > 0.9) out.push(`Nearly the same text (${Math.round(sim * 100)}%): ${a.title} ≈ ${b.title}`);
      }
    }
    await alertBox('Find Duplicate Sources', out.length ? out.join('\n') : 'No duplicates found.');
  });
  register('source.retrieveMetadata', async () => {
    const s = needSource();
    if (!(await confirmBox('Retrieve Citation Details', 'Look this work up in the Crossref catalog? The title or DOI is sent from your browser.', 'Look up'))) return;
    const r = await crossref({ doi: s.citation.doi, title: s.citation.title ?? s.title });
    if (!r) throw new UserError('Not found in the catalog.');
    const { retracted, ...c } = r as any;
    if (await confirmBox('Catalog record', `${c.authors?.join('; ')}. ${c.title}. ${c.container ?? ''} ${c.year ?? ''}. ${c.doi ?? ''}\n\nUse these details?`, 'Use'))
      app.store.transact('Citation from catalog', (tx) => tx.update<Source>('sources', s.id, { citation: { ...s.citation, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v)) }, tags: retracted ? [...new Set([...s.tags, 'retracted'])] : s.tags }));
  });

  // --- Claims ---------------------------------------------------------------------------------------
  register('claim.linkDocument', async () => { const f = await pickFiles(); if (f.length) { await app.addFiles(f, 'document'); app.view = app.store.evidence.length ? 'workbench' : 'document'; app.render(); } });
  register('claim.new', async () => {
    const r = await form<any>('New Claim', [{ key: 'text', label: 'Claim', type: 'textarea', rows: 3, required: true }, { key: 'kind', label: 'Kind', type: 'select', value: 'fact', options: kindOpts }]);
    if (!r) return;
    const c = app.newClaim(r.text, r.kind);
    app.store.transact('New claim', (tx) => tx.put('claims', c));
    app.select({ claimId: c.id });
  });
  register('claim.capture', async () => {
    const sel = need(app.sel.text, 'Select a sentence or figure in the linked document.');
    const doc = app.data.sources[sel.sourceId];
    const text = doc.text.slice(sel.start, sel.end).trim();
    need(text, 'The selection is empty.');
    if (doc.role === 'source') {
      // From a source passage: make a claim already tied to it.
      return run('claim.fromPassage');
    }
    const kind: ClaimKind = /["“]/.test(text) ? 'quotation' : parseNumbers(text).length ? 'number' : 'fact';
    const c = app.newClaim(text, kind, { documentId: doc.id, start: sel.start + doc.text.slice(sel.start, sel.end).indexOf(text), end: sel.start + doc.text.slice(sel.start, sel.end).indexOf(text) + text.length });
    app.store.transact('Capture claim', (tx) => tx.put('claims', c));
    app.select({ claimId: c.id, text: undefined });
  });
  register('claim.captureNumbers', () => { const d = needDoc(); const r = selectionRange(d); captureInto(shift(captureNumbers(d.text.slice(r.start, r.end)), r.start), d, 'Capture all numbers'); });
  register('claim.captureQuotes', () => { const d = needDoc(); const r = selectionRange(d); captureInto(shift(captureQuotes(d.text.slice(r.start, r.end)), r.start), d, 'Capture all quotations'); });
  register('claim.captureFacts', () => { const d = needDoc(); const r = selectionRange(d); captureInto(shift(captureDatesAndNames(d.text.slice(r.start, r.end)), r.start), d, 'Capture dates and names'); });
  register('claim.fromCitations', async () => {
    const d = needDoc();
    const { findReferenceLines } = await import('../ai/commands');
    const lines = findReferenceLines(d.text);
    if (!lines.length) throw new UserError('No reference list or numbered notes found in the document.');
    captureInto(lines.map((l) => { const i = d.text.indexOf(l); return { start: i, end: i + l.length, text: l, kind: 'other' as ClaimKind }; }).filter((x) => x.start >= 0), d, 'Claims from citations');
  });
  register('claim.refresh', async () => {
    const d = needDoc();
    const [f] = await pickFiles('*/*', false);
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const r = await readFile(f.name, bytes);
    const claims = app.store.claims.filter((c) => c.doc?.documentId === d.id);
    const moved: string[] = [], lost: string[] = [];
    app.blobs.set(d.id, bytes);
    app.store.transact('Refresh from document', (tx) => {
      tx.update<Source>('sources', d.id, { text: r.text, segments: r.segments, fileName: f.name, refreshedAt: nowIso() });
      for (const c of claims) {
        const hit = findPassage(r.text, { start: c.doc!.start, end: c.doc!.end, exact: c.doc!.textAtCapture, prefix: d.text.slice(Math.max(0, c.doc!.start - 32), c.doc!.start), suffix: d.text.slice(c.doc!.end, c.doc!.end + 32) }, 0.6);
        if (hit) { tx.update<Claim>('claims', c.id, { doc: { ...c.doc!, start: hit.start, end: hit.end } }); if (hit.how === 'fuzzy') moved.push(`${c.number}`); }
        else lost.push(`${c.number}`);
      }
    });
    const sh = await sha256(r.text);
    app.store.transact('Document fingerprint', (tx) => tx.update<Source>('sources', d.id, { contentHash: sh, fileHash: undefined }));
    await alertBox('Refresh from Document', `${claims.length} claims checked. Wording changed (now Stale): ${moved.join(', ') || 'none'}. Not found (deleted from the document?): ${lost.join(', ') || 'none'}.`);
  });
  register('claim.fromPassage', async () => {
    const a = need(anchorFromSelection(), 'Select a passage in a source.');
    const s = app.data.sources[a.sourceId];
    need(s.role === 'source', 'Select a passage in a source (not in the linked document).');
    const text = await promptBox('Make Claim from Source Passage', 'Claim (edit the wording if needed)', a.exact.trim(), 'textarea');
    if (!text) return;
    const c = app.newClaim(text, parseNumbers(text).length ? 'number' : 'fact');
    app.store.transact('Claim from passage', (tx) => {
      tx.put('claims', c);
      tx.put('anchors', a);
      tx.put('ties', { id: newId('t'), claimId: c.id, anchorId: a.id, kind: 'supports', directness: 'direct', state: 'confirmed', proposedBy: { type: 'person', who: app.store.user }, confirmedBy: app.store.user, confirmedAt: nowIso(), claimTextAtConfirm: c.text, sourceHashAtConfirm: s.contentHash, created: nowIso() } as Tie);
    });
    app.select({ claimId: c.id, text: undefined });
  });
  register('claim.importCsv', async () => {
    const [f] = await pickFiles('.csv,.tsv,.txt', false);
    if (!f) return;
    const { parseClaimsCsv } = await import('../io/formats');
    const rows = parseClaimsCsv(await f.text());
    app.store.transact('Import claims', (tx) => {
      let n = app.store.nextClaimNumber();
      for (const r of rows) tx.put('claims', { ...app.newClaim(r.text, (KINDS.includes(r.kind as ClaimKind) ? r.kind : 'fact') as ClaimKind, undefined, { group: r.group, tags: r.tags ?? [] }), number: n++ });
    });
    toast(`${rows.length} claims imported.`);
  });
  register('claim.atomize', async () => {
    const c = needClaim();
    const parts = atomize(c.text);
    if (parts.length < 2) throw new UserError('The rule-based splitter found no separate assertions. Try AI ▸ Split into Facts with AI, or Split Claim to do it by hand.');
    if (!(await confirmBox('Split into Facts', parts.map((p, i) => `${i + 1}. ${p}`).join('\n'), 'Create these claims'))) return;
    app.store.transact('Split into facts', (tx) => {
      let n = app.store.nextClaimNumber();
      const ids: Id[] = [];
      for (const p of parts) {
        const pos = c.doc ? app.data.sources[c.doc.documentId].text.indexOf(p, c.doc.start) : -1;
        const doc = c.doc && pos >= 0 && pos < c.doc.end ? { documentId: c.doc.documentId, start: pos, end: pos + p.length } : undefined;
        const x = { ...app.newClaim(p, c.kind, doc, { parentId: c.id }), number: n++ };
        tx.put('claims', x);
        ids.push(x.id);
      }
      tx.update<Claim>('claims', c.id, { dependsOn: [...c.dependsOn, ...ids] });
    });
  });
  register('claim.checkWorthiness', async () => {
    const d = needDoc();
    const ranked = splitSentences(d.text).map((s) => ({ s, w: checkWorthiness(s.text) })).sort((a, b) => b.w.score - a.w.score).slice(0, 200);
    const list = h('table.findings', h('tbody', ranked.map(({ s, w }) => h('tr',
      h('td', w.score.toFixed(2)), h('td', truncate(s.text.trim(), 180)), h('td.meta', w.reasons.join(', ')),
      h('td', h('button', { onclick: (e: Event) => { captureInto([{ start: s.start, end: s.end, text: s.text.trim(), kind: parseNumbers(s.text).length ? 'number' : 'fact' }], d, 'Capture claim'); (e.target as HTMLButtonElement).disabled = true; } }, 'Capture'))))));
    await showPanel('Check-Worthiness (rule-based, no AI)', list);
  });
  register('claim.details', async () => {
    const c = needClaim();
    const r = await form<any>(`Claim ${c.number}`, [
      { key: 'text', label: 'Text', type: 'textarea', rows: 3, value: c.text, required: true },
      { key: 'kind', label: 'Kind', type: 'select', value: c.kind, options: kindOpts },
      { key: 'importance', label: 'Importance', type: 'select', value: c.importance, options: ['low', 'normal', 'high'].map((x) => ({ value: x, label: x })) },
      { key: 'owner', label: 'Owner', value: c.owner ?? '' }, { key: 'due', label: 'Due', type: 'date', value: c.due ?? '' },
      { key: 'attributedTo', label: 'Quoted speaker or work', value: c.attributedTo ?? '' },
    ]);
    if (r) app.store.transact(`Edit claim ${c.number}`, (tx) => tx.update<Claim>('claims', c.id, { text: r.text, kind: r.kind, importance: r.importance, owner: r.owner || undefined, due: r.due || undefined, attributedTo: r.attributedTo || undefined }));
  });
  register('claim.split', async () => {
    const c = needClaim();
    const r = await form<any>('Split Claim', [{ key: 'a', label: 'First claim', type: 'textarea', value: c.text }, { key: 'b', label: 'Second claim', type: 'textarea', value: '' }]);
    if (!r || !r.b.trim()) return;
    app.store.transact('Split claim', (tx) => {
      tx.update<Claim>('claims', c.id, { text: r.a });
      tx.put('claims', { ...app.newClaim(r.b, c.kind, c.doc ? { documentId: c.doc.documentId, start: c.doc.start, end: c.doc.end } : undefined, { parentId: c.parentId, group: c.group, tags: c.tags }), number: app.store.nextClaimNumber() });
    });
  });
  register('claim.merge', async () => {
    const list = app.selectedClaims();
    if (list.length < 2) throw new UserError('Select two or more claims (Ctrl+click) to merge.');
    const [keep, ...rest] = list.sort((a, b) => a.number - b.number);
    if (!(await confirmBox('Merge Claims', `Keep claim ${keep.number} and move the ties of ${rest.map((r) => r.number).join(', ')} to it?`, 'Merge'))) return;
    app.store.transact('Merge claims', (tx) => {
      for (const r of rest) {
        for (const t of app.store.tiesOf(r.id)) tx.update<Tie>('ties', t.id, { claimId: keep.id });
        tx.delete('claims', r.id);
      }
      tx.update<Claim>('claims', keep.id, { notes: [keep.notes, `Merged from claims ${rest.map((r) => r.number).join(', ')}: ${rest.map((r) => r.text).join(' | ')}`].filter(Boolean).join('\n') });
    });
    app.select({ claimId: keep.id });
  });
  register('claim.dependsOn', async () => {
    const c = needClaim();
    const r = await form<any>('Depends On', [{ key: 'ids', label: `Claim ${c.number} is a conclusion from`, type: 'multiselect', value: c.dependsOn, options: app.store.claims.filter((x) => x.id !== c.id).map((x) => ({ value: x.id, label: `${x.number}. ${truncate(x.text, 90)}` })) }], 'Save', 'A conclusion is no stronger than the weakest claim it rests on.');
    if (r) app.store.transact('Depends on', (tx) => tx.update<Claim>('claims', c.id, { dependsOn: r.ids }));
  });
  register('claim.group', async () => {
    const list = app.selectedClaims().length ? app.selectedClaims() : [needClaim()];
    const g = await promptBox('Group Claims', `Group for ${list.length} claim(s) (chapter, statement line, person, topic)`, list[0].group ?? '');
    if (g !== null) app.store.transact('Group claims', (tx) => { for (const c of list) tx.update<Claim>('claims', c.id, { group: g || undefined }); });
  });
  register('claim.tags', async () => {
    const list = app.selectedClaims().length ? app.selectedClaims() : [needClaim()];
    const g = await promptBox('Tags', 'Tags (separate with ,)', list[0].tags.join(', '));
    if (g !== null) app.store.transact('Tags', (tx) => { for (const c of list) tx.update<Claim>('claims', c.id, { tags: g.split(',').map((x) => x.trim()).filter(Boolean) }); });
  });
  register('claim.filter', async () => {
    const groups = [...new Set(app.store.claims.map((c) => c.group).filter(Boolean))] as string[];
    const tags = [...new Set(app.store.claims.flatMap((c) => c.tags))];
    const owners = [...new Set(app.store.claims.map((c) => c.owner).filter(Boolean))] as string[];
    const opt = (xs: string[]) => [{ value: '', label: '(any)' }, ...xs.map((x) => ({ value: x, label: x }))];
    const r = await form<any>('Sort and Filter', [
      { key: 'text', label: 'Text contains', value: app.filter.text },
      { key: 'status', label: 'Status', type: 'select', value: app.filter.status, options: opt(['open', 'supported', 'corroborated', 'disputed', 'settled', 'stale', 'set-aside', 'drafts']) },
      { key: 'kind', label: 'Kind', type: 'select', value: app.filter.kind, options: opt(KINDS) },
      { key: 'group', label: 'Group', type: 'select', value: app.filter.group, options: opt(groups) },
      { key: 'tag', label: 'Tag', type: 'select', value: app.filter.tag, options: opt(tags) },
      { key: 'owner', label: 'Owner', type: 'select', value: app.filter.owner, options: opt(owners) },
    ]);
    if (r) { app.filter = r; app.render(); }
  });
  register('claim.savedViews', async () => {
    const views = Object.values(app.data.views);
    const id = await choose('Saved Views', [...views.map((v) => ({ label: v.name, value: v.id, detail: Object.entries(v.filter).filter(([, x]) => x).map(([k, x]) => `${k}=${x}`).join(', ') })), { label: 'Save the current filter…', value: '__save' }, { label: 'Clear the filter', value: '__clear' }]);
    if (!id) return;
    if (id === '__clear') { app.filter = { text: '', status: '', kind: '', tag: '', group: '', owner: '' }; return app.render(); }
    if (id === '__save') {
      const name = await promptBox('Save View', 'Name');
      if (name) app.store.transact('Save view', (tx) => tx.put('views', { id: newId('v'), name, filter: { ...app.filter } }));
      return;
    }
    app.filter = { ...app.filter, ...app.data.views[id].filter } as any;
    app.render();
  });
  register('claim.renumber', async () => {
    if (!(await confirmBox('Renumber Claims', 'Number claims 1, 2, 3… in document order (claims not in a document come last)?', 'Renumber'))) return;
    const order = [...app.store.claims].sort((a, b) => (a.doc && b.doc ? (a.doc.documentId === b.doc.documentId ? a.doc.start - b.doc.start || (a.parentId ? 1 : -1) : a.doc.documentId < b.doc.documentId ? -1 : 1) : a.doc ? -1 : b.doc ? 1 : a.number - b.number));
    app.store.transact('Renumber claims', (tx) => order.forEach((c, i) => tx.update<Claim>('claims', c.id, { number: i + 1 })));
  });
  register('claim.setStatus', async () => {
    const c = needClaim();
    const v = await choose('Set Status', [
      { label: 'Open', value: 'open', detail: 'removes Set Aside' },
      { label: 'Set Aside…', value: 'aside', detail: 'an opinion or assumption not meant to be proven' },
    ], 'Supported, Corroborated and Settled follow from confirmed ties and written conclusions; they cannot be set by hand. Disputed and Stale are computed too.');
    if (v === 'open') app.store.transact('Status open', (tx) => tx.update<Claim>('claims', c.id, { setAside: undefined }));
    if (v === 'aside') await run('claim.setAside');
  });
  register('claim.setAside', async () => {
    const c = needClaim();
    const reason = await promptBox('Set Aside', 'Why is this claim not meant to be proven? (shown in reports)', c.setAside?.reason ?? 'Opinion');
    if (reason) app.store.transact('Set aside', (tx) => tx.update<Claim>('claims', c.id, { setAside: { reason, by: app.store.user, at: nowIso() } }));
  });
  register('claim.verdict', async () => {
    const c = needClaim();
    const v = await form<any>('Editorial Verdict', [{ key: 'v', label: 'Verdict for publication (your scale)', type: 'select', value: c.verdict ?? '', options: ['', 'True', 'Mostly true', 'Half true', 'Mostly false', 'False', 'Misleading', 'Unproven', 'Satire'].map((x) => ({ value: x, label: x || '(none)' })) }, { key: 'custom', label: 'Or your own wording', value: '' }],
      'Save', 'A person’s editorial rating for publication. It is separate from the evidence status and is never computed.');
    if (v) app.store.transact('Verdict', (tx) => tx.update<Claim>('claims', c.id, { verdict: (v.custom || v.v) || undefined }));
  });
  register('claim.assign', async () => {
    const list = app.selectedClaims().length ? app.selectedClaims() : [needClaim()];
    const who = await promptBox('Assign To', 'Person', list[0].owner ?? '');
    if (who !== null) app.store.transact('Assign', (tx) => { for (const c of list) tx.update<Claim>('claims', c.id, { owner: who || undefined }); });
  });
  register('claim.note', async () => {
    const c = needClaim();
    const n = await promptBox('Add Note', `Note on claim ${c.number}`, c.notes ?? '', 'textarea');
    if (n !== null) app.store.transact('Note', (tx) => tx.update<Claim>('claims', c.id, { notes: n || undefined }));
  });
  register('claim.flag', { run: () => { const c = needClaim(); app.store.transact('Flag', (tx) => tx.update<Claim>('claims', c.id, { flagged: !c.flagged })); }, checked: () => !!app.claim?.flagged });
  register('claim.history', async () => {
    const c = needClaim();
    const tieIds = new Set(app.store.ties.filter((t) => t.claimId === c.id).map((t) => t.id));
    const entries = app.store.journal.filter((j) => j.ops.some((o) => (o.table === 'claims' && o.id === c.id) || (o.table === 'ties' && tieIds.has(o.id)) || (o.table === 'ties' && (o.after as any)?.claimId === c.id)));
    await showPanel(`History of claim ${c.number}`, h('table.findings', h('tbody', entries.map((e) => h('tr', h('td', e.at.replace('T', ' ').slice(0, 16)), h('td', e.by), h('td', e.label))))));
  });

  // --- Ties ---------------------------------------------------------------------------------------
  register('tie.create', async () => {
    needClaim();
    const k = await choose('Tie Selection to Claim', [{ label: 'Supports', value: 'supports' }, { label: 'Contradicts', value: 'contradicts' }, { label: 'Mentions', value: 'mentions' }]);
    if (k) await tieWith(k as TieKind);
  });
  register('tie.support', () => tieWith('supports'));
  register('tie.contradict', () => tieWith('contradicts'));
  register('tie.mention', () => tieWith('mentions'));
  register('tie.absence', async () => {
    const c = needClaim();
    const s = needSource();
    const r = await form<any>('Tie as Absence', [
      { key: 'search', label: `What you searched for in “${s.title}”, and how`, type: 'textarea', required: true, value: `Searched the whole of ${s.title} for ` },
      { key: 'counts', label: 'The absence', type: 'radio', value: 'neither', options: [{ value: 'for', label: 'Supports the claim (the claim says it did not happen)' }, { value: 'against', label: 'Counts against the claim' }, { value: 'neither', label: 'Recorded only' }] },
    ], 'Tie', 'Negative evidence: you looked where the fact should appear and it was not there.');
    if (!r) return;
    const seg = s.segments[0];
    const a = { ...app.makeAnchor(s.id, seg?.start ?? 0, seg?.start ?? 0), exact: '', note: 'Whole source searched' };
    app.store.transact('Tie as absence', (tx) => {
      tx.put('anchors', a);
      tx.put('ties', { id: newId('t'), claimId: c.id, anchorId: a.id, kind: 'absence', absenceCounts: r.counts, absenceSearch: r.search, directness: 'indirect', state: 'confirmed', proposedBy: { type: 'person', who: app.store.user }, confirmedBy: app.store.user, confirmedAt: nowIso(), claimTextAtConfirm: c.text, sourceHashAtConfirm: s.contentHash, created: nowIso() } as Tie);
      tx.put('log', { id: newId('l'), date: nowIso().slice(0, 10), searched: r.search, where: s.title, forWhat: c.text, result: 'not-found', claimId: c.id, sourceId: s.id });
    });
  });
  register('tie.sumOf', async () => {
    const c = needClaim();
    const r = await form<any>('Tie Total to Parts', [{ key: 'ids', label: `Claim ${c.number} equals the sum of`, type: 'multiselect', value: [], options: app.store.claims.filter((x) => x.id !== c.id && parseNumbers(x.text).length).map((x) => ({ value: x.id, label: `${x.number}. ${truncate(x.text, 90)}` })) }], 'Tie', 'Sum Check recomputes the total from the parts’ figures.');
    if (!r?.ids.length) return;
    app.store.transact('Tie total to parts', (tx) => tx.put('ties', { id: newId('t'), claimId: c.id, partClaimIds: r.ids, kind: 'sum-of', directness: 'direct', state: 'confirmed', tick: 'Σ', proposedBy: { type: 'person', who: app.store.user }, confirmedBy: app.store.user, confirmedAt: nowIso(), claimTextAtConfirm: c.text, created: nowIso() } as Tie));
  });
  register('tie.toClaim', async () => {
    const c = needClaim();
    const id = await choose('Tie to Another Claim', app.store.claims.filter((x) => x.id !== c.id).map((x) => ({ label: `${x.number}. ${truncate(x.text, 100)}`, value: x.id })), `Claim ${c.number} rests on…`);
    if (id) app.store.transact('Tie to claim', (tx) => {
      tx.put('ties', { id: newId('t'), claimId: c.id, targetClaimId: id, kind: 'claim', directness: 'indirect', state: 'confirmed', proposedBy: { type: 'person', who: app.store.user }, confirmedBy: app.store.user, confirmedAt: nowIso(), claimTextAtConfirm: c.text, created: nowIso() } as Tie);
      if (!c.dependsOn.includes(id)) tx.update<Claim>('claims', c.id, { dependsOn: [...c.dependsOn, id] });
    });
  });
  register('anchor.new', async () => {
    const a = anchorFromSelection();
    if (a) { app.store.transact('New anchor', (tx) => tx.put('anchors', a)); app.select({ anchorId: a.id, text: undefined }, false); return; }
    const r = need(app.sel.rect, 'Select a passage or draw a region first.');
    const { sourceId, ...rect } = r;
    const tr = await regionTranscription();
    const an = { ...app.makeAnchor(sourceId, 0, 0, rect), exact: '', note: tr ? `Reads: ${tr}` : undefined };
    app.store.transact('New anchor', (tx) => tx.put('anchors', an));
    app.select({ anchorId: an.id, rect: undefined }, false);
  });
  const currentTie = (): Tie => need(app.sel.tieId ? app.data.ties[app.sel.tieId] : app.claim ? app.store.tiesOf(app.claim.id).find((t) => t.state === 'proposed') : undefined, 'Select a tie.');
  register('tie.details', async () => {
    const t = currentTie();
    const a = t.anchorId ? app.data.anchors[t.anchorId] : undefined;
    const r = await form<any>('Tie Details', [
      { key: 'kind', label: 'Kind', type: 'select', value: t.kind, options: ['supports', 'contradicts', 'mentions', 'absence', 'sum-of', 'claim'].map((x) => ({ value: x, label: x })) },
      { key: 'directness', label: 'Evidence is', type: 'radio', value: t.directness, options: [{ value: 'direct', label: 'Direct (states it)' }, { value: 'indirect', label: 'Indirect (implies it with other facts)' }] },
      { key: 'tick', label: 'Tick mark', type: 'select', value: t.tick ?? '', options: [{ value: '', label: '(none)' }, ...app.data.settings.tickLegend.map((x) => ({ value: x.mark, label: `${x.mark} ${x.meaning}` }))] },
      { key: 'confidence', label: 'Your confidence', type: 'select', value: t.confidence ?? '', options: ['', 'very-low', 'low', 'normal', 'high', 'very-high'].map((x) => ({ value: x, label: x || '(not stated)' })) },
      ...(a ? [{ key: 'informant', label: 'Informant', value: a.informant ?? '' }, { key: 'knowledge', label: 'Informant knew it', type: 'select' as const, value: a.knowledge, options: ['first-hand', 'second-hand', 'unknown'].map((x) => ({ value: x, label: x })) }] : []),
      { key: 'note', label: 'Note', type: 'textarea', value: t.note ?? '' },
    ]);
    if (!r) return;
    app.store.transact('Tie details', (tx) => {
      tx.update<Tie>('ties', t.id, { kind: r.kind, directness: r.directness, tick: r.tick || undefined, confidence: (r.confidence || undefined) as Confidence | undefined, note: r.note || undefined });
      if (a) tx.update<Anchor>('anchors', a.id, { informant: r.informant || undefined, knowledge: r.knowledge });
    });
  });
  register('tie.tick', async () => {
    const t = currentTie();
    const m = await choose('Mark Tick', app.data.settings.tickLegend.map((x) => ({ label: `${x.mark}  ${x.meaning}`, value: x.mark })));
    if (m) app.store.transact('Tick', (tx) => tx.update<Tie>('ties', t.id, { tick: m }));
  });
  register('tie.tickLegend', async () => {
    const cur = app.data.settings.tickLegend.map((x) => `${x.mark} = ${x.meaning}`).join('\n');
    const v = await promptBox('Tick Mark Legend', 'One per line: mark = meaning', cur, 'textarea');
    if (v === null) return;
    const legend = v.split('\n').map((l) => l.split('=')).filter((p) => p.length >= 2).map(([m, ...rest]) => ({ mark: m.trim(), meaning: rest.join('=').trim() }));
    app.store.transact('Tick legend', () => { app.data.settings.tickLegend = legend; });
    app.store.touch();
  });
  register('tie.confidence', async () => {
    const t = currentTie();
    const v = await choose('Tie Confidence', ['very-low', 'low', 'normal', 'high', 'very-high'].map((x) => ({ label: x, value: x })));
    if (v) app.store.transact('Confidence', (tx) => tx.update<Tie>('ties', t.id, { confidence: v as Confidence }));
  });
  register('tie.confirm', () => {
    const t = currentTie();
    if (t.state === 'confirmed') return toast('Already confirmed.');
    app.store.transact('Confirm tie', (tx) => tx.put('ties', app.confirmTie(t.id)));
  });
  register('tie.reject', () => {
    const t = currentTie();
    app.store.transact('Reject tie', (tx) => tx.update<Tie>('ties', t.id, { state: 'rejected' }));
  });
  register('tie.confirmAll', async () => {
    const claims = app.selectedClaims().length ? app.selectedClaims() : app.visibleClaims();
    const ties = claims.flatMap((c) => app.store.tiesOf(c.id).filter((t) => t.state === 'proposed'));
    if (!ties.length) throw new UserError('No proposed ties among the selected or shown claims.');
    if (!(await confirmBox('Confirm All in Selection', `Confirm ${ties.length} proposed ties on ${claims.length} claims without reviewing each passage? Review ▸ Verify Drafts goes through them one by one.`, `Confirm ${ties.length}`))) return;
    app.store.transact(`Confirm ${ties.length} ties`, (tx) => { for (const t of ties) tx.put('ties', app.confirmTie(t.id)); });
  });
  register('anchor.adjust', () => {
    const a = need(app.sel.anchorId ? app.data.anchors[app.sel.anchorId] : undefined, 'Select an anchor (click a highlighted passage), then select the new passage.');
    const n = need(app.sel.text && app.sel.text.sourceId === a.sourceId ? app.sel.text : null, 'Select the new passage in the same source.');
    const s = app.data.sources[a.sourceId];
    app.store.transact('Move anchor', (tx) => tx.update<Anchor>('anchors', a.id, { ...makeSelector(s.text, n.start, n.end), broken: false, sourceHash: s.contentHash }));
  });
  register('tie.auto', async () => {
    const claims = app.store.claims;
    const srcs = app.store.evidence.filter((s) => !s.confidential && s.text);
    let n = 0;
    app.store.transact('Auto-Tie exact matches', (tx) => {
      for (const c of claims) {
        const needles = [...(c.kind === 'quotation' ? [...c.text.matchAll(/["“]([^"”]{8,})["”]/g)].map((m) => m[1]) : []), ...parseNumbers(c.text).filter((x) => !x.approx && x.raw.replace(/\D/g, '').length >= 3).map((x) => x.raw)];
        for (const needle of needles) {
          const hits: { s: Source; i: number }[] = [];
          for (const s of srcs) { let i = s.text.indexOf(needle); while (i >= 0 && hits.length < 2) { hits.push({ s, i }); i = s.text.indexOf(needle, i + 1); } }
          if (hits.length !== 1) continue;
          const { s, i } = hits[0];
          if (app.store.tiesOf(c.id).some((t) => t.anchorId && app.data.anchors[t.anchorId]?.sourceId === s.id && app.data.anchors[t.anchorId]?.start === i)) continue;
          const a = app.makeAnchor(s.id, i, i + needle.length);
          tx.put('anchors', a);
          tx.put('ties', { id: newId('t'), claimId: c.id, anchorId: a.id, kind: 'supports', directness: 'direct', state: 'proposed', proposedBy: { type: 'auto', who: app.store.user, command: 'tie.auto' }, note: `“${needle}” appears exactly once in the sources.`, created: nowIso() } as Tie);
          n++;
        }
      }
    });
    toast(`${n} ties proposed. Review ▸ Verify Drafts to confirm them.`);
  });
  register('tie.matchColumn', async () => {
    const d = needDoc();
    if (d.kind !== 'workbook') throw new UserError('The linked document is not a workbook.');
    const sheets = [...new Set(d.segments.map((s) => s.sheet).filter(Boolean))] as string[];
    const r = await form<any>('Match Column to Sources', [{ key: 'sheet', label: 'Sheet', type: 'select', value: sheets[0], options: sheets.map((x) => ({ value: x, label: x })) }, { key: 'col', label: 'Column letter', value: 'B', required: true }], 'Match',
      'Each figure in the column becomes a claim (if it is not one already) and is matched to equal figures in the sources. Matches are proposals.');
    if (!r) return;
    const col = r.col.toUpperCase();
    const cells = d.segments.filter((s) => s.sheet === r.sheet && s.cell?.replace(/\d+/g, '') === col);
    const srcs = app.store.evidence.filter((s) => !s.confidential && s.text);
    let claims = 0, ties = 0;
    app.store.transact('Match column to sources', (tx) => {
      let num = app.store.nextClaimNumber();
      for (const seg of cells) {
        const val = d.text.slice(seg.start, seg.end).trim();
        const fig = parseNumbers(val)[0];
        if (!fig) continue;
        let c = app.store.claims.find((x) => x.doc?.documentId === d.id && x.doc.start === seg.start);
        if (!c) { c = { ...app.newClaim(`${seg.label}: ${val}`, 'number', { documentId: d.id, start: seg.start, end: seg.end }), number: num++ }; tx.put('claims', c); claims++; }
        for (const s of srcs) for (const m of parseNumbers(s.text)) {
          if (Math.abs(m.value - fig.value) > Math.max(1e-9, app.data.settings.numberTolerance)) continue;
          const a = app.makeAnchor(s.id, m.start, m.end);
          tx.put('anchors', a);
          tx.put('ties', { id: newId('t'), claimId: c.id, anchorId: a.id, kind: 'supports', directness: 'direct', state: 'proposed', proposedBy: { type: 'auto', who: app.store.user, command: 'tie.matchColumn' }, created: nowIso() } as Tie);
          ties++;
        }
      }
    });
    toast(`${claims} claims added, ${ties} matches proposed.`);
  });
  register('tie.snipToCell', async () => {
    const d = needDoc();
    if (d.kind !== 'workbook') throw new UserError('The linked document is not a workbook.');
    const a = need(anchorFromSelection(), 'Select the figure in a source first.');
    const fig = need(parseNumbers(a.exact)[0], 'The selection has no figure.');
    const sheets = [...new Set(d.segments.map((s) => s.sheet).filter(Boolean))] as string[];
    const r = await form<any>('Snip Value to Cell', [{ key: 'sheet', label: 'Sheet', type: 'select', value: sheets[0], options: sheets.map((x) => ({ value: x, label: x })) }, { key: 'cell', label: 'Cell (for example C12)', required: true }], 'Write',
      `Writes ${fig.value} into a copy of “${d.title}” and ties that cell’s claim to the selected passage.`);
    if (!r) return;
    const bytes = need(app.blobs.get(d.id), 'The workbook file is not stored in this case.');
    const { writeCellValue } = await import('../writeback/xlsx');
    const out = await writeCellValue(bytes, r.sheet, r.cell.toUpperCase(), fig.value);
    download(out, (d.fileName ?? d.title).replace(/\.xlsx$/i, '') + ' (snipped).xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const c = app.newClaim(`${r.sheet}!${r.cell.toUpperCase()}: ${fig.value}`, 'number');
    app.store.transact('Snip value to cell', (tx) => {
      tx.put('claims', c);
      tx.put('anchors', a);
      tx.put('ties', { id: newId('t'), claimId: c.id, anchorId: a.id, kind: 'supports', directness: 'direct', state: 'confirmed', tick: '✓', proposedBy: { type: 'person', who: app.store.user }, confirmedBy: app.store.user, confirmedAt: nowIso(), claimTextAtConfirm: c.text, sourceHashAtConfirm: app.data.sources[a.sourceId].contentHash, created: nowIso() } as Tie);
    });
  });
  register('tie.remove', async () => {
    const t = currentTie();
    app.store.transact('Remove tie', (tx) => {
      tx.delete('ties', t.id);
      if (t.anchorId && !app.store.ties.some((x) => x.id !== t.id && x.anchorId === t.anchorId)) tx.delete('anchors', t.anchorId);
    });
    app.select({ tieId: undefined, anchorId: undefined }, false);
  });
  register('tie.ofSource', async () => {
    const s = needSource();
    const ids = new Set(app.store.anchorsOf(s.id).map((a) => a.id));
    const ties = app.store.ties.filter((t) => t.anchorId && ids.has(t.anchorId) && t.state !== 'rejected');
    await showPanel(`Claims that lean on “${s.title}”`, h('table.findings', h('tbody', ties.map((t) => { const c = app.data.claims[t.claimId]; const a = app.data.anchors[t.anchorId!]; return h('tr', { onclick: () => app.select({ claimId: c.id, tieId: t.id, anchorId: a.id }) }, h('td', `#${c.number}`), h('td', t.kind + (t.state === 'proposed' ? ' (proposed)' : '')), h('td', locate(s, a.start, a.end)), h('td', truncate(c.text, 120))); }))));
  });
  register('anchor.unused', async () => {
    const used = new Set(app.store.ties.map((t) => t.anchorId));
    const list = app.store.anchors.filter((a) => !used.has(a.id));
    await showPanel(`Unused anchors (${list.length})`, h('table.findings', h('tbody', list.map((a) => h('tr', { onclick: () => app.select({ sourceId: a.sourceId, anchorId: a.id }) }, h('td', app.data.sources[a.sourceId]?.title ?? '?'), h('td', truncate(a.exact || a.note || 'region', 120)))))));
  });
  void parseCsv;
}
