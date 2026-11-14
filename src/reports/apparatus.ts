// A simple critical apparatus from a collation: lemma ] variant reading (witness sigla).
import { CollationResult, variants } from '../resolve/collate';

export function apparatusMarkdown(c: CollationResult, sigla: string[]): string {
  const base = sigla[0] ?? 'A';
  const lines = [`Base text: ${base}. Witnesses: ${sigla.slice(1).join(', ') || '(none)'}.`, ''];
  for (const v of variants(c)) {
    const lemma = v.readings.find((r) => r.witness === 0)?.text || '(nothing)';
    const groups = new Map<string, string[]>();
    for (const r of v.readings) {
      if (r.witness === 0) continue;
      const t = r.text || 'om.';
      groups.set(t, [...(groups.get(t) ?? []), sigla[r.witness] ?? `W${r.witness}`]);
    }
    const ctx = c.base.slice(Math.max(0, v.position - 3), v.position).map((t) => t.text).join(' ');
    const readings = [...groups.entries()].map(([t, s]) => `${t} ${s.join(' ')}`).join('; ');
    lines.push(`- word ${v.position + 1}${ctx ? ` (after “${ctx}”)` : ''}: ${lemma} ${base} ] ${lemma === '(nothing)' ? 'add. ' : ''}${readings}`);
  }
  if (lines.length === 2) lines.push('No variants.');
  return lines.join('\n');
}
