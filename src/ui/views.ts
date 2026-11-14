// The main layout and views.
import { h, clear, icon } from './dom';
import { app, ViewName } from './app';
import { run } from './registry';
import { renderMarkedText, selectionOffsets, scrollToOffset, Mark } from './textview';
import { STATUS_LABEL, Status, Source, Tie, Id, Claim } from '../core/types';
import { locate } from '../core/anchor';
import { truncate } from '../core/util';
import { renderPdfPage } from '../readers/index';

const KIND_LABEL: Record<string, string> = { supports: 'Supports', contradicts: 'Contradicts', mentions: 'Mentions', absence: 'Absence', 'sum-of': 'Sum of', claim: 'Rests on claim' };

export function statusBadge(s: Status) {
  return h('span.status', { class: `status st-${s}`, title: STATUS_LABEL[s] }, STATUS_LABEL[s]);
}

// --- claims pane ------------------------------------------------------------------------------
function claimsPane() {
  const st = app.statuses();
  const claims = app.visibleClaims();
  const filter = h('input', {
    type: 'search', placeholder: 'Filter claims', value: app.filter.text, 'aria-label': 'Filter claims',
    oninput: (e: Event) => { app.filter.text = (e.target as HTMLInputElement).value; renderClaimsList(); },
  });
  const statusSel = h('select', { 'aria-label': 'Status filter', onchange: (e: Event) => { app.filter.status = (e.target as HTMLSelectElement).value; app.render(); } },
    h('option', { value: '' }, 'All statuses'),
    h('option', { value: 'drafts', selected: app.filter.status === 'drafts' }, 'With drafts'),
    (Object.keys(STATUS_LABEL) as Status[]).map((s) => h('option', { value: s, selected: app.filter.status === s }, STATUS_LABEL[s])));
  const list = h('div.claimlist', { role: 'listbox', 'aria-label': 'Claims', tabindex: '0' });
  const renderClaimsList = () => {
    clear(list);
    const q = app.filter.text.toLowerCase();
    const items = claims.filter((c) => !q || c.text.toLowerCase().includes(q) || String(c.number) === q);
    if (!items.length) list.appendChild(h('div.empty', app.store.claims.length ? 'No claims match.' : 'No claims yet. Link a document and capture claims from it, type one with New Claim, or run Draft Sources for Every Fact on the AI tab.'));
    for (const c of items) {
      const s = st[c.id]?.status ?? 'open';
      const drafts = app.store.tiesOf(c.id).filter((t) => t.state === 'proposed').length;
      const selected = app.sel.claimIds.has(c.id) || app.sel.claimId === c.id;
      list.appendChild(h('div.claim', {
        role: 'option', 'aria-selected': selected ? 'true' : 'false', class: `claim${selected ? ' sel' : ''}${c.parentId ? ' atom' : ''}`,
        dataset: { id: c.id },
        onclick: (e: MouseEvent) => {
          if (e.ctrlKey || e.metaKey) {
            const ids = new Set(app.sel.claimIds);
            ids.has(c.id) ? ids.delete(c.id) : ids.add(c.id);
            app.select({ claimId: c.id, claimIds: ids });
          } else app.select({ claimId: c.id });
        },
        ondblclick: () => run('nav.followTie'),
      },
        h('span.num', `${c.number}`), statusBadge(s),
        drafts ? h('span.drafts', { title: `${drafts} proposed tie(s) waiting` }, `${drafts}?`) : null,
        c.flagged ? h('span.flag', { title: 'Flagged' }, '⚑') : null,
        h('span.text', truncate(c.text, 160)),
        c.verdict ? h('span.verdict', c.verdict) : null,
      ));
    }
  };
  renderClaimsList();
  list.addEventListener('keydown', (e) => {
    const vis = app.visibleClaims();
    const i = vis.findIndex((c) => c.id === app.sel.claimId);
    if (e.key === 'ArrowDown' && vis[i + 1]) { app.select({ claimId: vis[i + 1].id }); e.preventDefault(); }
    if (e.key === 'ArrowUp' && i > 0) { app.select({ claimId: vis[i - 1].id }); e.preventDefault(); }
    if (e.key === 'Enter') run('nav.followTie');
  });
  return h('section.pane.claims', { 'aria-label': 'Claims' },
    h('div.pane-head', h('strong', `Claims (${claims.length})`), filter, statusSel,
      h('button', { title: 'New claim', onclick: () => run('claim.new') }, '+')),
    list);
}

