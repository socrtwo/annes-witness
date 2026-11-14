import { parseCsv } from '../core/util';
import { decodeText } from './common';
import type { ReadResult } from './index';

export function readCsv(bytes: Uint8Array, name = 'data.csv', tsv = false): ReadResult {
  const raw = decodeText(bytes);
  const delim = tsv || (raw.split('\n')[0].split('\t').length > raw.split('\n')[0].split(',').length) ? '\t' : ',';
  const rows = parseCsv(raw, delim);
  const sheet = name.replace(/\.[^.]+$/, '');
  let text = '';
  const segments: ReadResult['segments'] = [];
  rows.forEach((row, r) => {
    if (r > 0) text += '\n';
    row.forEach((cell, c) => {
      if (c > 0) text += '\t';
      const start = text.length;
      text += cell;
      if (cell !== '') segments.push({ start, end: text.length, label: `R${r + 1}C${c + 1}`, sheet, row: r + 1, col: c + 1 });
    });
  });
  return { kind: 'workbook', mime: delim === '\t' ? 'text/tab-separated-values' : 'text/csv', text, segments };
}
