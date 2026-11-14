import { describe, it, expect } from 'vitest';
import { CaseStore } from '../src/core/case';
import { Source } from '../src/core/types';
import { AiBackend, CitedBlock, ClaudeBackend } from '../src/ai/backend';
import { verifyQuote } from '../src/ai/gate';
import { runAttribution, applyAttribution, parseCitedAnswer, groupSources } from '../src/ai/attribution';
import { computeStatus } from '../src/core/status';
import { screenText, redact } from '../src/ai/privacy';
import { findReferenceLines } from '../src/ai/commands';

const now = '2026-11-14T00:00:00Z';
const S = (id: string, role: 'source' | 'document', text: string, title = id): Source => ({
  id, role, title, kind: 'text', embedded: true, added: now, citation: {}, classification: 'unknown', derivedFrom: [],
  confidential: false, tags: [], text, segments: [],
});

const census = 'Household of John Smith. Mary Ann Smith, daughter, age 8, born about 1902 in Ohio.';
const register = 'Baptisms, 1903. 3 May: Mary Ann, daughter of John and Ellen Smith, born 20 April 1903.';
const docText = 'Mary Ann Smith was born in 1902 in Ohio. Her father was John Smith.';

function store() {
  const st = new CaseStore();
  st.transact('setup', (tx) => {
    tx.put('sources', S('census', 'source', census, '1910 census'));
    tx.put('sources', S('register', 'source', register, 'Parish register'));
    tx.put('sources', { ...S('secret', 'source', 'Private diary.', 'Diary'), confidential: true });
    tx.put('sources', S('doc', 'document', docText, 'Family history draft'));
  });
  return st;
}

/** A stub that answers like Claude with citations, including one invented quote the gate must drop. */
class StubBackend implements AiBackend {
  service = 'Stub';
  model = 'stub-model';
  supportsCitations = true;
  calls: any[] = [];
  async json<T>(req: any): Promise<{ data: T; info: any }> {
    this.calls.push(req);
    if (req.prompt.startsWith('Sentences:'))
      return {
        data: {
          facts: [
            { sentence: 1, fact: 'Mary Ann Smith was born in 1902.', kind: 'date', words: 'Mary Ann Smith was born in 1902' },
            { sentence: 1, fact: 'Mary Ann Smith was born in Ohio.', kind: 'fact', words: 'in Ohio' },
            { sentence: 2, fact: 'Her father was John Smith.', kind: 'relationship', words: 'Her father was John Smith' },
          ],
        } as T,
        info: { service: 'Stub', model: 'stub-model', sentChars: req.prompt.length },
      };
    return { data: { leads: [{ fact: 1, suggestions: ['Birth register for Ohio'] }] } as T, info: { service: 'Stub', model: 'stub-model', sentChars: 1 } };
  }
  async text() { return { text: '', info: { service: 'Stub', model: 'stub-model', sentChars: 0 } }; }
  async cited(req: any): Promise<{ blocks: CitedBlock[]; info: any }> {
    this.calls.push(req);
    const ci = req.documents.findIndex((d: any) => d.title.startsWith('1910 census'));
    const ri = req.documents.findIndex((d: any) => d.title.startsWith('Parish register'));
    const at = (doc: string, s: string) => { const d = req.documents.find((x: any) => doc.includes(x.source?.data ?? x.text ?? '') || (x.text ?? '').includes(s)); const text = d?.text ?? doc; return { start: text.indexOf(s), end: text.indexOf(s) + s.length }; };
    const blocks: CitedBlock[] = [
      { text: '[F1]\nSUPPORTS: the census gives ', citations: [] },
      { text: 'born about 1902', citations: [{ documentIndex: ci, citedText: 'born about 1902', ...at(census, 'born about 1902') }] },
      { text: '. CONTRADICTS: the register gives ', citations: [] },
      { text: 'born 20 April 1903', citations: [{ documentIndex: ri, citedText: 'born 20 April 1903', ...at(register, 'born 20 April 1903') }] },
      { text: '\n[F2]\nSUPPORTS: ', citations: [] },
      { text: 'in Ohio', citations: [{ documentIndex: ci, citedText: 'in Ohio', ...at(census, 'in Ohio') }] },
      { text: ' and also ', citations: [] },
      { text: 'invented', citations: [{ documentIndex: ri, citedText: 'born in Columbus, Ohio', start: 0, end: 5 }] },
      { text: '\n[F3]\nSUPPORTS: ', citations: [] },
      { text: 'daughter of John', citations: [{ documentIndex: ri, citedText: 'daughter of John and Ellen Smith', ...at(register, 'daughter of John and Ellen Smith') }] },
    ];
    return { blocks, info: { service: 'Stub', model: 'stub-model', sentChars: 100 } };
  }
}

