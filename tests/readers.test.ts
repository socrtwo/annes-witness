import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { readFile } from '../src/readers';
import { makeDocx, makeXlsx, makePptx, makePdf, makeJpegWithExif, enc } from './fixtures-io';

describe('readers', () => {
  it('reads plain text in UTF-8, UTF-16 and Latin-1 with paragraph segments', async () => {
    const r = await readFile('a.txt', enc('# Title\n\nFirst para.\n\nSecond para.'));
    expect(r.kind).toBe('text');
    expect(r.title).toBe('Title');
    expect(r.segments.map((s) => s.label)).toEqual(['¶ 1', '¶ 2', '¶ 3']);
    expect(r.text.slice(r.segments[2].start, r.segments[2].end)).toBe('Second para.');
    const u16 = new Uint8Array([0xff, 0xfe, ...[...'Hé'].flatMap((c) => [c.charCodeAt(0), 0])]);
    expect((await readFile('b.txt', u16)).text).toBe('Hé');
    expect((await readFile('c.txt', new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).text).toBe('café');
  });

  it('reads CSV cells with row and column', async () => {
    const r = await readFile('ledger.csv', enc('Item,Amount\n"Rent, office",1200\nPhone,85'));
    expect(r.kind).toBe('workbook');
    const seg = r.segments.find((s) => s.label === 'R2C1')!;
    expect(r.text.slice(seg.start, seg.end)).toBe('Rent, office');
    expect(seg.row).toBe(2);
    expect(seg.col).toBe(1);
  });

  it('reads HTML without scripts', async () => {
    const r = await readFile('p.html', enc('<html><head><title>News &amp; Notes</title><script>bad()</script></head><body><h1>Head</h1><p>Population was <b>12,400</b> in 1900.</p></body></html>'));
    expect(r.title).toBe('News & Notes');
    expect(r.text).toContain('Population was 12,400 in 1900.');
    expect(r.text).not.toContain('bad()');
  });

  it('reads MHTML', async () => {
    const m = 'MIME-Version: 1.0\r\nSnapshot-Content-Location: https://example.org/a\r\nContent-Type: multipart/related; boundary="XX"\r\n\r\n--XX\r\nContent-Type: text/html\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<p>Caf=C3=A9 opened in 1921.</p>\r\n--XX--\r\n';
    const r = await readFile('page.mhtml', enc(m));
    expect(r.text).toBe('Café opened in 1921.');
    expect(r.citation?.url).toBe('https://example.org/a');
  });

  it('reads docx paragraphs, footnotes and title', async () => {
    const r = await readFile('d.docx', await makeDocx(['Mary Ann was born in 1902.', 'She married in 1921.'], 'Census of 1910.'));
    expect(r.kind).toBe('document');
    expect(r.title).toBe('Family History Draft');
    expect(r.text).toContain('Mary Ann was born in 1902.');
    expect(r.segments.find((s) => s.label === 'Footnote 1')).toBeTruthy();
    expect(r.citation?.authors).toEqual(['P. Pruitt']);
  });

  it('reads xlsx cells', async () => {
    const r = await readFile('w.xlsx', await makeXlsx());
    const b1 = r.segments.find((s) => s.label === 'Ledger!B1')!;
    expect(r.text.slice(b1.start, b1.end)).toBe('1250000');
    expect(b1.sheet).toBe('Ledger');
    expect(r.text).toContain('Expenses');
    expect(r.text).toContain('Net');
    expect(r.segments.find((s) => s.label === 'Ledger!B4')).toBeTruthy();
  });

  it('reads pptx slides and notes', async () => {
    const r = await readFile('s.pptx', await makePptx());
    expect(r.kind).toBe('presentation');
    expect(r.segments.map((s) => s.label)).toEqual(['Slide 1', 'Slide 1 notes', 'Slide 2']);
    expect(r.text).toContain('Revenue grew 12%\nin 2025');
  });

  it('reads ODF text', async () => {
    const z = new JSZip();
    z.file('mimetype', 'application/vnd.oasis.opendocument.text');
    z.file('content.xml', '<office:document-content><office:body><office:text><text:h>Heading</text:h><text:p>The deed is dated<text:s/>1888.<text:note><text:note-body><text:p>Book 4.</text:p></text:note-body></text:note></text:p></office:text></office:body></office:document-content>');
    const r = await readFile('x.odt', await z.generateAsync({ type: 'uint8array' }));
    expect(r.text).toContain('The deed is dated 1888.');
    expect(r.segments.some((s) => s.label === 'Note 1')).toBe(true);
  });

  it('reads PDF pages with page segments and metadata', async () => {
    const r = await readFile('r.pdf', await makePdf(['Baptisms 1903', 'Mary Ann, 3 May 1903']));
    expect(r.kind).toBe('pdf');
    expect(r.pageCount).toBe(2);
    expect(r.title).toBe('Parish Register Extract');
    const p2 = r.segments.find((s) => s.page === 2)!;
    expect(r.text.slice(p2.start, p2.end)).toContain('Mary Ann, 3 May 1903');
  });

  it('reads image dimensions and EXIF', async () => {
    const r = await readFile('photo.jpg', makeJpegWithExif());
    expect(r.kind).toBe('image');
    expect(r.meta?.width).toBe('640');
    expect(r.meta?.height).toBe('480');
    expect(r.meta?.Make).toBe('TestCam');
    expect(r.meta?.Model).toBe('Model X');
    expect(r.meta?.DateTimeOriginal).toBe('1999:12:31 23:59:00');
    expect(r.meta?.GPSLatitude).toBe('40.500000');
    expect(r.meta?.GPSLongitude).toBe('-74.250000');
    expect(r.citation?.date).toBe('1999-12-31');
  });

  it('reads email with quoted-printable and encoded subject', async () => {
    const eml = 'From: Aunt Jo <jo@example.org>\r\nTo: me@example.org\r\nSubject: =?UTF-8?B?RmFtaWx5IEJpYmxl?=\r\nDate: Tue, 3 Mar 2020 10:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nThe Bible says Mary was born 1902 =E2=80=94 page 2.\r\n';
    const r = await readFile('m.eml', enc(eml));
    expect(r.kind).toBe('email');
    expect(r.title).toBe('Family Bible');
    expect(r.text).toContain('born 1902 — page 2.');
    expect(r.citation?.date).toBe('2020-03-03');
  });

  it('reads mbox messages and multipart email', async () => {
    const mb = 'From a@b Mon Jan 1 00:00:00 2001\nSubject: One\nContent-Type: multipart/alternative; boundary="b1"\n\n--b1\nContent-Type: text/plain\n\nFirst body\n--b1\nContent-Type: text/html\n\n<p>ignored</p>\n--b1--\n\nFrom c@d Tue Jan 2 00:00:00 2001\nSubject: Two\n\nSecond body\n';
    const r = await readFile('box.mbox', enc(mb));
    expect(r.segments).toHaveLength(2);
    expect(r.text).toContain('First body');
    expect(r.text).not.toContain('ignored');
  });

  it('reads GEDCOM records', async () => {
    const g = '0 HEAD\n1 SOUR TEST\n1 GEDC\n2 VERS 5.5.1\n0 @I1@ INDI\n1 NAME Mary Ann /Smith/\n1 BIRT\n2 DATE ABT 1902\n2 NOTE Long note\n3 CONC  continued\n0 TRLR\n';
    const r = await readFile('t.ged', enc(g));
    expect(r.kind).toBe('gedcom');
    expect(r.segments.map((s) => s.label)).toEqual(['HEAD', '@I1@ INDI']);
    expect(r.text).toContain('NOTE Long note continued');
  });

  it('reads WebVTT and SRT with times', async () => {
    const v = await readFile('i.vtt', enc('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nI was born in Ohio.\n\n00:01:05.500 --> 00:01:08.000\nIn 1902, I think.'));
    expect(v.segments[1].label).toBe('00:01:05');
    expect(v.segments[1].timeStart).toBe(65.5);
    const s = await readFile('i.srt', enc('1\n00:00:02,000 --> 00:00:03,000\nHello\n'));
    expect(s.text).toBe('Hello');
  });

  it('reads EPUB chapters', async () => {
    const z = new JSZip();
    z.file('mimetype', 'application/epub+zip');
    z.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/c.opf"/></rootfiles></container>');
    z.file('OEBPS/c.opf', '<package><metadata><dc:title>Old Book</dc:title><dc:creator>Anon</dc:creator></metadata><manifest><item id="a" href="ch1.xhtml"/></manifest><spine><itemref idref="a"/></spine></package>');
    z.file('OEBPS/ch1.xhtml', '<html><head><title>One</title></head><body><p>It was 1850.</p></body></html>');
    const r = await readFile('b.epub', await z.generateAsync({ type: 'uint8array' }));
    expect(r.kind).toBe('ebook');
    expect(r.title).toBe('Old Book');
    expect(r.segments[0].label).toBe('Ch. 1: One');
  });

  it('recognizes media and unknown binaries', async () => {
    expect((await readFile('x.mp3', new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 1, 2]))).kind).toBe('recording');
    expect((await readFile('x.bin', new Uint8Array([0, 1, 2, 3, 0, 200, 4]))).kind).toBe('other');
  });
});
