import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { insertNotesIntoDocx, removeWitnessNotes } from '../src/writeback/docx';
import { addTickSheet, writeCellValue } from '../src/writeback/xlsx';
import { readFile } from '../src/readers';
import { makeDocx, makeXlsx } from './fixtures-io';

describe('docx notes', () => {
  it('inserts footnotes with part, relationship and content type, then removes them', async () => {
    const doc = await makeDocx(['Mary Ann was born in 1902.', 'She married   in 1921.']);
    const r = await insertNotesIntoDocx(doc, [
      { find: 'born in 1902', note: '[W1] Census 1910, p. 3; Baptism register, 3 May 1903.' },
      { find: 'She married in 1921', note: '[W2] Marriage record.' },
      { find: 'not in the document', note: '[W3] x' },
    ]);
    expect(r.placed).toBe(2);
    expect(r.missed).toEqual(['not in the document']);
    const z = await JSZip.loadAsync(r.bytes);
    const fn = await z.file('word/footnotes.xml')!.async('string');
    expect(fn).toContain('w:type="separator" w:id="-1"');
    expect(fn).toContain('w:id="1"');
    expect(fn).toContain('[W1] Census 1910');
    const body = await z.file('word/document.xml')!.async('string');
    expect(body).toContain('<w:footnoteReference w:id="1"/>');
    expect(body).toContain('<w:footnoteReference w:id="2"/>');
    expect(await z.file('word/_rels/document.xml.rels')!.async('string')).toContain('relationships/footnotes');
    expect(await z.file('[Content_Types].xml')!.async('string')).toContain('/word/footnotes.xml');
    // The text still reads back, with the notes.
    const back = await readFile('x.docx', r.bytes);
    expect(back.text).toContain('Mary Ann was born in 1902.');
    expect(back.text).toContain('[W2] Marriage record.');
    const rm = await removeWitnessNotes(r.bytes);
    expect(rm.removed).toBe(2);
    const z2 = await JSZip.loadAsync(rm.bytes);
    expect(await z2.file('word/document.xml')!.async('string')).not.toContain('footnoteReference');
    expect(await z2.file('word/footnotes.xml')!.async('string')).not.toContain('[W1]');
  });

  it('continues numbering after existing footnotes and supports endnotes and comments', async () => {
    const doc = await makeDocx(['First line here.', 'Second line here.'], 'Existing note.');
    const r = await insertNotesIntoDocx(doc, [{ find: 'Second line', note: '[W5] Ledger.' }]);
    const z = await JSZip.loadAsync(r.bytes);
    expect(await z.file('word/document.xml')!.async('string')).toContain('<w:footnoteReference w:id="2"/>');
    const e = await insertNotesIntoDocx(doc, [{ find: 'First line', note: '[W1] e' }], 'endnote');
    const ze = await JSZip.loadAsync(e.bytes);
    expect(ze.file('word/endnotes.xml')).toBeTruthy();
    const c = await insertNotesIntoDocx(doc, [{ find: 'First line', note: '[W1] c' }], 'comment');
    const zc = await JSZip.loadAsync(c.bytes);
    const body = await zc.file('word/document.xml')!.async('string');
    expect(body).toMatch(/<w:pPr>.*?<\/w:pPr><w:commentRangeStart w:id="1"\/>/);
    expect(body).toContain('<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r>');
    expect(await zc.file('word/comments.xml')!.async('string')).toContain('w:author="Anne\'s Witness"');
    const rm = await removeWitnessNotes(c.bytes);
    expect(rm.removed).toBe(1);
    expect(await (await JSZip.loadAsync(rm.bytes)).file('word/document.xml')!.async('string')).not.toContain('comment');
  });
});

describe('xlsx write-back', () => {
  it('adds and then replaces the tick sheet', async () => {
    const wb = await makeXlsx();
    const out = await addTickSheet(wb, [{ sheet: 'Ledger', cell: 'B1', mark: '✓', claim: '1. Revenue was $1.25 million', source: 'Bank statement' }], [{ mark: '✓', meaning: 'Agreed to source' }]);
    const z = await JSZip.loadAsync(out);
    const wbx = await z.file('xl/workbook.xml')!.async('string');
    expect(wbx).toContain('<sheet name="Witness Ticks" sheetId="2"');
    expect(await z.file('[Content_Types].xml')!.async('string')).toContain('/xl/worksheets/sheet2.xml');
    const r = await readFile('o.xlsx', out);
    expect(r.text).toContain('Revenue was $1.25 million');
    expect(r.segments.find((s) => s.label === 'Witness Ticks!A5')).toBeTruthy();
    const again = await addTickSheet(out, [], [{ mark: 'Σ', meaning: 'Footed' }]);
    const z2 = await JSZip.loadAsync(again);
    expect((await z2.file('xl/workbook.xml')!.async('string')).match(/Witness Ticks/g)).toHaveLength(1);
    expect(await z2.file('xl/worksheets/sheet2.xml')!.async('string')).toContain('Footed');
  });

  it('writes cell values in place and in new rows and columns', async () => {
    let wb = await makeXlsx();
    wb = await writeCellValue(wb, 'Ledger', 'B2', 831000);
    wb = await writeCellValue(wb, 'Ledger', 'C1', 'per bank');
    wb = await writeCellValue(wb, 'Ledger', 'A3', 'Inserted');
    wb = await writeCellValue(wb, 'Ledger', 'B9', 7);
    const z = await JSZip.loadAsync(wb);
    const x = await z.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(x).toContain('<c r="B2" s="3"><v>831000</v></c>');
    expect(x).toMatch(/<row r="2">.*<\/row><row r="3"><c r="A3" t="inlineStr">.*<\/row><row r="4">/);
    expect(x).toMatch(/<row r="9"><c r="B9"><v>7<\/v><\/c><\/row><\/sheetData>/);
    const r = await readFile('w.xlsx', wb);
    expect(r.text).toContain('per bank');
    await expect(writeCellValue(wb, 'Nope', 'A1', 1)).rejects.toThrow();
  });
});
