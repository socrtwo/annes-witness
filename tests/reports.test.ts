import { describe, it, expect } from 'vitest';
import { Claim } from '../src/core/types';
import { allStatuses } from '../src/core/status';
import { formatCitation, formatBibliography } from '../src/reports/citation';
import { proofSummary } from '../src/reports/proof';
import { claimTableCsv, openItems, sourceList, researchLogReport, confidentialLog, hashReport, chronology, citationContext, wordFrequency } from '../src/reports/tables';
import { coverageHtml } from '../src/reports/coverage';
import { evidenceMapSvg, lineageSvg } from '../src/reports/map';
import { changeReport } from '../src/reports/changes';
import { claimReviewJsonLd } from '../src/reports/claimreview';
import { readerKitHtml } from '../src/reports/kit';
import { agreement, sampleClaims } from '../src/reports/review';
import { runChecks } from '../src/checks';
import { parseCsv } from '../src/core/util';
import { build, src, claim, tie } from './helpers/fixture';

function sample() {
  const census = src('census', 'Mary Ann Smith, age 8, born about 1902 in Ohio.', {
    title: '1910 census, Ohio', classification: 'original', dateMade: '1910', citation: { type: 'record', title: '1910 census, Ohio', repository: 'National Archives', callNumber: 'T624' },
  });
  const register = src('register', 'Baptized 3 May 1903: Mary Ann, daughter of John Smith.', { title: 'St. John parish register', classification: 'original', dateMade: '1903' });
  const secret = src('secret', 'Private letter: Mary was born 1902.', { title: 'Private letter', confidential: true });
  const doc = src('doc', 'Mary Ann Smith was born in 1902. She lived in Ohio. <script>x</script>', { role: 'document', title: 'Family history draft' });
  const st = build([census, register, secret, doc], [
    claim('c1', 1, 'Mary Ann Smith was born in 1902.', { doc: { documentId: 'doc', start: 0, end: 32, textAtCapture: 'Mary Ann Smith was born in 1902.' }, verdict: 'Mostly supported' }),
    claim('c2', 2, 'She lived in Ohio.', { doc: { documentId: 'doc', start: 33, end: 51, textAtCapture: 'She lived in Ohio.' }, owner: 'Ann' }),
    claim('c3', 3, 'Her income was $1,000.', { kind: 'number' }),
  ], [
    ['c1', 'census', 'born about 1902'],
    ['c1', 'register', 'Baptized 3 May 1903', 'contradicts'],
    ['c1', 'secret', 'Mary was born 1902'],
  ]);
  st.transact('ai proposal', (tx) => {
    tx.put('anchors', { id: 'ax', sourceId: 'census', start: 37, end: 46, exact: 'born ... Ohio', prefix: '', suffix: '', knowledge: 'unknown', created: '' });
    tx.put('ties', tie('tai', 'c2', 'ax', 'supports', { state: 'proposed', proposedBy: { type: 'ai', who: 'Claude' } }));
    tx.put('reckonings', { id: 'r', claimId: 'c1', rows: [], preferredAnchorId: 'a0', conclusion: 'The census is nearer the event & independent.', history: [] });
    tx.put('log', { id: 'l', date: '2026-01-02', searched: 'Death index', where: 'Ohio archives', forWhat: 'Mary Ann Smith', result: 'not-found' });
  });
  return st;
}

describe('citations', () => {
  it('formats author-date and notes styles', () => {
    const f = { type: 'article' as const, authors: ['Jane Q. Public', 'Ann Lee'], title: 'Census errors', container: 'Journal of Records', volume: '12', issue: '3', pages: '45–67', year: '1999', doi: '10.1/x' };
    expect(formatCitation(f, 'author-date')).toBe('Public, Jane Q. and Ann Lee (1999). “Census errors”. *Journal of Records* 12(3): 45–67. https://doi.org/10.1/x');
    expect(formatCitation(f, 'notes')).toMatch(/^Jane Q. Public and Ann Lee, “Census errors”, \*Journal of Records\* 12, no. 3 \(1999\), 45–67/);
    expect(formatCitation({ title: 'Untitled record' }, 'author-date')).toBe('*Untitled record* (n.d.).');
    expect(formatBibliography([src('b', '', { title: 'Beta' }), src('a', '', { title: 'Alpha' })], 'author-date')[0]).toMatch(/Alpha/);
  });
});

