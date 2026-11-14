// Format commands added in the final round: Repair Source File.
import { register } from './registry';
import { app } from './app';
import { h } from './dom';
import { alertBox, confirmBox, progress } from './dialogs';
import { need, needSource, UserError } from './common';
import { repairSourceFile } from '../repair/index';
import { Source } from '../core/types';
import { newId, nowIso, sha256 } from '../core/util';

export function registerFormatCommands() {
  register('source.repair', async () => {
    const s = needSource();
    const bytes = need(app.blobs.get(s.id), 'The file of this source is not stored in the case, so there is nothing to repair. Use Relink Source to attach it first.');
    if (!(await confirmBox('Repair Source File', `Try to recover the text of “${s.title}”? The original source stays as it is; whatever is recovered is added as a new source marked as derived from it.`, 'Repair'))) return;
    const p = progress('Repairing');
    let r;
    try {
      p.update(`Reading ${s.fileName ?? s.title}…`);
      r = await repairSourceFile(s.fileName ?? `${s.title}.${s.kind}`, bytes);
    } finally { p.close(); }
    const reportView = (title: string) => h('div', h('p', title), h('pre.report', r.report.join('\n')));
    if (!r.ok || !r.result) {
      await alertBox('Repair Source File', reportView('Nothing could be recovered.'));
      return;
    }
    const res = r.result;
    const blob = r.repairedBytes;
    const repaired: Source = {
      id: newId('s'), role: 'source', title: `${s.title} (repaired)`, kind: res.kind, mime: res.mime,
      fileName: r.repairedName ?? (s.fileName ? `${s.fileName.replace(/\.[^.]+$/, '')} (repaired text).txt` : undefined),
      fileHash: blob ? await sha256(blob) : undefined, contentHash: await sha256(res.text), embedded: !!blob, size: blob?.byteLength, added: nowIso(),
      citation: { ...s.citation, note: [s.citation.note, 'Text recovered from a damaged file.'].filter(Boolean).join(' ') },
      dateMade: s.dateMade, place: s.place, classification: 'derivative', derivedFrom: [{ sourceId: s.id, how: 'copy' }],
      reliability: 'Recovered from a damaged file by Repair Source File; check passages against the original where possible.',
      confidential: s.confidential, group: s.group, tags: [...new Set([...s.tags, 'repaired'])],
      text: res.text, segments: res.segments, pageCount: res.pageCount,
      meta: { ...(res.meta ?? {}), repairReport: r.report.join('\n') },
    };
    if (blob) app.blobs.set(repaired.id, blob);
    app.store.transact(`Repair ${s.title}`, (tx) => tx.put('sources', repaired));
    app.select({ sourceId: repaired.id });
    await alertBox('Repair Source File', reportView(`Recovered ${res.text.length.toLocaleString()} characters into the new source “${repaired.title}”.`));
  });
  void UserError;
}
