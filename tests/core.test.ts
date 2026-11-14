import { describe, it, expect } from 'vitest';
import { CaseStore } from '../src/core/case';
import { computeStatus } from '../src/core/status';
import { findPassage, makeSelector, reanchor } from '../src/core/anchor';
import { independent, families } from '../src/core/lineage';
import { Anchor, Claim, Source, Tie } from '../src/core/types';

const now = '2026-11-14T00:00:00Z';
function src(id: string, text: string, derivedFrom: string[] = []): Source {
  return {
    id, role: 'source', title: id, kind: 'text', embedded: true, added: now, citation: {}, classification: 'unknown',
    derivedFrom: derivedFrom.map((s) => ({ sourceId: s, how: 'copy' as const })), confidential: false, tags: [], text, segments: [],
  };
}
function claim(id: string, n: number, text: string): Claim {
  return { id, number: n, text, kind: 'fact', importance: 'normal', dependsOn: [], tags: [], created: now };
}
function anchor(id: string, s: Source, exact: string): Anchor {
  const i = s.text.indexOf(exact);
  return { id, sourceId: s.id, ...makeSelector(s.text, i, i + exact.length), knowledge: 'unknown', created: now };
}
function tie(id: string, claimId: string, anchorId: string, kind: Tie['kind'], state: Tie['state'] = 'confirmed'): Tie {
  return { id, claimId, anchorId, kind, directness: 'direct', state, proposedBy: { type: 'person', who: 'me' }, created: now };
}

function setup() {
  const st = new CaseStore();
  const census = src('census', 'Mary Ann Smith, age 8, born about 1902 in Ohio.');
  const register = src('register', 'Baptized 3 May 1903: Mary Ann, daughter of John Smith.');
  const index = src('index', 'Smith, Mary Ann, b. 1902', ['census']);
  st.transact('setup', (tx) => {
    for (const s of [census, register, index]) tx.put('sources', s);
    tx.put('claims', claim('c1', 1, 'Mary Ann Smith was born in 1902.'));
  });
  return { st, census, register, index };
}

describe('journal', () => {
  it('undoes and redoes a transaction, and restores to a step', () => {
    const { st } = setup();
    st.transact('rename', (tx) => tx.update<Claim>('claims', 'c1', { text: 'changed' }));
    expect(st.data.claims.c1.text).toBe('changed');
    st.undo();
    expect(st.data.claims.c1.text).toBe('Mary Ann Smith was born in 1902.');
    st.redo();
    expect(st.data.claims.c1.text).toBe('changed');
    st.restoreTo(1);
    expect(st.data.claims.c1.text).toBe('Mary Ann Smith was born in 1902.');
    expect(st.snapshotAt(2).claims.c1.text).toBe('changed');
  });
  it('rolls back a failing transaction', () => {
    const { st } = setup();
    expect(() => st.transact('bad', (tx) => { tx.delete('claims', 'c1'); throw new Error('x'); })).toThrow();
    expect(st.data.claims.c1).toBeTruthy();
  });
});