describe('verification gate', () => {
  const s = S('x', 'source', 'The ship “Mary” arrived  on 3 May 1903.');
  it('accepts exact and normalized quotes, rejects invented ones', () => {
    expect(verifyQuote(s, 'arrived on 3 May 1903').ok).toBe(true); // whitespace normalized
    expect(verifyQuote(s, 'The ship "Mary"').ok).toBe(true); // quotes normalized
    expect(verifyQuote(s, 'arrived on 4 May 1903').ok).toBe(false);
    expect(verifyQuote(s, 'ok').ok).toBe(false);
    const at = verifyQuote(s, '3 May 1903', { start: s.text.indexOf('3 May'), end: s.text.indexOf('3 May') + 10 });
    expect(at.how).toBe('at-location');
  });
});

describe('parseCitedAnswer', () => {
  it('attaches citations to the latest marker and verdict', () => {
    const p = parseCitedAnswer(
      [
        { text: '[F1] SUPPORTS ', citations: [] },
        { text: 'x', citations: [{ documentIndex: 0, citedText: 'aaa' }] },
        { text: ' CONTRADICTS ', citations: [] },
        { text: 'y', citations: [{ documentIndex: 1, citedText: 'bbb' }] },
        { text: '\n[F2] NOT FOUND.', citations: [] },
        { text: '[F9] SUPPORTS', citations: [] },
        { text: 'z', citations: [{ documentIndex: 0, citedText: 'ccc' }] },
      ],
      2,
    );
    expect(p.filter((x) => x.fact === 1).map((x) => x.kind)).toEqual(['supports', 'contradicts']);
    expect(p.find((x) => x.fact === 2)?.kind).toBe('none');
    expect(p.some((x) => x.citations.some((c) => c.citedText === 'ccc'))).toBe(false);
  });
});

describe('attribution wizard', () => {
  it('drafts proposed ties for every fact, drops invented quotes and skips confidential sources', async () => {
    const st = store();
    const be = new StubBackend();
    const r = await runAttribution(st, be, { documentId: 'doc', granularity: 'fact', onlyUnclaimed: false, suggestLeads: true });
    expect(r.skippedSources.join()).toContain('Diary');
    expect(be.calls.some((c) => c.documents?.some((d: any) => d.title === 'Diary'))).toBe(false);
    expect(r.facts).toHaveLength(3);
    const f1 = r.facts[0];
    expect(f1.attributions.map((a) => a.kind).sort()).toEqual(['contradicts', 'supports']);
    expect(r.discarded).toHaveLength(1);
    expect(r.discarded[0].quote).toBe('born in Columbus, Ohio');

    const counts = applyAttribution(st, 'doc', r, { createClaims: true, includeMentions: true, leadsAsTodos: true, user: 'tester' });
    expect(counts.ties).toBe(4);
    expect(counts.claims).toBe(4); // one sentence claim (split in two facts) + three facts; sentence 2 is itself one fact
    const ties = st.ties;
    expect(ties.every((t) => t.state === 'proposed' && t.proposedBy.type === 'ai')).toBe(true);
    // Proposals never change status.
    for (const c of st.claims) expect(computeStatus(st.data, c.id).status).toBe('open');
    // Every anchor really points at its passage.
    for (const a of st.anchors) expect(st.data.sources[a.sourceId].text.slice(a.start, a.end)).toBe(a.exact);
    expect(Object.values(st.data.aiHistory)).toHaveLength(1);
    // One undo removes everything the wizard wrote.
    st.undo();
    expect(st.ties).toHaveLength(0);
    expect(st.claims).toHaveLength(0);
  });

  it('works in sentence mode without a fact-splitting call', async () => {
    const st = store();
    const be = new StubBackend();
    const r = await runAttribution(st, be, { documentId: 'doc', granularity: 'sentence', onlyUnclaimed: false, suggestLeads: false });
    expect(r.facts).toHaveLength(2);
    expect(be.calls.filter((c) => c.prompt?.startsWith('Sentences:'))).toHaveLength(0);
  });

  it('groups sources by size', () => {
    const a = S('a', 'source', 'x'.repeat(60)), b = S('b', 'source', 'y'.repeat(60)), c = S('c', 'source', 'z'.repeat(200));
    expect(groupSources([a, b, c], 100).map((g) => g.map((s) => s.id))).toEqual([['a'], ['b'], ['c']]);
    expect(groupSources([a, b, c], 130).map((g) => g.length)).toEqual([2, 1]);
  });
});