// --- source viewer ------------------------------------------------------------------------------
function anchorMarks(src: Source): Mark[] {
  const marks: Mark[] = [];
  for (const a of app.store.anchorsOf(src.id)) {
    if (!a.exact || a.broken) continue;
    const ties = app.store.ties.filter((t) => t.anchorId === a.id && t.state !== 'rejected' && !(app.blind && t.state === 'confirmed' && t.confirmedBy !== app.store.user));
    const kinds = new Set(ties.map((t) => t.kind));
    const proposed = ties.length > 0 && ties.every((t) => t.state === 'proposed');
    const cls = ['anchor', kinds.has('contradicts') ? 'k-contra' : kinds.has('supports') ? 'k-sup' : 'k-ment', proposed ? 'proposed' : '', app.sel.anchorId === a.id ? 'cur' : ''].join(' ');
    marks.push({
      start: a.start, end: a.end, cls,
      title: ties.map((t) => `Claim ${app.data.claims[t.claimId]?.number}: ${KIND_LABEL[t.kind]}${t.state === 'proposed' ? ' (proposed)' : ''}`).join('\n') || 'Anchor (not tied)',
      data: { anchor: a.id },
      onclick: (e) => { e.stopPropagation(); const t = ties.find((x) => x.claimId === app.sel.claimId) ?? ties[0]; app.select({ anchorId: a.id, sourceId: src.id, claimId: t?.claimId ?? app.sel.claimId, tieId: t?.id }); },
    });
  }
  if (app.sel.text?.sourceId === src.id) marks.push({ start: app.sel.text.start, end: app.sel.text.end, cls: 'pending-sel' });
  return marks;
}

function regionLayer(src: Source, page: number, w: number, hgt: number) {
  const layer = h('div.regions', { style: { width: w + 'px', height: hgt + 'px' } });
  for (const a of app.store.anchorsOf(src.id)) {
    if (!a.rect || a.rect.page !== page) continue;
    const ties = app.store.ties.filter((t) => t.anchorId === a.id && t.state !== 'rejected');
    const kind = ties.some((t) => t.kind === 'contradicts') ? 'k-contra' : ties.some((t) => t.kind === 'supports') ? 'k-sup' : 'k-ment';
    layer.appendChild(h('div.region', {
      class: `region ${kind}${app.sel.anchorId === a.id ? ' cur' : ''}`,
      style: { left: a.rect.x * 100 + '%', top: a.rect.y * 100 + '%', width: a.rect.w * 100 + '%', height: a.rect.h * 100 + '%' },
      title: ties.map((t) => `Claim ${app.data.claims[t.claimId]?.number}: ${KIND_LABEL[t.kind]}`).join('\n'),
      onclick: (e: MouseEvent) => { e.stopPropagation(); app.select({ anchorId: a.id, sourceId: src.id, tieId: ties[0]?.id, claimId: ties[0]?.claimId ?? app.sel.claimId }); },
    }));
  }
  const r = app.sel.rect;
  if (r && r.sourceId === src.id && r.page === page)
    layer.appendChild(h('div.region.pending', { style: { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' } }));
  // Draw a region with the mouse.
  let start: { x: number; y: number } | null = null;
  let ghost: HTMLElement | null = null;
  layer.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).classList.contains('region') && !(e.target as HTMLElement).classList.contains('pending')) return;
    const b = layer.getBoundingClientRect();
    start = { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height };
    ghost = h('div.region.pending');
    layer.appendChild(ghost);
    e.preventDefault();
  });
  layer.addEventListener('mousemove', (e) => {
    if (!start || !ghost) return;
    const b = layer.getBoundingClientRect();
    const x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
    Object.assign(ghost.style, { left: Math.min(x, start.x) * 100 + '%', top: Math.min(y, start.y) * 100 + '%', width: Math.abs(x - start.x) * 100 + '%', height: Math.abs(y - start.y) * 100 + '%' });
  });
  layer.addEventListener('mouseup', (e) => {
    if (!start) return;
    const b = layer.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)), y = Math.max(0, Math.min(1, (e.clientY - b.top) / b.height));
    const rect = { sourceId: src.id, page, x: Math.min(x, start.x), y: Math.min(y, start.y), w: Math.abs(x - start.x), h: Math.abs(y - start.y) };
    start = null;
    if (rect.w > 0.01 && rect.h > 0.01) app.select({ rect, text: undefined, sourceId: src.id }, false);
    else app.render();
  });
  return layer;
}

