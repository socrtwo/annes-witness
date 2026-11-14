import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { CaseStore } from '../src/core/case';
import { saveCase, loadCase, verifySeal, exportTextFolder, importTextFolder, importTextFolderJournal, salvageZip } from '../src/io/container';
import type { Claim, Source } from '../src/core/types';

const now = '2026-11-14T00:00:00Z';
function build() {
  const st = new CaseStore();
  const s: Source = {
    id: 's1', role: 'source', title: 'Census 1910', kind: 'text', embedded: true, added: now, fileName: 'census.txt',
    citation: { title: 'Census 1910' }, classification: 'original', derivedFrom: [], confidential: false, tags: [], text: 'Mary Ann, age 8.', segments: [],
  };
  st.transact('add source', (tx) => tx.put('sources', s));
  st.transact('add claim', (tx) =>
    tx.put<Claim>('claims', { id: 'c1', number: 1, text: 'Mary Ann was born in 1902.', kind: 'date', importance: 'high', dependsOn: [], tags: ['birth'], notes: 'Check baptism.', created: now }));
  st.transact('reckon', (tx) => tx.put('reckonings', { id: 'r1', claimId: 'c1', rows: [], conclusion: 'Census preferred.', history: [] }));
  const blobs = new Map([['s1', new TextEncoder().encode('Mary Ann, age 8.')]]);
  return { st, blobs };
}

describe('.witness container', () => {
  it('round-trips data, journal and embedded files', async () => {
    const { st, blobs } = build();
    const bytes = await saveCase(st.data, st.journal, blobs);
    const r = await loadCase(bytes);
    expect(r.data).toEqual(st.data);
    expect(r.journal).toHaveLength(3);
    expect(new TextDecoder().decode(r.blobs.get('s1'))).toBe('Mary Ann, age 8.');
    expect(r.sealed).toBe(false);
    expect(r.report).toEqual([]);
  });

  it('seals and detects tampering', async () => {
    const { st, blobs } = build();
    const bytes = await saveCase(st.data, st.journal, blobs, { seal: { by: 'Reviewer' } });
    expect(await verifySeal(bytes)).toEqual({ ok: true, sealed: true, differences: [] });
    const zip = await JSZip.loadAsync(bytes);
    zip.file('case.json', (await zip.file('case.json')!.async('string')).replace('1902', '1903'));
    zip.file('extra.txt', 'x');
    const v = await verifySeal(await zip.generateAsync({ type: 'uint8array' }));
    expect(v.ok).toBe(false);
    expect(v.differences).toContain('Changed after sealing: case.json');
    expect(v.differences).toContain('Added after sealing: extra.txt');
    const unsealed = await saveCase(st.data, st.journal, blobs);
    expect((await verifySeal(unsealed)).sealed).toBe(false);
  });

  it('rebuilds from the journal when case.json is damaged, skipping bad journal lines', async () => {
    const { st, blobs } = build();
    const zip = await JSZip.loadAsync(await saveCase(st.data, st.journal, blobs));
    zip.file('case.json', '{"format": "annes-wit');
    const j = await zip.file('journal.jsonl')!.async('string');
    zip.file('journal.jsonl', j + '{broken line\n');
    const r = await loadCase(await zip.generateAsync({ type: 'uint8array' }));
    expect(r.data.claims.c1.text).toBe('Mary Ann was born in 1902.');
    expect(r.data.sources.s1.title).toBe('Census 1910');
    expect(r.report.some((l) => l.includes('case.json is damaged'))).toBe(true);
    expect(r.report.some((l) => l.includes('damaged; skipped'))).toBe(true);
    expect(r.report.some((l) => l.includes('rebuilt from 3 journal entries'))).toBe(true);
  });

  it('salvages entries from a truncated, corrupted ZIP', async () => {
    const { st, blobs } = build();
    const bytes = await saveCase(st.data, st.journal, blobs);
    // Drop the central directory (end of file) so the ZIP no longer opens normally.
    const cut = bytes.slice(0, bytes.length - 60);
    const r = await loadCase(cut);
    expect(r.report[0]).toMatch(/damaged/);
    expect(r.data.claims.c1?.text ?? r.data.claims.c1).toBeTruthy();
    const entries = await salvageZip(cut);
    expect(entries.has('journal.jsonl')).toBe(true);
  });

  it('rejects files that are not cases', async () => {
    await expect(loadCase(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });

  it('exports and imports a text folder', async () => {
    const { st } = build();
    const bytes = await exportTextFolder(st.data, st.journal);
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('case/claims/0001.md')).toBeTruthy();
    expect(await zip.file('case/sources/s1.txt')!.async('string')).toBe('Mary Ann, age 8.');
    const back = await importTextFolder(bytes);
    expect(back).toEqual(st.data);
    expect(await importTextFolderJournal(bytes)).toHaveLength(3);
  });
});
