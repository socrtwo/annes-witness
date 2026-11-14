// Word-level collation of versions of one text (LCS alignment over normalized tokens).
export interface Token { text: string; norm: string; start: number; end: number }

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /[\p{L}\p{N}'’]+|[^\s\p{L}\p{N}]/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const norm = m[0].toLowerCase().replace(/’/g, "'");
    if (/^[^\p{L}\p{N}]$/u.test(norm) && !/[;:?!]/.test(norm)) continue; // drop most punctuation
    out.push({ text: m[0], norm, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export type Op = { type: 'same' | 'change'; a: Token[]; b: Token[] };

/** Diff two token lists by longest common subsequence; consecutive edits merge into one change. */
export function diffTokens(a: Token[], b: Token[]): Op[] {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i].norm === b[j].norm ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  const push = (type: Op['type'], x: Token[], y: Token[]) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) { last.a.push(...x); last.b.push(...y); } else ops.push({ type, a: [...x], b: [...y] });
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i].norm === b[j].norm) { push('same', [a[i]], [b[j]]); i++; j++; }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { push('change', [], [b[j]]); j++; }
    else { push('change', [a[i]], []); i++; }
  }
  return ops;
}

export interface CollationResult {
  base: Token[];
  witnesses: Token[][];
  /** For each witness, its diff against the base. */
  ops: Op[][];
}

export function alignTexts(base: string, others: string[]): CollationResult {
  const b = tokenize(base);
  const ws = others.map(tokenize);
  return { base: b, witnesses: ws, ops: ws.map((w) => diffTokens(b, w)) };
}

/** Variant readings keyed by the base token position where they occur (witness 0 = base). */
export function variants(result: CollationResult): { position: number; readings: { witness: number; text: string }[] }[] {
  const byPos = new Map<number, { witness: number; text: string }[]>();
  result.ops.forEach((ops, wi) => {
    let pos = 0;
    for (const op of ops) {
      if (op.type === 'same') { pos += op.a.length; continue; }
      const list = byPos.get(pos) ?? [];
      if (!list.some((r) => r.witness === 0)) list.push({ witness: 0, text: op.a.map((t) => t.text).join(' ') });
      else if (op.a.length) {
        const r0 = list.find((r) => r.witness === 0)!;
        if (r0.text.length < op.a.map((t) => t.text).join(' ').length) r0.text = op.a.map((t) => t.text).join(' ');
      }
      list.push({ witness: wi + 1, text: op.b.map((t) => t.text).join(' ') });
      byPos.set(pos, list);
      pos += op.a.length;
    }
  });
  return [...byPos.entries()].sort((x, y) => x[0] - y[0]).map(([position, readings]) => ({ position, readings }));
}

export function compareTranscriptions(a: string, b: string): { same: number; changes: { aText: string; bText: string; aStart: number; bStart: number }[] } {
  const ops = diffTokens(tokenize(a), tokenize(b));
  let same = 0;
  const changes: { aText: string; bText: string; aStart: number; bStart: number }[] = [];
  for (const op of ops) {
    if (op.type === 'same') same += op.a.length;
    else
      changes.push({
        aText: op.a.length ? a.slice(op.a[0].start, op.a[op.a.length - 1].end) : '',
        bText: op.b.length ? b.slice(op.b[0].start, op.b[op.b.length - 1].end) : '',
        aStart: op.a[0]?.start ?? -1,
        bStart: op.b[0]?.start ?? -1,
      });
  }
  return { same, changes };
}

/** For each base token, the share of witnesses that differ at it (0..1). */
export function variantHeat(result: CollationResult): number[] {
  const heat = new Array(result.base.length).fill(0);
  const w = result.witnesses.length || 1;
  for (const ops of result.ops) {
    let pos = 0;
    for (const op of ops) {
      if (op.type === 'same') { pos += op.a.length; continue; }
      if (op.a.length) for (let k = 0; k < op.a.length; k++) heat[pos + k] += 1 / w;
      else if (pos < heat.length) heat[pos] += 1 / w; // insertion before this token
      else if (heat.length) heat[heat.length - 1] += 1 / w;
      pos += op.a.length;
    }
  }
  return heat.map((h) => Math.min(1, +h.toFixed(4)));
}
