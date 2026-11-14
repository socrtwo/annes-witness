import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCsl, cslBibliography, cslCitation, cslInfo, parseXml, parseDate } from '../src/reports/csl';
import type { CitationFields } from '../src/core/types';

const style = (f: string) => parseCsl(readFileSync(resolve(__dirname, 'fixtures/csl', f), 'utf8'));
const AD = style('witness-author-date.csl');
const NOTE = style('witness-note.csl');

const book: CitationFields = { type: 'book', authors: ['Smith, Mary Ann', 'John Brown'], title: 'A history of Ohio parishes', publisher: 'Ohio Press', place: 'Columbus', year: '2001' };
const article: CitationFields = { type: 'article', authors: ['Doe, Alice'], title: 'Census methods', container: 'Journal of Records', volume: '4', issue: '2', pages: '1-20', year: '1999', doi: '10.1234/abc' };
const web: CitationFields = { type: 'web', title: 'Parish registers online', container: 'Example Archive', url: 'https://example.org/registers', accessed: '2026-11-14' };
const record: CitationFields = { type: 'record', title: 'Register of Baptisms, 1903', repository: 'Example Diocese', callNumber: 'Box 4, vol. 2', date: '1903-05-03' };

describe('CSL interpreter', () => {
  it('reads style information', () => {
    expect(cslInfo(AD)).toEqual({ title: 'Witness Test Author-Date', id: 'urn:annes-witness:test-author-date' });
    expect(NOTE.cls).toBe('note');
  });

  it('formats an author-date bibliography for four kinds of source', () => {
    expect(cslBibliography(AD, book)).toBe('Smith, M. A. and J. Brown. (2001). *A history of Ohio parishes*. Columbus: Ohio Press.');
    expect(cslBibliography(AD, article)).toBe('Doe, A. (1999). Census methods. *Journal of Records*, 4(2), 1–20. https://doi.org/10.1234/abc.');
    expect(cslBibliography(AD, web)).toBe('*Parish registers online*. (n.d.). Example Archive. Accessed November 14, 2026. https://example.org/registers.');
    expect(cslBibliography(AD, record)).toBe('*Register of Baptisms, 1903*. (1903). Example Diocese, Box 4, vol. 2.');
  });

  it('formats author-date citations with locators and et al.', () => {
    expect(cslCitation(AD, book, '45')).toBe('(Smith & Brown 2001, p. 45)');
    expect(cslCitation(AD, article, '3-4')).toBe('(Doe 1999, pp. 3–4)');
    expect(cslCitation(AD, { ...book, authors: ['A, B', 'C, D', 'E, F'] })).toBe('(A et al. 2001)');
    // CSL default (contextual): the comma before "and" appears only with three or more names.
    expect(cslBibliography(AD, { ...book, authors: ['A, B', 'C, D', 'E, F'] })).toMatch(/^A, B\., D\. C, and F\. E\. /);
  });

  it('formats notes and a note-style bibliography', () => {
    expect(cslCitation(NOTE, book, '12')).toBe('Mary Ann Smith and John Brown, *A history of Ohio parishes* (Columbus: Ohio Press, 2001), at 12.');
    expect(cslCitation(NOTE, article)).toBe('Alice Doe, “Census methods,” *Journal of Records* (1999).');
    expect(cslCitation(NOTE, record)).toBe('“Register of Baptisms, 1903,” Example Diocese, Box 4, vol. 2 (May 3, 1903).');
    expect(cslCitation(NOTE, web)).toBe('“Parish registers online,” *Example Archive*.');
    expect(cslBibliography(NOTE, book)).toBe('Smith, Mary Ann and John Brown. A History of Ohio Parishes. (Columbus: Ohio Press, 2001).');
  });

  it('suppresses empty groups and reports bad styles clearly', () => {
    expect(cslCitation(AD, { title: 'Untitled' })).toBe('(*Untitled* n.d.)');
    expect(() => parseCsl('<style><citation><layout><text variable="title"></layout></citation></style>')).toThrow(/Malformed/);
    expect(() => parseCsl('<notastyle/>')).toThrow(/root element/);
    expect(() => parseCsl('<style><citation><layout><sorcery/></layout></citation></style>')).toThrow(/Unsupported CSL element <sorcery>/);
    expect(() => parseCsl('<style><info><title>x</title></info></style>')).toThrow(/neither a citation nor a bibliography/);
  });

  it('parses XML entities, CDATA and comments, and dates in several forms', () => {
    const x = parseXml('<?xml version="1.0"?><!-- c --><a t="&amp;x"><![CDATA[<raw>]]>&#233;</a>');
    expect(x.attrs.t).toBe('&x');
    expect(x.children.map((c) => c.text).join('')).toBe('<raw>é');
    expect(parseDate('3 May 1903')).toEqual({ year: 1903, month: 5, day: 3 });
    expect(parseDate('May 3, 1903')).toEqual({ year: 1903, month: 5, day: 3 });
    expect(parseDate('about 1902')).toEqual({ year: 1902 });
  });
});

import { setCslStyle, formatCitation } from '../src/reports/citation';
import { readFileSync as readCsl } from 'node:fs';
import { readdirSync } from 'node:fs';

describe('a loaded CSL style drives citation formatting', () => {
  it('replaces the built-in style and falls back when cleared', () => {
    const dir = new URL('./fixtures/csl/', import.meta.url);
    const file = readdirSync(dir).find((f) => f.endsWith('.csl'))!;
    const fields = { type: 'book' as const, authors: ['Smith, Jane'], title: 'Parish Registers of Ohio', publisher: 'Example Press', place: 'Columbus', year: '1999' };
    const builtIn = formatCitation(fields, 'author-date');
    setCslStyle(readCsl(new URL(file, dir), 'utf8'));
    const viaCsl = formatCitation(fields, 'author-date');
    expect(viaCsl).toContain('Parish Registers of Ohio');
    expect(viaCsl).not.toBe(builtIn);
    setCslStyle(null);
    expect(formatCitation(fields, 'author-date')).toBe(builtIn);
  });
});
