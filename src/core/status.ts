// Status is computed from confirmed ties and written conclusions, never typed. See ARCHITECTURE-PLAN.md.
import { CaseData, Claim, Id, Status, Tie } from './types';
import { families } from './lineage';

export interface StatusResult {
  status: Status;
  reasons: string[];
  supportingSources: Id[];
  contradictingSources: Id[];
  independentFamilies: number;
}

/** Optional per-tie test (for example a Quote Check). Return a message when the tie fails. */
export type TieTest = (tie: Tie, data: CaseData) => string | null;

const RANK: Record<Status, number> = {
  'set-aside': 5, corroborated: 4, settled: 3, supported: 3, disputed: 1, stale: 1, open: 0,
};

function staleReasons(data: CaseData, claim: Claim, ties: Tie[]): string[] {
  const out: string[] = [];
  if (claim.doc) {
    const doc = data.sources[claim.doc.documentId];
    if (doc && doc.text.slice(claim.doc.start, claim.doc.end) !== claim.doc.textAtCapture)
      out.push('The claim’s wording in its document changed after it was captured.');
  }
  for (const t of ties) {
    if (t.claimTextAtConfirm !== undefined && t.claimTextAtConfirm !== claim.text)
      out.push(`Claim wording changed after tie ${t.id} was confirmed.`);
    const a = t.anchorId ? data.anchors[t.anchorId] : undefined;
    if (a?.broken) out.push(`An anchor in “${data.sources[a.sourceId]?.title ?? '?'}” could not be found again.`);
    if (a && t.sourceHashAtConfirm) {
      const s = data.sources[a.sourceId];
      if (s?.contentHash && s.contentHash !== t.sourceHashAtConfirm)
        out.push(`Source “${s.title}” changed after a tie to it was confirmed.`);
    }
  }
  return out;
}

export function computeStatus(data: CaseData, claimId: Id, tieTest?: TieTest, seen = new Set<Id>()): StatusResult {
  const claim = data.claims[claimId];
  const empty = { supportingSources: [], contradictingSources: [], independentFamilies: 0 };
  if (!claim) return { status: 'open', reasons: ['No such claim.'], ...empty };
  if (claim.setAside)
    return { status: 'set-aside', reasons: [`Set aside: ${claim.setAside.reason}`], ...empty };

  const confirmed = Object.values(data.ties).filter((t) => t.claimId === claimId && t.state === 'confirmed');
  const reasons: string[] = [];
  const sup = new Set<Id>();
  const con = new Set<Id>();
  let claimSupport = false;
  for (const t of confirmed) {
    const a = t.anchorId ? data.anchors[t.anchorId] : undefined;
    let kind: 'for' | 'against' | null = null;
    if (t.kind === 'supports') kind = 'for';
    else if (t.kind === 'contradicts') kind = 'against';
    else if (t.kind === 'absence') kind = t.absenceCounts === 'for' ? 'for' : t.absenceCounts === 'against' ? 'against' : null;
    else if (t.kind === 'sum-of' || t.kind === 'claim') {
      claimSupport = true;
      continue;
    }
    if (!kind || !a) continue;
    if (tieTest) {
      const fail = tieTest(t, data);
      if (fail) {
        reasons.push(fail);
        continue;
      }
    }
    (kind === 'for' ? sup : con).add(a.sourceId);
  }

  const stale = staleReasons(data, claim, confirmed);
  const fam = families(data, [...sup]);
  let status: Status;
  if (stale.length) {
    status = 'stale';
    reasons.push(...stale);
  } else if (sup.size && con.size) {
    const rk = Object.values(data.reckonings).find((r) => r.claimId === claimId);
    if (rk?.conclusion?.trim() && rk.preferredAnchorId) {
      status = 'settled';
      reasons.push('Sources disagree; a written conclusion prefers one reading.');
    } else {
      status = 'disputed';
      reasons.push('Confirmed ties both support and contradict this claim.');
    }
  } else if (con.size) {
    status = 'disputed';
    reasons.push('Only contradicting evidence is tied.');
  } else if (sup.size || claimSupport) {
    if (fam.length >= 2) {
      status = 'corroborated';
      reasons.push(`Supported by ${fam.length} independent source families.`);
    } else {
      status = 'supported';
      if (sup.size > 1) reasons.push('Several supporting sources, but they descend from a common original.');
      else reasons.push(sup.size ? 'One supporting source.' : 'Rests on other claims.');
    }
  } else {
    status = 'open';
    reasons.push(confirmed.length ? 'Ties only mention; nothing supports or contradicts.' : 'Nothing is tied yet.');
  }

  // A conclusion is no stronger than the weakest claim it rests on.
  const deps = new Set<Id>([...claim.dependsOn, ...confirmed.flatMap((t) => (t.kind === 'claim' && t.targetClaimId ? [t.targetClaimId] : t.kind === 'sum-of' ? t.partClaimIds ?? [] : []))]);
  if (deps.size && !seen.has(claimId)) {
    seen.add(claimId);
    for (const d of deps) {
      if (!data.claims[d]) continue;
      const ds = computeStatus(data, d, tieTest, seen);
      if (ds.status !== 'set-aside' && RANK[ds.status] < RANK[status]) {
        reasons.push(`Limited by claim ${data.claims[d].number} (${ds.status}).`);
        status = ds.status === 'disputed' || ds.status === 'stale' ? ds.status : 'open';
      }
    }
  }
  return { status, reasons, supportingSources: [...sup], contradictingSources: [...con], independentFamilies: fam.length };
}

export function allStatuses(data: CaseData, tieTest?: TieTest): Record<Id, StatusResult> {
  const out: Record<Id, StatusResult> = {};
  for (const id of Object.keys(data.claims)) out[id] = computeStatus(data, id, tieTest);
  return out;
}

export function statusCounts(statuses: Record<Id, StatusResult>): Record<Status, number> {
  const c: Record<Status, number> = { open: 0, supported: 0, corroborated: 0, disputed: 0, settled: 0, stale: 0, 'set-aside': 0 };
  for (const s of Object.values(statuses)) c[s.status]++;
  return c;
}
