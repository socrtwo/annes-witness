// The .witness file: a ZIP with case.json, journal.jsonl, sources/, derived/ and manifest.json.
import JSZip from 'jszip';
import type { CaseData, Id, TableName } from '../core/types';
import { TABLES } from '../core/types';
import { emptyCase, normalizeCase, type JournalEntry } from '../core/case';
import { sha256 } from '../core/util';

export const APP_NAME = "Anne's Witness 0.2.0";

export interface Manifest {
  format: 'annes-witness';
  version: 1;
  app: string;
  saved: string;
  counts: Record<string, number>;
  hashes: Record<string, string>;
  seal?: { sealedAt: string; by: string; root: string };
}

function safeName(s: string): string {
  return (s || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120);
}

async function rootHash(hashes: Record<string, string>): Promise<string> {
  const lines = Object.keys(hashes).sort().map((k) => `${k}:${hashes[k]}`).join('\n');
  return sha256(lines);
}

export async function saveCase(
  data: CaseData,
  journal: JournalEntry[],
  blobs: Map<Id, Uint8Array>,
  opts: { seal?: { by: string } } = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  const files: Record<string, Uint8Array | string> = {};
  files['case.json'] = JSON.stringify(data, null, 1);
  files['journal.jsonl'] = journal.map((j) => JSON.stringify(j)).join('\n') + (journal.length ? '\n' : '');
  for (const s of Object.values(data.sources)) {
    const b = blobs.get(s.id);
    if (b && s.embedded) files[`sources/${s.id}/${safeName(s.fileName ?? s.title)}`] = b;
    if (s.text) files[`derived/${s.id}.txt`] = s.text;
  }
  const hashes: Record<string, string> = {};
  for (const [p, v] of Object.entries(files)) hashes[p] = await sha256(v);
  const counts: Record<string, number> = {};
  for (const t of TABLES) counts[t] = Object.keys((data as any)[t] ?? {}).length;
  counts.journal = journal.length;
  const manifest: Manifest = { format: 'annes-witness', version: 1, app: APP_NAME, saved: new Date().toISOString(), counts, hashes };
  if (opts.seal) manifest.seal = { sealedAt: manifest.saved, by: opts.seal.by, root: await rootHash(hashes) };
  zip.file('mimetype', 'application/vnd.annes-witness+zip', { compression: 'STORE' });
  for (const [p, v] of Object.entries(files)) zip.file(p, v);
  zip.file('manifest.json', JSON.stringify(manifest, null, 1));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** Inflate raw DEFLATE data with the platform's DecompressionStream, tolerating truncation. */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } catch {
      /* truncated stream: keep what was produced */
    }
  })();
  try {
    await writer.write(new Uint8Array(data));
    await writer.close();
  } catch {
    /* ignore: corrupt input */
  }
  await pump;
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** Recover entries from a damaged ZIP by scanning local file headers. */
export async function salvageZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sigAt = (i: number) => bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 3 && bytes[i + 3] === 4;
  const starts: number[] = [];
  for (let i = 0; i + 30 <= bytes.length; i++) if (sigAt(i)) starts.push(i);
  for (let k = 0; k < starts.length; k++) {
    const i = starts[k];
    try {
      const flags = dv.getUint16(i + 6, true);
      const method = dv.getUint16(i + 8, true);
      let csize = dv.getUint32(i + 18, true);
      const nlen = dv.getUint16(i + 26, true);
      const xlen = dv.getUint16(i + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nlen));
      const dataStart = i + 30 + nlen + xlen;
      const next = k + 1 < starts.length ? starts[k + 1] : bytes.length;
      if ((flags & 8) || csize === 0 || dataStart + csize > bytes.length) csize = Math.max(0, Math.min(next, bytes.length) - dataStart);
      const raw = bytes.subarray(dataStart, dataStart + csize);
      if (!name || name.endsWith('/')) continue;
      const content = method === 0 ? raw.slice() : method === 8 ? await inflateRaw(raw) : null;
      if (content && content.length) out.set(name, content);
    } catch {
      /* skip this entry */
    }
  }
  return out;
}

export interface LoadResult {
  data: CaseData;
  journal: JournalEntry[];
  blobs: Map<Id, Uint8Array>;
  sealed: boolean;
  manifest?: Manifest;
  report: string[];
}

function parseJournal(text: string, report: string[]): JournalEntry[] {
  const out: JournalEntry[] = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const j = JSON.parse(line) as JournalEntry;
      if (typeof j.seq === 'number' && Array.isArray(j.ops)) out.push(j);
      else report.push(`Journal line ${i + 1} is not a journal entry; skipped.`);
    } catch {
      report.push(`Journal line ${i + 1} is damaged; skipped.`);
    }
  });
  return out;
}

