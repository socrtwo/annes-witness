// Change Report: what changed between two points in the journal.
import { JournalEntry } from '../core/case';
import { CaseData, TableName } from '../core/types';

const NAMES: Record<TableName, string> = {
  sources: 'Sources', anchors: 'Anchors', claims: 'Claims', ties: 'Ties', reckonings: 'Reckonings', log: 'Research log', todos: 'To-dos',
  comments: 'Comments', signoffs: 'Sign-offs', rules: 'Rules', aiHistory: 'AI history', views: 'Saved views',
};

function describe(table: TableName, v: any, d: CaseData): string {
  if (!v) return '';
  switch (table) {
    case 'sources': return `“${v.title}”`;
    case 'claims': return `claim ${v.number}: ${String(v.text).slice(0, 80)}`;
    case 'ties': return `${v.kind} tie (${v.state}) for claim ${d.claims[v.claimId]?.number ?? '?'}`;
    case 'anchors': return `anchor in “${d.sources[v.sourceId]?.title ?? '?'}”: “${String(v.exact).slice(0, 60)}”`;
    case 'reckonings': return `reckoning for claim ${d.claims[v.claimId]?.number ?? '?'}`;
    case 'signoffs': return `${v.kind} by ${v.by} on claim ${d.claims[v.claimId]?.number ?? '?'}`;
    case 'comments': return `comment by ${v.author}`;
    case 'log': return `search: ${v.searched}`;
    case 'todos': return `to-do: ${v.text}`;
    case 'rules': return `rule “${v.name}”`;
    default: return v.id;
  }
}

function changedFields(before: any, after: any): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]) && !['text', 'segments'].includes(k) || (k === 'text' && before?.text !== after?.text));
}

export function changeReport(journal: JournalEntry[], fromSeq: number, toSeq: number, d: CaseData): string {
  const entries = journal.filter((j) => j.seq > fromSeq && j.seq <= toSeq);
  // Net change per record: first before, last after.
  const net = new Map<string, { table: TableName; id: string; before: any; after: any }>();
  for (const e of entries)
    for (const op of e.ops) {
      const k = `${op.table}:${op.id}`;
      const cur = net.get(k);
      if (cur) cur.after = op.after;
      else net.set(k, { table: op.table, id: op.id, before: op.before, after: op.after });
    }
  const md = [`# Changes from step ${fromSeq} to step ${toSeq}`, '', `${entries.length} journal entries by ${[...new Set(entries.map((e) => e.by))].join(', ') || 'nobody'}.`, ''];
  const byTable = new Map<TableName, string[]>();
  for (const n of net.values()) {
    if (JSON.stringify(n.before) === JSON.stringify(n.after)) continue;
    let line: string;
    if (n.before === undefined) line = `Added ${describe(n.table, n.after, d)}`;
    else if (n.after === undefined) line = `Removed ${describe(n.table, n.before, d)}`;
    else line = `Changed ${describe(n.table, n.after, d)} (${changedFields(n.before, n.after).join(', ')})`;
    byTable.set(n.table, [...(byTable.get(n.table) ?? []), line]);
  }
  for (const [t, lines] of byTable) md.push(`## ${NAMES[t]}`, '', ...lines.map((l) => `- ${l}`), '');
  md.push('## Steps', '', ...entries.map((e) => `- ${e.seq}. ${e.at.replace('T', ' ').slice(0, 16)} ${e.by}: ${e.label}`));
  return md.join('\n');
}