describe('reports', () => {
  const st = sample();
  const statuses = allStatuses(st.data);
  it('proof summary includes evidence and conclusions, never proposals or confidential sources', () => {
    const p = proofSummary(st.data, statuses);
    expect(p.markdown).toMatch(/## Claim 1: Settled/);
    expect(p.markdown).toMatch(/> born about 1902/);
    expect(p.markdown).toMatch(/Evidence against/);
    expect(p.markdown).toMatch(/prefers 1910 census, Ohio/);
    expect(p.markdown).not.toMatch(/Private letter/);
    expect(p.markdown).not.toMatch(/born \.\.\. Ohio/);
    expect(p.html).toMatch(/&amp; independent/);
    expect(proofSummary(st.data, statuses, { includeConfidential: true }).markdown).toMatch(/Private letter/);
  });
  it('tables and lists', () => {
    const csv = parseCsv(claimTableCsv(st.data, statuses));
    expect(csv[0][0]).toBe('Claim');
    expect(csv[1][3]).toBe('Settled');
    expect(csv[1][4]).toBe('1910 census, Ohio');
    expect(csv[1][12]).toBe('Mostly supported');
    const oi = openItems(st.data, statuses, runChecks(st.data));
    expect(oi).toMatch(/Claim 2: She lived in Ohio. \(owner: Ann\)/);
    expect(sourceList(st.data)).not.toMatch(/Private letter/);
    expect(researchLogReport(st.data)).toMatch(/\| Death index \| Ohio archives/);
    expect(confidentialLog(st.data)).toMatch(/Private letter: 1 anchor/);
    expect(hashReport(st.data).split('\r\n')[0]).toMatch(/File SHA-256/);
    const chron = chronology(st.data);
    expect(chron.indexOf('Claim 1')).toBeLessThan(chron.indexOf('St. John parish register'));
    expect(citationContext(st.data)).toMatch(/Supporting 1 · Contradicting 0/);
    expect(wordFrequency(['the mill the mill mill closed'], 2)).toEqual([{ word: 'mill', count: 3 }, { word: 'closed', count: 1 }]);
  });
  it('coverage, map, lineage and reader kit HTML are escaped and complete', () => {
    const cov = coverageHtml(st.data, statuses, 'doc');
    expect(cov).toMatch(/2 of 3 sentences/);
    expect(cov).not.toMatch(/<script>x/);
    expect(cov).toMatch(/&lt;script&gt;/);
    const svg = evidenceMapSvg(st.data, statuses);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toMatch(/stroke-dasharray="8 4"/);
    expect(svg).not.toMatch(/Private letter/);
    const lst = { ...st.data, sources: { ...st.data.sources, copy: src('copy', 'x', { title: 'Index', derivedFrom: [{ sourceId: 'census', how: 'index' }] }) } };
    expect(lineageSvg(lst)).toMatch(/marker-end/);
    const kit = readerKitHtml(st.data, statuses, 'doc');
    expect(kit).toMatch(/<details id="claim-1"/);
    expect(kit).toMatch(/born about 1902/);
    expect(kit).not.toMatch(/<script>x/);
    expect(kit).not.toMatch(/<script/);
  });
  it('change report and ClaimReview', () => {
    const before = st.seq;
    st.transact('reword', (tx) => tx.update<Claim>('claims', 'c2', { text: 'She lived in Ohio in 1910.' }));
    st.transact('add', (tx) => tx.put('claims', claim('c9', 9, 'New claim')));
    const r = changeReport(st.journal, before, st.seq, st.data);
    expect(r).toMatch(/Changed claim 2: She lived in Ohio in 1910. \(text\)/);
    expect(r).toMatch(/Added claim 9/);
    const j = JSON.parse(claimReviewJsonLd(st.data, { author: 'Desk', url: 'https://ex.org/a', date: '2026-11-14' }));
    expect(j).toMatchObject({ '@type': 'ClaimReview', claimReviewed: 'Mary Ann Smith was born in 1902.', reviewRating: { alternateName: 'Mostly supported' }, url: 'https://ex.org/a#claim-1' });
  });
});

describe('review statistics', () => {
  it('computes Cohen kappa on a known table', () => {
    // 50 items: both yes 20, A yes B no 5, A no B yes 10, both no 15 -> po=0.7, pe=0.5, kappa=0.4
    const a: Record<string, any> = {};
    const b: Record<string, any> = {};
    let i = 0;
    const add = (n: number, x: any, y: any) => { for (let k = 0; k < n; k++) { a[i] = x; b[i] = y; i++; } };
    add(20, 'supports', 'supports'); add(5, 'supports', null); add(10, null, 'supports'); add(15, null, null);
    const r = agreement(a, b);
    expect(r.n).toBe(50);
    expect(r.observed).toBeCloseTo(0.7);
    expect(r.expected).toBeCloseTo(0.5);
    expect(r.kappa).toBeCloseTo(0.4);
    expect(r.table.supports.none).toBe(5);
  });
  it('samples reproducibly, monetary units by size', () => {
    const st = build([], [claim('a', 1, 'Paid $10.'), claim('b', 2, 'Paid $10,000.'), claim('c', 3, 'Paid $5.'), claim('d', 4, 'No figure.')]);
    expect(sampleClaims(st.data, 2, 'random', 7)).toEqual(sampleClaims(st.data, 2, 'random', 7));
    expect(sampleClaims(st.data, 2, 'random', 7)).toHaveLength(2);
    expect(sampleClaims(st.data, 1, 'monetary', 3)).toEqual(['b']);
    expect(sampleClaims(st.data, 3, 'monetary', 3)).not.toContain('d');
  });
});
