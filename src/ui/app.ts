// Application state, persistence and the core actions commands are built from.
import { CaseStore, JournalEntry, emptyCase } from '../core/case';
import { Anchor, CaseData, Claim, ClaimKind, Id, Rect, Source, SourceRole, Tie, TieKind } from '../core/types';
import { newId, nowIso, sha256 } from '../core/util';
import { makeSelector } from '../core/anchor';
import { allStatuses, StatusResult } from '../core/status';
import { readFile, ReadResult } from '../readers/index';
import { saveCase, loadCase } from '../io/container';
import { runChecks, quickTieTest, Finding } from '../checks/index';
import { loadAiSettings, AiSettings } from '../ai/settings';

export type ViewName = 'workbench' | 'document' | 'source' | 'matrix' | 'coverage' | 'lineage' | 'timeline' | 'people' | 'chronology' | 'wordfreq';

export interface Selection {
  claimId?: Id;
  claimIds: Set<Id>;
  sourceId?: Id;
  documentId?: Id;
  anchorId?: Id;
  tieId?: Id;
  text?: { sourceId: Id; start: number; end: number };
  rect?: Rect & { sourceId: Id };
}

export interface ClaimFilter { text: string; status: string; kind: string; tag: string; group: string; owner: string }

class App {
  store = new CaseStore();
  blobs = new Map<Id, Uint8Array>();
  sel: Selection = { claimIds: new Set() };
  view: ViewName = 'workbench';
  splitSourceId?: Id;
  showProblems = true;
  showDetails = true;
  findings: Finding[] = [];
  filter: ClaimFilter = { text: '', status: '', kind: '', tag: '', group: '', owner: '' };
  blind = false;
  zoom = 1;
  sourceMode: 'auto' | 'text' | 'page' | 'transcription' = 'auto';
  /** Reading aids for page pictures; never saved into the source. */
  pageFilter = { rotate: 0, contrast: 1, invert: false };
  fileHandle: any = null;
  fileName = 'case.witness';
  ai: AiSettings = loadAiSettings();
  history: { claimId?: Id; sourceId?: Id; anchorId?: Id }[] = [];
  future: typeof this.history = [];
  private statusCache: { seq: number; at: number; map: Record<Id, StatusResult> } | null = null;
  private renderers = new Set<() => void>();
  private saveTimer: any = null;

  constructor() {
    this.store.onChange(() => {
      this.statusCache = null;
      this.scheduleAutosave();
      this.render();
    });
  }

  get data(): CaseData { return this.store.data; }