/** Rebuild case data by replaying journal operations. */
export function replayJournal(journal: JournalEntry[]): CaseData {
  const d = emptyCase();
  for (const j of [...journal].sort((a, b) => a.seq - b.seq))
    for (const op of j.ops) {
      if (!TABLES.includes(op.table as TableName)) continue;
      const t = (d as any)[op.table] as Record<string, unknown>;
      if (op.after === undefined || op.after === null) delete t[op.id];
      else t[op.id] = op.after;
    }
  return d;
}

export async function loadCase(bytes: Uint8Array): Promise<LoadResult> {
  const report: string[] = [];
  let entries = new Map<string, Uint8Array>();
  try {
    const zip = await JSZip.loadAsync(bytes);
    for (const [name, f] of Object.entries(zip.files)) {
      if (f.dir) continue;
      try {
        entries.set(name, await f.async('uint8array'));
      } catch {
        report.push(`Entry ${name} could not be read.`);
      }
    }
  } catch (e) {
    report.push(`The file is damaged (${(e as Error).message}); recovering entries one by one.`);
    entries = await salvageZip(bytes);
    report.push(`Recovered ${entries.size} entr${entries.size === 1 ? 'y' : 'ies'}.`);
  }
  const td = new TextDecoder();
  const str = (p: string) => (entries.has(p) ? td.decode(entries.get(p)) : undefined);
  let manifest: Manifest | undefined;
  try {
    const m = str('manifest.json');
    if (m) manifest = JSON.parse(m);
  } catch {
    report.push('The manifest is damaged.');
  }
  const jtext = str('journal.jsonl');
  const journal = jtext ? parseJournal(jtext, report) : [];
  if (!jtext) report.push('No journal found.');
  let data: CaseData | undefined;
  try {
    const c = str('case.json');
    if (c) {
      const parsed = JSON.parse(c);
      if (parsed?.format !== 'annes-witness') throw new Error('not a case');
      data = normalizeCase(parsed);
    }
  } catch {
    report.push('case.json is damaged.');
  }
  if (!data) {
    if (journal.length) {
      data = replayJournal(journal);
      report.push(`Case rebuilt from ${journal.length} journal entries.`);
    } else {
      if (!entries.size) throw new Error('This is not an Anne\'s Witness case, or nothing in it could be recovered.');
      data = emptyCase();
      report.push('Nothing of the case data could be recovered; an empty case was created.');
    }
  }
  const blobs = new Map<Id, Uint8Array>();
  for (const [p, b] of entries) {
    const m = /^sources\/([^/]+)\//.exec(p);
    if (m) blobs.set(m[1], b);
    const d = /^derived\/([^/]+)\.txt$/.exec(p);
    if (d && data.sources[d[1]] && !data.sources[d[1]].text) {
      data.sources[d[1]].text = td.decode(b);
      report.push(`Text of “${data.sources[d[1]].title}” restored from derived/.`);
    }
  }
  return { data, journal, blobs, sealed: !!manifest?.seal, manifest, report };
}

export async function verifySeal(bytes: Uint8Array): Promise<{ ok: boolean; sealed: boolean; differences: string[] }> {
  const zip = await JSZip.loadAsync(bytes);
  const mtext = await zip.file('manifest.json')?.async('string');
  if (!mtext) return { ok: false, sealed: false, differences: ['No manifest.'] };
  const m = JSON.parse(mtext) as Manifest;
  if (!m.seal) return { ok: false, sealed: false, differences: ['This case is not sealed.'] };
  const differences: string[] = [];
  const present = new Set<string>();
  for (const [name, f] of Object.entries(zip.files)) {
    if (f.dir || name === 'manifest.json' || name === 'mimetype') continue;
    present.add(name);
    const h = await sha256(await f.async('uint8array'));
    if (!(name in m.hashes)) differences.push(`Added after sealing: ${name}`);
    else if (m.hashes[name] !== h) differences.push(`Changed after sealing: ${name}`);
  }
  for (const p of Object.keys(m.hashes)) if (!present.has(p)) differences.push(`Missing: ${p}`);
  if ((await rootHash(m.hashes)) !== m.seal.root) differences.push('The manifest’s hash list was altered.');
  return { ok: differences.length === 0, sealed: true, differences };
}

// ---- Text folder export, for version control ----

