import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readCfb, extractDoc97, isOle2 } from '../src/readers/legacy/doc97';
import { readXlsCells, rk } from '../src/readers/legacy/xls';
import { readFile } from '../src/readers/index';

const F = resolve(__dirname, 'fixtures/legacy');
const load = (f: string) => new Uint8Array(readFileSync(resolve(F, f)));

/** Minimal CFB (version 3) writer: one FAT sector, one directory sector, streams stored in regular sectors (padded to 4096 bytes). */
export function buildCfb(streams: Record<string, Uint8Array>): Uint8Array {
  const names = Object.keys(streams);
  if (names.length > 3) throw new Error('test writer: at most 3 streams');
  const padded = names.map((n) => { const s = streams[n]; const out = new Uint8Array(Math.max(4096, Math.ceil(s.length / 512) * 512)); out.set(s); return { n, data: out, size: Math.max(4096, s.length) }; });
  const sectors = 2 + padded.reduce((k, p) => k + p.data.length / 512, 0);
  const file = new Uint8Array(512 * (1 + sectors));
  const dv = new DataView(file.buffer);
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].forEach((b, i) => (file[i] = b));
  dv.setUint16(0x18, 0x3e, true); dv.setUint16(0x1a, 3, true); dv.setUint16(0x1c, 0xfffe, true);
  dv.setUint16(0x1e, 9, true); dv.setUint16(0x20, 6, true);
  dv.setUint32(0x2c, 1, true); // FAT sectors
  dv.setUint32(0x30, 1, true); // first directory sector
  dv.setUint32(0x38, 4096, true); // mini stream cutoff
  dv.setUint32(0x3c, 0xfffffffe, true); dv.setUint32(0x40, 0, true);
  dv.setUint32(0x44, 0xfffffffe, true); dv.setUint32(0x48, 0, true);
  for (let i = 0; i < 109; i++) dv.setUint32(0x4c + i * 4, i === 0 ? 0 : 0xffffffff, true);
  const sec = (n: number) => 512 * (n + 1);
  // FAT
  const fat = (i: number, v: number) => dv.setUint32(sec(0) + i * 4, v, true);
  for (let i = 0; i < 128; i++) fat(i, 0xffffffff);
  fat(0, 0xfffffffd); fat(1, 0xfffffffe);
  let next = 2;
  const starts: number[] = [];
  for (const p of padded) {
    const n = p.data.length / 512;
    starts.push(next);
    for (let k = 0; k < n; k++) fat(next + k, k === n - 1 ? 0xfffffffe : next + k + 1);
    file.set(p.data, sec(next));
    next += n;
  }
  // Directory
  const entry = (i: number, name: string, type: number, child: number, right: number, start: number, size: number) => {
    const o = sec(1) + i * 128;
    for (let k = 0; k < name.length; k++) dv.setUint16(o + k * 2, name.charCodeAt(k), true);
    dv.setUint16(o + 0x40, (name.length + 1) * 2, true);
    file[o + 0x42] = type; file[o + 0x43] = 1;
    dv.setUint32(o + 0x44, 0xffffffff, true); dv.setUint32(o + 0x48, right, true); dv.setUint32(o + 0x4c, child, true);
    dv.setUint32(o + 0x74, start, true); dv.setUint32(o + 0x78, size, true);
  };
  entry(0, 'Root Entry', 5, 1, 0xffffffff, 0xfffffffe, 0);
  padded.forEach((p, i) => entry(i + 1, p.n, 2, 0xffffffff, i + 2 <= padded.length ? i + 2 : 0xffffffff, starts[i], p.size));
  return file;
}

/** BIFF8 record builder. */
const rec = (id: number, body: number[] | Uint8Array) => { const b = Array.from(body); return [id & 0xff, id >> 8, b.length & 0xff, b.length >> 8, ...b]; };
const le16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const le32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
const f64 = (v: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); return Array.from(b); };
const xstr = (s: string, high = false) => [...le16(s.length), high ? 1 : 0, ...(high ? [...s].flatMap((c) => le16(c.charCodeAt(0))) : [...s].map((c) => c.charCodeAt(0)))];

