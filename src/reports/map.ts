// Evidence Map and Lineage diagrams as standalone SVG.
import { CaseData, Id, STATUS_LABEL, TieKind } from '../core/types';
import { StatusResult } from '../core/status';
import { escapeHtml, truncate } from '../core/util';
import { claimsSorted, STATUS_COLOR } from './common';

const TIE_STYLE: Record<TieKind, { color: string; dash: string }> = {
  supports: { color: '#1f7a3d', dash: '' },
  contradicts: { color: '#c0392b', dash: '8 4' },
  mentions: { color: '#888888', dash: '2 4' },
  absence: { color: '#7a6aa8', dash: '1 6' },
  'sum-of': { color: '#2c6fa8', dash: '12 3 2 3' },
  claim: { color: '#2c6fa8', dash: '6 3' },
};

export function evidenceMapSvg(d: CaseData, statuses: Record<Id, StatusResult>, includeConfidential = false): string {
  const claims = claimsSorted(d);
  const srcs = Object.values(d.sources).filter((s) => s.role === 'source' && (includeConfidential || !s.confidential));
  const ties = Object.values(d.ties).filter((t) => t.state === 'confirmed');
  // Order sources by the average position of the claims they serve (fewer crossings).
  const pos = new Map(claims.map((c, i) => [c.id, i]));
  const weight = (sid: Id) => {
    const xs = ties.filter((t) => t.anchorId && d.anchors[t.anchorId]?.sourceId === sid).map((t) => pos.get(t.claimId) ?? 0);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1e9;
  };
  srcs.sort((a, b) => weight(a.id) - weight(b.id));
  const rowH = 34;
  const W = 900;
  const cx = 20;
  const cw = 360;
  const sx = 520;
  const sw = 360;
  const H = Math.max(claims.length, srcs.length) * rowH + 70;
  const sy = new Map(srcs.map((s, i) => [s.id, 50 + i * rowH]));
  const cy = new Map(claims.map((c, i) => [c.id, 50 + i * rowH]));
  const e = escapeHtml;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, sans-serif" font-size="12">`,
    `<rect width="${W}" height="${H}" fill="#fff"/>`,
    `<text x="${cx}" y="24" font-weight="bold" font-size="14">Claims</text><text x="${sx}" y="24" font-weight="bold" font-size="14">Sources</text>`,
  ];
  for (const t of ties) {
    const y1 = cy.get(t.claimId);
    if (y1 === undefined) continue;
    const st = TIE_STYLE[t.kind];
    if (t.kind === 'claim' || t.kind === 'sum-of') {
      for (const target of t.kind === 'claim' ? [t.targetClaimId] : t.partClaimIds ?? []) {
        const y2 = target ? cy.get(target) : undefined;
        if (y2 === undefined) continue;
        out.push(`<path d="M${cx} ${y1 + 12} C ${cx - 18} ${y1 + 12}, ${cx - 18} ${y2 + 12}, ${cx} ${y2 + 12}" fill="none" stroke="${st.color}" stroke-dasharray="${st.dash}" stroke-width="1.5"><title>${e(t.kind)}</title></path>`);
      }
      continue;
    }
    const a = t.anchorId ? d.anchors[t.anchorId] : undefined;
    const y2 = a ? sy.get(a.sourceId) : undefined;
    if (y2 === undefined) continue;
    out.push(`<path d="M${cx + cw} ${y1 + 12} C ${(cx + cw + sx) / 2} ${y1 + 12}, ${(cx + cw + sx) / 2} ${y2 + 12}, ${sx} ${y2 + 12}" fill="none" stroke="${st.color}" stroke-dasharray="${st.dash}" stroke-width="1.6"><title>${e(t.kind)}${t.tick ? ' ' + e(t.tick) : ''}</title></path>`);
  }
  for (const c of claims) {
    const y = cy.get(c.id)!;
    const st = statuses[c.id]?.status ?? 'open';
    out.push(`<g><rect x="${cx}" y="${y}" width="${cw}" height="24" rx="4" fill="#fff" stroke="${STATUS_COLOR[st]}" stroke-width="2"/>`,
      `<text x="${cx + 8}" y="${y + 16}">${e(`${c.number}. ${truncate(c.text, 52)}`)}</text><title>${e(c.text)} — ${e(STATUS_LABEL[st])}</title></g>`);
  }
  for (const s of srcs) {
    const y = sy.get(s.id)!;
    out.push(`<g><rect x="${sx}" y="${y}" width="${sw}" height="24" rx="4" fill="#f5f2ea" stroke="#9c6b0e"/>`,
      `<text x="${sx + 8}" y="${y + 16}">${e(truncate(s.title, 54))}</text><title>${e(s.title)} (${e(s.classification)})</title></g>`);
  }
  let lx = cx;
  const ly = H - 14;
  for (const [k, st] of Object.entries(TIE_STYLE)) {
    out.push(`<line x1="${lx}" y1="${ly - 4}" x2="${lx + 26}" y2="${ly - 4}" stroke="${st.color}" stroke-dasharray="${st.dash}" stroke-width="2"/><text x="${lx + 30}" y="${ly}">${e(k)}</text>`);
    lx += 120;
  }
  out.push('</svg>');
  return out.join('\n');
}

