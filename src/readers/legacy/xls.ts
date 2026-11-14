// Excel 97-2003 (BIFF8) and Excel 5/95 (BIFF5) cell text, with a tolerant record walker.
// Adapted from Anne's Grid (src/io/recover/xls.ts; MIT, same author): the record walk,
// CONTINUE-aware string cursor and RK decoding. Grid's workbook model, styles and formula
// decompiler are left out: Anne's Witness needs each cell's displayed value and address.
import { readCfb, isOle2 } from './doc97';
import { cp1252 } from './salvage';

export interface XlsCell { sheet: string; row: number; col: number; value: string | number | boolean; kind: 'string' | 'number' | 'boolean' | 'error' }
export interface XlsResult { sheets: string[]; cells: XlsCell[]; version: 8 | 5 | 4 | 3 | 2; encrypted: boolean; warnings: string[] }

const R = {
  FORMULA: 0x0006, FORMULA3: 0x0206, FORMULA4: 0x0406, EOF: 0x000a, CONTINUE: 0x003c, FILEPASS: 0x002f, CODEPAGE: 0x0042,
  BOUNDSHEET: 0x0085, SST: 0x00fc, LABELSST: 0x00fd, RSTRING: 0x00d6, MULRK: 0x00bd, NUMBER: 0x0203, LABEL: 0x0204,
  BOOLERR: 0x0205, STRING: 0x0207, RK: 0x027e, BOF: 0x0809, BOF2: 0x0009, BOF3: 0x0209, BOF4: 0x0409,
  NUMBER2: 0x0003, LABEL2: 0x0004, INTEGER2: 0x0002, BOOLERR2: 0x0005, STRING2: 0x0007,
} as const;
const isBof = (id: number) => id === R.BOF || id === R.BOF2 || id === R.BOF3 || id === R.BOF4;
const ERR: Record<number, string> = { 0x00: '#NULL!', 0x07: '#DIV/0!', 0x0f: '#VALUE!', 0x17: '#REF!', 0x1d: '#NAME?', 0x24: '#NUM!', 0x2a: '#N/A' };

const u16 = (b: Uint8Array, o: number) => (o + 2 <= b.length ? b[o] | (b[o + 1] << 8) : 0);
const u32 = (b: Uint8Array, o: number) => (o + 4 <= b.length ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : 0);
const f64 = (b: Uint8Array, o: number) => (o + 8 <= b.length ? new DataView(b.buffer, b.byteOffset + o, 8).getFloat64(0, true) : NaN);

export function rk(v: number): number {
  let n: number;
  if (v & 2) n = v >> 2;
  else {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setUint32(0, 0, true);
    dv.setUint32(4, v & 0xfffffffc, true);
    n = dv.getFloat64(0, true);
  }
  return v & 1 ? n / 100 : n;
}

interface Rec { id: number; off: number; data: Uint8Array; conts: Uint8Array[] }

function walk(s: Uint8Array, warnings: string[]): Rec[] {
  const out: Rec[] = [];
  let p = 0;
  while (p + 4 <= s.length) {
    const id = u16(s, p), len = u16(s, p + 2);
    if (len > 8224 || p + 4 + len > s.length) {
      // Resynchronize on the next plausible record header.
      let q = -1;
      for (let k = p + 1; k + 4 <= s.length; k++) {
        const kid = u16(s, k), kl = u16(s, k + 2);
        if (kl <= 8224 && k + 4 + kl <= s.length && (kid === R.LABELSST || kid === R.NUMBER || kid === R.RK || kid === R.MULRK || isBof(kid) || kid === R.EOF || kid === R.LABEL)) { q = k; break; }
      }
      if (q < 0) { warnings.push(`Stream damaged at byte ${p}; the rest is unreadable.`); break; }
      warnings.push(`Skipped ${q - p} damaged bytes at ${p}.`);
      p = q;
      continue;
    }
    const data = s.subarray(p + 4, p + 4 + len);
    if (id === R.CONTINUE && out.length) out[out.length - 1].conts.push(data);
    else out.push({ id, off: p, data, conts: [] });
    p += 4 + len;
  }
  return out;
}

class EndOfData extends Error {}

