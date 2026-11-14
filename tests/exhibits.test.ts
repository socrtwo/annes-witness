import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { CaseStore } from '../src/core/case';
import { buildExhibitBundle } from '../src/reports/exhibits';
import { readFile } from '../src/readers';
import { makePdf } from './fixtures-io';
import type { Source } from '../src/core/types';

const now = '2026-11-14T00:00:00Z';

describe('exhibit bundle', () => {
  it('builds index, covers and copied pages, with Bates numbers', async () => {
    const pdf = await makePdf(['Baptisms 1903', 'Mary Ann, 3 May 1903']);
    const read = await readFile('reg.pdf', pdf);
    const st = new CaseStore();
    const s: Source = {
      id: 's1', role: 'source', title: 'Parish register', kind: 'pdf', embedded: true, added: now, citation: { repository: 'St. John’s' },
      classification: 'original', derivedFrom: [], confidential: false, tags: [], text: read.text, segments: read.segments,
    };
    const conf: Source = { ...s, id: 's2', title: 'Private letter — Ω', kind: 'text', text: 'Secret 1902', segments: [], confidential: true };
    const p2 = read.segments.find((g) => g.page === 2)!;
    const start = read.text.indexOf('3 May 1903');
    st.transact('setup', (tx) => {
      tx.put('sources', s);
      tx.put('sources', conf);
      tx.put('claims', { id: 'c1', number: 1, text: 'Mary Ann was baptized 3 May 1903 — “Ω”.', kind: 'date', importance: 'normal', dependsOn: [], tags: [], created: now });
      tx.put('anchors', { id: 'a1', sourceId: 's1', start, end: start + 10, exact: '3 May 1903', prefix: '', suffix: '', knowledge: 'first-hand', created: now, rect: { page: 2, x: 0.1, y: 0.1, w: 0.3, h: 0.05 } });
      tx.put('anchors', { id: 'a2', sourceId: 's2', start: 0, end: 6, exact: 'Secret', prefix: '', suffix: '', knowledge: 'unknown', created: now });
      tx.put('ties', { id: 't1', claimId: 'c1', anchorId: 'a1', kind: 'supports', directness: 'direct', state: 'confirmed', proposedBy: { type: 'person', who: 'me' }, created: now });
      tx.put('ties', { id: 't2', claimId: 'c1', anchorId: 'a2', kind: 'supports', directness: 'direct', state: 'confirmed', proposedBy: { type: 'person', who: 'me' }, created: now });
    });
    expect(p2.page).toBe(2);
    const { bytes, exhibits } = await buildExhibitBundle(st.data, new Map([['s1', pdf]]), { bates: { prefix: 'AW', start: 1 } });
    expect(exhibits).toEqual([{ number: 1, anchorId: 'a1', sourceId: 's1', claims: [1] }]);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(3); // index, cover, copied page 2
    const text = (await readFile('b.pdf', bytes)).text;
    expect(text).toContain('Exhibit 1');
    expect(text).toContain('AW000003');
    const withConf = await buildExhibitBundle(st.data, new Map([['s1', pdf]]), { includeConfidential: true });
    expect(withConf.exhibits).toHaveLength(2);
    expect((await PDFDocument.load(withConf.bytes)).getPageCount()).toBe(4);
  });
});