const objectUrls = new Map<Id, string>();
function blobUrl(src: Source) {
  const b = app.blobs.get(src.id);
  if (!b) return '';
  if (!objectUrls.has(src.id)) objectUrls.set(src.id, URL.createObjectURL(new Blob([b as BlobPart], { type: src.mime })));
  return objectUrls.get(src.id)!;
}

function pagesView(src: Source) {
  const wrap = h('div.pages');
  const bytes = app.blobs.get(src.id);
  if (!bytes) return h('div.empty', 'The file is not stored in this case; only its text is available.');
  const n = src.pageCount ?? 1;
  for (let p = 1; p <= Math.min(n, 300); p++) {
    const canvas = h('canvas') as HTMLCanvasElement;
    const holder = h('div.page', { dataset: { page: String(p) } }, canvas, h('div.pageno', `Page ${p}`));
    wrap.appendChild(holder);
    const io = new IntersectionObserver((ents) => {
      if (!ents.some((x) => x.isIntersecting)) return;
      io.disconnect();
      renderPdfPage(bytes, p, canvas, 1.4 * app.zoom).then(({ width, height }) => {
        canvas.style.width = width / devicePixelRatio + 'px';
        holder.appendChild(regionLayer(src, p, canvas.clientWidth || width, canvas.clientHeight || height));
        const layer = holder.querySelector('.regions') as HTMLElement;
        Object.assign(layer.style, { width: canvas.clientWidth + 'px', height: canvas.clientHeight + 'px' });
      }).catch((e) => holder.appendChild(h('div.err', `Page could not be drawn: ${e?.message ?? e}`)));
    }, { rootMargin: '600px' });
    io.observe(holder);
  }
  return wrap;
}

function imageView(src: Source) {
  const url = blobUrl(src);
  if (!url) return h('div.empty', 'The picture is not stored in this case.');
  const img = h('img', { src: url, alt: src.title, style: { width: `${Math.round(100 * app.zoom)}%` } }) as HTMLImageElement;
  const holder = h('div.page.imgpage', img);
  img.addEventListener('load', () => {
    holder.appendChild(regionLayer(src, 1, img.clientWidth, img.clientHeight));
  });
  return h('div.pages', holder);
}

function mediaView(src: Source) {
  const url = blobUrl(src);
  if (!url) return null;
  const isVideo = (src.mime ?? '').startsWith('video');
  const el = h(isVideo ? 'video' : 'audio', { src: url, controls: true, preload: 'metadata', class: 'media' }) as HTMLMediaElement;
  return el;
}

function filterCss() {
  const f = app.pageFilter;
  return `contrast(${f.contrast})${f.invert ? ' invert(1)' : ''}`;
}

