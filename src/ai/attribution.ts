// The Source Attribution Wizard engine: for every fact in a document's sentences, draft where it
// comes from in the case's sources. Every draft is a *proposed* tie that a person verifies.
import { CaseStore } from '../core/case';
import { makeSelector } from '../core/anchor';
import { Anchor, Claim, ClaimKind, Id, Source, Tie, Todo, AiHistoryEntry } from '../core/types';
import { newId, nowIso } from '../core/util';
import { splitSentences } from '../text/sentences';
import { AiBackend, CallInfo, CitedBlock } from './backend';
import { verifyQuote } from './gate';
import { PassageIndex, selectPassages } from './retrieve';

/** A source, or one passage of it, as sent to the model. `offset` maps the passage back into the source's text. */
export interface DocSlice { source: Source; offset: number; text: string; title: string }

export const wholeSource = (s: Source): DocSlice => ({ source: s, offset: 0, text: s.text, title: s.title });

export type Granularity = 'sentence' | 'fact';
export type DraftKind = 'supports' | 'contradicts' | 'mentions';

export interface AttributionOptions {
  documentId: Id;
  /** Sources to search. Default: every evidence source that is not confidential and has text. */
  sourceIds?: Id[];
  granularity: Granularity;
  /** Skip sentences that already have a claim. */
  onlyUnclaimed: boolean;
  /** Ask for kinds of records to look for when no source in the case bears on a fact. */
  suggestLeads: boolean;
  /** Facts per request. */
  batchSize?: number;
  /** Characters of source text per request; larger sets are split into groups. */
  maxSourceChars?: number;
  /**
   * 'passages' (default): passages chosen on the device for each batch of facts are sent.
   * 'documents': the whole text of every chosen source is sent (needs the Whole documents privacy level).
   */
  scope?: 'passages' | 'documents';
  /** Additional AIs; each one's proposals pass the gate separately (Several AIs). */
  extraBackends?: AiBackend[];
  /** With several AIs: keep a draft only if at least this many AIs proposed it (agreement mode). */
  minAgreement?: number;
  signal?: AbortSignal;
  onProgress?: (p: { phase: string; done: number; total: number; message?: string }) => void;
}

export interface DraftAttribution {
  sourceId: Id;
  start: number;
  end: number;
  exact: string;
  kind: DraftKind;
  rationale: string;
  via: 'citation' | 'quote';
  proposedBy: string[];
}

export interface DraftFact {
  key: string;
  sentenceIndex: number;
  sentenceStart: number;
  sentenceEnd: number;
  sentence: string;
  fact: string;
  kind: ClaimKind;
  /** Position of the fact's own words in the document (falls back to the sentence). */
  docStart: number;
  docEnd: number;
  attributions: DraftAttribution[];
  leads: string[];
  outcome: 'found' | 'none' | 'not-checkable' | 'error';
  error?: string;
}

export interface AttributionResult {
  facts: DraftFact[];
  /** Passages sent in passages scope. */
  passagesSent?: number;
  /** Drafts dropped because too few AIs proposed them (agreement mode). */
  belowAgreement?: number;
  discarded: { factKey: string; sourceTitle: string; quote: string; reason: string }[];
  calls: CallInfo[];
  skippedSources: string[];
}

const KINDS: ClaimKind[] = ['fact', 'number', 'date', 'identity', 'relationship', 'quotation', 'opinion', 'other'];

const FACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['facts'],
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sentence', 'fact', 'kind', 'words'],
        properties: {
          sentence: { type: 'integer', description: 'The sentence number the fact comes from.' },
          fact: { type: 'string', description: 'The fact restated as one short, self-contained statement.' },
          kind: { type: 'string', enum: KINDS },
          words: { type: 'string', description: 'The exact words of the sentence that state this fact, copied character for character.' },
        },
      },
    },
  },
};

const EXTRACT_SYSTEM = `You split sentences into the separate facts a fact-checker would verify.
A fact is one checkable assertion: a number, date, name, place, relationship, quotation, event or attribute.
Opinions, predictions and rhetorical statements are not facts; give them kind "opinion" only if they are explicitly attributed claims worth checking, otherwise leave them out.
Do not add facts the sentence does not state. Do not merge facts from different sentences.
"words" must be copied exactly from the sentence.`;

