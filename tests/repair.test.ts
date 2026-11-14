import { describe, it, expect } from 'vitest';
import { makeDocx, makePdf } from './fixtures-io';
import { repairSourceFile, textFromContent, pdfLiteral, scanPdfStreams } from '../src/repair/index';
import { simpleWellFormed } from '../src/readers/legacy/salvage';

describe('Repair Source File', () => {
  it('recovers a .docx whose central directory is destroyed', async () => {
    const good = await makeDocx(['The census was taken in April 1910.', 'Second paragraph.']);
    const eocd = good.length - 22;
    const bad = good.slice(0, eocd - 40); // cut the end of the central directory and the end record
    const r = await repairSourceFile('draft.docx', bad);
    expect(r.ok).toBe(true);
    expect(r.result!.text).toContain('The census was taken in April 1910.');
    expect(r.repairedName).toBe('draft (repaired).docx');
    expect(r.report.some((l) => l.startsWith('ZIP salvage'))).toBe(true);
  });

  it('recovers text from a .docx whose document.xml is cut off', async () => {
    const good = await makeDocx(['First complete paragraph here.', 'Second paragraph that will be cut.']);
    const JSZip = (await import('jszip')).default;
    const z = await JSZip.loadAsync(good);
    const xml = await z.file('word/document.xml')!.async('string');
    z.file('word/document.xml', xml.slice(0, xml.indexOf('Second paragraph') + 10));
    const bad = await z.generateAsync({ type: 'uint8array' });
    const r = await repairSourceFile('cut.docx', bad);
    expect(r.ok).toBe(true);
    expect(r.result!.text).toContain('First complete paragraph here.');
  });

  it('reads a PDF with a broken cross-reference table through the stream scan', async () => {
    const good = await makePdf(['Baptized 3 May 1903 at St. John.', 'Page two text.']);
    const latin = new TextDecoder('latin1').decode(good);
    // Destroy the xref table, the trailer and the startxref pointer.
    const x = latin.lastIndexOf('xref');
    const broken = new Uint8Array(good.length);
    broken.set(good);
    for (let i = x; i < good.length; i++) broken[i] = 0x20;
    const r = await repairSourceFile('register.pdf', broken);
    expect(r.ok).toBe(true);
    expect(r.result!.text).toContain('Baptized 3 May 1903 at St. John.');
    expect(r.result!.text).toContain('Page two text.');
    expect(r.result!.segments.length).toBeGreaterThanOrEqual(2);
  });

  it('decodes text with invalid UTF-8 and NULs', async () => {
    const bytes = new Uint8Array([...new TextEncoder().encode('Line one '), 0xff, 0xfe, 0x00, ...new TextEncoder().encode('line two\nThird line')]);
    const r = await repairSourceFile('notes.txt', bytes);
    expect(r.ok).toBe(true);
    expect(r.result!.text).not.toContain('\0');
    expect(r.result!.text).toContain('line two');
    expect(r.report.some((l) => l.startsWith('Text decoding'))).toBe(true);
  });
});

describe('PDF text operators', () => {
  it('handles literal escapes, octal, hex strings and TJ spacing', () => {
    expect(String.fromCharCode(...pdfLiteral('a\\(b\\)\\n\\101'))).toBe('a(b)\nA');
    const t = textFromContent('BT /F1 12 Tf 72 700 Td (Hello) Tj [(Wor) -50 (ld) -300 (again)] TJ T* <4F4B> Tj ET');
    // No positioning between Tj and TJ: the strings run together; a TJ gap wider than 200 units is a space.
    expect(t).toBe('HelloWorld again\nOK');
  });
  it('finds nothing in a file with no streams', () => {
    expect(scanPdfStreams(new TextEncoder().encode('%PDF-1.4\n%%EOF')).text).toBe('');
  });
});

describe('XML well-formedness fallback', () => {
  it('accepts good XML and rejects broken XML', () => {
    expect(simpleWellFormed('<?xml version="1.0"?><a x="1"><b/>t &amp; u</a>')).toBe(true);
    expect(simpleWellFormed('<a><b></a>')).toBe(false);
    expect(simpleWellFormed('<a>&bogus;</a>')).toBe(false);
    expect(simpleWellFormed('<a>cut off')).toBe(false);
  });
});