export function sourceView(src: Source, compact = false) {
  const mode = app.sourceMode === 'auto' ? (src.kind === 'pdf' && app.blobs.get(src.id) ? 'page' : src.kind === 'image' ? 'page' : 'text') : app.sourceMode;
  const head = h('div.pane-head',
    h('strong', src.title), src.confidential ? h('span.conf', ' Confidential') : null, src.key ? h('span.key', ' Key') : null,
    h('span.meta', ` ${src.kind}${src.pageCount ? `, ${src.pageCount} pages` : ''}${src.dateMade ? `, made ${src.dateMade}` : ''}${src.role === 'document' ? ' · linked document' : ''}`),
    compact ? null : h('span.modes',
      ['text', 'page', 'transcription'].map((m) => h('button', { class: mode === m ? 'on' : '', disabled: m === 'page' && !(src.kind === 'pdf' || src.kind === 'image'), onclick: () => { app.sourceMode = m as any; app.render(); } }, m === 'text' ? 'Text' : m === 'page' ? 'Page' : 'Transcription'))),
  );
  let body: HTMLElement;
  if (mode === 'page' && src.kind === 'pdf') body = pagesView(src);
  else if (mode === 'page' && src.kind === 'image') body = imageView(src);
  else if (mode === 'transcription') {
    body = h('div.transcription',
      h('h4', 'Transcription (a person’s reading)'), h('pre', src.transcription || 'None yet. Sources ▸ Transcribe.'),
      src.aiTranscription ? h('div.ai-note', h('h4', 'AI transcription — labeled, not evidence'), h('pre', src.aiTranscription)) : null,
      (src.translationNotes ?? []).length ? h('div', h('h4', 'Translation notes'), (src.translationNotes ?? []).map((t) => h('p', `${t.ai ? '[AI] ' : ''}“${truncate(src.text.slice(t.start, t.end), 80)}” → ${t.text}`))) : null);
  } else {
    const media = (src.kind === 'recording') ? mediaView(src) : null;
    if (!src.text) body = h('div', media, h('div.empty', src.kind === 'image' ? 'This picture has no text yet. Draw a region in Page view, or run Recognize Text (OCR) or Transcribe.' : 'No text could be read from this file.'));
    else {
      const tv = renderMarkedText(src.text, anchorMarks(src), { segments: src.segments.length < 3000 ? src.segments : [] });
      tv.addEventListener('mouseup', () => {
        const off = selectionOffsets(tv);
        if (off && off.end > off.start) { app.sel.text = { sourceId: src.id, ...off }; app.sel.rect = undefined; app.sel.sourceId = src.id; }
      });
      tv.style.fontSize = `${app.zoom}em`;
      body = h('div', media, tv);
      const a = app.sel.anchorId ? app.data.anchors[app.sel.anchorId] : undefined;
      if (a && a.sourceId === src.id) setTimeout(() => scrollToOffset(tv, a.start), 0);
    }
  }
  if (mode === 'page' && (src.kind === 'pdf' || src.kind === 'image')) body.style.cssText += `;filter:${filterCss()};transform:rotate(${app.pageFilter.rotate}deg);transform-origin:center top;`;
  return h('section.pane.source', { 'aria-label': `Source ${src.title}` }, head, h('div.pane-body', body));
}

function sourceTabs() {
  const evid = app.store.evidence;
  return h('div.sourcetabs',
    h('div.tablist', { role: 'tablist', 'aria-label': 'Sources' },
      evid.map((s) => h('button', { role: 'tab', 'aria-selected': app.sel.sourceId === s.id ? 'true' : 'false', class: app.sel.sourceId === s.id ? 'on' : '', title: s.title, onclick: () => app.select({ sourceId: s.id, anchorId: undefined }) },
        truncate(s.title, 28), h('span.count', ` ${app.store.anchorsOf(s.id).length}`)))),
    h('button', { title: 'Add sources', onclick: () => run('source.addFiles') }, '+ Add'));
}

// --- document view ----------------------------------------------------------------------------
export function documentView() {
  const doc = app.document;
  if (!doc) return h('section.pane', h('div.empty', 'No linked document. Claims ▸ Link Document… attaches the work being checked.'));
  const st = app.statuses();
  const marks: Mark[] = app.store.claims.filter((c) => c.doc?.documentId === doc.id).map((c) => ({
    start: c.doc!.start, end: c.doc!.end, cls: `claimmark st-${st[c.id]?.status ?? 'open'}${app.sel.claimId === c.id ? ' cur' : ''}${c.parentId ? ' atom' : ''}`,
    title: `Claim ${c.number}: ${STATUS_LABEL[st[c.id]?.status ?? 'open']}`, data: { claim: c.id },
    onclick: (e) => { e.stopPropagation(); app.select({ claimId: c.id }); },
  }));
  if (app.sel.text?.sourceId === doc.id) marks.push({ start: app.sel.text.start, end: app.sel.text.end, cls: 'pending-sel' });
  const tv = renderMarkedText(doc.text, marks, { segments: doc.segments.length < 3000 ? doc.segments : [] });
  tv.style.fontSize = `${app.zoom}em`;
  tv.addEventListener('mouseup', () => {
    const off = selectionOffsets(tv);
    if (off && off.end > off.start) app.sel.text = { sourceId: doc.id, ...off };
  });
  const c = app.claim;
  if (c?.doc?.documentId === doc.id) setTimeout(() => scrollToOffset(tv, c.doc!.start), 0);
  const docs = app.store.documents;
  return h('section.pane.document', { 'aria-label': 'Document' },
    h('div.pane-head', h('strong', 'Document: '),
      docs.length > 1 ? h('select', { onchange: (e: Event) => app.select({ documentId: (e.target as HTMLSelectElement).value }) }, docs.map((d) => h('option', { value: d.id, selected: d.id === doc.id }, d.title))) : h('span', doc.title),
      h('button', { onclick: () => run('claim.capture'), title: 'Capture Claim from Selection (Ctrl+K)' }, 'Capture selection'),
      h('span.legend', (Object.keys(STATUS_LABEL) as Status[]).map((s) => h('span', { class: `claimmark st-${s}` }, STATUS_LABEL[s])))),
    h('div.pane-body', tv));
}

