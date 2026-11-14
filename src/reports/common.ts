import { Anchor, CaseData, Claim, Id, STATUS_LABEL, Source, Status, Tie } from '../core/types';
import { StatusResult } from '../core/status';
import { locate } from '../core/anchor';
import { escapeHtml } from '../core/util';

export const STATUS_ORDER: Status[] = ['corroborated', 'settled', 'supported', 'set-aside', 'disputed', 'stale', 'open'];
export const STATUS_COLOR: Record<Status, string> = {
  corroborated: '#1f7a3d', supported: '#5aa469', settled: '#2c6fa8', disputed: '#c0392b', stale: '#c77d0a', open: '#888888', 'set-aside': '#7a6aa8',
};
/** Strength 0..1 for shading. */
export const STRENGTH: Record<Status, number> = { corroborated: 1, settled: 0.85, supported: 0.7, 'set-aside': 0.4, stale: 0.3, disputed: 0.2, open: 0 };

export function claimsSorted(d: CaseData): Claim[] {
  return Object.values(d.claims).sort((a, b) => a.number - b.number);
}

export function visible(d: CaseData, sourceId: Id, includeConfidential = false): boolean {
  const s = d.sources[sourceId];
  return !!s && (includeConfidential || !s.confidential);
}

export interface Evidence { tie: Tie; anchor: Anchor; source: Source; where: string }

export function evidenceFor(d: CaseData, claimId: Id, kinds: Tie['kind'][], includeConfidential = false): Evidence[] {
  return Object.values(d.ties)
    .filter((t) => t.claimId === claimId && t.state === 'confirmed' && kinds.includes(t.kind) && t.anchorId)
    .map((t) => {
      const anchor = d.anchors[t.anchorId!];
      const source = anchor ? d.sources[anchor.sourceId] : undefined;
      return anchor && source ? { tie: t, anchor, source, where: locate(source, anchor.start, anchor.end) } : null;
    })
    .filter((e): e is Evidence => !!e && visible(d, e.source.id, includeConfidential));
}

export const statusWord = (r?: StatusResult) => (r ? STATUS_LABEL[r.status] : 'Open');
export const h = escapeHtml;

export function htmlPage(title: string, body: string, extraCss = ''): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(title)}</title>
<style>
:root{--fg:#1b1b1b;--bg:#fff;--muted:#666;--line:#ddd}
@media (prefers-color-scheme:dark){:root{--fg:#eee;--bg:#161616;--muted:#aaa;--line:#444}}
body{font:16px/1.55 Georgia,'Times New Roman',serif;color:var(--fg);background:var(--bg);max-width:860px;margin:2rem auto;padding:0 16px}
h1,h2,h3{font-family:system-ui,sans-serif;line-height:1.25}
blockquote{border-left:3px solid var(--line);margin:.5em 0;padding:.1em .8em;color:var(--fg)}
.muted{color:var(--muted)} .badge{font:12px system-ui,sans-serif;padding:1px 6px;border-radius:9px;color:#fff;white-space:nowrap}
table{border-collapse:collapse;width:100%} td,th{border:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}
${extraCss}
</style></head><body>
${body}
</body></html>`;
}

export function badge(s: Status): string {
  return `<span class="badge" style="background:${STATUS_COLOR[s]}">${h(STATUS_LABEL[s])}</span>`;
}

/** Citation text (with *italics*) as HTML. */
export const citeHtml = (c: string) => escapeHtml(c).replace(/\*([^*]+)\*/g, '<em>$1</em>');