describe('Claude backend request shape', () => {
  it('sends text documents with citations, caches the last one, and reads char locations', async () => {
    let body: any = null;
    const fakeFetch = (async (_url: any, init: any) => {
      body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
          content: [{ type: 'text', text: 'born about 1902', citations: [{ type: 'char_location', cited_text: 'born about 1902', document_index: 0, document_title: 'c', start_char_index: 3, end_char_index: 18, file_id: null }] }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const be = new ClaudeBackend({ id: 'anthropic', kind: 'anthropic', label: 'Claude', apiKey: 'sk-test', model: 'claude-opus-5-5' }, fakeFetch);
    const r = await be.cited({ system: 'sys', documents: [{ title: 'c', text: 'aa born about 1902' }, { title: 'd', text: 'zz' }], prompt: 'q' });
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.fallbacks).toBe('default');
    const docs = body.messages[0].content.filter((b: any) => b.type === 'document');
    expect(docs[0].citations).toEqual({ enabled: true });
    expect(docs[0].source).toEqual({ type: 'text', media_type: 'text/plain', data: 'aa born about 1902' });
    expect(docs[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(docs[0].cache_control).toBeUndefined();
    expect(r.blocks[0].citations[0]).toMatchObject({ documentIndex: 0, start: 3, end: 18 });
  });
  it('raises on a refusal', async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: 'no' }, usage: { input_tokens: 1, output_tokens: 0 }, content: [] }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const be = new ClaudeBackend({ id: 'a', kind: 'anthropic', label: 'Claude', apiKey: 'k', model: 'claude-opus-5-5' }, fakeFetch);
    await expect(be.text({ system: 's', prompt: 'p' })).rejects.toThrow(/declined|no/);
  });
});

describe('privacy screen and references', () => {
  it('finds private details and redacts them', () => {
    const t = 'Write to jane@example.com or call 555-123-4567. Born: 12 March 1990.';
    const hits = screenText(t, new Date('2026-11-14'));
    expect(hits.map((h) => h.kind)).toEqual(expect.arrayContaining(['Email address', 'Phone number', 'Birth date of a possibly living person']));
    expect(redact(t, hits)).not.toContain('jane@example.com');
  });
  it('finds reference lines', () => {
    const t = 'Body text.\n\nReferences\n\nSmith, J. (2001). A history of Ohio parishes. Ohio Press.\nDoe, A. (1999). Census methods. Journal of Records 4: 1-20. doi:10.1234/abc\n';
    expect(findReferenceLines(t)).toHaveLength(2);
  });
});

import { PassageIndex, selectPassages, chunkSource } from '../src/ai/retrieve';

describe('on-device passage selection', () => {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `Line ${i} of the register lists ordinary parish business with no names of interest.`).join('\n');
  const big = S('big', 'source', filler(200) + '\nBaptized 3 May 1903: Mary Ann, daughter of John Smith, born 20 April 1903.\n' + filler(200), 'Big register');
  it('finds the passage that matters in a large source', () => {
    const ix = new PassageIndex([big]);
    expect(ix.chunks.length).toBeGreaterThan(20);
    const top = ix.search('Mary Ann Smith was born in 1903', 1)[0];
    expect(top.chunk.text).toContain('born 20 April 1903');
    const sel = selectPassages(ix, ['Mary Ann Smith was born in 1903'], 2, 5000);
    expect(sel.reduce((n, c) => n + c.text.length, 0)).toBeLessThan(big.text.length / 10);
    for (const c of sel) expect(big.text.slice(c.start, c.end)).toBe(c.text);
  });
  it('chunks cover the whole text', () => {
    const cs = chunkSource(big);
    expect(cs[0].start).toBe(0);
    expect(cs[cs.length - 1].end).toBe(big.text.length);
  });
  it('sends passages, maps citations back into the source, and applies agreement', async () => {
    const st = new CaseStore();
    st.transact('s', (tx) => { tx.put('sources', big); tx.put('sources', S('doc', 'document', 'Mary Ann Smith was born in 1903.', 'Draft')); });
    const sent: any[] = [];
    const mk = (model: string): AiBackend => ({
      service: 'Stub', model, supportsCitations: true,
      async json() { return { data: {} as any, info: { service: 'Stub', model, sentChars: 0 } }; },
      async text() { return { text: '', info: { service: 'Stub', model, sentChars: 0 } }; },
      async cited(req: any) {
        sent.push(req);
        const d = req.documents.findIndex((x: any) => x.text.includes('born 20 April 1903'));
        const t = req.documents[d].text;
        const q = 'born 20 April 1903';
        return { blocks: [{ text: '[F1] SUPPORTS ', citations: [] }, { text: q, citations: [{ documentIndex: d, citedText: q, start: t.indexOf(q), end: t.indexOf(q) + q.length }] }], info: { service: 'Stub', model, sentChars: 1 } };
      },
    });
    const r = await runAttribution(st, mk('a'), { documentId: 'doc', granularity: 'sentence', onlyUnclaimed: false, suggestLeads: false, extraBackends: [mk('b')], minAgreement: 2 });
    expect(sent[0].documents.reduce((n: number, d: any) => n + d.text.length, 0)).toBeLessThan(big.text.length / 5);
    const a = r.facts[0].attributions[0];
    expect(big.text.slice(a.start, a.end)).toBe('born 20 April 1903');
    expect(a.proposedBy).toEqual(['a', 'b']);
    const r3 = await runAttribution(st, mk('a'), { documentId: 'doc', granularity: 'sentence', onlyUnclaimed: false, suggestLeads: false, minAgreement: 2, extraBackends: [] });
    expect(r3.facts[0].attributions).toHaveLength(0);
    expect(r3.belowAgreement).toBe(1);
  });
});