// --- details pane ----------------------------------------------------------------------------
function tieRow(t: Tie) {
  const a = t.anchorId ? app.data.anchors[t.anchorId] : undefined;
  const s = a ? app.data.sources[a.sourceId] : undefined;
  const target = t.targetClaimId ? app.data.claims[t.targetClaimId] : undefined;
  const hiddenByBlind = app.blind && t.state === 'confirmed' && t.confirmedBy !== app.store.user;
  if (hiddenByBlind) return h('div.tie.hidden', 'A tie by another reviewer (hidden in Second Reader Mode).');
  return h('div.tie', { class: `tie ${t.state} k-${t.kind}${app.sel.tieId === t.id ? ' cur' : ''}`, onclick: () => app.select({ tieId: t.id, anchorId: t.anchorId, sourceId: a?.sourceId ?? app.sel.sourceId }) },
    h('div.tie-head',
      h('span.kind', KIND_LABEL[t.kind]), t.state === 'proposed' ? h('span.prop', ` proposed by ${t.proposedBy.type === 'ai' ? `AI (${t.proposedBy.model})` : t.proposedBy.who}`) : null,
      t.tick ? h('span.tick', ` ${t.tick}`) : null, t.confidence ? h('span.conf', ` ${t.confidence}`) : null,
      s ? h('span.src', ` — ${s.title}${a ? ` ${locate(s, a.start, a.end)}` : ''}`) : target ? h('span.src', ` — claim ${target.number}`) : null),
    a?.exact ? h('blockquote', truncate(a.exact, 400)) : a?.rect ? h('blockquote', `Region on page ${a.rect.page}${a.note ? ` — ${a.note}` : ''}`) : null,
    t.kind === 'absence' && t.absenceSearch ? h('div.note', `Searched: ${t.absenceSearch}`) : null,
    t.rationale ? h('div.note.ai-note', `AI note (not evidence): ${truncate(t.rationale, 300)}`) : null,
    t.note ? h('div.note', t.note) : null,
    h('div.tie-actions',
      a ? h('button', { onclick: (e: Event) => { e.stopPropagation(); app.select({ sourceId: a.sourceId, anchorId: a.id, tieId: t.id }); app.view = 'workbench'; app.render(); } }, 'Show') : null,
      t.state === 'proposed' ? h('button.primary', { onclick: (e: Event) => { e.stopPropagation(); app.select({ tieId: t.id }, false); run('tie.confirm'); } }, 'Confirm') : null,
      t.state === 'proposed' ? h('button', { onclick: (e: Event) => { e.stopPropagation(); app.select({ tieId: t.id }, false); run('tie.reject'); } }, 'Reject') : null,
      h('button', { onclick: (e: Event) => { e.stopPropagation(); app.select({ tieId: t.id }, false); run('tie.details'); } }, 'Details'),
      h('button', { onclick: (e: Event) => { e.stopPropagation(); app.select({ tieId: t.id }, false); run('tie.remove'); } }, 'Remove')));
}

