// Spelling, language and downloaded models.
import { register } from './registry';
import { app } from './app';
import { h } from './dom';
import { form, showPanel, toast, confirmBox, progress } from './dialogs';
import { UserError } from './common';
import { Claim, Source } from '../core/types';
import { truncate } from '../core/util';

export const OCR_LANGS: Record<string, string> = {
  eng: 'English', deu: 'German', fra: 'French', spa: 'Spanish', ita: 'Italian', por: 'Portuguese', nld: 'Dutch', swe: 'Swedish',
  nor: 'Norwegian', dan: 'Danish', fin: 'Finnish', pol: 'Polish', ces: 'Czech', hun: 'Hungarian', lat: 'Latin', 'deu_latf': 'German (Fraktur)',
  ell: 'Greek', rus: 'Russian', ukr: 'Ukrainian', heb: 'Hebrew', ara: 'Arabic', chi_sim: 'Chinese (simplified)', chi_tra: 'Chinese (traditional)', jpn: 'Japanese', kor: 'Korean',
};

export const caseLanguage = () => app.data.settings.language ?? { spell: 'en-US', ocr: 'eng' };

export function registerExtraCommands() {
  register('tools.language', async () => {
    const { SPELL_LANGS } = await import('../text/spell');
    const cur = caseLanguage();
    const r = await form<{ spell: string; ocr: string }>('Language', [
      { key: 'spell', label: 'Spelling dictionary', type: 'select', value: cur.spell, options: Object.entries(SPELL_LANGS).map(([value, label]) => ({ value, label })) },
      { key: 'ocr', label: 'Language of scanned pages (Recognize Text)', type: 'select', value: cur.ocr, options: Object.entries(OCR_LANGS).map(([value, label]) => ({ value, label })) },
    ], 'Save', 'For this case. The interface itself is in English. Recognize Text downloads the chosen language model on first use; AI ▸ Delete Downloaded Models removes them.');
    if (r) { app.store.transact('Language', () => { app.data.settings.language = r; }); app.store.touch(); }
  });

  register('tools.spelling', async () => {
    const what = await form<{ claims: boolean; notes: boolean; trans: boolean; src: boolean }>('Spelling', [
      { key: 'claims', label: 'Claims', type: 'checkbox', value: true },
      { key: 'notes', label: 'Notes on claims and sources, conclusions', type: 'checkbox', value: true },
      { key: 'trans', label: 'Your transcriptions', type: 'checkbox', value: true },
      { key: 'src', label: `Text of the selected source${app.source ? ` (“${truncate(app.source.title, 40)}”)` : ''} — to spot OCR errors; source text is never changed`, type: 'checkbox', value: false },
    ], 'Check');
    if (!what) return;
    const p = progress('Loading the dictionary');
    let sp;
    try { sp = await (await import('../text/spell')).loadSpeller(caseLanguage().spell); } finally { p.close(); }
    const { checkText } = await import('../text/spell');
    const extra = new Set((app.data.settings.dictionary ?? []).map((w) => w.toLowerCase()));
    type Hit = { where: string; word: string; suggestions: string[]; fix?: (to: string) => void; go: () => void };
    const hits: Hit[] = [];
    const scan = (text: string | undefined, where: string, go: () => void, fix?: (word: string, to: string) => void) => {
      if (!text) return;
      for (const m of checkText(sp!, text, extra)) hits.push({ where, word: m.word, suggestions: m.suggestions, go, fix: fix ? (to) => fix(m.word, to) : undefined });
    };
    const replaceWord = (s: string, w: string, to: string) => s.replace(new RegExp(`(?<![\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u'), to);
    for (const c of app.store.claims) {
      if (what.claims) scan(c.text, `Claim ${c.number}`, () => app.select({ claimId: c.id }), (w, to) => app.store.transact(`Spelling in claim ${c.number}`, (tx) => tx.update<Claim>('claims', c.id, { text: replaceWord(app.data.claims[c.id].text, w, to) })));
      if (what.notes) scan(c.notes, `Note on claim ${c.number}`, () => app.select({ claimId: c.id }), (w, to) => app.store.transact('Spelling in note', (tx) => tx.update<Claim>('claims', c.id, { notes: replaceWord(app.data.claims[c.id].notes ?? '', w, to) })));
    }
    for (const s of app.store.sources) {
      if (what.notes) scan(s.notes, `Notes on ${s.title}`, () => app.select({ sourceId: s.id }), (w, to) => app.store.transact('Spelling in note', (tx) => tx.update<Source>('sources', s.id, { notes: replaceWord(app.data.sources[s.id].notes ?? '', w, to) })));
      if (what.trans) scan(s.transcription, `Transcription of ${s.title}`, () => app.select({ sourceId: s.id }), (w, to) => app.store.transact('Spelling in transcription', (tx) => tx.update<Source>('sources', s.id, { transcription: replaceWord(app.data.sources[s.id].transcription ?? '', w, to) })));
    }
    if (what.notes) for (const r of Object.values(app.data.reckonings)) scan(r.conclusion, `Conclusion for claim ${app.data.claims[r.claimId]?.number}`, () => app.select({ claimId: r.claimId }));
    if (what.src && app.source) scan(app.source.text.slice(0, 300_000), `Source text: ${app.source.title} (not changed)`, () => {});
    if (!hits.length) return toast('No spelling problems found.');
    const addWord = (w: string) => app.store.transact('Add to case dictionary', () => { app.data.settings.dictionary = [...new Set([...(app.data.settings.dictionary ?? []), w])]; });
    const table = h('table.findings', h('tbody', hits.slice(0, 1500).map((x) => {
      const row = h('tr', { onclick: x.go },
        h('td', x.where), h('td', h('strong', x.word)),
        h('td', x.fix ? x.suggestions.map((sg) => h('button', { onclick: (e: Event) => { e.stopPropagation(); x.fix!(sg); row.style.opacity = '.4'; } }, sg)) : x.suggestions.join(', ')),
        h('td', h('button', { title: 'Add to this case’s dictionary', onclick: (e: Event) => { e.stopPropagation(); addWord(x.word); row.style.opacity = '.4'; } }, 'Add')));
      return row;
    })));
    await showPanel(`Spelling (${hits.length})`, table);
  });

  register('ai.deleteModels', async () => {
    if (!(await confirmBox('Delete Downloaded Models', 'Remove the text-recognition (OCR) language models downloaded by Recognize Text? They are downloaded again when needed. Anne’s Witness downloads no AI language models: passage selection for AI commands runs on this device without a model.', 'Delete'))) return;
    if (typeof indexedDB === 'undefined') throw new UserError('No browser storage is available.');
    await new Promise<void>((res) => { const r = indexedDB.deleteDatabase('keyval-store'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    toast('Downloaded models removed.');
  });
}
