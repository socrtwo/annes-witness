// The AI tab and AI menu: the AI Setup wizard, the Source Attribution Wizard, and the other AI commands.
// AI output is a proposal or a labeled note; nothing here confirms a tie or sets a status.
import { register, run } from './registry';
import { app } from './app';
import { h, clear } from './dom';
import { form, alertBox, confirmBox, showPanel, toast, choose, progress, modal, openHtmlWindow } from './dialogs';
import { need, needClaim, needSource, needDoc, backend, extraBackends, aiAbort, stopAi, UserError } from './common';
import { SERVICES, EFFORTS, saveAiSettings, setKey, forgetKeys, hasVault, unlockVault, getKey } from '../ai/settings';
import { ClaudeBackend, makeBackend, ProviderConfig, AiImage, AiRefusal, DEFAULT_CLAUDE_MODEL } from '../ai/backend';
import { runAttribution, applyAttribution, AttributionResult, Granularity, eligibleSources } from '../ai/attribution';
import * as ai from '../ai/commands';
import { screenText } from '../ai/privacy';
import { Claim, Source } from '../core/types';
import { newId, nowIso, truncate, escapeHtml } from '../core/util';
import { locate } from '../core/anchor';
import { verifyDrafts } from './cmd-check';

const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (recommended default)' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2 (most capable, higher price)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, lower price)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, lowest price)' },
];

async function imageOf(s: Source, page = 1): Promise<AiImage | undefined> {
  const b = app.blobs.get(s.id);
  if (!b) return undefined;
  const toB64 = (u: Uint8Array) => { let bin = ''; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(bin); };
  if (s.kind === 'image' && /image\/(jpeg|png|gif|webp)/.test(s.mime ?? '')) return { mediaType: s.mime as AiImage['mediaType'], base64: toB64(b) };
  if (s.kind === 'pdf' || s.kind === 'image') {
    const canvas = document.createElement('canvas');
    if (s.kind === 'pdf') { const { renderPdfPage } = await import('../readers/index'); await renderPdfPage(b, page, canvas, 2); }
    else {
      const img = new Image();
      img.src = URL.createObjectURL(new Blob([b as BlobPart], { type: s.mime }));
      await img.decode();
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
    }
    const blob: Blob = await new Promise((res) => canvas.toBlob((x) => res(x!), 'image/png'));
    return { mediaType: 'image/png', base64: toB64(new Uint8Array(await blob.arrayBuffer())) };
  }
  return undefined;
}

async function withProgress<T>(title: string, fn: (signal: AbortSignal, update: (t: string, d?: number, n?: number) => void) => Promise<T>): Promise<T | null> {
  const p = progress(title);
  const outer = aiAbort();
  outer.addEventListener('abort', () => p.signal.dispatchEvent(new Event('abort')));
  try {
    return await fn(p.signal, (t, d, n) => p.update(t, d, n));
  } catch (e: any) {
    if (e?.name === 'AbortError' || p.signal.aborted) { toast('Stopped.'); return null; }
    if (e instanceof AiRefusal) throw new UserError(`The model declined this request${e.category ? ` (${e.category})` : ''}: ${e.message}`);
    if (e?.status === 401) throw new UserError('The service rejected the API key (401). Run AI ▸ Set Up AI again.');
    if (e?.status === 429) throw new UserError('The service is rate-limiting requests (429). Wait a minute and try again, or use smaller batches.');
    throw e;
  } finally { p.close(); }
}

