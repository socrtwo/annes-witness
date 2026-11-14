// Live test against the real Claude API. Skipped unless ANTHROPIC_API_KEY is set:
//   ANTHROPIC_API_KEY=sk-ant-... npx vitest run tests/live.test.ts
// It makes three small requests (a few cents at most) with the model in WITNESS_LIVE_MODEL (default claude-opus-5-5).
import { describe, it, expect } from 'vitest';
import { ClaudeBackend } from '../src/ai/backend';
import { runAttribution } from '../src/ai/attribution';
import { CaseStore } from '../src/core/case';
import { buildSample } from '../src/ui/sample';

const key = process.env.ANTHROPIC_API_KEY;
const model = process.env.WITNESS_LIVE_MODEL ?? 'claude-opus-5-5';

describe.skipIf(!key)('live Claude API', () => {
  it('drafts sources for the guided example, and every draft passes the gate', async () => {
    const st = new CaseStore(buildSample());
    const be = new ClaudeBackend({ id: 'anthropic', kind: 'anthropic', label: 'Claude', apiKey: key, model, effort: 'medium' });
    const doc = st.documents[0];
    const r = await runAttribution(st, be, { documentId: doc.id, granularity: 'fact', onlyUnclaimed: false, suggestLeads: false, scope: 'documents' });
    const found = r.facts.filter((f) => f.outcome === 'found');
    expect(found.length).toBeGreaterThan(0);
    for (const f of found)
      for (const a of f.attributions) expect(st.data.sources[a.sourceId].text.slice(a.start, a.end)).toBe(a.exact);
    // The birth-year fact must draw both the 1902 census and the 1903 register.
    const birth = r.facts.find((f) => /1902/.test(f.fact) && /born/i.test(f.fact));
    expect(birth?.attributions.some((a) => a.kind === 'supports')).toBe(true);
    expect(birth?.attributions.some((a) => a.kind === 'contradicts')).toBe(true);
    console.log(`live: ${r.calls.length} requests, ${found.length} facts with drafts, ${r.discarded.length} discarded; model ${r.calls.map((c) => c.model).join(', ')}`);
  }, 300_000);
});
