// Lines of descent between sources, and independence.
import { CaseData, Id } from './types';

/** The source and every source it descends from. */
export function ancestors(data: CaseData, id: Id): Set<Id> {
  const out = new Set<Id>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    for (const d of data.sources[cur]?.derivedFrom ?? []) stack.push(d.sourceId);
  }
  return out;
}

/** Two sources are independent when neither descends from the other and they share no ancestor. */
export function independent(data: CaseData, a: Id, b: Id): boolean {
  if (a === b) return false;
  const A = ancestors(data, a);
  for (const x of ancestors(data, b)) if (A.has(x)) return false;
  return true;
}

/** Group sources into families that share ancestry; each family counts once. */
export function families(data: CaseData, ids: Id[]): Id[][] {
  const uniq = [...new Set(ids)];
  const groups: Id[][] = [];
  for (const id of uniq) {
    const hit = groups.filter((g) => g.some((x) => !independent(data, x, id)));
    if (!hit.length) groups.push([id]);
    else {
      const merged = hit.flat().concat(id);
      for (const h of hit) groups.splice(groups.indexOf(h), 1);
      groups.push(merged);
    }
  }
  return groups;
}

/** Cycles in the derived-from graph (a data error). */
export function lineageCycles(data: CaseData): Id[][] {
  const cycles: Id[][] = [];
  const state: Record<Id, number> = {};
  const path: Id[] = [];
  const visit = (id: Id) => {
    state[id] = 1;
    path.push(id);
    for (const d of data.sources[id]?.derivedFrom ?? []) {
      if (state[d.sourceId] === 1) cycles.push(path.slice(path.indexOf(d.sourceId)));
      else if (!state[d.sourceId]) visit(d.sourceId);
    }
    path.pop();
    state[id] = 2;
  };
  for (const id of Object.keys(data.sources)) if (!state[id]) visit(id);
  return cycles;
}
