// Find support or contradictions for existing claims (Find group), reusing the attribution parser.
import { Claim, Source } from '../core/types';
import { AiBackend, CallInfo } from './backend';
import { parseCitedAnswer, DraftKind } from './attribution';
import { verifyQuote } from './gate';

export interface ClaimFinding {
  claimId: string;
  attributions: { sourceId: string; start: number; end: number; kind: DraftKind; rationale: string }[];
}

const SYSTEM = (focus: 'any' | 'contradicts') => `You check claims against source documents.
For each numbered claim, start with its marker on its own line, for example [F2]. Then write short sentences, each beginning with SUPPORTS, CONTRADICTS, MENTIONS or NOT FOUND, citing the exact passage.
${focus === 'contradicts' ? 'Look especially for passages that state something incompatible with the claim.' : ''}
Use only the documents. If nothing bears on a claim, write NOT FOUND.`;

export async function attributeClaims(
  be: AiBackend, claims: Claim[], sources: Source[],
  result: { facts: ClaimFinding[]; discarded: any[]; calls: CallInfo[] },
  focus: 'any' | 'contradicts', signal?: AbortSignal,
) {
  for (let i = 0; i < claims.length; i += 12) {
    const batch = claims.slice(i, i + 12);
    const prompt = batch.map((c, j) => `[F${j + 1}] ${c.text}`).join('\n');
    let parsed: ReturnType<typeof parseCitedAnswer>;
    if (be.cited) {
      const r = await be.cited({ system: SYSTEM(focus), documents: sources.map((s) => ({ title: s.title, text: s.text })), prompt, signal });
      result.calls.push(r.info);
      parsed = parseCitedAnswer(r.blocks, batch.length);
    } else {
      const docs = sources.map((s, k) => `<source number="${k + 1}" title="${s.title}">\n${s.text}\n</source>`).join('\n');
      const r = await be.json<{ items: { fact: number; verdict: string; source: number; quote: string; why: string }[] }>({
        system: SYSTEM(focus) + '\nReturn JSON items; "quote" must be copied exactly.',
        prompt: `${docs}\n\n${prompt}`,
        schema: { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['fact', 'verdict', 'source', 'quote', 'why'], properties: { fact: { type: 'integer' }, verdict: { type: 'string', enum: ['SUPPORTS', 'CONTRADICTS', 'MENTIONS', 'NOT FOUND'] }, source: { type: 'integer' }, quote: { type: 'string' }, why: { type: 'string' } } } } } },
        signal,
      });
      result.calls.push(r.info);
      parsed = r.data.items.map((it) => ({
        fact: it.fact,
        kind: (it.verdict === 'SUPPORTS' ? 'supports' : it.verdict === 'CONTRADICTS' ? 'contradicts' : it.verdict === 'MENTIONS' ? 'mentions' : 'none') as any,
        citations: it.source > 0 ? [{ documentIndex: it.source - 1, citedText: it.quote }] : [],
        rationale: it.why,
      }));
    }
    for (const p of parsed) {
      const c = batch[p.fact - 1];
      if (!c || p.kind === 'none') continue;
      let f = result.facts.find((x) => x.claimId === c.id);
      if (!f) { f = { claimId: c.id, attributions: [] }; result.facts.push(f); }
      for (const ct of p.citations) {
        const s = sources[ct.documentIndex];
        if (!s) continue;
        const g = verifyQuote(s, ct.citedText, { start: ct.start, end: ct.end });
        if (!g.ok) { result.discarded.push({ claimId: c.id, source: s.title, quote: ct.citedText, reason: g.reason }); continue; }
        f.attributions.push({ sourceId: s.id, start: g.start, end: g.end, kind: p.kind as DraftKind, rationale: p.rationale });
      }
    }
  }
}
