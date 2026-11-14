import { describe, it, expect } from 'vitest';
import { Tie } from '../src/core/types';
import { runChecks, quoteMatches, quickTieTest, CHECKS } from '../src/checks';
import { computeStatus } from '../src/core/status';
import { build, src, claim, tie } from './helpers/fixture';

const ids = (fs: { check: string }[]) => fs.map((f) => f.check);

describe('quote check', () => {
  const passage = 'The committee said that “the bridge is unsafe for heavy traffic and must close by June.”';
  it('accepts exact quotes, ellipsis omissions and bracketed insertions', () => {
    expect(quoteMatches('the bridge is unsafe for heavy traffic', passage).ok).toBe(true);
    expect(quoteMatches('“The bridge is unsafe … and must close by June.”', passage).ok).toBe(true);
    expect(quoteMatches('the bridge [over the river] is unsafe for heavy traffic', passage).ok).toBe(true);
  });
  it('reports word differences', () => {
    const r = quoteMatches('the bridge is dangerous for heavy traffic', passage);
    expect(r.ok).toBe(false);
    expect(r.differences.join(' ')).toMatch(/dangerous/);
  });
  it('runs on quotation claims and fails the tie test', () => {
    const s = src('minutes', passage);
    const st = build([s], [claim('c1', 1, 'the bridge is dangerous for heavy traffic', { kind: 'quotation' })], [['c1', 'minutes', 'the bridge is unsafe for heavy traffic']]);
    expect(ids(runChecks(st.data, { only: ['check.quote'] }))).toEqual(['check.quote']);
    expect(quickTieTest(st.data.ties.t0, st.data)).toMatch(/Quote Check/);
    expect(computeStatus(st.data, 'c1', quickTieTest).status).toBe('open');
  });
});

describe('number checks', () => {
  const ledger = src('ledger', 'Total revenue for 2020: $5,234,100. Costs were about 1.2 million.', { dateMade: '2021' });
  it('number, materiality, precision and units', () => {
    const st = build([ledger], [
      claim('c1', 1, 'Revenue in 2020 was $5,234,100.', { kind: 'number' }),
      claim('c2', 2, 'Revenue in 2020 was $5,234,900.', { kind: 'number' }),
      claim('c3', 3, 'Costs were exactly $1,213,456 in 2020.', { kind: 'number' }),
      claim('c4', 4, 'Revenue in 2020 was €5,234,100.', { kind: 'number' }),
    ], [
      ['c1', 'ledger', 'Total revenue for 2020: $5,234,100'],
      ['c2', 'ledger', 'Total revenue for 2020: $5,234,100'],
      ['c3', 'ledger', 'Costs were about 1.2 million'],
      ['c4', 'ledger', 'Total revenue for 2020: $5,234,100'],
    ]);
    let f = runChecks(st.data, { only: ['check.number'] });
    expect(f.filter((x) => x.claimId === 'c2')[0].severity).toBe('error');
    expect(f.some((x) => x.claimId === 'c1')).toBe(false);
    st.data.settings.materiality = 1000;
    f = runChecks(st.data, { only: ['check.number', 'check.materiality'] });
    expect(f.find((x) => x.claimId === 'c2')!.severity).toBe('info');
    expect(ids(runChecks(st.data, { only: ['check.precision'] }))).toContain('check.precision');
    expect(runChecks(st.data, { only: ['check.units'] }).find((x) => x.claimId === 'c4')?.message).toMatch(/EUR/);
    expect(quickTieTest(st.data.ties.t1, st.data)).toMatch(/Number Check/);
    expect(quickTieTest(st.data.ties.t0, st.data)).toBeNull();
  });
  it('sum check and percentage recompute', () => {
    const st = build([], [
      claim('t', 1, 'Total sales were $300.', { kind: 'number' }),
      claim('p1', 2, 'North sold $100.', { kind: 'number' }),
      claim('p2', 3, 'South sold $150.', { kind: 'number' }),
      claim('pc', 4, 'Tax was 20% of $500, or $90.', { kind: 'number' }),
      claim('pk', 5, 'Tax was 20% of $500, or $100.', { kind: 'number' }),
    ]);
    st.transact('sum', (tx) => tx.put('ties', tie('s', 't', undefined, 'sum-of', { partClaimIds: ['p1', 'p2'] })));
    const f = runChecks(st.data, { only: ['check.sum'] });
    expect(f.find((x) => x.claimId === 't')?.message).toMatch(/250/);
    expect(f.some((x) => x.claimId === 'pc')).toBe(true);
    expect(f.some((x) => x.claimId === 'pk')).toBe(false);
  });
  it('period check', () => {
    const r2019 = src('r2019', 'Members: 412', { dateMade: '2019' });
    const st = build([r2019], [claim('c', 1, 'In 2021 there were 412 members.', { kind: 'number' })], [['c', 'r2019', 'Members: 412']]);
    expect(ids(runChecks(st.data, { only: ['check.period'] }))).toContain('check.period');
  });
  it('number consistency inside a document', () => {
    const doc = src('report', 'In 2020 revenue of $5.2 million was recorded. Later we note revenue of $5.4 million for 2020.', { role: 'document' });
    expect(ids(runChecks(build([doc], []).data, { only: ['check.numberConsistency'] }))).toContain('check.numberConsistency');
  });
});

