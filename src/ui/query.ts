// Query Case: read-only SQL over the case's records, using SQLite compiled to WebAssembly.
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { CaseData } from '../core/types';

const COLS: Record<string, string[]> = {
  sources: ['id', 'role', 'title', 'kind', 'classification', 'confidential', 'dateMade', 'fileName', 'fileHash', 'contentHash', 'reliability', 'siglum', 'group', 'textLength'],
  anchors: ['id', 'sourceId', 'start', 'end', 'exact', 'knowledge', 'broken', 'informant'],
  claims: ['id', 'number', 'text', 'kind', 'importance', 'owner', 'group', 'tags', 'verdict', 'parentId', 'flagged', 'setAside'],
  ties: ['id', 'claimId', 'anchorId', 'targetClaimId', 'kind', 'directness', 'state', 'tick', 'confidence', 'proposedByType', 'proposedByModel', 'confirmedBy', 'confirmedAt'],
  reckonings: ['id', 'claimId', 'preferredAnchorId', 'conclusion', 'unresolved'],
  log: ['id', 'date', 'searched', 'where', 'forWhat', 'result', 'claimId', 'kind'],
  todos: ['id', 'text', 'claimId', 'done', 'ai'],
  comments: ['id', 'targetType', 'targetId', 'text', 'author', 'created', 'resolved'],
  signoffs: ['id', 'claimId', 'kind', 'by', 'at'],
};

function row(table: string, r: any): unknown[] {
  return COLS[table].map((c) => {
    let v: any;
    if (c === 'textLength') v = r.text?.length ?? 0;
    else if (c === 'tags') v = (r.tags ?? []).join(', ');
    else if (c === 'setAside') v = r.setAside?.reason ?? null;
    else if (c === 'proposedByType') v = r.proposedBy?.type;
    else if (c === 'proposedByModel') v = r.proposedBy?.model ?? null;
    else if (c === 'targetType') v = r.target?.type;
    else if (c === 'targetId') v = r.target?.id;
    else v = r[c];
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v ?? null;
  });
}

export async function queryCase(data: CaseData, sql: string): Promise<{ columns: string[]; rows: unknown[][] }> {
  if (!/^\s*(select|with)\b/i.test(sql) || /;\s*\S/.test(sql.trim().replace(/;\s*$/, '')))
    throw new Error('Only one read-only SELECT (or WITH … SELECT) statement is allowed.');
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database();
  try {
    for (const [t, cols] of Object.entries(COLS)) {
      db.run(`CREATE TABLE "${t}" (${cols.map((c) => `"${c}"`).join(', ')})`);
      const stmt = db.prepare(`INSERT INTO "${t}" VALUES (${cols.map(() => '?').join(', ')})`);
      for (const r of Object.values((data as any)[t] ?? {})) stmt.run(row(t, r) as any);
      stmt.free();
    }
    db.run('PRAGMA query_only = 1');
    const res = db.exec(sql);
    return res.length ? { columns: res[0].columns, rows: res[0].values as unknown[][] } : { columns: [], rows: [] };
  } finally {
    db.close();
  }
}