/** Reads across a record and its CONTINUE parts; strings re-read the width flag at each boundary. */
class Cursor {
  pi = 0;
  constructor(public parts: Uint8Array[], public p = 0) {}
  private ensure() { while (this.pi < this.parts.length && this.p >= this.parts[this.pi].length) { this.pi++; this.p = 0; } }
  u8(): number { this.ensure(); if (this.pi >= this.parts.length) throw new EndOfData(); return this.parts[this.pi][this.p++]; }
  u16(): number { const a = this.u8(); return a | (this.u8() << 8); }
  u32(): number { const a = this.u16(); return (a | (this.u16() << 16)) >>> 0; }
  skip(n: number) { while (n > 0) { this.ensure(); if (this.pi >= this.parts.length) throw new EndOfData(); const t = Math.min(n, this.parts[this.pi].length - this.p); this.p += t; n -= t; } }
  bytes(n: number) { const o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = this.u8(); return o; }
  chars(n: number, high: boolean): string {
    let s = '';
    while (n > 0) {
      if (this.pi >= this.parts.length || this.p >= this.parts[this.pi].length) {
        this.pi++; this.p = 0;
        if (this.pi >= this.parts.length) throw new EndOfData();
        high = !!(this.parts[this.pi][this.p++] & 1);
        continue;
      }
      const part = this.parts[this.pi];
      const avail = part.length - this.p;
      if (high) {
        const take = Math.min(n, avail >> 1);
        if (!take) { this.p = part.length; continue; }
        for (let k = 0; k < take; k++) s += String.fromCharCode(part[this.p + 2 * k] | (part[this.p + 2 * k + 1] << 8));
        this.p += take * 2; n -= take;
      } else {
        const take = Math.min(n, avail);
        for (let k = 0; k < take; k++) s += String.fromCharCode(part[this.p + k]);
        this.p += take; n -= take;
      }
    }
    return s;
  }
}

export function colName(c: number): string {
  let s = '';
  c++;
  while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
  return s;
}

function findWorkbookStream(u8: Uint8Array, warnings: string[]): Uint8Array | null {
  if (isOle2(u8)) {
    const cfb = readCfb(u8);
    if (cfb) {
      for (const d of cfb.damaged) warnings.push(`Damaged compound-file chain: ${d}`);
      for (const name of ['Workbook', 'Book', 'WORKBOOK', 'BOOK']) {
        const s = cfb.streams.get(name);
        if (s && s.length >= 8) return s;
      }
    }
    // Directory lost: look for a BIFF8/5 BOF at a sector boundary.
    for (let o = 512; o + 8 < u8.length; o += 512) {
      if (u16(u8, o) === R.BOF && (u16(u8, o + 4) === 0x0600 || u16(u8, o + 4) === 0x0500) && u16(u8, o + 6) === 0x0005) {
        warnings.push('Workbook stream located by its BOF record (directory damaged).');
        return u8.subarray(o);
      }
    }
    return null;
  }
  return isBof(u16(u8, 0)) ? u8 : null; // BIFF2-4 files are a bare record stream
}

