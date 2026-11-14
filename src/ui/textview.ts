// Render source text with marked ranges, and map browser selections back to text offsets.
import { h } from './dom';

export interface Mark { start: number; end: number; cls: string; title?: string; data?: Record<string, string>; onclick?: (e: MouseEvent) => void }

const LIMIT = 400_000;

export function renderMarkedText(text: string, marks: Mark[], opts: { limit?: number; segments?: { start: number; label: string }[] } = {}): HTMLElement {
  const limit = opts.limit ?? LIMIT;
  const shown = text.slice(0, limit);
  const el = h('div.textview', { tabindex: '0' });
  // Boundaries from marks and segment labels.
  const cuts = new Set<number>([0, shown.length]);
  const ms = marks.filter((m) => m.end > m.start && m.start < shown.length).map((m) => ({ ...m, end: Math.min(m.end, shown.length) }));
  for (const m of ms) { cuts.add(m.start); cuts.add(m.end); }
  const segStarts = new Map<number, string>();
  for (const s of opts.segments ?? []) if (s.start < shown.length) { cuts.add(s.start); segStarts.set(s.start, s.label); }
  const pts = [...cuts].sort((a, b) => a - b);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (segStarts.has(a)) el.appendChild(h('span.seglabel', { contenteditable: 'false', 'data-skip': '1' }, segStarts.get(a)!));
    const covering = ms.filter((m) => m.start <= a && m.end >= b);
    const span = h('span', { dataset: { start: String(a) } }, shown.slice(a, b));
    if (covering.length) {
      const top = covering[covering.length - 1];
      span.className = covering.map((m) => m.cls).join(' ');
      if (top.title) span.title = covering.map((m) => m.title).filter(Boolean).join('\n');
      for (const m of covering) if (m.data) Object.assign(span.dataset, m.data);
      if (top.onclick) span.addEventListener('click', top.onclick);
    }
    el.appendChild(span);
  }
  if (text.length > limit) el.appendChild(h('div.more', `… ${text.length - limit} more characters not shown. Use Find in Whole Case to reach them.`));
  return el;
}

/** Offsets of the current browser selection inside a renderMarkedText element. */
export function selectionOffsets(container: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (!container.contains(r.startContainer) || !container.contains(r.endContainer)) return null;
  const pos = (node: Node, off: number): number | null => {
    let el: Node | null = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
    if (node.nodeType !== Node.TEXT_NODE && el && (el as Element).childNodes[off]) {
      // Element boundary: use the start of the child.
      const child = (el as Element).childNodes[off] as HTMLElement;
      if (child?.dataset?.start) return Number(child.dataset.start);
    }
    while (el && el !== container && !(el as HTMLElement).dataset?.start) el = el.parentNode;
    if (!el || el === container) return null;
    if ((el as HTMLElement).dataset.skip) return Number((el.nextSibling as HTMLElement)?.dataset?.start ?? 0);
    return Number((el as HTMLElement).dataset.start) + (node.nodeType === Node.TEXT_NODE ? off : 0);
  };
  const a = pos(r.startContainer, r.startOffset);
  const b = pos(r.endContainer, r.endOffset);
  if (a === null || b === null) return null;
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

export function scrollToOffset(container: HTMLElement, offset: number) {
  const spans = [...container.querySelectorAll('span[data-start]')] as HTMLElement[];
  let best: HTMLElement | null = null;
  for (const s of spans) { if (Number(s.dataset.start) <= offset) best = s; else break; }
  best?.scrollIntoView({ block: 'center' });
}
