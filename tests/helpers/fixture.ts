import { CaseStore } from '../../src/core/case';
import { makeSelector } from '../../src/core/anchor';
import { Anchor, Claim, Source, Tie } from '../../src/core/types';

export const now = '2026-11-14T00:00:00Z';

export function src(id: string, text: string, extra: Partial<Source> = {}): Source {
  return {
    id, role: 'source', title: id, kind: 'text', embedded: true, added: now, citation: {}, classification: 'unknown',
    derivedFrom: [], confidential: false, tags: [], text, segments: [{ start: 0, end: text.length, label: 'p. 1', page: 1 }], ...extra,
  };
}
export function claim(id: string, n: number, text: string, extra: Partial<Claim> = {}): Claim {
  return { id, number: n, text, kind: 'fact', importance: 'normal', dependsOn: [], tags: [], created: now, ...extra };
}
export function anchor(id: string, s: Source, exact: string, extra: Partial<Anchor> = {}): Anchor {
  const i = s.text.indexOf(exact);
  if (i < 0) throw new Error(`"${exact}" not in ${s.id}`);
  return { id, sourceId: s.id, ...makeSelector(s.text, i, i + exact.length), knowledge: 'unknown', created: now, ...extra };
}
export function tie(id: string, claimId: string, anchorId: string | undefined, kind: Tie['kind'] = 'supports', extra: Partial<Tie> = {}): Tie {
  return { id, claimId, anchorId, kind, directness: 'direct', state: 'confirmed', proposedBy: { type: 'person', who: 'me' }, created: now, ...extra };
}

/** Build a case from sources, claims and [claimId, sourceId, exact, kind] ties. */
export function build(sources: Source[], claims: Claim[], ties: [string, string, string, Tie['kind']?, Partial<Tie>?][] = []) {
  const st = new CaseStore();
  st.transact('fixture', (tx) => {
    for (const s of sources) tx.put('sources', s);
    for (const c of claims) tx.put('claims', c);
    ties.forEach(([cid, sid, exact, kind, extra], i) => {
      const s = sources.find((x) => x.id === sid)!;
      tx.put('anchors', anchor(`a${i}`, s, exact));
      tx.put('ties', tie(`t${i}`, cid, `a${i}`, kind ?? 'supports', extra));
    });
  });
  return st;
}