describe('status rules', () => {
  it('open, supported, corroborated, disputed, settled, stale, set aside', () => {
    const { st, census, register, index } = setup();
    expect(computeStatus(st.data, 'c1').status).toBe('open');
    st.transact('t', (tx) => {
      tx.put('anchors', anchor('a1', census, 'born about 1902'));
      tx.put('ties', tie('t1', 'c1', 'a1', 'supports'));
    });
    expect(computeStatus(st.data, 'c1').status).toBe('supported');
    // The index is copied from the census: not independent.
    st.transact('t', (tx) => {
      tx.put('anchors', anchor('a2', index, 'b. 1902'));
      tx.put('ties', tie('t2', 'c1', 'a2', 'supports'));
    });
    const r = computeStatus(st.data, 'c1');
    expect(r.status).toBe('supported');
    expect(r.independentFamilies).toBe(1);
    // A proposed tie changes nothing.
    st.transact('t', (tx) => {
      tx.put('anchors', anchor('a3', register, 'Baptized 3 May 1903'));
      tx.put('ties', tie('t3', 'c1', 'a3', 'contradicts', 'proposed'));
    });
    expect(computeStatus(st.data, 'c1').status).toBe('supported');
    st.transact('confirm', (tx) => tx.update<Tie>('ties', 't3', { state: 'confirmed' }));
    expect(computeStatus(st.data, 'c1').status).toBe('disputed');
    st.transact('reckon', (tx) => tx.put('reckonings', { id: 'r1', claimId: 'c1', rows: [], preferredAnchorId: 'a1', conclusion: 'The census is nearer the event.', history: [] }));
    expect(computeStatus(st.data, 'c1').status).toBe('settled');
    st.transact('reword', (tx) => tx.update<Tie>('ties', 't1', { claimTextAtConfirm: 'old wording' }));
    expect(computeStatus(st.data, 'c1').status).toBe('stale');
    st.transact('aside', (tx) => tx.update<Claim>('claims', 'c1', { setAside: { reason: 'opinion', by: 'me', at: now } }));
    expect(computeStatus(st.data, 'c1').status).toBe('set-aside');
  });
  it('corroborates with independent sources and caps by dependencies', () => {
    const { st, census, register } = setup();
    const reg2 = { ...register, text: 'Mary Ann Smith, born 1902, per family Bible.' };
    st.transact('t', (tx) => {
      tx.put('sources', reg2);
      tx.put('anchors', anchor('a1', census, 'born about 1902'));
      tx.put('anchors', anchor('a2', reg2, 'born 1902'));
      tx.put('ties', tie('t1', 'c1', 'a1', 'supports'));
      tx.put('ties', tie('t2', 'c1', 'a2', 'supports'));
      tx.put('claims', { ...claim('c2', 2, 'She was 8 in 1910.'), dependsOn: ['c1'] });
      tx.put('ties', { ...tie('t3', 'c2', '', 'claim'), anchorId: undefined, targetClaimId: 'c1' });
      tx.put('claims', { ...claim('c3', 3, 'Depends on an open claim'), dependsOn: ['c4'] });
      tx.put('claims', claim('c4', 4, 'Unknown'));
      tx.put('anchors', anchor('a3', census, 'Ohio'));
      tx.put('ties', tie('t4', 'c3', 'a3', 'supports'));
    });
    expect(computeStatus(st.data, 'c1').status).toBe('corroborated');
    expect(computeStatus(st.data, 'c2').status).toBe('supported');
    expect(computeStatus(st.data, 'c3').status).toBe('open');
  });
  it('honors a tie test', () => {
    const { st, census } = setup();
    st.transact('t', (tx) => {
      tx.put('anchors', anchor('a1', census, 'born about 1902'));
      tx.put('ties', tie('t1', 'c1', 'a1', 'supports'));
    });
    const r = computeStatus(st.data, 'c1', () => 'Quote differs');
    expect(r.status).toBe('open');
    expect(r.reasons).toContain('Quote differs');
  });
});

describe('lineage', () => {
  it('detects shared ancestry', () => {
    const { st } = setup();
    expect(independent(st.data, 'census', 'register')).toBe(true);
    expect(independent(st.data, 'census', 'index')).toBe(false);
    expect(families(st.data, ['census', 'index', 'register'])).toHaveLength(2);
  });
});

describe('anchors', () => {
  const text = 'The parish register records that Mary Ann was baptized on 3 May 1903 at St. John’s.';
  it('finds unchanged, moved, normalized and fuzzy passages', () => {
    const sel = makeSelector(text, text.indexOf('baptized'), text.indexOf(' at St.'));
    expect(findPassage(text, sel)?.how).toBe('unchanged');
    const moved = 'Page 2. ' + text;
    const r = findPassage(moved, sel)!;
    expect(moved.slice(r.start, r.end)).toBe(sel.exact);
    const respaced = text.replace('baptized on', 'baptized\n  on');
    expect(findPassage(respaced, sel)?.how).toBe('normalized');
    const ocrish = text.replace('baptized on 3 May', 'baptlzed on 3 Mav');
    const f = findPassage(ocrish, sel)!;
    expect(f.how).toBe('fuzzy');
    expect(ocrish.slice(f.start, f.end)).toContain('1903');
    expect(findPassage('nothing like it', sel)).toBeNull();
  });
  it('re-anchors a set of anchors', () => {
    const a: Anchor = { id: 'x', sourceId: 's', ...makeSelector(text, 0, 20), knowledge: 'unknown', created: now };
    expect(reanchor([a], 'Intro. ' + text)[0].how).toBe('exact');
    expect(reanchor([a], 'gone')[0].how).toBe('broken');
  });
});