const ATTRIBUTE_SYSTEM = `You are drafting a source attribution for a fact-checker. You receive source documents and a numbered list of facts taken from a piece of writing.
For each fact, find where in the documents it comes from. Rules:
- Start each fact's section with its marker on its own line, for example [F3].
- Under it, write one or more short sentences. Begin each with exactly one of: SUPPORTS, CONTRADICTS, MENTIONS, NOT FOUND.
- Every SUPPORTS, CONTRADICTS or MENTIONS sentence must cite the exact passage in the documents. Cite the narrowest passage that bears on the fact.
- SUPPORTS means the passage states the same thing. CONTRADICTS means it states something incompatible. MENTIONS means relevant but does not settle it.
- If nothing in the documents bears on the fact, write NOT FOUND. Never use outside knowledge, and never guess.
- Keep explanations brief: what the passage says and why it bears on the fact.`;

const LEADS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['leads'],
  properties: {
    leads: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fact', 'suggestions'],
        properties: {
          fact: { type: 'integer' },
          suggestions: { type: 'array', items: { type: 'string' }, description: 'Kinds of records or places to look, each one line.' },
        },
      },
    },
  },
};

function guessKind(s: string): ClaimKind {
  if (/["“”].{3,}["“”]/.test(s)) return 'quotation';
  if (/\b(1[5-9]\d\d|20\d\d)\b/.test(s) || /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/.test(s)) return 'date';
  if (/\d/.test(s)) return 'number';
  return 'fact';
}

/** Evidence sources the wizard can send: not confidential, with text. */
export function eligibleSources(store: CaseStore, ids?: Id[]): { use: Source[]; skipped: string[] } {
  const pool = (ids ? ids.map((i) => store.data.sources[i]).filter(Boolean) : store.evidence) as Source[];
  const use: Source[] = [];
  const skipped: string[] = [];
  for (const s of pool) {
    if (s.role !== 'source') continue;
    if (s.confidential) skipped.push(`${s.title} (confidential)`);
    else if (!s.text.trim()) skipped.push(`${s.title} (no text: run Recognize Text or Transcribe first)`);
    else use.push(s);
  }
  return { use, skipped };
}

/** Split sources into groups that fit the per-request size. A source larger than the limit is sent alone. */
export function groupSources(sources: Source[], maxChars: number): Source[][] {
  const groups: Source[][] = [];
  let cur: Source[] = [];
  let n = 0;
  for (const s of sources) {
    if (cur.length && n + s.text.length > maxChars) {
      groups.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(s);
    n += s.text.length;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

function sourceContext(s: Source): string {
  const c = s.citation;
  return [c.authors?.join('; '), c.title ?? s.title, c.container, c.year ?? s.dateMade, c.repository].filter(Boolean).join(', ');
}

/** Parse a cited answer into per-fact draft attributions. Exported for tests. */
export function parseCitedAnswer(blocks: CitedBlock[], factCount: number): { fact: number; kind: DraftKind | 'none'; citations: { documentIndex: number; citedText: string; start?: number; end?: number }[]; rationale: string }[] {
  const out: { fact: number; kind: DraftKind | 'none'; citations: any[]; rationale: string }[] = [];
  let fact = -1;
  let verdict: DraftKind | 'none' | null = null;
  let current: (typeof out)[number] | null = null;
  const flush = () => {
    if (current && (current.citations.length || current.kind === 'none')) out.push(current);
    current = null;
  };
  for (const b of blocks) {
    // A block may contain a marker and/or a verdict word; citations attach to the latest verdict.
    const re = /\[F(\d+)\]|\b(SUPPORTS|CONTRADICTS|MENTIONS|NOT FOUND)\b/g;
    let m: RegExpExecArray | null;
    let lastIdx = 0;
    while ((m = re.exec(b.text))) {
      if (current) current.rationale += b.text.slice(lastIdx, m.index);
      lastIdx = m.index + m[0].length;
      if (m[1]) {
        flush();
        const n = Number(m[1]);
        fact = n >= 1 && n <= factCount ? n : -1;
        verdict = null;
      } else if (fact > 0) {
        flush();
        verdict = m[2] === 'SUPPORTS' ? 'supports' : m[2] === 'CONTRADICTS' ? 'contradicts' : m[2] === 'MENTIONS' ? 'mentions' : 'none';
        current = { fact, kind: verdict, citations: [], rationale: '' };
      }
    }
    if (current) {
      current.rationale += b.text.slice(lastIdx);
      if (b.citations.length) current.citations.push(...b.citations);
    } else if (b.citations.length && fact > 0) {
      // Cited text with no verdict word: count it as a mention.
      current = { fact, kind: verdict && verdict !== 'none' ? verdict : 'mentions', citations: [...b.citations], rationale: b.text };
    }
  }
  flush();
  for (const o of out) o.rationale = o.rationale.replace(/\s+/g, ' ').trim().replace(/^[:;,.\-–—\s]+/, '');
  return out;
}

const QUOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fact', 'verdict', 'source', 'quote', 'why'],
        properties: {
          fact: { type: 'integer' },
          verdict: { type: 'string', enum: ['SUPPORTS', 'CONTRADICTS', 'MENTIONS', 'NOT FOUND'] },
          source: { type: 'integer', description: 'Source number, or 0 when NOT FOUND.' },
          quote: { type: 'string', description: 'The exact words copied from the source, or empty when NOT FOUND.' },
          why: { type: 'string' },
        },
      },
    },
  },
};