// --- AI Setup wizard ------------------------------------------------------------------------------
async function setupWizard() {
  // Step 1: service
  const svc = await choose('Set Up AI — 1 of 4: choose a service', SERVICES.map((s) => ({ label: `${s.label}${s.recommended ? ' — recommended' : ''}`, value: s.id, detail: `${s.group}. ${s.note}` })),
    'Nothing is sent anywhere until you run an AI command. Each command says what it sends; confidential sources are never sent.');
  if (!svc) return;
  const S = SERVICES.find((s) => s.id === svc)!;
  // Step 2: key and address
  const keyIntro = h('div', S.keyPage ? h('p', S.kind === 'anthropic' ? 'Create an API key in your Anthropic account, then paste it here. ' : 'Install and start the server, then give its address. ', h('a', { href: S.keyPage, target: '_blank', rel: 'noopener' }, S.kind === 'anthropic' ? 'Open the API keys page' : 'Open the download page')) : null,
    S.kind === 'anthropic' ? h('p.meta', 'Prices: ', h('a', { href: S.priceInfo, target: '_blank', rel: 'noopener' }, 'current price page'), '. Each request is billed by the service to your account.') : null,
    h('p.meta', 'The key stays on this device. “This session only” forgets it when the tab closes; “Remember” stores it encrypted with a passphrase you choose.'));
  const existing = app.ai.providers[svc];
  const r = await form<any>(`Set Up AI — 2 of 4: ${S.label}`, [
    ...(S.kind === 'anthropic' ? [{ key: 'apiKey', label: 'API key', type: 'password' as const, value: getKey(svc) ?? '', required: true }] : [{ key: 'apiKey', label: 'API key (if the server needs one)', type: 'password' as const, value: getKey(svc) ?? '' }]),
    ...(S.kind === 'openai-compatible' ? [{ key: 'baseUrl', label: 'Server address', value: existing?.baseUrl ?? S.baseUrl ?? '', required: true }] : []),
    { key: 'remember', label: 'Keep the key', type: 'radio', value: app.ai.remember, options: [{ value: 'session', label: 'This session only' }, { value: 'passphrase', label: 'Remember on this device (encrypted with a passphrase)' }] },
    { key: 'passphrase', label: 'Passphrase (only for Remember)', type: 'password' },
  ], 'Next', keyIntro);
  if (!r) return;
  const cfg: ProviderConfig = { id: svc, kind: S.kind, label: S.label, apiKey: r.apiKey || undefined, baseUrl: r.baseUrl || undefined, model: existing?.model ?? S.defaultModel, effort: existing?.effort ?? 'high' };
  // Step 3: test and models
  let models: { id: string; label: string }[] = S.kind === 'anthropic' ? CLAUDE_MODELS : [];
  const test = await withProgress('Set Up AI — 3 of 4: checking the connection', async (signal) => {
    if (S.kind === 'anthropic') {
      const be = new ClaudeBackend({ ...cfg, model: cfg.model || DEFAULT_CLAUDE_MODEL });
      try {
        const list = await be.listModels();
        const known = new Set(CLAUDE_MODELS.map((m) => m.id));
        models = [...CLAUDE_MODELS.filter((m) => list.some((x) => x.id === m.id)), ...list.filter((x) => !known.has(x.id)).map((x) => ({ id: x.id, label: x.name }))];
        if (!models.length) models = CLAUDE_MODELS;
      } catch (e: any) {
        if (e?.status === 401) throw new UserError('The key was rejected (401). Check that it was copied completely.');
        throw e;
      }
      return 'ok';
    }
    const res = await fetch((cfg.baseUrl ?? '').replace(/\/$/, '') + '/models', { signal, headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {} });
    if (!res.ok) throw new UserError(`The server answered ${res.status}. Is it running at ${cfg.baseUrl}?`);
    const j: any = await res.json();
    models = (j.data ?? []).map((m: any) => ({ id: m.id, label: m.id }));
    return 'ok';
  });
  if (!test) return;
  // Step 4: model and effort
  const m = await form<any>('Set Up AI — 4 of 4: model', [
    models.length ? { key: 'model', label: 'Model', type: 'select', value: models.some((x) => x.id === cfg.model) ? cfg.model : models[0].id, options: models.map((x) => ({ value: x.id, label: x.label })) } : { key: 'model', label: 'Model name', value: cfg.model, required: true },
    ...(S.kind === 'anthropic' ? [{ key: 'effort', label: 'Effort (higher is more thorough, slower and costs more)', type: 'select' as const, value: cfg.effort, options: EFFORTS.map((e) => ({ value: e, label: e })) }] : []),
    { key: 'privacy', label: 'What AI commands may send from this case', type: 'radio', value: app.data.settings.aiPrivacy, options: [
      { value: 'passages', label: 'Passages only (default): the passages a command needs' },
      { value: 'pages', label: 'Whole pages when a command needs them (Transcribe, Extract Fields)' },
      { value: 'documents', label: 'Whole documents when a command needs them (Draft Sources, Extract Claims, Ask the Case)' }] },
  ], 'Finish', S.kind === 'anthropic' ? 'Claude Opus 5.5 is the default. When a request is declined by a safety filter, the service may retry it on a fallback model automatically; the answer says which model served it.' : undefined);
  if (!m) return;
  cfg.model = m.model;
  if (m.effort) cfg.effort = m.effort;
  if (cfg.apiKey) await setKey(svc, cfg.apiKey, r.remember, r.passphrase || undefined);
  const { apiKey: _k, ...stored } = cfg;
  void _k;
  app.ai = { ...app.ai, active: svc, providers: { ...app.ai.providers, [svc]: stored }, remember: r.remember };
  saveAiSettings(app.ai);
  app.store.transact('AI privacy', () => { app.data.settings.aiPrivacy = m.privacy; });
  app.store.touch();
  toast(`AI ready: ${cfg.label}, ${cfg.model}.`);
}

function privacyAllows(level: 'passages' | 'pages' | 'documents', what: string) {
  const order = { passages: 0, pages: 1, documents: 2 };
  if (order[app.data.settings.aiPrivacy] >= order[level]) return;
  throw new UserError(`${what} needs to send ${level === 'documents' ? 'whole documents' : 'whole pages'}, but AI and Privacy allows ${app.data.settings.aiPrivacy === 'passages' ? 'passages only' : 'whole pages only'}. Change it in AI ▸ AI and Privacy.`);
}

