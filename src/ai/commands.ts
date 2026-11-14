// The AI tab's other commands. Each returns proposals or labeled notes; none confirms a tie,
// sets a status or chooses a preferred source. See docs/AI-PLAN.md.
import { CaseStore } from '../core/case';
import { makeSelector } from '../core/anchor';
import { Anchor, Claim, ClaimKind, Id, Source, Tie, AiHistoryEntry, CitationFields, Reckoning } from '../core/types';
import { newId, nowIso, truncate } from '../core/util';
import { AiBackend, AiImage, CallInfo } from './backend';
import { verifyQuote } from './gate';
import { runAttribution, applyAttribution, eligibleSources, parseCitedAnswer, DocSlice, wholeSource } from './attribution';
import { PassageIndex, selectPassages } from './retrieve';

export type Scope = 'passages' | 'documents';

/** Whole sources, or the passages chosen on the device for the given queries. */
export function slicesFor(sources: Source[], scope: Scope, index?: PassageIndex) {
  return (queries: string[]): DocSlice[] => {
    if (scope === 'documents') return sources.map(wholeSource);
    const ix = index ?? new PassageIndex(sources);
    return selectPassages(ix, queries, 4, 60_000).map((c) => {
      const src = ix.sources.get(c.sourceId)!;
      return { source: src, offset: c.start, text: c.text, title: `${src.title} (${c.label || 'passage'})` };
    });
  };
}

export function recordHistory(store: CaseStore, command: string, info: CallInfo[], sent: string, received: string, proposals = 0, discarded = 0) {
  const h: AiHistoryEntry = {
    id: newId('ai'), at: nowIso(), command,
    service: [...new Set(info.map((i) => i.service))].join(', '),
    model: [...new Set(info.map((i) => i.model))].join(', '),
    sent: truncate(sent, 2000), sentChars: info.reduce((s, i) => s + i.sentChars, 0), received: truncate(received, 4000), proposals, discarded,
  };
  store.transact('AI history', (tx) => tx.put('aiHistory', h));
}

// --- Ask the Case ------------------------------------------------------------------
export interface CaseAnswer {
  sentences: { text: string; anchors: { sourceId: Id; start: number; end: number; exact: string }[] }[];
  droppedSentences: number;
  notInSources: boolean;
}

export async function askCase(store: CaseStore, be: AiBackend, question: string, signal?: AbortSignal, scope: Scope = 'passages'): Promise<CaseAnswer> {
  const { use } = eligibleSources(store);
  if (!use.length) throw new Error('No sources with text in this case.');
  const slices = slicesFor(use, scope)([question]);
  if (!slices.length) return { sentences: [], droppedSentences: 0, notInSources: true };
  const system = `Answer only from the documents provided, citing the passage for every statement. If the documents do not answer the question, reply exactly: NOT IN THE SOURCES. Do not use outside knowledge.`;
  const ans: CaseAnswer = { sentences: [], droppedSentences: 0, notInSources: false };
  const infos: CallInfo[] = [];
  if (be.cited) {
    const r = await be.cited({ system, documents: slices.map((d) => ({ title: d.title, text: d.text })), prompt: question, signal });
    infos.push(r.info);
    for (const b of r.blocks) {
      const t = b.text.trim();
      if (!t) continue;
      if (/NOT IN THE SOURCES/.test(t)) { ans.notInSources = true; continue; }
      const anchors = b.citations
        .map((c) => ({ c, d: slices[c.documentIndex] }))
        .filter((x) => x.d)
        .map(({ c, d }) => ({ s: d.source, g: verifyQuote(d.source, c.citedText, c.start !== undefined && c.end !== undefined ? { start: d.offset + c.start, end: d.offset + c.end } : undefined) }))
        .filter((x) => x.g.ok)
        .map(({ s, g }) => ({ sourceId: s.id, start: g.start, end: g.end, exact: s.text.slice(g.start, g.end) }));
      // Connective text with no citation is kept only when it is short; a substantive sentence without an anchor is dropped.
      if (anchors.length || t.length < 40) ans.sentences.push({ text: t, anchors });
      else ans.droppedSentences++;
    }
  } else {
    const docs = slices.map((d, i) => `<source number="${i + 1}" title="${d.title}">\n${d.text}\n</source>`).join('\n');
    const r = await be.json<{ statements: { text: string; source: number; quote: string }[]; not_in_sources: boolean }>({
      system: system + ' Return statements, each with the source number and the exact quote supporting it.',
      prompt: `${docs}\n\nQuestion: ${question}`,
      schema: {
        type: 'object', additionalProperties: false, required: ['statements', 'not_in_sources'],
        properties: {
          not_in_sources: { type: 'boolean' },
          statements: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'source', 'quote'], properties: { text: { type: 'string' }, source: { type: 'integer' }, quote: { type: 'string' } } } },
        },
      },
      signal,
    });
    infos.push(r.info);
    ans.notInSources = r.data.not_in_sources;
    for (const st of r.data.statements) {
      const s = slices[st.source - 1]?.source;
      const g = s ? verifyQuote(s, st.quote) : null;
      if (s && g?.ok) ans.sentences.push({ text: st.text, anchors: [{ sourceId: s.id, start: g.start, end: g.end, exact: s.text.slice(g.start, g.end) }] });
      else ans.droppedSentences++;
    }
  }
  recordHistory(store, 'ai.ask', infos, question, ans.sentences.map((s) => s.text).join(' '), ans.sentences.length, ans.droppedSentences);
  return ans;
}