async function attributeBatch(
  backend: AiBackend,
  facts: DraftFact[],
  sources: DocSlice[],
  signal: AbortSignal | undefined,
  result: AttributionResult,
) {
  const list = facts.map((f, i) => `[F${i + 1}] ${f.fact}`).join('\n');
  const prompt = `Facts to attribute:\n${list}\n\nGo through every fact, in order.`;
  type Raw = { fact: number; kind: DraftKind | 'none'; citations: { documentIndex: number; citedText: string; start?: number; end?: number }[]; rationale: string };
  let parsed: Raw[];
  if (backend.cited) {
    const r = await backend.cited({
      system: ATTRIBUTE_SYSTEM,
      documents: sources.map((d) => ({ title: d.title, text: d.text, context: sourceContext(d.source) })),
      prompt,
      signal,
    });
    result.calls.push(r.info);
    parsed = parseCitedAnswer(r.blocks, facts.length);
  } else {
    const docs = sources.map((d, i) => `<source number="${i + 1}" title="${d.title.replace(/"/g, "'")}">\n${d.text}\n</source>`).join('\n');
    const r = await backend.json<{ items: { fact: number; verdict: string; source: number; quote: string; why: string }[] }>({
      system: ATTRIBUTE_SYSTEM + '\nReturn JSON items instead of prose; "quote" must be copied exactly from the source.',
      prompt: `${docs}\n\n${prompt}`,
      schema: QUOTE_SCHEMA,
      signal,
    });
    result.calls.push(r.info);
    parsed = r.data.items.map((it) => ({
      fact: it.fact,
      kind: it.verdict === 'SUPPORTS' ? 'supports' : it.verdict === 'CONTRADICTS' ? 'contradicts' : it.verdict === 'MENTIONS' ? 'mentions' : 'none',
      citations: it.source > 0 && it.quote ? [{ documentIndex: it.source - 1, citedText: it.quote }] : [],
      rationale: it.why,
    }));
  }
  for (const p of parsed) {
    const f = facts[p.fact - 1];
    if (!f || p.kind === 'none') continue;
    for (const c of p.citations) {
      const d = sources[c.documentIndex];
      if (!d) continue;
      const s = d.source;
      const g = verifyQuote(s, c.citedText, c.start !== undefined && c.end !== undefined ? { start: d.offset + c.start, end: d.offset + c.end } : undefined);
      if (!g.ok) {
        result.discarded.push({ factKey: f.key, sourceTitle: s.title, quote: c.citedText, reason: g.reason ?? 'not found' });
        continue;
      }
      const same = f.attributions.find((a) => a.sourceId === s.id && a.start === g.start && a.end === g.end && a.kind === p.kind);
      if (same) {
        if (!same.proposedBy.includes(backend.model)) same.proposedBy.push(backend.model);
        continue;
      }
      f.attributions.push({
        sourceId: s.id, start: g.start, end: g.end, exact: s.text.slice(g.start, g.end), kind: p.kind,
        rationale: p.rationale, via: c.start !== undefined ? 'citation' : 'quote', proposedBy: [backend.model],
      });
    }
  }
}

