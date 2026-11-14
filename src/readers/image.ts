// Pictures: dimensions and EXIF (JPEG APP1), parsed by hand.
import { ascii, startsWith } from './common';
import type { ReadResult } from './index';

export function imageMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (ascii(bytes, 0, 4) === 'GIF8') return 'image/gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  if (ascii(bytes, 0, 2) === 'BM') return 'image/bmp';
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0]) || startsWith(bytes, [0x4d, 0x4d, 0, 0x2a])) return 'image/tiff';
  if (ascii(bytes, 4, 8) === 'ftypheic' || ascii(bytes, 4, 8) === 'ftypmif1' || ascii(bytes, 4, 8) === 'ftypheix') return 'image/heic';
  return null;
}

function dims(bytes: Uint8Array, mime: string): { width?: number; height?: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (mime === 'image/png') return { width: dv.getUint32(16), height: dv.getUint32(20) };
    if (mime === 'image/gif') return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
    if (mime === 'image/bmp') return { width: dv.getInt32(18, true), height: Math.abs(dv.getInt32(22, true)) };
    if (mime === 'image/webp') {
      const chunk = ascii(bytes, 12, 4);
      if (chunk === 'VP8X') return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
      if (chunk === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
      if (chunk === 'VP8L') {
        const b = dv.getUint32(21, true);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < bytes.length - 9) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const marker = bytes[i + 1];
        const len = dv.getUint16(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
          return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
        i += 2 + len;
      }
    }
  } catch {
    /* fall through */
  }
  return {};
}

const TAGS: Record<number, string> = {
  0x010f: 'Make', 0x0110: 'Model', 0x0131: 'Software', 0x0132: 'DateTime', 0x013b: 'Artist', 0x8298: 'Copyright',
  0x010e: 'ImageDescription', 0x9003: 'DateTimeOriginal', 0x9004: 'DateTimeDigitized', 0xa434: 'LensModel',
};

/** EXIF fields from a JPEG APP1 segment, or a TIFF file. */
export function readExif(bytes: Uint8Array): Record<string, string> {
  let tiff = -1;
  if (startsWith(bytes, [0xff, 0xd8])) {
    let i = 2;
    while (i < bytes.length - 4 && bytes[i] === 0xff) {
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker === 0xe1 && ascii(bytes, i + 4, 6) === 'Exif\0\0') { tiff = i + 10; break; }
      if (marker === 0xda) break;
      i += 2 + len;
    }
  } else if (startsWith(bytes, [0x49, 0x49, 0x2a, 0]) || startsWith(bytes, [0x4d, 0x4d, 0, 0x2a])) tiff = 0;
  if (tiff < 0) return {};
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const le = ascii(bytes, tiff, 2) === 'II';
  const u16 = (o: number) => dv.getUint16(tiff + o, le);
  const u32 = (o: number) => dv.getUint32(tiff + o, le);
  const out: Record<string, string> = {};
  const gps: Record<number, number[] | string> = {};
  const readIfd = (off: number, kind: 'main' | 'exif' | 'gps', depth = 0) => {
    if (depth > 4 || off <= 0 || tiff + off + 2 > bytes.length) return;
    const n = u16(off);
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12;
      if (tiff + e + 12 > bytes.length) break;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
      const total = (sizes[type] ?? 1) * count;
      const vo = total <= 4 ? e + 8 : u32(e + 8);
      const str = () => ascii(bytes, tiff + vo, count).replace(/\0+$/, '').trim();
      const rats = () => {
        const a: number[] = [];
        for (let r = 0; r < count; r++) {
          const d = u32(vo + r * 8 + 4);
          a.push(d ? u32(vo + r * 8) / d : 0);
        }
        return a;
      };
      if (kind === 'gps') gps[tag] = type === 2 ? str() : type === 5 ? rats() : String(u32(e + 8));
      else if (tag === 0x8769) readIfd(u32(e + 8), 'exif', depth + 1);
      else if (tag === 0x8825) readIfd(u32(e + 8), 'gps', depth + 1);
      else if (TAGS[tag] && type === 2) out[TAGS[tag]] = str();
    }
  };
  try {
    readIfd(u32(4), 'main');
  } catch {
    /* damaged EXIF: keep what was read */
  }
  const dms = (v: unknown) => (Array.isArray(v) && v.length === 3 ? v[0] + v[1] / 60 + v[2] / 3600 : undefined);
  const lat = dms(gps[2]);
  const lon = dms(gps[4]);
  if (lat !== undefined && lon !== undefined) {
    out.GPSLatitude = (gps[1] === 'S' ? -lat : lat).toFixed(6);
    out.GPSLongitude = (gps[3] === 'W' ? -lon : lon).toFixed(6);
  }
  return out;
}

export function readImage(bytes: Uint8Array, mime: string): ReadResult {
  const d = dims(bytes, mime);
  const exif = readExif(bytes);
  const meta: Record<string, string> = { ...exif };
  if (d.width) meta.width = String(d.width);
  if (d.height) meta.height = String(d.height);
  const taken = exif.DateTimeOriginal ?? exif.DateTime;
  const date = taken ? taken.replace(/^(\d{4}):(\d{2}):(\d{2}).*/, '$1-$2-$3') : undefined;
  return {
    kind: 'image', mime, text: '', segments: [], pageCount: 1, meta,
    citation: { type: 'record', date, authors: exif.Artist ? [exif.Artist] : undefined },
  };
}