// --- Find support / contradictions for one claim ------------------------------------
export async function findForClaims(store: CaseStore, be: AiBackend, claimIds: Id[], focus: 'any' | 'contradicts', signal?: AbortSignal, scope: Scope = 'passages') {
  const claims = claimIds.map((i) => store.data.claims[i]).filter(Boolean);
  const { use, skipped } = eligibleSources(store);
  if (!use.length) throw new Error('No sources with text in this case.');
  const result = { facts: [] as any[], discarded: [] as any[], calls: [] as CallInfo[], skippedSources: skipped };
  const { attributeClaims } = await import('./attributeClaims');
  const pick = slicesFor(use, scope);
  await attributeClaims(be, claims, (batch) => pick(batch.map((c) => c.text)), result, focus, signal);
  let ties = 0;
  store.transact(focus === 'contradicts' ? 'AI: find contradictions' : 'AI: find support', (tx) => {
    for (const f of result.facts) {
      for (const a of f.attributions) {
        if (focus === 'contradicts' && a.kind !== 'contradicts') continue;
        const src = store.data.sources[a.sourceId];
        const anchor: Anchor = { id: newId('a'), sourceId: src.id, ...makeSelector(src.text, a.start, a.end), knowledge: 'unknown', sourceHash: src.contentHash, created: nowIso() };
        tx.put('anchors', anchor);
        tx.put('ties', {
          id: newId('t'), claimId: f.claimId, anchorId: anchor.id, kind: a.kind, directness: 'direct', state: 'proposed',
          proposedBy: { type: 'ai', who: store.user, service: be.service, model: be.model, command: focus === 'contradicts' ? 'ai.findContradictions' : 'ai.findSupport' },
          rationale: a.rationale, created: nowIso(),
        } as Tie);
        ties++;
      }
    }
  });
  recordHistory(store, focus === 'contradicts' ? 'ai.findContradictions' : 'ai.findSupport', result.calls, claims.map((c) => c.text).join('\n'), `${ties} proposed ties`, ties + result.discarded.length, result.discarded.length);
  return { ties, discarded: result.discarded.length };
}

// --- Extract claims from a document -------------------------------------------------
export async function extractClaims(store: CaseStore, be: AiBackend, documentId: Id, signal?: AbortSignal) {
  const r = await runAttributionFactsOnly(store, be, documentId, signal);
  return r;
}

async function runAttributionFactsOnly(store: CaseStore, be: AiBackend, documentId: Id, signal?: AbortSignal) {
  const { draftFacts } = await import('./attribution');
  const result = { facts: [] as any[], discarded: [] as any[], calls: [] as CallInfo[], skippedSources: [] as string[] };
  const facts = await draftFacts(store, be, { documentId, granularity: 'fact', onlyUnclaimed: true, suggestLeads: false, signal }, result);
  recordHistory(store, 'ai.extractClaims', result.calls, `Document “${store.data.sources[documentId].title}”`, `${facts.length} proposed claims`, facts.length, 0);
  return facts.filter((f) => f.outcome !== 'not-checkable');
}