function buildXls(): Uint8Array {
  const bof = (type: number) => rec(0x0809, [...le16(0x0600), ...le16(type), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  // SST: "Item", "Amount", "Ελληνικά", "A long string split by CONTINUE"
  const s1 = [...xstr('Item'), ...xstr('Amount'), ...xstr('Ελληνικά', true)];
  const long = 'A long string split by CONTINUE';
  const firstPart = [...le16(long.length), 0, ...[...long.slice(0, 10)].map((c) => c.charCodeAt(0))];
  const sst = [...rec(0x00fc, [...le32(4), ...le32(4), ...s1, ...firstPart]), ...rec(0x003c, [0, ...[...long.slice(10)].map((c) => c.charCodeAt(0))])];
  const globalsWithoutBound = [...bof(0x0005), ...sst];
  const boundLen = 4 + 6 + 2 + 'Data'.length; // record header + pos/flags + name
  const sheetPos = globalsWithoutBound.length + boundLen + 4; // + EOF record
  const bound = rec(0x0085, [...le32(sheetPos), 0, 0, 'Data'.length, 0, ...[...'Data'].map((c) => c.charCodeAt(0))]);
  const eof = rec(0x000a, []);
  const cell = (row: number, col: number) => [...le16(row), ...le16(col), ...le16(0)];
  const sheet = [
    ...bof(0x0010),
    ...rec(0x00fd, [...cell(0, 0), ...le32(0)]),
    ...rec(0x00fd, [...cell(0, 1), ...le32(1)]),
    ...rec(0x00fd, [...cell(1, 0), ...le32(2)]),
    ...rec(0x0203, [...cell(1, 1), ...f64(1234.5)]),
    ...rec(0x027e, [...cell(2, 1), ...le32((25 << 2) | 2)]), // RK integer 25
    ...rec(0x00bd, [...le16(3), ...le16(0), ...le16(0), ...le32((7 << 2) | 2), ...le16(0), ...le32((8 << 2) | 2), ...le16(1)]), // MULRK A4:B4
    ...rec(0x0006, [...cell(4, 0), 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0, 0, 0, 0, 0, 0]), // formula with string result
    ...rec(0x0207, xstr('computed')),
    ...rec(0x00fd, [...cell(5, 0), ...le32(3)]),
    ...eof,
  ];
  return new Uint8Array([...globalsWithoutBound, ...bound, ...eof, ...sheet]);
}

describe('compound files', () => {
  it('the test writer produces files the ported reader can open', () => {
    const f = buildCfb({ Alpha: new TextEncoder().encode('hello'), Beta: new Uint8Array([1, 2, 3]) });
    expect(isOle2(f)).toBe(true);
    const c = readCfb(f)!;
    expect(new TextDecoder().decode(c.streams.get('Alpha')!.subarray(0, 5))).toBe('hello');
    expect(c.streams.get('Beta')!.slice(0, 3)).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('Excel 97-2003', () => {
  it('reads shared strings across CONTINUE, numbers, RK, MULRK and formula strings', () => {
    const r = readXlsCells(buildCfb({ Workbook: buildXls() }))!;
    expect(r.version).toBe(8);
    expect(r.sheets).toEqual(['Data']);
    const at = (row: number, col: number) => r.cells.find((c) => c.row === row && c.col === col)?.value;
    expect(at(0, 0)).toBe('Item');
    expect(at(1, 0)).toBe('Ελληνικά');
    expect(at(1, 1)).toBe(1234.5);
    expect(at(2, 1)).toBe(25);
    expect(at(3, 0)).toBe(7);
    expect(at(3, 1)).toBe(8);
    expect(at(4, 0)).toBe('computed');
    expect(at(5, 0)).toBe('A long string split by CONTINUE');
  });
  it('decodes RK numbers', () => {
    expect(rk((3 << 2) | 2)).toBe(3);
    expect(rk((1234 << 2) | 3)).toBe(12.34);
  });
  it('reads a workbook saved by LibreOffice as Excel 97 through readFile', async () => {
    const r = await readFile('sheet.xls', load('sheet.xls'));
    expect(r.kind).toBe('workbook');
    expect(r.text).toContain('Paper');
    const seg = r.segments.find((s) => s.label === 'Budget!B2')!;
    expect(r.text.slice(seg.start, seg.end)).toBe('12.5');
    expect(r.segments.some((s) => s.sheet === 'Notes')).toBe(true);
  });
  it('reads the built workbook through readFile with cell segments', async () => {
    const r = await readFile('x.xls', buildCfb({ Workbook: buildXls() }));
    const seg = r.segments.find((s) => s.label === 'Data!B2')!;
    expect(r.text.slice(seg.start, seg.end)).toBe('1234.5');
  });
});

describe('Word 97-2003', () => {
  it('reads paragraphs and tables through the piece table', async () => {
    const d = extractDoc97(load('word97.doc'))!;
    expect(d.method).toBe('piece table');
    const r = await readFile('word97.doc', load('word97.doc'));
    expect(r.kind).toBe('document');
    expect(r.text).toContain('Legacy Fixture Title');
    expect(r.text).toContain('Cell A1\tCell B1\tCell C1');
    expect(r.segments[0]).toMatchObject({ start: 0, label: '¶ 1' });
  });
  it('still finds the text when the FAT sector is destroyed', () => {
    const c = load('word97.doc');
    for (let i = 512; i < 1024; i++) c[i] = 0xff;
    expect(extractDoc97(c)!.main).toContain('Legacy Fixture Title');
  });
});

describe('Outlook messages', () => {
  it('reads subject and body', async () => {
    const u16 = (s: string) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[2 * i] = s.charCodeAt(i) & 0xff; b[2 * i + 1] = s.charCodeAt(i) >> 8; } return b; };
    const msg = buildCfb({ '__substg1.0_0037001F': u16('Census copy'), '__substg1.0_1000001F': u16('The 1910 census page is attached.'), '__substg1.0_0C1A001F': u16('Archive Desk') });
    const r = await readFile('mail.msg', msg);
    expect(r.kind).toBe('email');
    expect(r.title).toBe('Census copy');
    expect(r.text).toContain('The 1910 census page is attached.');
    expect(r.citation?.authors).toEqual(['Archive Desk']);
  });
});
