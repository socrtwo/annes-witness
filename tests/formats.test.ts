import { describe, it, expect } from 'vitest';
import { parseBibtex, toBibtex, parseRis, toRis, parseCslJson, toCslJson, parseWebAnnotations, parseClaimsCsv, parseSourcesCsv, parseIdentifier } from '../src/io/formats';
import type { Source } from '../src/core/types';

const src = (citation: Source['citation'], title = citation.title ?? 'x'): Source => ({
  id: 's1', role: 'source', title, kind: 'reference', embedded: false, added: '', citation, classification: 'unknown', derivedFrom: [], confidential: false, tags: [], text: '', segments: [],
});

describe('citation formats', () => {
  const bib = `@comment{ignore}
@article{smith2020,
  author = {Smith, John and M{\\"u}ller, Anna},
  title = {Birth {Registers} in Ohio},
  journal = "Journal of Records",
  year = 2020, volume = {12}, pages = {1--20},
  doi = {10.1234/jr.2020.12}
}`;
  it('parses and writes BibTeX', () => {
    const [c] = parseBibtex(bib);
    expect(c).toMatchObject({ type: 'article', authors: ['Smith, John', 'Muller, Anna'], title: 'Birth Registers in Ohio', container: 'Journal of Records', year: '2020', volume: '12', pages: '1–20', doi: '10.1234/jr.2020.12' });
    const out = toBibtex([src(c)]);
    expect(out).toMatch(/^@article\{Smith2020,/);
    expect(parseBibtex(out)[0]).toMatchObject({ title: 'Birth Registers in Ohio', pages: '1–20' });
  });
  it('parses and writes RIS', () => {
    const ris = 'TY  - BOOK\r\nAU  - Doe, Jane\r\nTI  - County History\r\nPY  - 1888\r\nPB  - Old Press\r\nSP  - 10\r\nEP  - 12\r\nER  - \r\n';
    const [c] = parseRis(ris);
    expect(c).toMatchObject({ type: 'book', authors: ['Doe, Jane'], title: 'County History', year: '1888', publisher: 'Old Press', pages: '10–12' });
    expect(parseRis(toRis([src(c)]))[0]).toMatchObject({ title: 'County History', pages: '10–12', year: '1888' });
  });
  it('parses and writes CSL-JSON', () => {
    const json = JSON.stringify([{ type: 'webpage', title: 'Parish page', URL: 'https://x.org', author: [{ family: 'Lee', given: 'Ann' }], issued: { 'date-parts': [[2019, 5, 2]] } }]);
    const [c] = parseCslJson(json);
    expect(c).toMatchObject({ type: 'web', title: 'Parish page', url: 'https://x.org', authors: ['Lee, Ann'], date: '2019-05-02', year: '2019' });
    const back = parseCslJson(toCslJson([src(c)]));
    expect(back[0]).toMatchObject({ authors: ['Lee, Ann'], date: '2019-05-02' });
  });
});

describe('annotations, lists and identifiers', () => {
  it('parses W3C and Hypothes.is annotations', () => {
    const w3c = { type: 'Annotation', body: { type: 'TextualBody', value: 'Key line' }, target: { source: 'https://a.org', selector: [{ type: 'TextPositionSelector', start: 1, end: 5 }, { type: 'TextQuoteSelector', exact: 'born 1902', prefix: 'was ', suffix: ' in' }] } };
    expect(parseWebAnnotations(JSON.stringify(w3c))).toEqual([{ url: 'https://a.org', exact: 'born 1902', prefix: 'was ', suffix: ' in', note: 'Key line' }]);
    const hyp = { rows: [{ uri: 'https://b.org', text: 'note', target: [{ source: 'https://b.org', selector: [{ type: 'TextQuoteSelector', exact: 'quote' }] }] }] };
    expect(parseWebAnnotations(JSON.stringify(hyp))[0]).toMatchObject({ url: 'https://b.org', exact: 'quote', note: 'note' });
  });
  it('parses claim and source lists', () => {
    expect(parseClaimsCsv('Claim,Kind,Tags\n"She was born in 1902.",date,"birth;ohio"\n,,\nHe died.,fact,')).toEqual([
      { text: 'She was born in 1902.', kind: 'date', tags: ['birth', 'ohio'] },
      { text: 'He died.', kind: 'fact' },
    ]);
    expect(parseClaimsCsv('Only one column line\nAnother')).toHaveLength(2);
    expect(parseSourcesCsv('Title,URL,Year\nCensus,https://c.org,1910')).toEqual([{ title: 'Census', url: 'https://c.org', date: '1910' }]);
  });
  it('recognizes identifiers', () => {
    expect(parseIdentifier('https://doi.org/10.1000/xyz123.')).toEqual({ type: 'doi', value: '10.1000/xyz123' });
    expect(parseIdentifier('ISBN 978-0-306-40615-7')).toEqual({ type: 'isbn', value: '9780306406157' });
    expect(parseIdentifier('0-306-40615-2')).toEqual({ type: 'isbn', value: '0306406152' });
    expect(parseIdentifier('PMID: 12345678')).toEqual({ type: 'pmid', value: '12345678' });
    expect(parseIdentifier('https://example.org/x')).toEqual({ type: 'url', value: 'https://example.org/x' });
    expect(parseIdentifier('hello world')).toBeNull();
  });
});