// --- Suggest where to look ------------------------------------------------------------
export async function suggestSources(store: CaseStore, be: AiBackend, claimIds: Id[], signal?: AbortSignal) {
  const claims = claimIds.map((i) => store.data.claims[i]).filter(Boolean);
  const titles = store.evidence.filter((s) => !s.confidential).map((s) => s.title);
  const r = await be.json<{ items: { claim: number; suggestions: string[] }[] }>({
    system: 'You suggest kinds of records, archives, databases and people a researcher could consult to verify each claim. Suggest searches only. Never say whether a claim is true.',
    prompt: `Records already in the case: ${titles.join('; ') || 'none'}\n\nClaims:\n${claims.map((c, i) => `(${i + 1}) ${c.text}`).join('\n')}`,
    schema: { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['claim', 'suggestions'], properties: { claim: { type: 'integer' }, suggestions: { type: 'array', items: { type: 'string' } } } } } } },
    signal,
  });
  let n = 0;
  store.transact('AI: suggest where to look', (tx) => {
    for (const it of r.data.items) {
      const c = claims[it.claim - 1];
      if (!c) continue;
      for (const s of it.suggestions.slice(0, 8)) { tx.put('todos', { id: newId('td'), text: `Look for: ${s}`, claimId: c.id, done: false, created: nowIso(), ai: true }); n++; }
    }
  });
  recordHistory(store, 'ai.suggestSources', [r.info], claims.map((c) => c.text).join('\n'), `${n} to-dos`);
  return n;
}

// --- Check that citations exist ----------------------------------------------------------
export interface CitationCheckItem { citation: string; fields: CitationFields; inCase?: Id; catalog?: { found: boolean; title?: string; doi?: string; url?: string }; }

/** Pull reference lines out of a document: a References/Bibliography/Works Cited section, or numbered notes. */
export function findReferenceLines(text: string): string[] {
  const m = text.match(/\n\s*(References|Bibliography|Works Cited|Sources|Notes|Endnotes)\s*\n([\s\S]+)$/i);
  const body = m ? m[2] : text;
  return body
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 25 && (/(\(|\b)(1[5-9]\d\d|20\d\d)(\)|\b)/.test(l) || /doi\.org|doi:/i.test(l)) && (m || /^\[?\d+[\].)]/.test(l)));
}

function titleSim(a: string, b: string) {
  const w = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((x) => x.length > 3));
  const A = w(a), B = w(b);
  if (!A.size || !B.size) return 0;
  let i = 0;
  for (const x of A) if (B.has(x)) i++;
  return i / Math.min(A.size, B.size);
}

export async function checkCitations(store: CaseStore, be: AiBackend | null, documentId: Id, lookup: boolean, fetchImpl: typeof fetch = (...a) => fetch(...a), signal?: AbortSignal): Promise<CitationCheckItem[]> {
  const doc = store.data.sources[documentId];
  const lines = findReferenceLines(doc.text).slice(0, 200);
  let fields: CitationFields[] = lines.map((l) => ({ title: l }));
  const infos: CallInfo[] = [];
  if (be && lines.length) {
    const r = await be.json<{ refs: { authors: string[]; title: string; year: string; container: string; doi: string }[] }>({
      system: 'Split each reference into fields. Copy text exactly; leave a field empty if absent. Do not correct or complete references.',
      prompt: lines.map((l, i) => `(${i + 1}) ${l}`).join('\n'),
      schema: { type: 'object', additionalProperties: false, required: ['refs'], properties: { refs: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['authors', 'title', 'year', 'container', 'doi'], properties: { authors: { type: 'array', items: { type: 'string' } }, title: { type: 'string' }, year: { type: 'string' }, container: { type: 'string' }, doi: { type: 'string' } } } } } },
      signal,
    });
    infos.push(r.info);
    fields = lines.map((l, i) => {
      const f = r.data.refs[i];
      // Only keep a split title if it really is in the reference line.
      return f && f.title && l.includes(f.title.slice(0, 20)) ? { authors: f.authors, title: f.title, year: f.year, container: f.container, doi: f.doi || undefined } : { title: l };
    });
  }
  const out: CitationCheckItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const f = fields[i];
    const inCase = store.evidence.find((s) => (f.doi && s.citation.doi?.toLowerCase() === f.doi.toLowerCase()) || titleSim(s.citation.title ?? s.title, f.title ?? '') >= 0.8);
    const item: CitationCheckItem = { citation: lines[i], fields: f, inCase: inCase?.id };
    if (!inCase && lookup) {
      try {
        const doi = f.doi ?? lines[i].match(/10\.\d{4,9}\/[^\s"<>]+/)?.[0];
        const url = doi
          ? `https://api.crossref.org/works/${encodeURIComponent(doi.replace(/[.,;]$/, ''))}`
          : `https://api.crossref.org/works?rows=1&query.bibliographic=${encodeURIComponent(lines[i].slice(0, 300))}`;
        const res = await fetchImpl(url, { signal });
        if (res.ok) {
          const j: any = await res.json();
          const w = j.message?.items?.[0] ?? j.message;
          const t = w?.title?.[0] ?? '';
          const found = !!w && (doi ? true : titleSim(t, f.title ?? lines[i]) >= 0.7);
          item.catalog = { found, title: t, doi: w?.DOI, url: w?.URL };
        } else item.catalog = { found: false };
      } catch {
        item.catalog = undefined;
      }
    }
    out.push(item);
  }
  if (infos.length) recordHistory(store, 'ai.checkCitations', infos, lines.join('\n'), `${out.length} references split`);
  return out;
}

