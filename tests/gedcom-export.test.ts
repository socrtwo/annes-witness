import { describe, it, expect } from 'vitest';
import { exportGedcomCitations, gedLines } from '../src/io/gedcom-export';
import { parseGedcomCitations } from '../src/ui/gedcomCitations';
import { buildSample } from '../src/ui/sample';
import { makeSelector } from '../src/core/anchor';

function caseWithTie() {
  const d = buildSample();
  const census = Object.values(d.sources).find((s) => s.title.startsWith('1910'))!;
  census.confidential = false;
  const claim = Object.values(d.claims).sort((a, b) => a.number - b.number)[0];
  const i = census.text.indexOf('born about 1902');
  d.anchors.a1 = { id: 'a1', sourceId: census.id, ...makeSelector(census.text, i, i + 15), knowledge: 'unknown', created: 'x' };
  d.ties.t1 = { id: 't1', claimId: claim.id, anchorId: 'a1', kind: 'supports', directness: 'direct', state: 'confirmed', confidence: 'high', proposedBy: { type: 'person', who: 'me' }, created: 'x' };
  d.ties.t2 = { id: 't2', claimId: claim.id, anchorId: 'a1', kind: 'supports', directness: 'direct', state: 'proposed', proposedBy: { type: 'ai', who: 'me' }, created: 'x' };
  return d;
}

describe('GEDCOM export', () => {
  it('writes a valid 5.5.1 skeleton with sources, notes and citations', () => {
    const ged = exportGedcomCitations(caseWithTie(), { date: new Date('2026-11-14T00:00:00Z') });
    const lines = ged.trimEnd().split('\n');
    expect(lines[0]).toBe('0 HEAD');
    expect(lines).toContain('2 VERS 5.5.1');
    expect(lines).toContain('1 CHAR UTF-8');
    expect(lines).toContain('1 DATE 14 NOV 2026');
    expect(lines[lines.length - 1]).toBe('0 TRLR');
    for (const l of lines) {
      expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(255);
      expect(l).toMatch(/^\d+ (@[^@]+@ )?[A-Z_0-9]+( .*)?$/);
    }
    // Levels never jump by more than one.
    for (let i = 1; i < lines.length; i++) expect(Number(lines[i].split(' ')[0])).toBeLessThanOrEqual(Number(lines[i - 1].split(' ')[0]) + 1);
    // Only the confirmed tie is cited, with its location, quote and quality.
    const n1 = ged.slice(ged.indexOf('0 @N1@ NOTE'), ged.indexOf('0 @N2@'));
    expect(n1.match(/1 SOUR @S\d+@/g)).toHaveLength(1);
    expect(n1).toContain('2 PAGE line 4');
    expect(n1).toContain('3 TEXT born about 1902');
    expect(n1).toContain('2 QUAY 3');
  });

  it('round-trips source records through the GEDCOM citation reader', () => {
    const d = caseWithTie();
    const parsed = parseGedcomCitations(exportGedcomCitations(d));
    const titles = Object.values(d.sources).filter((s) => s.role === 'source' && !s.confidential).map((s) => s.citation.title || s.title);
    expect(parsed.sources.map((s) => s.title).sort()).toEqual(titles.sort());
    expect(parsed.sources.find((s) => s.title.includes('Register of Baptisms'))?.repository).toBeUndefined(); // REPO carries a NOTE, not a value
  });

  it('leaves out confidential sources and their citations unless asked', () => {
    const d = caseWithTie();
    Object.values(d.sources).find((s) => s.title.startsWith('1910'))!.confidential = true;
    const ged = exportGedcomCitations(d);
    expect(ged).not.toContain('1910 census, household of John Smith');
    expect(ged).not.toContain('born about 1902');
    expect(exportGedcomCitations(d, { includeConfidential: true })).toContain('born about 1902');
  });

  it('splits long values with CONC and line breaks with CONT, escaping @', () => {
    const long = 'word '.repeat(120) + 'end';
    const ls = gedLines(1, 'TEXT', long + '\nsecond line with a@b');
    expect(ls[0].startsWith('1 TEXT word')).toBe(true);
    expect(ls.some((l) => l.startsWith('2 CONC '))).toBe(true);
    expect(ls).toContain('2 CONT second line with a@@b');
    const rebuilt = ls.map((l, i) => (i === 0 ? l.slice(7) : l.startsWith('2 CONT') ? '\n' + l.slice(7) : l.slice(7))).join('');
    expect(rebuilt).toBe((long + '\nsecond line with a@@b'));
    for (const l of ls) expect(l.length).toBeLessThanOrEqual(255);
  });
});