/** Phase 1: the facts of each sentence (or the sentences themselves). */
export async function draftFacts(store: CaseStore, backend: AiBackend | null, opts: AttributionOptions, result: AttributionResult): Promise<DraftFact[]> {
  const doc = store.data.sources[opts.documentId];
  if (!doc) throw new Error('No such document.');
  const claimed = (s: number, e: number) => store.claims.some((c) => c.doc?.documentId === doc.id && c.doc.start < e && c.doc.end > s);
  const sentences = splitSentences(doc.text)
    .map((s, i) => ({ ...s, index: i }))
    .filter((s) => /[A-Za-z0-9]/.test(s.text) && s.text.trim().length > 3)
    .filter((s) => !(opts.onlyUnclaimed && claimed(s.start, s.end)));
  const mk = (s: (typeof sentences)[number], fact: string, kind: ClaimKind, start: number, end: number): DraftFact => ({
    key: newId('f'), sentenceIndex: s.index, sentenceStart: s.start, sentenceEnd: s.end, sentence: s.text, fact, kind,
    docStart: start, docEnd: end, attributions: [], leads: [], outcome: 'none',
  });
  if (opts.granularity === 'sentence' || !backend) return sentences.map((s) => mk(s, s.text.trim(), guessKind(s.text), s.start, s.end));
  const out: DraftFact[] = [];
  const CH = 40;
  for (let i = 0; i < sentences.length; i += CH) {
    opts.signal?.throwIfAborted();
    const chunk = sentences.slice(i, i + CH);
    opts.onProgress?.({ phase: 'Finding the facts in each sentence', done: i, total: sentences.length });
    const prompt = chunk.map((s, j) => `(${j + 1}) ${s.text.trim()}`).join('\n');
    const r = await backend.json<{ facts: { sentence: number; fact: string; kind: string; words: string }[] }>({
      system: EXTRACT_SYSTEM, prompt: `Sentences:\n${prompt}`, schema: FACT_SCHEMA, signal: opts.signal,
    });
    result.calls.push(r.info);
    const seen = new Set<number>();
    for (const f of r.data.facts) {
      const s = chunk[f.sentence - 1];
      if (!s || !f.fact?.trim()) continue;
      seen.add(f.sentence - 1);
      // The fact's words must really be in the sentence; otherwise anchor to the whole sentence.
      const w = (f.words ?? '').trim();
      const at = w ? s.text.indexOf(w) : -1;
      const kind = (KINDS.includes(f.kind as ClaimKind) ? f.kind : 'fact') as ClaimKind;
      out.push(mk(s, f.fact.trim(), kind, at >= 0 ? s.start + at : s.start, at >= 0 ? s.start + at + w.length : s.end));
    }
    chunk.forEach((s, j) => {
      if (!seen.has(j)) {
        const d = mk(s, s.text.trim(), 'opinion', s.start, s.end);
        d.outcome = 'not-checkable';
        out.push(d);
      }
    });
  }
  return out;
}

