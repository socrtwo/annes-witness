// Write tick marks and values into a copy of an .xlsx workbook.
import JSZip from 'jszip';
import { attr, elements } from '../readers/common';
import { escapeXml } from '../readers/common';
import { ensureOverride } from './ooxml-parts';

const SHEET_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const WS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const TICK_SHEET = 'Witness Ticks';

function colLetters(n: number): string {
  let s = '';
  while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function colNumber(letters: string): number {
  let n = 0;
  for (const c of letters.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

function inlineCell(ref: string, v: string | number, style?: string): string {
  const s = style ? ` s="${style}"` : '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(v))}</t></is></c>`;
}

async function sheetPaths(zip: JSZip): Promise<{ name: string; rid: string; path: string; sheetId: number }[]> {
  const wb = (await zip.file('xl/workbook.xml')?.async('string')) ?? '';
  const rels = (await zip.file('xl/_rels/workbook.xml.rels')?.async('string')) ?? '';
  const map: Record<string, string> = {};
  for (const r of elements(rels, 'Relationship')) {
    const id = attr(r.attrs, 'Id');
    const t = attr(r.attrs, 'Target');
    if (id && t) map[id] = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
  }
  return elements(wb, 'sheet').map((s) => {
    const rid = attr(s.attrs, 'r:id') ?? '';
    return { name: attr(s.attrs, 'name') ?? '', rid, path: map[rid] ?? '', sheetId: Number(attr(s.attrs, 'sheetId') ?? 0) };
  });
}

export async function addTickSheet(
  bytes: Uint8Array,
  rows: { sheet: string; cell: string; mark: string; claim: string; source: string; note?: string }[],
  legend: { mark: string; meaning: string }[],
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  let wb = await zip.file('xl/workbook.xml')?.async('string');
  if (!wb) throw new Error('This file has no xl/workbook.xml; it is not an Excel workbook.');
  const header = ['Sheet', 'Cell', 'Mark', 'Claim', 'Source', 'Note'];
  const table: (string | number)[][] = [header, ...rows.map((r) => [r.sheet, r.cell, r.mark, r.claim, r.source, r.note ?? ''])];
  table.push([], ['Mark', 'Meaning'], ...legend.map((l) => [l.mark, l.meaning]));
  const sheetData = table
    .map((r, i) => `<row r="${i + 1}">${r.map((v, j) => inlineCell(`${colLetters(j + 1)}${i + 1}`, v)).join('')}</row>`)
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><cols><col min="1" max="2" width="12" customWidth="1"/><col min="3" max="3" width="6" customWidth="1"/><col min="4" max="5" width="50" customWidth="1"/><col min="6" max="6" width="40" customWidth="1"/></cols><sheetData>${sheetData}</sheetData></worksheet>`;
  const sheets = await sheetPaths(zip);
  const existing = sheets.find((s) => s.name === TICK_SHEET && s.path);
  if (existing) {
    zip.file(existing.path, xml);
  } else {
    let n = 1;
    while (zip.file(`xl/worksheets/sheet${n}.xml`)) n++;
    const path = `xl/worksheets/sheet${n}.xml`;
    zip.file(path, xml);
    const relsPath = 'xl/_rels/workbook.xml.rels';
    let rels = (await zip.file(relsPath)?.async('string')) ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    const ids = new Set([...rels.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]));
    let k = ids.size + 1;
    while (ids.has(`rId${k}`)) k++;
    rels = rels.replace('</Relationships>', `<Relationship Id="rId${k}" Type="${WS_REL}" Target="worksheets/sheet${n}.xml"/></Relationships>`);
    zip.file(relsPath, rels);
    const sheetId = Math.max(0, ...sheets.map((s) => s.sheetId)) + 1;
    if (!/xmlns:r=/.test(wb)) wb = wb.replace(/<workbook\b/, '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
    wb = wb.replace('</sheets>', `<sheet name="${TICK_SHEET}" sheetId="${sheetId}" r:id="rId${k}"/></sheets>`);
    zip.file('xl/workbook.xml', wb);
    await ensureOverride(zip, '/' + path, SHEET_CT);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** Set one cell's value ("Snip to Cell"). Numbers are written as numbers; anything else as text. */
export async function writeCellValue(bytes: Uint8Array, sheet: string, cell: string, value: string | number): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const target = (await sheetPaths(zip)).find((s) => s.name === sheet);
  if (!target?.path) throw new Error(`No sheet named “${sheet}”.`);
  let xml = (await zip.file(target.path)?.async('string')) ?? '';
  const m = /^([A-Z]+)(\d+)$/i.exec(cell.trim());
  if (!m) throw new Error(`“${cell}” is not a cell reference.`);
  const ref = m[1].toUpperCase() + m[2];
  const rowNo = Number(m[2]);
  const colNo = colNumber(m[1]);
  if (!/<sheetData\s*\/>/.test(xml) && !/<sheetData[\s>]/.test(xml)) throw new Error('The worksheet has no sheetData.');
  xml = xml.replace(/<sheetData\s*\/>/, '<sheetData></sheetData>');
  const rowRe = new RegExp(`<row\\b[^>]*\\br="${rowNo}"[^>]*?(?:/>|>([\\s\\S]*?)</row>)`);
  const rowM = rowRe.exec(xml);
  if (rowM) {
    let inner = rowM[1] ?? '';
    const openTag = /^<row\b[^>]*?(?=\/?>)/.exec(rowM[0])![0];
    const cellRe = new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
    const cm = cellRe.exec(inner);
    if (cm) {
      const style = /\bs="(\d+)"/.exec(cm[0])?.[1];
      inner = inner.replace(cm[0], inlineCell(ref, value, style));
    } else {
      const cells = [...inner.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)];
      const after = cells.find((c) => colNumber(c[1]) > colNo);
      const nc = inlineCell(ref, value);
      inner = after ? inner.replace(after[0], nc + after[0]) : inner + nc;
    }
    xml = xml.replace(rowM[0], `${openTag}>${inner}</row>`);
  } else {
    const newRow = `<row r="${rowNo}">${inlineCell(ref, value)}</row>`;
    const rows = [...xml.matchAll(/<row\b[^>]*\br="(\d+)"/g)];
    const after = rows.find((r) => Number(r[1]) > rowNo);
    if (after) xml = xml.slice(0, after.index) + newRow + xml.slice(after.index);
    else xml = xml.replace('</sheetData>', newRow + '</sheetData>');
  }
  zip.file(target.path, xml);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
