// Case templates: settings, tick legend, rules and search checklists for each kind of work.
// They describe common practice in plain words; they certify nothing (see docs/LEGAL.md).
import { CaseSettings, Rule } from '../core/types';
import { newId } from '../core/util';

export interface Template {
  id: string;
  label: string;
  description: string;
  settings: Partial<CaseSettings>;
  rules: Omit<Rule, 'id'>[];
  checklist: string[];
}

export const TEMPLATES: Template[] = [
  {
    id: 'blank', label: 'Blank case', description: 'No presets.', settings: {}, rules: [], checklist: [],
  },
  {
    id: 'family-history', label: 'Family-history proof',
    description: 'Weigh records about people: originals and copies, first- and second-hand information, conflicts resolved in writing.',
    settings: { standard: 'Common family-history practice: reasonably exhaustive search, source and information analysis, correlation, resolution of conflicts, written conclusion. This template does not certify conformance to any standard.', citationStyle: 'notes', calendarDefault: 'gregorian' },
    rules: [
      { name: 'Vital facts need two independent sources', pattern: '\\b(born|died|married|baptized|buried)\\b', condition: 'minIndependent', value: 2, message: 'Birth, death and marriage claims should rest on at least two independent sources.', enabled: true },
      { name: 'Relationships need first-hand information', pattern: '\\b(daughter|son|father|mother|wife|husband|child)\\b', condition: 'requiresFirstHand', value: 1, message: 'A relationship claim rests only on second-hand or unknown information.', enabled: true },
    ],
    checklist: ['Civil birth, marriage and death registers', 'Church registers (baptisms, marriages, burials)', 'Census returns', 'Wills and probate files', 'Land and tax records', 'Newspapers (notices, obituaries)', 'Cemetery and gravestone records', 'Military and pension files', 'Immigration and naturalization records', 'Family Bibles and letters'],
  },
  {
    id: 'financial-tieout', label: 'Financial report tie-out',
    description: 'Tie each figure in a statement or report to ledgers, schedules and bank statements; foot and cross-foot.',
    settings: { standard: 'Common tie-out practice: every figure agreed to support, totals footed and cross-footed, prepared and reviewed sign-offs. This template does not certify conformance to any auditing standard.', numberTolerance: 0.5, materiality: 1000 },
    rules: [
      { name: 'Figures need a tick mark', pattern: '\\d', condition: 'requiresTick', value: 1, message: 'Each confirmed tie on a figure should carry a tick mark from the legend.', enabled: true },
      { name: 'Large figures need two supports', pattern: '\\d', condition: 'numberAbove', value: 100000, message: 'Figures above the threshold should be supported by two sources.', enabled: false },
    ],
    checklist: ['General ledger', 'Trial balance', 'Bank statements and reconciliations', 'Supporting schedules', 'Contracts and invoices', 'Prior-period report (roll-forward)', 'Board minutes'],
  },
  {
    id: 'fact-check', label: 'Article fact check',
    description: 'Check every name, number, date and quotation in copy before publication.',
    settings: { standard: 'Common editorial fact-checking practice: each checkable statement is verified against a primary source where possible; quotations are checked word for word.', citationStyle: 'author-date' },
    rules: [
      { name: 'Quotations need a first-hand source', pattern: '["“]', condition: 'requiresFirstHand', value: 1, message: 'A quotation should be checked against a recording, transcript or the speaker.', enabled: true },
    ],
    checklist: ['Primary documents and data sets', 'Recordings and transcripts of quoted people', 'Official statements and records', 'Earlier reporting (as leads, not as proof)', 'The people named, for confirmation'],
  },
  {
    id: 'manuscript', label: 'Book manuscript', description: 'Check facts and quotations chapter by chapter; group claims by chapter.',
    settings: { citationStyle: 'notes' }, rules: [], checklist: ['Archival sources', 'Published primary sources', 'Interviews', 'Secondary works'],
  },
  {
    id: 'research-paper', label: 'Research paper', description: 'Show which page of which work supports each sentence; catch invented references.',
    settings: { citationStyle: 'author-date' }, rules: [], checklist: ['Cited works (full text)', 'Data sets', 'Supplementary material'],
  },
  {
    id: 'ocr-verification', label: 'OCR verification', description: 'Confirm recognized text against the page pictures; compare transcriptions.',
    settings: {}, rules: [], checklist: ['Page images at full resolution', 'Second OCR engine output', 'Typed transcription'],
  },
  {
    id: 'translation', label: 'Translation check', description: 'Tie each translated sentence to the original passage it renders.',
    settings: {}, rules: [], checklist: ['Original text', 'Earlier translations', 'Dictionaries of the period'],
  },
];

export function templateRules(t: Template): Rule[] {
  return t.rules.map((r) => ({ ...r, id: newId('r') }));
}
