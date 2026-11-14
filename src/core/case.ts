// The case store: data, an append-only journal, undo and redo.
import {
  CaseData, Claim, Id, TableName, TABLES, defaultSettings, Source, Anchor, Tie,
} from './types';
import { clone, newId, nowIso } from './util';

export interface JournalOp {
  table: TableName;
  id: Id;
  before: unknown; // undefined = did not exist
  after: unknown; // undefined = deleted
}

export interface JournalEntry {
  seq: number;
  at: string;
  by: string;
  label: string;
  ops: JournalOp[];
  /** Set when this entry undid or redid another. */
  undoOf?: number;
  redoOf?: number;
}

export function emptyCase(): CaseData {
  return {
    format: 'annes-witness',
    version: 1,
    id: newId('case'),
    created: nowIso(),
    settings: defaultSettings(),
    sources: {}, anchors: {}, claims: {}, ties: {}, reckonings: {}, log: {}, todos: {},
    comments: {}, signoffs: {}, rules: {}, aiHistory: {}, views: {},
  };
}

/** Bring older or partial case data up to the current shape. */
export function normalizeCase(d: Partial<CaseData>): CaseData {
  const base = emptyCase();
  const out = { ...base, ...d, settings: { ...base.settings, ...(d.settings ?? {}) } } as CaseData;
  for (const t of TABLES) (out as any)[t] = (d as any)[t] ?? {};
  return out;
}

type Listener = (entry: JournalEntry | null) => void;

export class Tx {
  ops: JournalOp[] = [];
  constructor(private store: CaseStore) {}
  put<T extends { id: Id }>(table: TableName, value: T): T {
    const tableObj = (this.store.data as any)[table] as Record<Id, unknown>;
    const before = clone(tableObj[value.id]);
    const after = clone(value);
    tableObj[value.id] = after;
    this.ops.push({ table, id: value.id, before, after: clone(after) });
    return after as T;
  }
  update<T extends { id: Id }>(table: TableName, id: Id, patch: Partial<T>): T {
    const cur = (this.store.data as any)[table][id] as T | undefined;
    if (!cur) throw new Error(`${table} ${id} not found`);
    return this.put(table, { ...clone(cur), ...patch } as T);
  }
  delete(table: TableName, id: Id): void {
    const tableObj = (this.store.data as any)[table] as Record<Id, unknown>;
    if (!(id in tableObj)) return;
    const before = clone(tableObj[id]);
    delete tableObj[id];
    this.ops.push({ table, id, before, after: undefined });
  }
}

export class CaseStore {
  data: CaseData;
  journal: JournalEntry[] = [];
  private undoStack: number[] = [];
  private redoStack: number[] = [];
  private listeners = new Set<Listener>();
  user = 'me';
  dirty = false;
  /** Set by Open Read-Only: every change is refused. */
  readOnly = false;

  constructor(data?: CaseData, journal?: JournalEntry[]) {
    this.data = data ? normalizeCase(data) : emptyCase();
    this.journal = journal ?? [];
  }

  get seq(): number {
    return this.journal.length ? this.journal[this.journal.length - 1].seq : 0;
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: JournalEntry | null) {
    for (const l of this.listeners) l(e);
  }

  /** Run changes as one journaled, undoable step. */
  transact<R>(label: string, fn: (tx: Tx) => R): R {
    if (this.readOnly) throw new Error('This case is open read-only. Use File ▸ Save As to make an editable copy.');
    const tx = new Tx(this);
    let result: R;
    try {
      result = fn(tx);
    } catch (e) {
      this.rollback(tx.ops);
      throw e;
    }
    if (tx.ops.length) {
      const entry: JournalEntry = { seq: this.seq + 1, at: nowIso(), by: this.user, label, ops: tx.ops };
      this.journal.push(entry);
      this.undoStack.push(entry.seq);
      this.redoStack = [];
      this.dirty = true;
      this.emit(entry);
    }
    return result;
  }