/** Run the whole wizard (without writing to the case). */
export async function runAttribution(store: CaseStore, backend: AiBackend, opts: AttributionOptions): Promise<AttributionResult> {
  const result: AttributionResult = { facts: [], discarded: [], calls: [], skippedSources: [] };
  const { use, skipped } = eligibleSources(store, opts.sourceIds);
  result.skippedSources = skipped;
  if (!use.length) throw new Error('No sources with text to search. Add sources, or run Recognize Text on scans first.');
  const facts = await draftFacts(store, backend, opts, result);
  result.facts = facts;
  const work = facts.filter((f) => f.outcome !== 'not-checkable');
  const B = opts.batchSize ?? 12;
  const backends = [backend, ...(opts.extraBackends ?? [])];
  const scope = opts.scope ?? 'passages';
  // Documents: whole sources, in groups that fit a request. Passages: chosen per batch on the device.
  const groups: (DocSlice[] | null)[] = scope === 'documents' ? groupSources(use, opts.maxSourceChars ?? 400_000).map((g) => g.map(wholeSource)) : [null];
  const index = scope === 'passages' ? new PassageIndex(use) : null;
  const total = Math.ceil(work.length / B) * groups.length * backends.length;
  let done = 0;
  for (const be of backends)
    for (const g of groups)
      for (let i = 0; i < work.length; i += B) {
        opts.signal?.throwIfAborted();
        opts.onProgress?.({ phase: `Looking for sources (${be.model})`, done, total });
        const batch = work.slice(i, i + B);
        let docs = g;
        if (!docs) {
          docs = selectPassages(index!, batch.map((f) => f.fact), 4, opts.maxSourceChars ?? 60_000).map((c) => {
            const src = index!.sources.get(c.sourceId)!;
            return { source: src, offset: c.start, text: c.text, title: `${src.title} (${c.label || 'passage'})` };
          });
          result.passagesSent = (result.passagesSent ?? 0) + docs.length;
        }
        try {
          if (docs.length) await attributeBatch(be, batch, docs, opts.signal, result);
        } catch (e: any) {
          if (e?.name === 'AbortError') throw e;
          for (const f of batch) { f.outcome = 'error'; f.error = String(e?.message ?? e); }
        }
        done++;
      }
  if (opts.minAgreement && opts.minAgreement > 1)
    for (const f of work) {
      const kept = f.attributions.filter((a) => a.proposedBy.length >= opts.minAgreement!);
      result.belowAgreement = (result.belowAgreement ?? 0) + f.attributions.length - kept.length;
      f.attributions = kept;
    }
  for (const f of work) if (f.outcome !== 'error') f.outcome = f.attributions.length ? 'found' : 'none';
  if (opts.suggestLeads) {
    const none = work.filter((f) => f.outcome === 'none');
    for (let i = 0; i < none.length; i += 25) {
      opts.signal?.throwIfAborted();
      opts.onProgress?.({ phase: 'Suggesting where to look', done: i, total: none.length });
      const batch = none.slice(i, i + 25);
      try {
        const r = await backend.json<{ leads: { fact: number; suggestions: string[] }[] }>({
          system: 'You suggest kinds of records and places a researcher could search to verify a fact. Suggest searches only; never state whether the fact is true.',
          prompt: batch.map((f, j) => `(${j + 1}) ${f.fact}`).join('\n'),
          schema: LEADS_SCHEMA,
          signal: opts.signal,
        });
        result.calls.push(r.info);
        for (const l of r.data.leads) if (batch[l.fact - 1]) batch[l.fact - 1].leads = l.suggestions.slice(0, 6);
      } catch (e: any) {
        if (e?.name === 'AbortError') throw e;
      }
    }
  }
  opts.onProgress?.({ phase: 'Done', done: total, total });
  return result;
}

export interface ApplyOptions { createClaims: boolean; includeMentions: boolean; leadsAsTodos: boolean; user: string; command?: string }