export function lineageSvg(d: CaseData): string {
  const srcs = Object.values(d.sources).filter((s) => s.role === 'source');
  const ids = new Set(srcs.map((s) => s.id));
  // Layer = longest path from an original.
  const layer = new Map<Id, number>();
  const depth = (id: Id, seen = new Set<Id>()): number => {
    if (layer.has(id)) return layer.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = (d.sources[id]?.derivedFrom ?? []).filter((p) => ids.has(p.sourceId));
    const v = parents.length ? Math.max(...parents.map((p) => depth(p.sourceId, seen) + 1)) : 0;
    layer.set(id, v);
    return v;
  };
  srcs.forEach((s) => depth(s.id));
  const layers: Id[][] = [];
  for (const s of srcs) (layers[layer.get(s.id)!] ??= []).push(s.id);
  const bw = 200;
  const bh = 40;
  const gap = 30;
  const vgap = 70;
  const W = Math.max(1, ...layers.map((l) => l?.length ?? 0)) * (bw + gap) + gap;
  const H = layers.length * (bh + vgap) + 40;
  const xy = new Map<Id, { x: number; y: number }>();
  layers.forEach((l, i) => (l ?? []).forEach((id, j) => xy.set(id, { x: gap + j * (bw + gap), y: 20 + i * (bh + vgap) })));
  const e = escapeHtml;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, sans-serif" font-size="12">`,
    '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#555"/></marker></defs>',
    `<rect width="${W}" height="${H}" fill="#fff"/>`];
  for (const s of srcs)
    for (const p of s.derivedFrom) {
      const a = xy.get(p.sourceId);
      const b = xy.get(s.id);
      if (!a || !b) continue;
      out.push(`<line x1="${a.x + bw / 2}" y1="${a.y + bh}" x2="${b.x + bw / 2}" y2="${b.y}" stroke="#555" stroke-width="1.5" marker-end="url(#arr)"/>`,
        `<text x="${(a.x + b.x) / 2 + bw / 2 + 4}" y="${(a.y + bh + b.y) / 2}" fill="#555">${e(p.how)}</text>`);
    }
  for (const s of srcs) {
    const { x, y } = xy.get(s.id)!;
    const fill = s.classification === 'original' ? '#e8f3ea' : s.classification === 'derivative' ? '#fdf2e0' : '#f3f3f3';
    out.push(`<g><rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="6" fill="${fill}" stroke="#777"/><text x="${x + 8}" y="${y + 17}">${e(truncate(s.title, 30))}</text><text x="${x + 8}" y="${y + 32}" fill="#666">${e(s.classification)}${s.dateMade ? ' · ' + e(s.dateMade) : ''}</text><title>${e(s.title)}</title></g>`);
  }
  out.push('</svg>');
  return out.join('\n');
}