// --- Reading -----------------------------------------------------------------------------
export async function transcribeImage(store: CaseStore, be: AiBackend, sourceId: Id, image: AiImage, signal?: AbortSignal) {
  const r = await be.text({
    system: 'Transcribe the document image line by line, exactly as written, keeping original spelling and line breaks. Mark words you cannot read as [illegible] and uncertain readings as [word?]. Do not modernize, correct, complete or guess missing text.',
    prompt: 'Transcribe this page.',
    images: [image],
    signal,
  });
  store.transact('AI transcription', (tx) => tx.update<Source>('sources', sourceId, { aiTranscription: r.text }));
  recordHistory(store, 'ai.transcribe', [r.info], `Image of “${store.data.sources[sourceId].title}”`, r.text);
  return r.text;
}

export async function translatePassage(store: CaseStore, be: AiBackend, sourceId: Id, start: number, end: number, lang: string, signal?: AbortSignal) {
  const s = store.data.sources[sourceId];
  const passage = s.text.slice(start, end);
  const r = await be.text({ system: `Translate into ${lang}. Translate faithfully; mark uncertain words with [?]. Output only the translation.`, prompt: passage, signal });
  store.transact('AI translation', (tx) => tx.update<Source>('sources', sourceId, { translationNotes: [...(s.translationNotes ?? []), { start, end, text: r.text, ai: true }] }));
  recordHistory(store, 'ai.translate', [r.info], passage, r.text);
  return r.text;
}

export async function extractFields(store: CaseStore, be: AiBackend, sourceId: Id, image?: AiImage, signal?: AbortSignal) {
  const s = store.data.sources[sourceId];
  const r = await be.json<{ fields: { label: string; value: string; quote: string; kind: string }[] }>({
    system: 'Extract names, dates, places, relationships and amounts from this record. For each, give the exact words from the record text ("quote"). Do not infer values that are not written.',
    prompt: s.text ? `Record text:\n${s.text.slice(0, 60000)}` : 'Read the record in the image.',
    images: image ? [image] : undefined,
    schema: { type: 'object', additionalProperties: false, required: ['fields'], properties: { fields: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'value', 'quote', 'kind'], properties: { label: { type: 'string' }, value: { type: 'string' }, quote: { type: 'string' }, kind: { type: 'string', enum: ['fact', 'number', 'date', 'identity', 'relationship', 'other'] } } } } } },
    signal,
  });
  let claims = 0, ties = 0, discarded = 0;
  store.transact('AI: extract fields', (tx) => {
    let n = store.nextClaimNumber();
    for (const f of r.data.fields) {
      const g = s.text ? verifyQuote(s, f.quote) : { ok: false, start: -1, end: -1 };
      const c: Claim = { id: newId('c'), number: n++, text: `${f.label}: ${f.value}`, kind: f.kind as ClaimKind, importance: 'normal', dependsOn: [], tags: ['from record', 'AI proposed'], created: nowIso() };
      tx.put('claims', c);
      claims++;
      if (g.ok) {
        const a: Anchor = { id: newId('a'), sourceId, ...makeSelector(s.text, g.start, g.end), knowledge: 'unknown', sourceHash: s.contentHash, created: nowIso() };
        tx.put('anchors', a);
        tx.put('ties', { id: newId('t'), claimId: c.id, anchorId: a.id, kind: 'supports', directness: 'direct', state: 'proposed', proposedBy: { type: 'ai', who: store.user, service: be.service, model: be.model, command: 'ai.extractFields' }, created: nowIso() } as Tie);
        ties++;
      } else discarded++;
    }
  });
  recordHistory(store, 'ai.extractFields', [r.info], `Record “${s.title}”`, JSON.stringify(r.data.fields).slice(0, 4000), ties, discarded);
  return { claims, ties, discarded };
}