function claimDetails(c: Claim) {
  const r = app.status(c.id);
  const ties = app.store.tiesOf(c.id).filter((t) => t.state !== 'rejected');
  const doc = c.doc ? app.data.sources[c.doc.documentId] : undefined;
  const rk = Object.values(app.data.reckonings).find((x) => x.claimId === c.id);
  const todos = Object.values(app.data.todos).filter((t) => t.claimId === c.id);
  const comments = Object.values(app.data.comments).filter((x) => x.target.type === 'claim' && x.target.id === c.id);
  const signs = Object.values(app.data.signoffs).filter((x) => x.claimId === c.id);
  const parent = c.parentId ? app.data.claims[c.parentId] : undefined;
  const atoms = app.store.claims.filter((x) => x.parentId === c.id);
  return h('div.details',
    h('h3', `Claim ${c.number}`), statusBadge(r?.status ?? 'open'), c.verdict ? h('span.verdict', ` Verdict: ${c.verdict}`) : null,
    h('p.claimtext', c.text),
    h('div.meta', `${c.kind} · ${c.importance}${c.owner ? ` · ${c.owner}` : ''}${c.group ? ` · ${c.group}` : ''}${c.tags.length ? ` · ${c.tags.join(', ')}` : ''}${doc ? ` · in “${doc.title}” ${locate(doc, c.doc!.start)}` : ''}`),
    parent ? h('div.meta', 'Part of ', h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); app.select({ claimId: parent.id }); } }, `claim ${parent.number}`)) : null,
    atoms.length ? h('div.meta', 'Facts: ', atoms.map((a) => h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); app.select({ claimId: a.id }); } }, `${a.number} `))) : null,
    h('ul.reasons', (r?.reasons ?? []).map((x) => h('li', x))),
    h('h4', `Ties (${ties.length})`),
    ties.length ? ties.map(tieRow) : h('div.empty', 'None. Select a passage or draw a region in a source, then Tie (Ctrl+L). Or AI ▸ Find Support.'),
    rk ? h('div.reckoning', h('h4', 'Reckoning'), rk.conclusion ? h('p', rk.conclusion) : h('p.empty', 'No written conclusion yet.'), rk.unresolved ? h('p', `Unresolved: ${rk.unresolved}`) : null) : null,
    todos.length ? h('div', h('h4', 'To-do'), todos.map((t) => h('label.todo', h('input', { type: 'checkbox', checked: t.done, onchange: () => app.store.transact('To-do', (tx) => tx.update<import('../core/types').Todo>('todos', t.id, { done: !t.done })) }), ` ${t.ai ? '[AI suggestion] ' : ''}${t.text}`))) : null,
    comments.length ? h('div', h('h4', 'Comments'), comments.map((x) => h('div.comment', { class: x.resolved ? 'comment resolved' : 'comment' }, h('strong', x.author), `: ${x.text}`))) : null,
    signs.length ? h('div', h('h4', 'Sign-off'), signs.map((x) => h('div', `${x.kind === 'prepared' ? 'Prepared' : 'Reviewed'} by ${x.by}, ${x.at.slice(0, 10)}`))) : null,
    c.notes ? h('div', h('h4', 'Notes'), h('p.pre', c.notes)) : null,
  );
}

function sourceDetails(s: Source) {
  const anchors = app.store.anchorsOf(s.id);
  const c = s.citation;
  return h('div.details',
    h('h3', s.title), h('div.meta', `${s.kind} · ${s.classification}${s.confidential ? ' · confidential' : ''}${s.siglum ? ` · siglum ${s.siglum}` : ''}`),
    h('p', [c.authors?.join('; '), c.title, c.container, c.publisher, c.year ?? c.date, c.repository, c.callNumber, c.url].filter(Boolean).join('. ')),
    s.derivedFrom.length ? h('div.meta', 'Derived from: ' + s.derivedFrom.map((d) => `${app.data.sources[d.sourceId]?.title ?? '?'} (${d.how})`).join('; ')) : null,
    s.reliability ? h('div', h('h4', 'Reliability'), h('p', s.reliability)) : null,
    h('div.meta', `Fingerprint ${s.fileHash?.slice(0, 16) ?? '—'}… · ${anchors.length} anchors`),
    s.notes ? h('div', h('h4', 'Notes'), h('p.pre', s.notes)) : null,
  );
}