/** Read every cell's value. Returns null when the bytes are not an Excel binary workbook. */
export function readXlsCells(u8: Uint8Array): XlsResult | null {
  const warnings: string[] = [];
  const s = findWorkbookStream(u8, warnings);
  if (!s) return null;
  const recs = walk(s, warnings);
  if (!recs.length || !isBof(recs[0].id)) return null;
  const bofVer = recs[0].id === R.BOF ? u16(recs[0].data, 0) : 0;
  const version: XlsResult['version'] = recs[0].id === R.BOF2 ? 2 : recs[0].id === R.BOF3 ? 3 : recs[0].id === R.BOF4 ? 4 : bofVer === 0x0600 ? 8 : 5;
  let dec8 = (b: Uint8Array) => { let x = ''; for (const c of b) x += cp1252(c); return x; };
  const res: XlsResult = { sheets: [], cells: [], version, encrypted: false, warnings };
  const str = (c: Cursor, cch8 = false): string => {
    const n = cch8 ? c.u8() : c.u16();
    if (version < 8) return dec8(c.bytes(n));
    const fl = c.u8();
    const runs = fl & 8 ? c.u16() : 0;
    const ext = fl & 4 ? c.u32() : 0;
    const out = c.chars(n, !!(fl & 1));
    if (runs) c.skip(4 * runs);
    if (ext) c.skip(ext);
    return out;
  };
  const sst: string[] = [];
  const bound: { name: string; pos: number; type: number }[] = [];
  // Globals
  let i = 1;
  for (; i < recs.length; i++) {
    const r = recs[i];
    if (r.id === R.EOF) { i++; break; }
    if (r.id === R.FILEPASS) { res.encrypted = true; warnings.push('The workbook is password-protected; its cells cannot be read.'); return res; }
    if (r.id === R.CODEPAGE) {
      const cp = u16(r.data, 0);
      if (cp !== 1200 && cp !== 1252 && cp !== 32769) {
        try { const d = new TextDecoder(`windows-${cp}`); dec8 = (b) => d.decode(b); } catch { /* keep cp1252 */ }
      }
    }
    if (r.id === R.BOUNDSHEET) {
      try {
        const c = new Cursor([r.data], 6);
        bound.push({ pos: u32(r.data, 0), type: r.data[5] ?? 0, name: str(c, true) });
      } catch { warnings.push('Unreadable sheet name.'); }
    }
    if (r.id === R.SST) {
      const c = new Cursor([r.data, ...r.conts], 8);
      const n = u32(r.data, 4);
      try { for (let k = 0; k < n; k++) sst.push(str(c)); } catch { warnings.push(`Shared strings table cut short after ${sst.length} of ${n} strings.`); }
    }
  }
  // Sheets: either at BOUNDSHEET positions, or (BIFF2-4, or damaged positions) the substreams in order.
  const sheetStarts: { name: string; idx: number }[] = [];
  if (version <= 4) sheetStarts.push({ name: 'Sheet1', idx: 1 });
  else {
    let k = 0;
    for (let j = i; j < recs.length; j++) {
      if (isBof(recs[j].id)) {
        const type = u16(recs[j].data, 2);
        const b = bound.find((x) => x.pos === recs[j].off) ?? bound[k];
        k++;
        if (type === 0x0010 || type === 0) sheetStarts.push({ name: b?.name ?? `Sheet${k}`, idx: j + 1 });
      }
    }
  }
  for (const st of sheetStarts) {
    res.sheets.push(st.name);
    let pendingFormula: { row: number; col: number } | null = null;
    const put = (row: number, col: number, value: XlsCell['value'], kind: XlsCell['kind']) => res.cells.push({ sheet: st.name, row, col, value, kind });
    for (let j = st.idx; j < recs.length; j++) {
      const r = recs[j];
      const d = r.data;
      if (r.id === R.EOF || isBof(r.id)) break;
      try {
        switch (r.id) {
          case R.LABELSST: { const v = sst[u32(d, 6)]; if (v !== undefined) put(u16(d, 0), u16(d, 2), v, 'string'); break; }
          case R.LABEL: case R.RSTRING: put(u16(d, 0), u16(d, 2), str(new Cursor([d, ...r.conts], 6)), 'string'); break;
          case R.LABEL2: put(u16(d, 0), u16(d, 2), dec8(d.subarray(8, 8 + d[7])), 'string'); break;
          case R.NUMBER: put(u16(d, 0), u16(d, 2), f64(d, 6), 'number'); break;
          case R.NUMBER2: put(u16(d, 0), u16(d, 2), f64(d, 7), 'number'); break;
          case R.INTEGER2: put(u16(d, 0), u16(d, 2), u16(d, 7), 'number'); break;
          case R.RK: put(u16(d, 0), u16(d, 2), rk(u32(d, 6)), 'number'); break;
          case R.MULRK: {
            const row = u16(d, 0), first = u16(d, 2);
            const n = (d.length - 6) / 6;
            for (let k = 0; k < n; k++) put(row, first + k, rk(u32(d, 4 + k * 6 + 2)), 'number');
            break;
          }
          case R.BOOLERR: case R.BOOLERR2: {
            const o = r.id === R.BOOLERR ? 6 : 7;
            if (d[o + 1]) put(u16(d, 0), u16(d, 2), ERR[d[o]] ?? '#N/A', 'error');
            else put(u16(d, 0), u16(d, 2), !!d[o], 'boolean');
            break;
          }
          case R.FORMULA: case R.FORMULA3: case R.FORMULA4: {
            const row = u16(d, 0), col = u16(d, 2);
            // Cached result: a number, or a marker (0xFFFF in the top bytes) for string/bool/error/empty.
            if (u16(d, 12) === 0xffff) {
              const t = d[6];
              if (t === 0) pendingFormula = { row, col }; // string follows in a STRING record
              else if (t === 1) put(row, col, !!d[8], 'boolean');
              else if (t === 2) put(row, col, ERR[d[8]] ?? '#N/A', 'error');
            } else put(row, col, f64(d, 6), 'number');
            break;
          }
          case R.STRING: case R.STRING2: {
            if (pendingFormula) {
              const v = r.id === R.STRING2 ? dec8(d.subarray(1, 1 + d[0])) : str(new Cursor([d, ...r.conts], 0));
              put(pendingFormula.row, pendingFormula.col, v, 'string');
              pendingFormula = null;
            }
            break;
          }
        }
      } catch {
        res.warnings.push(`Unreadable cell record at byte ${r.off} in ${st.name}.`);
      }
    }
  }
  return res;
}

export function formatXlsValue(v: XlsCell['value']): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v;
}