// --- The Source Attribution Wizard -----------------------------------------------------------------
async function attributionWizard() {
  const docs = app.store.documents;
  if (!docs.length) throw new UserError('Link the document you want to check first (Claims ▸ Link Document).');
  const { use, skipped } = eligibleSources(app.store);
  if (!use.length) throw new UserError('Add sources with text first. Scans need Recognize Text (OCR) or a transcription before they can be searched.');
  backend(); // fails early if AI is not set up
  privacyAllows('documents', 'Draft Sources for Every Fact');
  const totalChars = use.reduce((n, s) => n + s.text.length, 0);
  const be = backend();
  const intro = h('div',
    h('p', 'For every sentence of the document, the wizard drafts where each fact comes from in your sources. Claude cites exact passages; the app then checks that every cited passage really is in the source, word for word, before showing it. Each draft arrives as a ', h('strong', 'proposed'), ' tie: nothing counts as evidence until you confirm it in Verify Drafts.'),
    h('p.meta', `Will send: the document’s sentences and the text of ${use.length} sources (about ${Math.round(totalChars / 1000)}k characters) to ${be.service} (${be.model}). Repeated requests reuse a cache of the sources.`),
    skipped.length ? h('p.meta', `Not sent: ${skipped.join('; ')}.`) : null);
  const r = await form<any>('Draft Sources for Every Fact — Source Attribution Wizard', [
    { key: 'doc', label: 'Document to check', type: 'select', value: app.document?.id ?? docs[0].id, options: docs.map((d) => ({ value: d.id, label: d.title })) },
    { key: 'sources', label: 'Sources to search', type: 'multiselect', value: use.map((s) => s.id), options: use.map((s) => ({ value: s.id, label: `${s.title} (${Math.round(s.text.length / 1000)}k chars)` })) },
    { key: 'granularity', label: 'Split sentences into', type: 'radio', value: 'fact', options: [{ value: 'fact', label: 'Separate facts (one extra request per 40 sentences; more precise)' }, { value: 'sentence', label: 'Whole sentences' }] },
    { key: 'onlyUnclaimed', label: 'Skip sentences that already have claims', type: 'checkbox', value: false },
    { key: 'includeMentions', label: 'Also keep “mentions” (relevant but not deciding)', type: 'checkbox', value: true },
    { key: 'leads', label: 'For facts with no source in the case, suggest where to look (as to-dos)', type: 'checkbox', value: true },
    { key: 'several', label: `Also ask the other AIs chosen in Several AIs (${app.ai.ensemble.members.length} chosen)`, type: 'checkbox', value: app.ai.ensemble.mode !== 'single' },
  ], 'Start', intro);
  if (!r) return;
  const res = await withProgress('Drafting sources', (signal, update) => runAttribution(app.store, be, {
    documentId: r.doc, sourceIds: r.sources, granularity: r.granularity as Granularity, onlyUnclaimed: r.onlyUnclaimed, suggestLeads: r.leads,
    extraBackends: r.several ? extraBackends() : [], signal,
    onProgress: (p) => update(`${p.phase}… ${p.total ? `${p.done} of ${p.total}` : ''}`, p.done, p.total),
  }));
  if (!res) return;
  // Review step: summary before writing anything into the case.
  const proceed = await draftSummary(res);
  if (!proceed) return toast('Nothing was added.');
  const counts = applyAttribution(app.store, r.doc, res, { createClaims: true, includeMentions: r.includeMentions, leadsAsTodos: r.leads, user: app.store.user });
  app.view = 'workbench';
  app.select({ documentId: r.doc });
  const go = await confirmBox('Drafts ready', `${counts.claims} claims created, ${counts.ties} proposed ties, ${counts.todos} to-dos.\nAll are proposals. Verify them now?`, 'Verify Drafts');
  if (go) await verifyDrafts();
}

async function draftSummary(res: AttributionResult): Promise<boolean> {
  const found = res.facts.filter((f) => f.outcome === 'found');
  const none = res.facts.filter((f) => f.outcome === 'none');
  const errs = res.facts.filter((f) => f.outcome === 'error');
  const nc = res.facts.filter((f) => f.outcome === 'not-checkable');
  const body = h('div',
    h('p', `${res.facts.length - nc.length} facts: ${found.length} with draft sources, ${none.length} with nothing in the sources${errs.length ? `, ${errs.length} failed` : ''}. ${nc.length} sentence(s) with nothing checkable (opinion or no assertion). ${res.discarded.length} cited passage(s) discarded because the app could not find them in the source.`),
    h('table.findings', h('tbody', res.facts.slice(0, 500).map((f) => h('tr', { class: `o-${f.outcome}` },
      h('td', f.outcome === 'found' ? '●' : f.outcome === 'none' ? '○' : f.outcome === 'error' ? '!' : '–'),
      h('td', truncate(f.fact, 120)),
      h('td', f.attributions.map((a) => `${a.kind} · ${app.data.sources[a.sourceId]?.title} ${locate(app.data.sources[a.sourceId], a.start, a.end)}`).join('\n') || f.error || f.leads.slice(0, 2).join('; '))))),
    ),
    res.discarded.length ? h('details', h('summary', `Discarded citations (${res.discarded.length})`), h('ul', res.discarded.map((d) => h('li', `${d.sourceTitle}: “${truncate(d.quote, 100)}” — ${d.reason}`)))) : null,
    h('p.meta', `Requests: ${res.calls.length}. Model(s): ${[...new Set(res.calls.map((c) => c.model))].join(', ')}. Tokens: ${res.calls.reduce((n, c) => n + (c.inputTokens ?? 0), 0)} in, ${res.calls.reduce((n, c) => n + (c.outputTokens ?? 0), 0)} out.`),
  );
  return !!(await modal('Drafts — add to the case?', body, [{ label: 'Discard', value: false }, { label: 'Add as proposals', primary: true, value: true }], { wide: true }));
}