function detailsPane() {
  const c = app.claim;
  const s = app.sel.sourceId ? app.data.sources[app.sel.sourceId] : undefined;
  return h('aside.pane.details', { 'aria-label': 'Details' },
    h('div.pane-head', h('strong', 'Details')),
    h('div.pane-body', c ? claimDetails(c) : null, !c && s ? sourceDetails(s) : null, !c && !s ? h('div.empty', 'Select a claim or a source.') : null));
}

// --- problems pane ------------------------------------------------------------------------------
function problemsPane() {
  const f = app.findings;
  return h('section.pane.problems', { 'aria-label': 'Problems' },
    h('div.pane-head', h('strong', `Problems (${f.length})`), h('button', { onclick: () => run('check.all') }, 'Run All Checks (F9)'), h('button', { onclick: () => { app.showProblems = false; app.render(); } }, '×')),
    h('div.pane-body', f.length ? h('table.findings', h('tbody', f.slice(0, 1000).map((x) => h('tr', {
      class: `sev-${x.severity}`, onclick: () => app.select({ claimId: x.claimId ?? app.sel.claimId, sourceId: x.sourceId ?? app.sel.sourceId, tieId: x.tieId, anchorId: x.anchorId }),
    }, h('td', x.severity), h('td', x.check), h('td', x.claimId ? `#${app.data.claims[x.claimId]?.number ?? '?'}` : ''), h('td', x.message))))) : h('div.empty', 'No problems found, or checks have not run.')));
}

// --- other views ----------------------------------------------------------------------------------
function matrixView() {
  const claims = app.visibleClaims();
  const sources = app.store.evidence;
  const st = app.statuses();
  const cell = (c: Claim, s: Source) => {
    const ts = app.store.tiesOf(c.id).filter((t) => t.state !== 'rejected' && t.anchorId && app.data.anchors[t.anchorId]?.sourceId === s.id);
    if (!ts.length) return h('td');
    const mark = ts.some((t) => t.kind === 'contradicts') ? '✗' : ts.some((t) => t.kind === 'supports') ? '✓' : '·';
    return h('td', { class: `m ${ts.every((t) => t.state === 'proposed') ? 'proposed' : ''}`, title: ts.map((t) => `${KIND_LABEL[t.kind]}${t.state === 'proposed' ? ' (proposed)' : ''}`).join(', '), onclick: () => app.select({ claimId: c.id, sourceId: s.id, anchorId: ts[0].anchorId, tieId: ts[0].id }) }, mark + (ts.length > 1 ? ts.length : ''));
  };
  return h('section.pane.matrix', h('div.pane-head', h('strong', 'Matrix: claims down, sources across (✓ supports, ✗ contradicts, · mentions; faint = proposed)')),
    h('div.pane-body', h('table.matrix', h('thead', h('tr', h('th', '#'), h('th', 'Status'), sources.map((s) => h('th', { title: s.title }, truncate(s.siglum || s.title, 18))))),
      h('tbody', claims.map((c) => h('tr', h('td', { onclick: () => app.select({ claimId: c.id }) }, `${c.number}`), h('td', statusBadge(st[c.id]?.status ?? 'open')), sources.map((s) => cell(c, s))))))));
}

function frameView(title: string, html: string) {
  const f = h('iframe', { title, sandbox: '', srcdoc: html, class: 'reportframe' });
  return h('section.pane', h('div.pane-head', h('strong', title)), h('div.pane-body', f));
}

async function lazyView(target: HTMLElement, make: () => Promise<HTMLElement>) {
  try { target.appendChild(await make()); } catch (e: any) { target.appendChild(h('div.err', String(e?.message ?? e))); }
}

function timelineView() {
  const items = app.store.evidence.filter((s) => s.dateMade).sort((a, b) => (a.dateMade! < b.dateMade! ? -1 : 1));
  return h('section.pane', h('div.pane-head', h('strong', 'Timeline of sources (by date made)')),
    h('div.pane-body', items.length ? h('ol.timeline', items.map((s) => h('li', { onclick: () => app.select({ sourceId: s.id }) }, h('strong', s.dateMade!), ` ${s.title} (${s.classification})`))) : h('div.empty', 'No source has a “date made” yet (Source Details).')));
}