export async function noteFromAi(store: CaseStore, be: AiBackend, command: string, system: string, prompt: string, target: { sourceId?: Id; claimId?: Id }, label: string, image?: AiImage, signal?: AbortSignal) {
  const r = await be.text({ system, prompt, images: image ? [image] : undefined, signal });
  const note = `[${label} — AI (${r.info.model}), not evidence] ${r.text.trim()}`;
  store.transact(label, (tx) => {
    if (target.sourceId) {
      const s = store.data.sources[target.sourceId];
      tx.update<Source>('sources', s.id, { notes: [s.notes, note].filter(Boolean).join('\n\n') });
    } else if (target.claimId) {
      const c = store.data.claims[target.claimId];
      tx.update<Claim>('claims', c.id, { notes: [c.notes, note].filter(Boolean).join('\n\n') });
    }
  });
  recordHistory(store, command, [r.info], truncate(prompt, 2000), r.text);
  return r.text;
}

export async function checkParaphrase(store: CaseStore, be: AiBackend, tieId: Id, signal?: AbortSignal) {
  const t = store.data.ties[tieId];
  const a = t.anchorId ? store.data.anchors[t.anchorId] : null;
  if (!a) throw new Error('This tie has no passage.');
  const c = store.data.claims[t.claimId];
  const r = await be.json<{ says_more: boolean; explanation: string }>({
    system: 'Compare a claim with the source passage it is tied to. Say whether the claim says more than the passage does (stronger, more specific, broader, or more certain). Judge only from the passage.',
    prompt: `Claim: ${c.text}\nPassage: ${a.exact}`,
    schema: { type: 'object', additionalProperties: false, required: ['says_more', 'explanation'], properties: { says_more: { type: 'boolean' }, explanation: { type: 'string' } } },
    signal,
  });
  recordHistory(store, 'ai.checkParaphrase', [r.info], `${c.text} || ${a.exact}`, JSON.stringify(r.data));
  return r.data;
}

export async function classifyTie(store: CaseStore, be: AiBackend, tieId: Id, signal?: AbortSignal) {
  const t = store.data.ties[tieId];
  const a = t.anchorId ? store.data.anchors[t.anchorId] : null;
  if (!a) throw new Error('This tie has no passage.');
  const c = store.data.claims[t.claimId];
  const r = await be.json<{ kind: 'supports' | 'contradicts' | 'mentions'; directness: 'direct' | 'indirect'; why: string }>({
    system: 'Classify how a source passage bears on a claim: supports, contradicts or mentions; direct (states it) or indirect (implies it).',
    prompt: `Claim: ${c.text}\nPassage: ${a.exact}`,
    schema: { type: 'object', additionalProperties: false, required: ['kind', 'directness', 'why'], properties: { kind: { type: 'string', enum: ['supports', 'contradicts', 'mentions'] }, directness: { type: 'string', enum: ['direct', 'indirect'] }, why: { type: 'string' } } },
    signal,
  });
  recordHistory(store, 'ai.classifyTie', [r.info], `${c.text} || ${a.exact}`, JSON.stringify(r.data));
  return r.data;
}