export function registerAiCommands() {
  register('ai.setup', setupWizard);
  register('ai.providers', async () => {
    const list = Object.values(app.ai.providers);
    const id = await choose('Providers and Models', [...list.map((p) => ({ label: `${p.id === app.ai.active ? '● ' : ''}${p.label}`, value: p.id, detail: `${p.model}${p.effort ? `, effort ${p.effort}` : ''}${getKey(p.id) ? ', key available' : p.kind === 'anthropic' ? ', key not entered this session' : ''}` })), { label: 'Add or change a provider…', value: '__setup' }, ...(hasVault() ? [{ label: 'Unlock remembered keys…', value: '__unlock' }] : []), { label: 'Forget all keys on this device', value: '__forget' }]);
    if (!id) return;
    if (id === '__setup') return setupWizard();
    if (id === '__forget') { if (await confirmBox('Forget keys', 'Remove every stored API key from this device?', 'Forget')) { forgetKeys(); toast('Keys removed.'); } return; }
    if (id === '__unlock') { const p = await form<{ p: string }>('Unlock keys', [{ key: 'p', label: 'Passphrase', type: 'password' }]); if (p) toast((await unlockVault(p.p)) ? 'Keys unlocked for this session.' : 'Wrong passphrase.'); return; }
    const p = app.ai.providers[id];
    const r = await form<any>(p.label, [{ key: 'model', label: 'Model', value: p.model }, { key: 'effort', label: 'Effort', type: 'select', value: p.effort ?? 'high', options: EFFORTS.map((e) => ({ value: e, label: e })) }, { key: 'remove', label: 'Remove this provider', type: 'checkbox' }]);
    if (!r) return;
    const providers = { ...app.ai.providers };
    if (r.remove) delete providers[id]; else providers[id] = { ...p, model: r.model, effort: r.effort };
    app.ai = { ...app.ai, providers, active: r.remove && app.ai.active === id ? Object.keys(providers)[0] ?? '' : app.ai.active };
    saveAiSettings(app.ai);
    app.render();
  });
  register('ai.active', async () => {
    const id = await choose('Active AI', Object.values(app.ai.providers).map((p) => ({ label: p.label, value: p.id, detail: p.model })));
    if (id) { app.ai = { ...app.ai, active: id }; saveAiSettings(app.ai); app.render(); }
  });
  register('ai.privacy', async () => {
    const r = await form<any>('AI and Privacy', [
      { key: 'level', label: 'What AI commands may send from this case', type: 'radio', value: app.data.settings.aiPrivacy, options: [{ value: 'passages', label: 'Passages only' }, { value: 'pages', label: 'Whole pages when needed' }, { value: 'documents', label: 'Whole documents when needed' }] },
      { key: 'x', label: 'Sources marked Confidential (Sources ▸ Mark as Confidential) are never sent, at any level. Keys are never stored in the case file.', type: 'info' },
    ]);
    if (r) { app.store.transact('AI privacy', () => { app.data.settings.aiPrivacy = r.level; }); app.store.touch(); }
  });
  register('ai.ensembleMode', async () => {
    const m = await choose('Several AIs', [{ label: 'Single AI', value: 'single' }, { label: 'Several AIs propose; all proposals pass the check', value: 'master' }], 'With several AIs, each proposes passages separately; every proposal is checked against the source, and the drafts show which AIs proposed each one. Agreement among AIs is not corroboration.');
    if (m) { app.ai = { ...app.ai, ensemble: { ...app.ai.ensemble, mode: m as any } }; saveAiSettings(app.ai); }
  });
  register('ai.ensembleMembers', async () => {
    const r = await form<any>('Choose AIs', [{ key: 'm', label: 'AIs to use together', type: 'multiselect', value: app.ai.ensemble.members, options: Object.values(app.ai.providers).map((p) => ({ value: p.id, label: `${p.label} (${p.model})` })) }]);
    if (r) { app.ai = { ...app.ai, ensemble: { ...app.ai.ensemble, members: r.m } }; saveAiSettings(app.ai); }
  });
  register('ai.showDeliberation', { run: () => { app.ai = { ...app.ai, ensemble: { ...app.ai.ensemble, showDeliberation: !app.ai.ensemble.showDeliberation } }; saveAiSettings(app.ai); }, checked: () => app.ai.ensemble.showDeliberation });
  register('ai.history', async () => {
    const list = Object.values(app.data.aiHistory).sort((a, b) => (a.at < b.at ? 1 : -1));
    await showPanel(`AI History (${list.length})`, h('div',
      h('table.findings', h('thead', h('tr', h('th', 'When'), h('th', 'Command'), h('th', 'Service / model'), h('th', 'Sent'), h('th', 'Proposals'), h('th', 'Discarded by the check'))),
        h('tbody', list.map((x) => h('tr', h('td', x.at.replace('T', ' ').slice(0, 16)), h('td', x.command), h('td', `${x.service} / ${x.model}`), h('td', `${truncate(x.sent, 120)} (${x.sentChars} chars)`), h('td', String(x.proposals)), h('td', String(x.discarded)))))),
      h('button', { onclick: async () => { if (await confirmBox('Clear AI History', 'Remove the AI history of this case?', 'Clear')) app.store.transact('Clear AI history', (tx) => { for (const x of list) tx.delete('aiHistory', x.id); }); } }, 'Clear history')));
  });
  register('ai.stop', () => { stopAi(); toast('Stopping AI requests.'); });
  register('ai.attributionWizard', attributionWizard);

  register('ai.ask', async () => {
    privacyAllows('documents', 'Ask the Case');
    const prefill = (window as any).__askPrefill ?? '';
    (window as any).__askPrefill = undefined;
    const q = await form<{ q: string }>('Ask the Case', [{ key: 'q', label: 'Question', type: 'textarea', rows: 3, required: true, value: prefill }], 'Ask', 'The answer comes only from this case’s sources. Every sentence shows the passages it rests on; sentences the app cannot tie to a passage are dropped.');
    if (!q) return;
    const ans = await withProgress('Asking', (signal) => ai.askCase(app.store, backend(), q.q, signal));
    if (!ans) return;
    const body = h('div.answer',
      ans.notInSources && !ans.sentences.length ? h('p', h('strong', 'The sources in this case do not answer that.')) : null,
      ans.sentences.map((s) => h('p', s.text, ' ', s.anchors.map((a) => h('a.cite', { href: '#', title: a.exact, onclick: (e: Event) => { e.preventDefault(); const anchorId = app.store.anchors.find((x) => x.sourceId === a.sourceId && x.start === a.start && x.end === a.end)?.id; app.select({ sourceId: a.sourceId, text: { sourceId: a.sourceId, start: a.start, end: a.end }, anchorId }); (body.closest('.dialog')?.querySelector('.dialog-buttons button') as HTMLButtonElement)?.click(); } }, `[${truncate(app.data.sources[a.sourceId]?.title ?? '', 24)} ${locate(app.data.sources[a.sourceId], a.start, a.end)}]`)))),
      ans.droppedSentences ? h('p.meta', `${ans.droppedSentences} sentence(s) dropped: no passage could be confirmed for them.`) : null,
      h('p.meta', 'An answer is a reading aid. To use a passage as evidence, select it in the source and tie it to a claim.'));
    await showPanel(`Answer: ${truncate(q.q, 60)}`, body);
  });
  register('ai.suggestQuestions', async () => {
    const { use } = eligibleSources(app.store);
    need(use.length, 'No sources with text.');
    privacyAllows('documents', 'Suggest Questions');
    const r = await withProgress('Suggesting questions', (signal) => backend().text({ system: 'List 10 short factual questions that the documents below can answer. One per line, no numbering.', prompt: use.map((s) => `### ${s.title}\n${s.text.slice(0, 60000)}`).join('\n\n'), signal }));
    if (!r) return;
    const qs = r.text.split('\n').map((x) => x.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean);
    const pick = await choose('Suggested questions', qs.map((x) => ({ label: x, value: x })), 'Pick one to ask the case.');
    if (pick) { (window as any).__askPrefill = pick; await run('ai.ask'); }
  });
  register('ai.extractClaims', async () => {
    const d = needDoc();
    privacyAllows('documents', 'Extract Claims');
    const facts = await withProgress('Finding checkable statements', (signal) => ai.extractClaims(app.store, backend(), d.id, signal));
    if (!facts) return;
    const r = await form<any>('Extract Claims', [{ key: 'ids', label: `${facts.length} proposed claims (uncheck to leave out)`, type: 'multiselect', value: facts.map((f) => f.key), options: facts.map((f) => ({ value: f.key, label: `${f.kind}: ${truncate(f.fact, 140)}` })) }], 'Add claims');
    if (!r) return;
    app.store.transact('Extract claims (AI)', (tx) => {
      let n = app.store.nextClaimNumber();
      for (const f of facts.filter((x) => r.ids.includes(x.key))) tx.put('claims', { ...app.newClaim(f.fact, f.kind, { documentId: d.id, start: f.docStart, end: f.docEnd }, { tags: ['AI proposed'] }), number: n++ });
    });
  });
  register('ai.atomize', async () => {
    const claims = app.selectedClaims().length ? app.selectedClaims() : [needClaim()];
    const r = await withProgress('Splitting into facts', (signal) => backend().json<{ items: { claim: number; facts: { fact: string; words: string }[] }[] }>({
      system: 'Split each sentence into the separate checkable facts it asserts. "words" must be copied exactly from the sentence. Do not add facts.',
      prompt: claims.map((c, i) => `(${i + 1}) ${c.text}`).join('\n'),
      schema: { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['claim', 'facts'], properties: { claim: { type: 'integer' }, facts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['fact', 'words'], properties: { fact: { type: 'string' }, words: { type: 'string' } } } } } } } } },
      signal,
    }));
    if (!r) return;
    let n = 0;
    app.store.transact('Split into facts (AI)', (tx) => {
      let num = app.store.nextClaimNumber();
      for (const it of r.data.items) {
        const c = claims[it.claim - 1];
        if (!c || it.facts.length < 2) continue;
        const ids: string[] = [];
        for (const f of it.facts) {
          const pos = c.doc && f.words ? app.data.sources[c.doc.documentId].text.indexOf(f.words, c.doc.start) : -1;
          const doc = c.doc && pos >= 0 && pos < c.doc.end ? { documentId: c.doc.documentId, start: pos, end: pos + f.words.length } : undefined;
          const x: Claim = { ...app.newClaim(f.fact, c.kind, doc, { parentId: c.id, tags: ['AI proposed'] }), number: num++ };
          tx.put('claims', x); ids.push(x.id); n++;
        }
        tx.update<Claim>('claims', c.id, { dependsOn: [...c.dependsOn, ...ids] });
      }
    });
    ai.recordHistory(app.store, 'ai.atomize', [r.info], claims.map((c) => c.text).join('\n'), `${n} facts`);
    toast(`${n} fact claims created.`);
  });
  const find = (focus: 'any' | 'contradicts') => async () => {
    const claims = app.selectedClaims().length ? app.selectedClaims() : [needClaim()];
    privacyAllows('documents', 'Find');
    const r = await withProgress(focus === 'contradicts' ? 'Looking for contradictions' : 'Looking for support', (signal) => ai.findForClaims(app.store, backend(), claims.map((c) => c.id), focus, signal));
    if (r) toast(`${r.ties} proposed ties${r.discarded ? `; ${r.discarded} cited passages discarded (not found in the source)` : ''}. Review ▸ Verify Drafts.`);
  };
  register('ai.findSupport', find('any'));
  register('ai.findContradictions', find('contradicts'));
  register('ai.suggestSources', async () => {
    const claims = app.selectedClaims().length ? app.selectedClaims() : [needClaim()];
    const n = await withProgress('Suggesting where to look', (signal) => ai.suggestSources(app.store, backend(), claims.map((c) => c.id), signal));
    if (n !== null) toast(`${n} to-dos added (labeled as AI suggestions).`);
  });
  register('ai.checkCitations', async () => {
    const d = needDoc();
    const lookup = await confirmBox('Check That Citations Exist', 'Also look up references that are not in the case in the Crossref catalog? Reference text is sent from your browser to Crossref.', 'Look up too');
    const items = await withProgress('Checking citations', (signal) => ai.checkCitations(app.store, app.ai.active ? backend() : null, d.id, lookup, undefined, signal));
    if (!items) return;
    const grp = (x: ai.CitationCheckItem) => (x.inCase ? 'In the case' : x.catalog?.found ? 'Found in a catalog, not in the case' : x.catalog ? 'Not found anywhere — check by hand' : 'Not in the case (not looked up)');
    await showPanel(`Citations (${items.length})`, h('table.findings', h('tbody', items.map((x) => h('tr', { class: x.inCase ? '' : x.catalog?.found ? 'sev-info' : 'sev-warning' }, h('td', grp(x)), h('td', truncate(x.citation, 200)), h('td', x.catalog?.doi ? h('a', { href: `https://doi.org/${x.catalog.doi}`, target: '_blank', rel: 'noopener' }, x.catalog.doi) : ''))))));
  });
  register('ai.transcribe', async () => {
    const s = needSource();
    privacyAllows('pages', 'Transcribe Source');
    if (s.confidential) throw new UserError('This source is confidential and is never sent to AI services.');
    const img = need(await imageOf(s), 'Transcribe works on pictures and PDF pages stored in the case.');
    const t = await withProgress('Transcribing', (signal) => ai.transcribeImage(app.store, backend(), s.id, img, signal));
    if (t !== null) { app.sourceMode = 'transcription'; app.render(); toast('AI transcription added beside the source (labeled; not evidence).'); }
  });
  register('ai.translate', async () => {
    const sel = need(app.sel.text, 'Select a passage in a source.');
    const s = app.data.sources[sel.sourceId];
    if (s.confidential) throw new UserError('This source is confidential and is never sent to AI services.');
    const lang = await form<{ l: string }>('Translate Passage', [{ key: 'l', label: 'Into', value: 'English' }]);
    if (!lang) return;
    const t = await withProgress('Translating', (signal) => ai.translatePassage(app.store, backend(), s.id, sel.start, sel.end, lang.l, signal));
    if (t !== null) await alertBox('AI translation (kept beside the original; not evidence)', t);
  });
  register('ai.extractFields', async () => {
    const s = needSource();
    if (s.confidential) throw new UserError('This source is confidential and is never sent to AI services.');
    privacyAllows('pages', 'Extract Fields from Record');
    const img = s.text ? undefined : await imageOf(s);
    if (!s.text && !img) throw new UserError('The record has no text and no picture to read.');
    const r = await withProgress('Reading the record', (signal) => ai.extractFields(app.store, backend(), s.id, img, signal));
    if (r) toast(`${r.claims} claims, ${r.ties} proposed ties${r.discarded ? `, ${r.discarded} values not found in the text (left without ties)` : ''}.`);
  });
  const note = (cmd: string, label: string, system: string, build: () => Promise<{ prompt: string; target: { sourceId?: string; claimId?: string }; image?: AiImage }>) => async () => {
    const b = await build();
    const t = await withProgress(label, (signal) => ai.noteFromAi(app.store, backend(), cmd, system, b.prompt, b.target, label, b.image, signal));
    if (t !== null) await alertBox(`${label} — AI, not evidence`, t);
  };
  register('ai.summarize', note('ai.summarize', 'Summary', 'Summarize this source in a few sentences, for finding one’s way in it. Do not add facts.', async () => {
    const s = needSource(); if (s.confidential) throw new UserError('This source is confidential.'); privacyAllows('documents', 'Summarize Source');
    return { prompt: s.text.slice(0, 150000), target: { sourceId: s.id } };
  }));
  register('ai.describeImage', note('ai.describeImage', 'Description', 'Describe what is visible in this picture plainly. Do not identify people by face. Say what is uncertain.', async () => {
    const s = needSource(); if (s.confidential) throw new UserError('This source is confidential.'); privacyAllows('pages', 'Describe Picture');
    return { prompt: `Describe the picture “${s.title}”.`, target: { sourceId: s.id }, image: need(await imageOf(s), 'No picture stored for this source.') };
  }));
  register('ai.explainSource', note('ai.explainSource', 'About this kind of record', 'Explain what kind of record this appears to be, who usually made such records, when and why, and what such records are known to get wrong. This is general background; say so.', async () => {
    const s = needSource(); if (s.confidential) throw new UserError('This source is confidential.');
    return { prompt: `${s.title}\n${s.text.slice(0, 4000)}`, target: { sourceId: s.id } };
  }));
  register('ai.explainConflict', note('ai.explainConflict', 'Possible reasons for the disagreement', 'Two or more passages disagree about a claim. List possible reasons (copying error, calendar difference, different person, later correction, informant error, rounding). These are possibilities to investigate, not conclusions.', async () => {
    const c = needClaim();
    const ps = app.store.tiesOf(c.id).filter((t) => t.state === 'confirmed' && t.anchorId && (t.kind === 'supports' || t.kind === 'contradicts')).map((t) => { const a = app.data.anchors[t.anchorId!]; const s = app.data.sources[a.sourceId]; return s.confidential ? null : `- ${s.title} (${s.classification}, made ${s.dateMade ?? '?'}): “${a.exact}” [${t.kind}]`; }).filter(Boolean);
    need(ps.length >= 2, 'Explain Disagreement needs at least two confirmed supporting or contradicting passages.');
    return { prompt: `Claim: ${c.text}\nPassages:\n${ps.join('\n')}`, target: { claimId: c.id } };
  }));
  register('ai.checkParaphrase', async () => {
    const t = need(app.sel.tieId ? app.data.ties[app.sel.tieId] : undefined, 'Select a tie.');
    const r = await withProgress('Comparing', (signal) => ai.checkParaphrase(app.store, backend(), t.id, signal));
    if (r) await alertBox('Check Paraphrase (AI opinion)', `${r.says_more ? 'The claim appears to say more than the passage.' : 'The claim does not appear to say more than the passage.'}\n\n${r.explanation}`);
  });
  register('ai.classifyTie', async () => {
    const t = need(app.sel.tieId ? app.data.ties[app.sel.tieId] : undefined, 'Select a tie.');
    const r = await withProgress('Classifying', (signal) => ai.classifyTie(app.store, backend(), t.id, signal));
    if (r && (await confirmBox('Suggest Tie Kind', `Suggested: ${r.kind}, ${r.directness}.\n${r.why}\n\nApply this to the tie? (A confirmed tie stays confirmed; a proposed tie stays proposed.)`, 'Apply')))
      app.store.transact('Tie kind (AI suggestion)', (tx) => tx.update('ties', t.id, { kind: r.kind, directness: r.directness } as any));
  });
  register('ai.assessIndependence', async () => {
    const srcs = app.store.evidence.filter((s) => !s.confidential && s.text);
    const r = await form<any>('Assess Independence', [{ key: 'a', label: 'Source A', type: 'select', value: srcs[0]?.id, options: srcs.map((s) => ({ value: s.id, label: s.title })) }, { key: 'b', label: 'Source B', type: 'select', value: srcs[1]?.id, options: srcs.map((s) => ({ value: s.id, label: s.title })) }]);
    if (!r || r.a === r.b) return;
    const res = await withProgress('Comparing sources', (signal) => ai.assessIndependence(app.store, backend(), r.a, r.b, signal));
    if (!res) return;
    const A = app.data.sources[r.a], B = app.data.sources[r.b];
    const msg = `${res.likely_related ? 'Looks related' : 'No sign of copying'} (${res.direction}).\n${res.why}\n\nShared phrases found in both by the app: ${res.shared.length ? res.shared.map((x) => `“${x}”`).join('; ') : 'none'}`;
    if (res.likely_related && (res.direction === 'a-from-b' || res.direction === 'b-from-a') && (await confirmBox('Assess Independence (AI proposal)', msg + '\n\nRecord it with Derived From?', 'Record'))) {
      const [child, parent] = res.direction === 'a-from-b' ? [A, B] : [B, A];
      app.store.transact('Derived from (AI proposal confirmed)', (tx) => tx.update<Source>('sources', child.id, { derivedFrom: [...child.derivedFrom, { sourceId: parent.id, how: 'copy' }], classification: 'derivative' }));
    } else await alertBox('Assess Independence (AI proposal)', msg);
  });
  register('ai.screenPrivacy', async () => {
    const targets = app.source ? [app.source] : app.store.sources;
    const rows = targets.flatMap((s) => screenText(s.text).map((h0) => ({ s, h0 })));
    await showPanel(`Private information (${rows.length}) — checked on this device; nothing was sent`, h('table.findings', h('tbody', rows.slice(0, 1000).map(({ s, h0 }) => h('tr', { onclick: () => app.select({ sourceId: s.id, text: { sourceId: s.id, start: h0.start, end: h0.end } }) }, h('td', s.title), h('td', h0.kind), h('td', truncate(h0.text, 60)))))));
  });
  register('ai.draftProof', async () => {
    const { proofSummary } = await import('../reports/proof');
    const md = proofSummary(app.data, app.statuses(), { includeConfidential: false }).markdown;
    const t = await withProgress('Drafting', (signal) => ai.draftProof(app.store, backend(), md, signal));
    if (t) {
      const safe = escapeHtml(t);
      openHtmlWindow('<!doctype html><meta charset="utf-8"><title>Draft proof</title><body style="font:16px/1.6 Georgia,serif;max-width:46em;margin:2em auto"><p style="background:#fff3cd;padding:.5em">AI draft written from the confirmed ties and conclusions. Check it against the Proof Summary before use.</p><pre style="white-space:pre-wrap;font:inherit">' + safe + '</pre>');
    }
  });
  register('ai.draftCitation', async () => {
    const s = needSource();
    if (s.confidential) throw new UserError('This source is confidential.');
    const c = await withProgress('Drafting citation', (signal) => ai.draftCitation(app.store, backend(), s.id, signal));
    if (!c) return;
    const { formatCitation } = await import('../reports/citation');
    if (await confirmBox('Draft Citation (AI)', `${formatCitation(c, app.data.settings.citationStyle, s.title).replace(/\*/g, '')}\n\nUse these fields? You can correct them in Sources ▸ Citation.`, 'Use'))
      app.store.transact('Citation (AI draft)', (tx) => tx.update<Source>('sources', s.id, { citation: { ...s.citation, ...c } }));
  });
  register('ai.draftConclusion', async () => {
    const c = needClaim();
    const rk = need(Object.values(app.data.reckonings).find((r) => r.claimId === c.id), 'Open a Reckoning for this claim first (Resolve ▸ Open Reckoning).');
    const t = await withProgress('Drafting conclusion', (signal) => ai.draftConclusion(app.store, backend(), rk, signal));
    if (t && (await confirmBox('Draft Conclusion (AI)', `${t}\n\nPut this draft into the Reckoning’s conclusion for you to edit? The claim becomes Settled only with a preferred reading and your conclusion.`, 'Use as draft')))
      app.store.transact('Conclusion (AI draft)', (tx) => tx.put('reckonings', { ...rk, conclusion: `${t}\n\n[Drafted with AI; edited by ${app.store.user}]` }));
  });
  register('ai.draftPlan', async () => {
    const c = needClaim();
    const n = await withProgress('Drafting a research plan', (signal) => ai.suggestSources(app.store, backend(), [c.id], signal));
    if (n !== null) toast(`${n} to-dos added.`);
  });
  register('ai.runOnSelection', async () => {
    const claims = app.selectedClaims();
    const s = app.source;
    need(claims.length || s, 'Select claims or a source.');
    const r = await form<{ q: string }>('Run on Selection', [{ key: 'q', label: 'Instruction', type: 'textarea', rows: 3, required: true }], 'Run', 'The result is a labeled note; it is never evidence.');
    if (!r) return;
    const prompt = `${r.q}\n\n${claims.length ? claims.map((c) => `Claim ${c.number}: ${c.text}`).join('\n') : `Source “${s!.title}”:\n${s!.confidential ? '(confidential: not sent)' : s!.text.slice(0, 100000)}`}`;
    const t = await withProgress('Running', (signal) => ai.noteFromAi(app.store, backend(), 'ai.runOnSelection', 'Follow the instruction using only the material given. Say when the material is not enough.', prompt, claims.length ? { claimId: claims[0].id } : { sourceId: s!.id }, 'AI note', undefined, signal));
    if (t !== null) await alertBox('AI result (not evidence)', t);
  });
  void makeBackend; void newId; void nowIso; void clear;
}