/** Write the drafts into the case as claims, anchors and *proposed* ties, in one undoable step. */
export function applyAttribution(store: CaseStore, documentId: Id, result: AttributionResult, opts: ApplyOptions): { claims: number; ties: number; todos: number } {
  const doc = store.data.sources[documentId];
  const counts = { claims: 0, ties: 0, todos: 0 };
  const model = [...new Set(result.calls.map((c) => c.model))].join(', ');
  const service = [...new Set(result.calls.map((c) => c.service))].join(', ');
  store.transact('Draft sources with AI', (tx) => {
    let n = store.nextClaimNumber();
    const parents = new Map<number, Id>();
    for (const f of result.facts) {
      if (f.outcome === 'not-checkable' && !opts.createClaims) continue;
      // Find or create the claim.
      let claim = store.claims.find((c) => c.doc?.documentId === documentId && c.doc.start === f.docStart && c.doc.end === f.docEnd);
      if (!claim) {
        if (!opts.createClaims) continue;
        const isAtom = f.fact !== f.sentence.trim();
        let parentId: Id | undefined;
        if (isAtom) {
          parentId = parents.get(f.sentenceIndex);
          if (!parentId) {
            const existingParent = store.claims.find((c) => c.doc?.documentId === documentId && c.doc.start === f.sentenceStart && c.doc.end === f.sentenceEnd);
            if (existingParent) parentId = existingParent.id;
            else {
              const p: Claim = {
                id: newId('c'), number: n++, text: f.sentence.trim(), kind: 'fact', importance: 'normal', dependsOn: [], tags: ['sentence'],
                doc: { documentId, start: f.sentenceStart, end: f.sentenceEnd, textAtCapture: doc.text.slice(f.sentenceStart, f.sentenceEnd) },
                created: nowIso(),
              };
              tx.put('claims', p);
              counts.claims++;
              parentId = p.id;
            }
            parents.set(f.sentenceIndex, parentId);
          }
        }
        claim = {
          id: newId('c'), number: n++, text: f.fact, kind: f.kind, importance: 'normal', dependsOn: [], tags: f.outcome === 'not-checkable' ? ['not checkable'] : [],
          doc: { documentId, start: f.docStart, end: f.docEnd, textAtCapture: doc.text.slice(f.docStart, f.docEnd) },
          parentId, created: nowIso(),
        };
        tx.put('claims', claim);
        counts.claims++;
        if (parentId) {
          const p = (store.data.claims[parentId] ?? null) as Claim | null;
          if (p && !p.dependsOn.includes(claim.id)) tx.update<Claim>('claims', parentId, { dependsOn: [...p.dependsOn, claim.id] });
        }
      }
      for (const a of f.attributions) {
        if (a.kind === 'mentions' && !opts.includeMentions) continue;
        const src = store.data.sources[a.sourceId];
        const dup = store.ties.find((t) => t.claimId === claim!.id && t.anchorId && store.data.anchors[t.anchorId]?.sourceId === a.sourceId && store.data.anchors[t.anchorId]?.start === a.start && store.data.anchors[t.anchorId]?.end === a.end);
        if (dup) continue;
        const anchor: Anchor = { id: newId('a'), sourceId: a.sourceId, ...makeSelector(src.text, a.start, a.end), knowledge: 'unknown', sourceHash: src.contentHash, created: nowIso() };
        tx.put('anchors', anchor);
        const tie: Tie = {
          id: newId('t'), claimId: claim.id, anchorId: anchor.id, kind: a.kind, directness: 'direct', state: 'proposed',
          proposedBy: { type: 'ai', who: opts.user, service, model: a.proposedBy.join(', '), command: opts.command ?? 'ai.attributionWizard' },
          rationale: a.rationale, created: nowIso(),
        };
        tx.put('ties', tie);
        counts.ties++;
      }
      if (opts.leadsAsTodos)
        for (const l of f.leads) {
          const td: Todo = { id: newId('td'), text: `Look for: ${l}`, claimId: claim.id, done: false, created: nowIso(), ai: true };
          tx.put('todos', td);
          counts.todos++;
        }
    }
    const h: AiHistoryEntry = {
      id: newId('ai'), at: nowIso(), command: opts.command ?? 'ai.attributionWizard', service, model,
      sent: `${result.facts.length} facts from “${doc.title}” against ${result.calls.length} request(s)`,
      sentChars: result.calls.reduce((s, c) => s + c.sentChars, 0),
      received: `${counts.ties} proposed ties`, proposals: counts.ties + result.discarded.length, discarded: result.discarded.length,
    };
    tx.put('aiHistory', h);
  });
  return counts;
}