export async function assessIndependence(store: CaseStore, be: AiBackend, aId: Id, bId: Id, signal?: AbortSignal) {
  const A = store.data.sources[aId], B = store.data.sources[bId];
  const r = await be.json<{ likely_related: boolean; direction: 'a-from-b' | 'b-from-a' | 'common-original' | 'unrelated'; shared: string[]; why: string }>({
    system: 'Decide whether two sources look copied from one another or from a common original, judging by shared unusual wording and shared errors. "shared" must list exact phrases that appear in both.',
    prompt: `Source A (${A.title}):\n${A.text.slice(0, 40000)}\n\nSource B (${B.title}):\n${B.text.slice(0, 40000)}`,
    schema: { type: 'object', additionalProperties: false, required: ['likely_related', 'direction', 'shared', 'why'], properties: { likely_related: { type: 'boolean' }, direction: { type: 'string', enum: ['a-from-b', 'b-from-a', 'common-original', 'unrelated'] }, shared: { type: 'array', items: { type: 'string' } }, why: { type: 'string' } } },
    signal,
  });
  // Keep only shared phrases the app can find in both.
  const shared = r.data.shared.filter((p) => verifyQuote(A, p).ok && verifyQuote(B, p).ok);
  recordHistory(store, 'ai.assessIndependence', [r.info], `${A.title} vs ${B.title}`, JSON.stringify(r.data), r.data.shared.length, r.data.shared.length - shared.length);
  return { ...r.data, shared };
}

export async function draftCitation(store: CaseStore, be: AiBackend, sourceId: Id, signal?: AbortSignal) {
  const s = store.data.sources[sourceId];
  const r = await be.json<CitationFields & { authors: string[] }>({
    system: 'Fill citation fields from the title page, heading or first lines of a source. Copy what is written; leave fields empty when not present. Do not look anything up.',
    prompt: s.text.slice(0, 6000) || s.title,
    schema: {
      type: 'object', additionalProperties: false,
      required: ['type', 'authors', 'title', 'container', 'publisher', 'place', 'year', 'volume', 'issue', 'pages', 'doi', 'isbn'],
      properties: {
        type: { type: 'string', enum: ['book', 'article', 'chapter', 'web', 'record', 'interview', 'letter', 'report', 'dataset', 'other'] },
        authors: { type: 'array', items: { type: 'string' } },
        title: { type: 'string' }, container: { type: 'string' }, publisher: { type: 'string' }, place: { type: 'string' }, year: { type: 'string' },
        volume: { type: 'string' }, issue: { type: 'string' }, pages: { type: 'string' }, doi: { type: 'string' }, isbn: { type: 'string' },
      },
    },
    signal,
  });
  recordHistory(store, 'ai.draftCitation', [r.info], `Opening of “${s.title}”`, JSON.stringify(r.data));
  const clean: CitationFields = {};
  for (const [k, v] of Object.entries(r.data)) if (Array.isArray(v) ? v.length : v) (clean as any)[k] = v;
  return clean;
}

export async function draftConclusion(store: CaseStore, be: AiBackend, reckoning: Reckoning, signal?: AbortSignal) {
  const c = store.data.claims[reckoning.claimId];
  const rows = reckoning.rows.map((r) => `- ${store.data.sources[r.sourceId]?.title}: says “${r.says}”; informant ${r.informant || 'unknown'} (${r.knowledge}); made ${r.when || '?'}; ${r.classification}`).join('\n');
  const pref = reckoning.preferredAnchorId ? store.data.anchors[reckoning.preferredAnchorId] : null;
  const r = await be.text({
    system: 'Write a first draft of a short written conclusion for a conflict between sources, using only the table provided and the reading the researcher prefers. Explain the reasoning plainly. Do not add facts.',
    prompt: `Claim: ${c.text}\nSources:\n${rows}\nPreferred reading: ${pref ? `“${pref.exact}” in ${store.data.sources[pref.sourceId]?.title}` : 'not chosen yet'}\nReason given: ${reckoning.preferReason ?? ''}`,
    signal,
  });
  recordHistory(store, 'ai.draftConclusion', [r.info], c.text, r.text);
  return r.text;
}

export async function draftProof(store: CaseStore, be: AiBackend, proofMarkdown: string, signal?: AbortSignal) {
  const r = await be.text({
    system: 'Rewrite the evidence summary below as readable prose. Use only what it contains; keep every claim number and every source reference; do not add facts, and keep conflicts and open items visible.',
    prompt: proofMarkdown,
    signal,
  });
  recordHistory(store, 'ai.draftProof', [r.info], truncate(proofMarkdown, 2000), r.text);
  return r.text;
}

export { runAttribution, applyAttribution, parseCitedAnswer };