  onRender(f: () => void) { this.renderers.add(f); }
  private pending = false;
  render() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      for (const f of this.renderers) f();
    });
  }

  statuses(): Record<Id, StatusResult> {
    const seq = this.store.seq;
    if (this.statusCache && this.statusCache.seq === seq && this.statusCache.at === this.store.journal.length) return this.statusCache.map;
    const map = allStatuses(this.data, quickTieTest);
    this.statusCache = { seq, at: this.store.journal.length, map };
    return map;
  }
  status(id: Id) { return this.statuses()[id]; }

  runChecks(only?: string[], claimIds?: Id[]) {
    this.findings = runChecks(this.data, { only, claimIds, today: new Date().toISOString().slice(0, 10) });
    this.showProblems = true;
    this.render();
    return this.findings;
  }

  // --- selection & navigation -----------------------------------------------------------------
  select(patch: Partial<Selection>, push = true) {
    if (push) {
      this.history.push({ claimId: this.sel.claimId, sourceId: this.sel.sourceId, anchorId: this.sel.anchorId });
      if (this.history.length > 200) this.history.shift();
      this.future = [];
    }
    this.sel = { ...this.sel, ...patch };
    if (patch.claimId !== undefined && !patch.claimIds) this.sel.claimIds = new Set(patch.claimId ? [patch.claimId] : []);
    this.render();
  }
  back() {
    const h = this.history.pop();
    if (!h) return;
    this.future.push({ claimId: this.sel.claimId, sourceId: this.sel.sourceId, anchorId: this.sel.anchorId });
    this.select(h, false);
  }
  forward() {
    const h = this.future.pop();
    if (!h) return;
    this.history.push({ claimId: this.sel.claimId, sourceId: this.sel.sourceId, anchorId: this.sel.anchorId });
    this.select(h, false);
  }
  get claim(): Claim | undefined { return this.sel.claimId ? this.data.claims[this.sel.claimId] : undefined; }
  get source(): Source | undefined { return this.sel.sourceId ? this.data.sources[this.sel.sourceId] : undefined; }
  get document(): Source | undefined {
    const id = this.sel.documentId ?? this.store.documents[0]?.id;
    return id ? this.data.sources[id] : undefined;
  }
  selectedClaims(): Claim[] {
    const ids = this.sel.claimIds.size ? [...this.sel.claimIds] : this.sel.claimId ? [this.sel.claimId] : [];
    return ids.map((i) => this.data.claims[i]).filter(Boolean);
  }

  visibleClaims(): Claim[] {
    const f = this.filter;
    const st = this.statuses();
    const q = f.text.toLowerCase();
    return this.store.claims.filter((c) =>
      (!q || c.text.toLowerCase().includes(q) || String(c.number) === q) &&
      (!f.status || st[c.id]?.status === f.status || (f.status === 'drafts' && this.store.tiesOf(c.id).some((t) => t.state === 'proposed'))) &&
      (!f.kind || c.kind === f.kind) &&
      (!f.tag || c.tags.includes(f.tag)) &&
      (!f.group || c.group === f.group) &&
      (!f.owner || c.owner === f.owner));
  }

  // --- sources --------------------------------------------------------------------------------
  async addFile(name: string, bytes: Uint8Array, role: SourceRole, extra: Partial<Source> = {}): Promise<Source> {
    let r: ReadResult;
    try {
      r = await readFile(name, bytes);
    } catch (e) {
      r = { kind: 'other', mime: 'application/octet-stream', text: '', segments: [], meta: { error: String((e as Error)?.message ?? e) } };
    }
    const fileHash = await sha256(bytes);
    const dup = this.store.sources.find((s) => s.fileHash === fileHash && s.role === role);
    if (dup) return dup;
    const s: Source = {
      id: newId('s'), role, title: r.title?.trim() || name.replace(/\.[^.]+$/, ''), kind: r.kind, mime: r.mime, fileName: name,
      fileHash, contentHash: await sha256(r.text), embedded: true, size: bytes.byteLength, added: nowIso(),
      citation: { ...(r.citation ?? {}) }, classification: 'unknown', derivedFrom: [], confidential: false, tags: [],
      text: r.text, segments: r.segments, pageCount: r.pageCount, meta: r.meta, ...extra,
    };
    if (!s.citation.title) s.citation.title = s.title;
    this.blobs.set(s.id, bytes);
    this.store.transact(role === 'document' ? `Link document ${s.title}` : `Add source ${s.title}`, (tx) => tx.put('sources', s));
    return s;
  }

  async addFiles(files: File[], role: SourceRole) {
    const out: Source[] = [];
    for (const f of files) out.push(await this.addFile(f.name, new Uint8Array(await f.arrayBuffer()), role));
    if (out[0]) this.select(role === 'document' ? { documentId: out[0].id } : { sourceId: out[0].id });
    return out;
  }

  /** New extracted text for a source (rescan, refresh, OCR). Anchors are re-found; ties become Stale until confirmed again. */
  async replaceSourceContent(id: Id, bytes: Uint8Array | null, text: string, segments: Source['segments'], label: string) {
    const contentHash = await sha256(text);
    const fileHash = bytes ? await sha256(bytes) : this.data.sources[id].fileHash;
    if (bytes) this.blobs.set(id, bytes);
    const { reanchor } = await import('../core/anchor');
    const moves = reanchor(this.store.anchorsOf(id), text);
    this.store.transact(label, (tx) => {
      tx.update<Source>('sources', id, { text, segments, contentHash, fileHash, refreshedAt: nowIso() });
      for (const m of moves) {
        const a = this.data.anchors[m.anchorId];
        if (m.to) tx.update<Anchor>('anchors', a.id, { ...makeSelector(text, m.to.start, m.to.end), broken: false });
        else tx.update<Anchor>('anchors', a.id, { broken: true });
      }
    });
    return moves;
  }

  // --- claims, anchors and ties ------------------------------------------------------------------
  newClaim(text: string, kind: ClaimKind = 'fact', doc?: { documentId: Id; start: number; end: number }, extra: Partial<Claim> = {}): Claim {
    const c: Claim = {
      id: newId('c'), number: this.store.nextClaimNumber(), text: text.trim(), kind, importance: 'normal', dependsOn: [], tags: [],
      doc: doc ? { ...doc, textAtCapture: this.data.sources[doc.documentId].text.slice(doc.start, doc.end) } : undefined,
      created: nowIso(), ...extra,
    };
    return c;
  }

  makeAnchor(sourceId: Id, start: number, end: number, rect?: Rect): Anchor {
    const s = this.data.sources[sourceId];
    return { id: newId('a'), sourceId, ...makeSelector(s.text, start, end), rect, knowledge: 'unknown', sourceHash: s.contentHash, created: nowIso() };
  }

  /** Tie the current text or region selection to the active claim. */
  tieSelection(kind: TieKind, transcription?: string): Tie | null {
    const claim = this.claim;
    if (!claim) return null;
    let anchor: Anchor | null = null;
    if (this.sel.text && this.sel.text.end > this.sel.text.start) anchor = this.makeAnchor(this.sel.text.sourceId, this.sel.text.start, this.sel.text.end);
    else if (this.sel.rect) {
      const { sourceId, ...rect } = this.sel.rect;
      const s = this.data.sources[sourceId];
      const seg = s.segments.find((g) => g.page === rect.page);
      anchor = this.makeAnchor(sourceId, seg?.start ?? 0, seg?.start ?? 0, rect);
      anchor.exact = '';
      if (transcription) anchor.note = `Reads: ${transcription}`;
    } else if (this.sel.anchorId) anchor = this.data.anchors[this.sel.anchorId];
    if (!anchor) return null;
    const existing = this.data.anchors[anchor.id];
    const t: Tie = {
      id: newId('t'), claimId: claim.id, anchorId: anchor.id, kind, directness: 'direct', state: 'confirmed',
      proposedBy: { type: 'person', who: this.store.user }, confirmedBy: this.store.user, confirmedAt: nowIso(),
      claimTextAtConfirm: claim.text, sourceHashAtConfirm: this.data.sources[anchor.sourceId].contentHash, created: nowIso(),
    };
    this.store.transact(`Tie claim ${claim.number} (${kind})`, (tx) => {
      if (!existing) tx.put('anchors', anchor!);
      tx.put('ties', t);
    });
    this.sel.text = undefined;
    this.sel.rect = undefined;
    return t;
  }

  confirmTie(id: Id) {
    const t = this.data.ties[id];
    const c = this.data.claims[t.claimId];
    const a = t.anchorId ? this.data.anchors[t.anchorId] : undefined;
    return { ...t, state: 'confirmed' as const, confirmedBy: this.store.user, confirmedAt: nowIso(), claimTextAtConfirm: c.text, sourceHashAtConfirm: a ? this.data.sources[a.sourceId]?.contentHash : undefined };
  }

  // --- persistence ---------------------------------------------------------------------------------
  private db: IDBDatabase | null = null;
  private async idb(): Promise<IDBDatabase | null> {
    if (this.db) return this.db;
    if (typeof indexedDB === 'undefined') return null;
    this.db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('annes-witness', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    return this.db;
  }
  private async put(key: string, value: unknown) {
    const db = await this.idb();
    if (!db) return;
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  private async get<T>(key: string): Promise<T | undefined> {
    const db = await this.idb();
    if (!db) return undefined;
    return new Promise((res) => {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => res(r.result as T);
      r.onerror = () => res(undefined);
    });
  }
  scheduleAutosave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.autosave().catch((e) => console.warn('autosave failed', e)), 1200);
  }
  async autosave() {
    await this.put('current', { data: this.data, journal: this.store.journal, fileName: this.fileName });
    const ids = new Set(Object.keys(this.data.sources));
    const blobs: Record<string, Uint8Array> = {};
    for (const [k, v] of this.blobs) if (ids.has(k)) blobs[k] = v;
    await this.put('blobs', blobs);
  }
  async restore(): Promise<boolean> {
    const cur = await this.get<{ data: CaseData; journal: JournalEntry[]; fileName?: string }>('current');
    if (!cur?.data) return false;
    const blobs = (await this.get<Record<string, Uint8Array>>('blobs')) ?? {};
    this.blobs = new Map(Object.entries(blobs));
    this.fileName = cur.fileName ?? this.fileName;
    this.store.load(cur.data, cur.journal ?? []);
    return true;
  }

  newCase(data?: CaseData) {
    this.store.load(data ?? emptyCase(), []);
    this.blobs = new Map();
    this.sel = { claimIds: new Set() };
    this.findings = [];
    this.fileHandle = null;
    this.fileName = 'case.witness';
    this.scheduleAutosave();
  }

  async serialize(seal?: { by: string }) {
    return saveCase(this.data, this.store.journal, this.blobs, seal ? { seal } : {});
  }

  async openBytes(bytes: Uint8Array, name: string) {
    const r = await loadCase(bytes);
    this.store.load(r.data, r.journal);
    this.blobs = r.blobs;
    this.fileName = name;
    this.sel = { claimIds: new Set() };
    this.findings = [];
    this.scheduleAutosave();
    return r;
  }
}

export const app = new App();