  private rollback(ops: JournalOp[]) {
    for (const op of [...ops].reverse()) {
      const t = (this.data as any)[op.table];
      if (op.before === undefined) delete t[op.id];
      else t[op.id] = clone(op.before);
    }
  }

  private applyInverse(entry: JournalEntry, label: string, mark: 'undoOf' | 'redoOf'): JournalEntry {
    const ops: JournalOp[] = [];
    const src = mark === 'undoOf' ? [...entry.ops].reverse() : entry.ops;
    for (const op of src) {
      const t = (this.data as any)[op.table];
      const target = mark === 'undoOf' ? op.before : op.after;
      const before = clone(t[op.id]);
      if (target === undefined) delete t[op.id];
      else t[op.id] = clone(target);
      ops.push({ table: op.table, id: op.id, before, after: clone(target) });
    }
    const e: JournalEntry = { seq: this.seq + 1, at: nowIso(), by: this.user, label, ops, [mark]: entry.seq };
    this.journal.push(e);
    this.dirty = true;
    return e;
  }

  canUndo() { return !this.readOnly && this.undoStack.length > 0; }
  canRedo() { return !this.readOnly && this.redoStack.length > 0; }

  undo(): JournalEntry | null {
    const seq = this.undoStack.pop();
    if (seq === undefined) return null;
    const entry = this.journal.find((j) => j.seq === seq)!;
    const e = this.applyInverse(entry, `Undo ${entry.label}`, 'undoOf');
    this.redoStack.push(seq);
    this.emit(e);
    return e;
  }

  redo(): JournalEntry | null {
    const seq = this.redoStack.pop();
    if (seq === undefined) return null;
    const entry = this.journal.find((j) => j.seq === seq)!;
    const e = this.applyInverse(entry, `Redo ${entry.label}`, 'redoOf');
    this.undoStack.push(seq);
    this.emit(e);
    return e;
  }

  /** Restore the case as it was after journal entry `seq`, as one new undoable step. */
  restoreTo(seq: number): void {
    const later = this.journal.filter((j) => j.seq > seq).reverse();
    this.transact(`Restore to step ${seq}`, (tx) => {
      for (const entry of later)
        for (const op of [...entry.ops].reverse()) {
          if (op.before === undefined) tx.delete(op.table, op.id);
          else tx.put(op.table, op.before as { id: Id });
        }
    });
  }

  /** The case as it was after journal entry `seq` (read-only reconstruction). */
  snapshotAt(seq: number): CaseData {
    const d = clone(this.data);
    for (const entry of this.journal.filter((j) => j.seq > seq).reverse())
      for (const op of [...entry.ops].reverse()) {
        const t = (d as any)[op.table];
        if (op.before === undefined) delete t[op.id];
        else t[op.id] = clone(op.before);
      }
    return d;
  }

  /** Replace everything (open a file). Clears undo history but keeps the journal. */
  load(data: CaseData, journal: JournalEntry[]) {
    this.data = normalizeCase(data);
    this.journal = journal;
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.readOnly = false;
    this.emit(null);
  }

  touch() { this.emit(null); }

  // Convenience accessors
  get sources(): Source[] { return Object.values(this.data.sources); }
  get evidence(): Source[] { return this.sources.filter((s) => s.role === 'source'); }
  get documents(): Source[] { return this.sources.filter((s) => s.role === 'document'); }
  get claims(): Claim[] { return Object.values(this.data.claims).sort((a, b) => a.number - b.number); }
  get anchors(): Anchor[] { return Object.values(this.data.anchors); }
  get ties(): Tie[] { return Object.values(this.data.ties); }
  tiesOf(claimId: Id): Tie[] { return this.ties.filter((t) => t.claimId === claimId); }
  anchorsOf(sourceId: Id): Anchor[] { return this.anchors.filter((a) => a.sourceId === sourceId); }
  nextClaimNumber(): number { return this.claims.reduce((m, c) => Math.max(m, c.number), 0) + 1; }

  /** Journal entries that touched a record. */
  historyOf(table: TableName, id: Id): JournalEntry[] {
    return this.journal.filter((j) => j.ops.some((o) => o.table === table && o.id === id));
  }
}