function frontMatter(obj: Record<string, unknown>): string {
  const lines = Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

function parseFrontMatter(md: string): { meta: Record<string, any>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(md);
  if (!m) return { meta: {}, body: md };
  const meta: Record<string, any> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(': ');
    if (i > 0) {
      try {
        meta[line.slice(0, i)] = JSON.parse(line.slice(i + 2));
      } catch {
        meta[line.slice(0, i)] = line.slice(i + 2);
      }
    }
  }
  return { meta, body: m[2] };
}

export async function exportTextFolder(data: CaseData, journal: JournalEntry[]): Promise<Uint8Array> {
  const zip = new JSZip();
  const root = zip.folder('case')!;
  root.file('settings.json', JSON.stringify({ format: data.format, version: data.version, id: data.id, created: data.created, settings: data.settings }, null, 2));
  for (const s of Object.values(data.sources)) {
    const { text, ...rest } = s;
    root.file(`sources/${s.id}.json`, JSON.stringify(rest, null, 2));
    root.file(`sources/${s.id}.txt`, text ?? '');
  }
  for (const c of Object.values(data.claims)) {
    const { text, notes, ...rest } = c;
    root.file(`claims/${String(c.number).padStart(4, '0')}.md`, frontMatter(rest as any) + `\n${text}\n` + (notes ? `\n## Notes\n\n${notes}\n` : ''));
  }
  for (const r of Object.values(data.reckonings)) {
    const { conclusion, ...rest } = r;
    root.file(`reckonings/${r.id}.md`, frontMatter(rest as any) + `\n${conclusion ?? ''}\n`);
  }
  root.file('anchors.json', JSON.stringify(Object.values(data.anchors), null, 2));
  root.file('ties.json', JSON.stringify(Object.values(data.ties), null, 2));
  for (const t of ['log', 'todos', 'comments', 'signoffs', 'rules', 'aiHistory', 'views'] as const)
    root.file(`${t}.json`, JSON.stringify(Object.values(data[t]), null, 2));
  root.file('journal.jsonl', journal.map((j) => JSON.stringify(j)).join('\n') + '\n');
  root.file('README.md', `# ${data.settings.title}\n\nAn Anne's Witness case exported as text. Import it with File ▸ Import ▸ Case Text Folder.\n`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function importTextFolder(bytes: Uint8Array): Promise<CaseData> {
  const zip = await JSZip.loadAsync(bytes);
  const prefix = Object.keys(zip.files).find((p) => p.endsWith('settings.json'))?.replace(/settings\.json$/, '') ?? '';
  const read = async (p: string) => zip.file(prefix + p)?.async('string');
  const head = JSON.parse((await read('settings.json')) ?? '{}');
  const d = emptyCase();
  if (head.id) d.id = head.id;
  if (head.created) d.created = head.created;
  d.settings = { ...d.settings, ...(head.settings ?? {}) };
  for (const p of Object.keys(zip.files)) {
    if (!p.startsWith(prefix)) continue;
    const rel = p.slice(prefix.length);
    const sm = /^sources\/([^/]+)\.json$/.exec(rel);
    if (sm) {
      const s = JSON.parse((await read(rel))!);
      s.text = (await read(`sources/${sm[1]}.txt`)) ?? '';
      d.sources[s.id] = s;
    }
    if (/^claims\/\d+\.md$/.test(rel)) {
      const { meta, body } = parseFrontMatter((await read(rel))!);
      const notesAt = body.indexOf('\n## Notes\n');
      const text = (notesAt >= 0 ? body.slice(0, notesAt) : body).trim();
      const notes = notesAt >= 0 ? body.slice(notesAt + 10).trim() : undefined;
      d.claims[meta.id] = { ...(meta as any), text, ...(notes ? { notes } : {}) };
    }
    if (/^reckonings\/[^/]+\.md$/.test(rel)) {
      const { meta, body } = parseFrontMatter((await read(rel))!);
      const conclusion = body.trim();
      d.reckonings[meta.id] = { ...(meta as any), ...(conclusion ? { conclusion } : {}) };
    }
  }
  for (const t of ['anchors', 'ties', 'log', 'todos', 'comments', 'signoffs', 'rules', 'aiHistory', 'views'] as const) {
    const j = await read(`${t}.json`);
    if (!j) continue;
    for (const rec of JSON.parse(j) as { id: string }[]) (d as any)[t][rec.id] = rec;
  }
  return d;
}

/** Journal entries from a text folder, if present. */
export async function importTextFolderJournal(bytes: Uint8Array): Promise<JournalEntry[]> {
  const zip = await JSZip.loadAsync(bytes);
  const p = Object.keys(zip.files).find((x) => x.endsWith('journal.jsonl'));
  const t = p ? await zip.file(p)!.async('string') : '';
  return parseJournal(t, []);
}
