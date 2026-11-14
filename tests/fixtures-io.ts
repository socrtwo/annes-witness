// Test fixtures built in code: docx, xlsx, pptx, PDF, JPEG with EXIF.
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export async function makeDocx(paragraphs: string[], footnote?: string): Promise<Uint8Array> {
  const z = new JSZip();
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);
  const body = paragraphs
    .map((p, i) => {
      // Split the first paragraph into two runs to test run joining.
      if (i === 0 && p.length > 6) return `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>${p.slice(0, 5)}</w:t></w:r><w:r><w:t xml:space="preserve">${p.slice(5)}</w:t></w:r></w:p>`;
      return `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`;
    })
    .join('');
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  if (footnote) {
    z.file('word/footnotes.xml', `<?xml version="1.0"?><w:footnotes xmlns:w="${W}"><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:t>${footnote}</w:t></w:r></w:p></w:footnote></w:footnotes>`);
  }
  z.file('docProps/core.xml', `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>Family History Draft</dc:title><dc:creator>P. Pruitt</dc:creator></cp:coreProperties>`);
  return z.generateAsync({ type: 'uint8array' });
}

export async function makeXlsx(): Promise<Uint8Array> {
  const z = new JSZip();
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  z.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  z.file('xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ledger" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  z.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  z.file('xl/sharedStrings.xml', `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Revenue</t></si><si><t>Expenses</t></si></sst>`);
  z.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1250000</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" s="3"><v>830000</v></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>Net</t></is></c><c r="B4"><f>B1-B2</f><v>420000</v></c></row></sheetData></worksheet>`);
  return z.generateAsync({ type: 'uint8array' });
}

export async function makePptx(): Promise<Uint8Array> {
  const z = new JSZip();
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  z.file('ppt/presentation.xml', `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);
  z.file('ppt/slides/slide1.xml', `<p:sld xmlns:p="p" xmlns:a="${A}"><a:p><a:r><a:t>Revenue grew 12%</a:t></a:r></a:p><a:p><a:r><a:t>in 2025</a:t></a:r></a:p></p:sld>`);
  z.file('ppt/slides/slide2.xml', `<p:sld xmlns:p="p" xmlns:a="${A}"><a:p><a:r><a:t>Thank you</a:t></a:r></a:p></p:sld>`);
  z.file('ppt/notesSlides/notesSlide1.xml', `<p:notes xmlns:p="p" xmlns:a="${A}"><a:p><a:r><a:t>Source: ledger</a:t></a:r></a:p><a:p><a:r><a:t>1</a:t></a:r></a:p></p:notes>`);
  return z.generateAsync({ type: 'uint8array' });
}

export async function makePdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Parish Register Extract');
  doc.setAuthor('St. John’s');
  const f = await doc.embedFont(StandardFonts.Helvetica);
  for (const t of pages) {
    const p = doc.addPage([612, 792]);
    t.split('\n').forEach((line, i) => p.drawText(line, { x: 72, y: 700 - i * 20, size: 12, font: f }));
  }
  return doc.save();
}

/** A minimal JPEG: SOI, APP1 EXIF (big-endian TIFF with Make, Model, DateTimeOriginal via ExifIFD, GPS), SOF0, EOI. */
export function makeJpegWithExif(): Uint8Array {
  const tiff: number[] = [];
  const u16 = (n: number) => [(n >> 8) & 255, n & 255];
  const u32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const str = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);
  const make = str('TestCam');
  const model = str('Model X');
  const dto = str('1999:12:31 23:59:00');
  // Layout: header(8) | IFD0 at 8: 4 entries (2+48+4=54) -> ends 62 | data make at 62, model after
  const ifd0 = 8;
  const ifd0Size = 2 + 4 * 12 + 4;
  const makeOff = ifd0 + ifd0Size;
  const modelOff = makeOff + make.length;
  const exifIfd = modelOff + model.length;
  const exifSize = 2 + 12 + 4;
  const dtoOff = exifIfd + exifSize;
  const gpsIfd = dtoOff + dto.length;
  const gpsSize = 2 + 4 * 12 + 4;
  const latOff = gpsIfd + gpsSize;
  const lonOff = latOff + 24;
  tiff.push(0x4d, 0x4d, 0, 42, ...u32(ifd0));
  tiff.push(...u16(4));
  tiff.push(...u16(0x010f), ...u16(2), ...u32(make.length), ...u32(makeOff));
  tiff.push(...u16(0x0110), ...u16(2), ...u32(model.length), ...u32(modelOff));
  tiff.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifIfd));
  tiff.push(...u16(0x8825), ...u16(4), ...u32(1), ...u32(gpsIfd));
  tiff.push(...u32(0));
  tiff.push(...make, ...model);
  tiff.push(...u16(1), ...u16(0x9003), ...u16(2), ...u32(dto.length), ...u32(dtoOff), ...u32(0));
  tiff.push(...dto);
  tiff.push(...u16(4));
  tiff.push(...u16(1), ...u16(2), ...u32(2), ...[78, 0, 0, 0]); // N
  tiff.push(...u16(2), ...u16(5), ...u32(3), ...u32(latOff));
  tiff.push(...u16(3), ...u16(2), ...u32(2), ...[87, 0, 0, 0]); // W
  tiff.push(...u16(4), ...u16(5), ...u32(3), ...u32(lonOff));
  tiff.push(...u32(0));
  const rat = (a: number, b: number) => [...u32(a), ...u32(b)];
  tiff.push(...rat(40, 1), ...rat(30, 1), ...rat(0, 1)); // 40.5
  tiff.push(...rat(74, 1), ...rat(15, 1), ...rat(0, 1)); // 74.25
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const app1 = [0xff, 0xe1, ...u16(exif.length + 2), ...exif];
  const sof = [0xff, 0xc0, ...u16(11), 8, ...u16(480), ...u16(640), 1, 1, 0x11, 0];
  return new Uint8Array([0xff, 0xd8, ...app1, ...sof, 0xff, 0xd9]);
}

export const enc = (s: string) => new TextEncoder().encode(s);