export function mainView(): HTMLElement {
  const v: ViewName = app.view;
  const holder = h('div.mainview');
  switch (v) {
    case 'document': holder.appendChild(documentView()); break;
    case 'source': {
      const s = app.source ?? app.store.evidence[0];
      holder.appendChild(s ? sourceView(s) : h('div.empty', 'No sources.'));
      break;
    }
    case 'matrix': holder.appendChild(matrixView()); break;
    case 'timeline': holder.appendChild(timelineView()); break;
    case 'coverage': lazyView(holder, async () => {
      const doc = app.document;
      if (!doc) return h('div.empty', 'No linked document.');
      const { coverageHtml } = await import('../reports/coverage');
      return frameView(`Coverage of “${doc.title}”`, coverageHtml(app.data, app.statuses(), doc.id));
    }); break;
    case 'lineage': lazyView(holder, async () => {
      const { lineageSvg } = await import('../reports/map');
      return h('section.pane', h('div.pane-head', h('strong', 'Lineage: which sources descend from which')), h('div.pane-body.svgbox', { innerHTML: lineageSvg(app.data) }));
    }); break;
    case 'chronology': lazyView(holder, async () => {
      const { chronology } = await import('../reports/tables');
      return h('section.pane', h('div.pane-head', h('strong', 'Chronology')), h('div.pane-body', h('pre.report', chronology(app.data))));
    }); break;
    case 'people': lazyView(holder, async () => {
      const { findNames, nameVariants } = await import('../text/names');
      const names = [...app.store.claims.map((c) => c.text), ...app.store.evidence.filter((s) => !s.confidential).map((s) => s.text.slice(0, 200000))].flatMap((t) => findNames(t).map((n) => n.text));
      const groups = nameVariants([...new Set(names)]).sort((a, b) => a[0].localeCompare(b[0]));
      return h('section.pane', h('div.pane-head', h('strong', `People index (${groups.length})`)),
        h('div.pane-body', h('ul.people', groups.map((g) => h('li', h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); app.filter.text = g[0]; app.view = 'workbench'; app.render(); } }, g[0]), g.length > 1 ? h('span.meta', ` also: ${g.slice(1).join('; ')}`) : null)))));
    }); break;
    case 'wordfreq': lazyView(holder, async () => {
      const { wordFrequency } = await import('../reports/tables');
      const srcs = app.source ? [app.source] : app.store.evidence.filter((s) => !s.confidential);
      const out = wordFrequency(srcs.map((s) => s.text), 150) as unknown;
      return h('section.pane', h('div.pane-head', h('strong', `Word frequency — ${app.source ? app.source.title : 'all sources'}`)), h('div.pane-body', h('pre.report', typeof out === 'string' ? out : JSON.stringify(out, null, 1))));
    }); break;
    default: {
      const doc = app.document;
      const s = app.source ?? app.store.evidence[0];
      if (s && !app.sel.sourceId) app.sel.sourceId = s.id;
      const split = app.splitSourceId ? app.data.sources[app.splitSourceId] : undefined;
      holder.appendChild(h('div.center', sourceTabs(),
        h('div.split', s ? sourceView(s) : h('section.pane', h('div.empty.welcome',
          h('h2', 'Show your work'),
          h('p', 'A case holds your sources, the claims your work makes, and the ties between them.'),
          h('ol',
            h('li', h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); run('source.addFiles'); } }, 'Add sources'), ' — PDFs, scans, photos, workbooks, web pages, transcripts.'),
            h('li', h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); run('claim.linkDocument'); } }, 'Link the document you are checking'), ' and capture its claims.'),
            h('li', 'Select a passage, then press Ctrl+L to tie it to the claim — or let ', h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); run('ai.attributionWizard'); } }, 'Draft Sources for Every Fact'), ' propose ties for you to verify.'),
            h('li', h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); run('help.tutorial'); } }, 'Open the guided example'), ' to see it worked through.'))),
        ), split && split.id !== s?.id ? sourceView(split, true) : null, doc && !split ? documentView() : null)));
    }
  }
  return holder;
}

export function renderLayout(main: HTMLElement) {
  clear(main);
  main.append(
    h('div.layout', { class: `layout${app.showDetails ? '' : ' nodetails'}` }, claimsPane(), mainView(), app.showDetails ? detailsPane() : null),
    ...(app.showProblems ? [problemsPane()] : []),
  );
}

export { icon };