describe('date checks', () => {
  it('impossible sequences, parent ages, calendar and ages', () => {
    const census = src('census', 'Mary Ann Smith, age 8, in the 1910 census.', { dateMade: '1910' });
    const reg = src('reg', 'Baptized 5 Feb 1710/11.');
    const st = build([census, reg], [
      claim('b', 1, 'Mary Ann Smith was born 3 May 1890.'),
      claim('d', 2, 'Mary Ann Smith died 4 June 1880.'),
      claim('pb', 3, 'John Smith was born 1885.'),
      claim('rel', 4, 'Mary Ann Smith was the daughter of John Smith.'),
      claim('cal', 5, 'He was baptized 5 Feb 1710.'),
    ], [['b', 'census', 'Mary Ann Smith, age 8'], ['cal', 'reg', 'Baptized 5 Feb 1710/11']]);
    const f = runChecks(st.data, { only: ['check.dates', 'check.ages', 'check.calendar', 'check.selfContradiction'] });
    expect(f.some((x) => x.check === 'check.dates' && /died .* before being born/.test(x.message))).toBe(true);
    expect(f.some((x) => x.check === 'check.dates' && /under 12/.test(x.message))).toBe(true);
    expect(f.some((x) => x.check === 'check.ages' && /1901/.test(x.message))).toBe(true);
    expect(f.some((x) => x.check === 'check.calendar' && /old-style/.test(x.message))).toBe(true);
  });
  it('a record dated before the event', () => {
    const s = src('paper', 'Obituary of Ann Lee, died 1920', { dateMade: '1915' });
    const st = build([s], [claim('c', 1, 'Ann Lee died in 1920.')], [['c', 'paper', 'died 1920']]);
    expect(runChecks(st.data, { only: ['check.dates'] })[0].message).toMatch(/before the event/);
  });
});

describe('evidence checks', () => {
  it('independence, circularity, weak points, stale, coverage, links, rules, hedging, recency, paraphrase, names, citations', () => {
    const orig = src('orig', 'The mill employed 300 workers.', { classification: 'original', dateMade: '2010' });
    const copy = src('copy', 'The mill employed 300 workers, per the original.', { classification: 'derivative', derivedFrom: [{ sourceId: 'orig', how: 'copy' }], dateMade: '2011' });
    const loopA = src('loopA', 'A', { derivedFrom: [{ sourceId: 'loopB', how: 'copy' }] });
    const loopB = src('loopB', 'B', { derivedFrom: [{ sourceId: 'loopA', how: 'copy' }] });
    const web = src('web', 'Studies suggest the mill may have closed.', { kind: 'web', url: 'https://example.org', citation: { type: 'web' } });
    const doc = src('doc', 'The mill employed 300 workers. It closed in 1999 after a fire destroyed 40 looms.', { role: 'document' });
    const st = build([orig, copy, loopA, loopB, web, doc], [
      claim('c1', 1, 'The mill employed 300 workers.', { doc: { documentId: 'doc', start: 0, end: 30, textAtCapture: 'The mill employed 300 workers.' } }),
      claim('c2', 2, 'The fire definitely closed the mill.'),
      claim('c3', 3, 'The mill currently employs 300 workers.'),
      claim('c4', 4, 'Jon Smyth owned it.'),
      claim('c5', 5, 'John Smith owned it.'),
      claim('c6', 6, 'Weather was grand.'),
    ], [
      ['c1', 'orig', 'The mill employed 300 workers'],
      ['c1', 'copy', 'The mill employed 300 workers'],
      ['c2', 'web', 'Studies suggest the mill may have closed'],
      ['c3', 'orig', 'employed 300 workers'],
      ['c6', 'orig', 'The mill'],
    ]);
    st.transact('rule', (tx) => tx.put('rules', { id: 'r', name: 'Mill', pattern: 'mill', condition: 'minIndependent', value: 2, message: 'Needs two independent sources', enabled: true }));
    st.transact('stale', (tx) => tx.update<Tie>('ties', 't0', { claimTextAtConfirm: 'old' }));
    const f = runChecks(st.data, { today: '2026-11-14' });
    const has = (c: string, re?: RegExp) => f.some((x) => x.check === c && (!re || re.test(x.message)));
    expect(has('check.independence', /only 1 independent/)).toBe(true);
    expect(has('check.circular')).toBe(true);
    expect(has('check.weakPoints', /one source/)).toBe(true);
    expect(has('check.stale', /wording changed/)).toBe(true);
    expect(has('check.coverage', /closed in 1999/)).toBe(true);
    expect(has('check.coverage', /Claim 4 has no tie/)).toBe(true);
    expect(has('check.links')).toBe(true);
    expect(has('check.rules', /two independent/)).toBe(true);
    expect(has('check.hedging', /definitely/)).toBe(true);
    expect(has('check.recency')).toBe(true);
    expect(has('check.paraphrase', /Claim 6/)).toBe(true);
    expect(has('check.names')).toBe(true);
    expect(has('check.citations', /url|accessed/)).toBe(true);
    // Errors sort first.
    expect(f[0].severity).toBe('error');
    expect(Object.keys(CHECKS)).toHaveLength(24);
    expect(runChecks(st.data, { claimIds: ['c2'] }).every((x) => x.claimId === 'c2')).toBe(true);
  });
});
