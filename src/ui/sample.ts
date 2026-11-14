// The guided example: a small made-up case where three sources disagree about a birth year.
import { emptyCase } from '../core/case';
import { CaseData, Source } from '../core/types';
import { newId, nowIso } from '../core/util';
import { splitSentences } from '../text/sentences';

const T = nowIso();

function src(title: string, text: string, extra: Partial<Source> = {}): Source {
  let pos = 0;
  const segments = text.split('\n').map((line, i) => { const s = { start: pos, end: pos + line.length, label: `line ${i + 1}` }; pos += line.length + 1; return s; });
  return {
    id: newId('s'), role: 'source', title, kind: 'text', embedded: false, added: T, citation: { title }, classification: 'unknown',
    derivedFrom: [], confidential: false, tags: ['example'], text, segments, ...extra,
  };
}

export function buildSample(): CaseData {
  const d = emptyCase();
  d.settings.title = 'Guided example: when was Mary Ann Smith born?';
  d.settings.question = 'When and where was Mary Ann Smith, daughter of John and Ellen Smith, born?';
  d.settings.template = 'family-history';
  const census = src('1910 census, Ohio, household of John Smith (made-up)', [
    'Thirteenth Census of the United States, 1910 — Population (example transcription)',
    'Household of John Smith, farmer, age 41, born Ohio.',
    'Ellen Smith, wife, age 36, born Pennsylvania.',
    'Mary Ann Smith, daughter, age 8, born about 1902 in Ohio.',
    'Informant not stated.',
  ].join('\n'), { classification: 'original', dateMade: '1910-04-15', citation: { type: 'record', title: '1910 census, household of John Smith', repository: 'Example Archive', year: '1910' } });
  const register = src('Parish register of St. John’s, baptisms 1903 (made-up)', [
    'Register of Baptisms, St. John’s Church, 1903',
    '3 May 1903. Mary Ann, daughter of John and Ellen Smith, born 20 April 1903.',
    'Sponsors: Thomas and Sarah Brown. Entry made by the minister on the day of baptism.',
  ].join('\n'), { classification: 'original', dateMade: '1903-05-03', citation: { type: 'record', title: 'Register of Baptisms, St. John’s Church', repository: 'Example Diocese', year: '1903' } });
  const index = src('County birth index, compiled 1950 (made-up)', [
    'Index compiled in 1950 from the 1910 census returns.',
    'Smith, Mary Ann — b. 1902 — parents John and Ellen.',
  ].join('\n'), { classification: 'derivative', dateMade: '1950', derivedFrom: [{ sourceId: census.id, how: 'index' }], citation: { type: 'dataset', title: 'County birth index', year: '1950' } });
  const docText = 'Mary Ann Smith was born in 1902 in Ohio. Her parents were John and Ellen Smith. She was baptized at St. John’s Church.';
  const doc: Source = { ...src('Family history draft (made-up)', docText), role: 'document', tags: ['example'] };
  for (const s of [census, register, index, doc]) d.sources[s.id] = s;
  let n = 1;
  for (const s of splitSentences(docText)) {
    const id = newId('c');
    d.claims[id] = {
      id, number: n++, text: s.text.trim(), kind: n === 2 ? 'date' : 'fact', importance: 'normal', dependsOn: [], tags: [],
      doc: { documentId: doc.id, start: s.start, end: s.end, textAtCapture: docText.slice(s.start, s.end) }, created: T,
    };
  }
  return d;
}
