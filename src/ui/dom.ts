type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, any>;

/** Tiny element builder: h('div.cls#id', {onclick}, children). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K | string, attrs?: Attrs | Child, ...children: Child[]): HTMLElement {
  const [name, ...rest] = String(tag).split(/(?=[.#])/);
  const el = document.createElement(name || 'div');
  for (const r of rest) {
    if (r.startsWith('.')) el.classList.add(r.slice(1));
    else if (r.startsWith('#')) el.id = r.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs as Child);
    attrs = undefined;
  }
  for (const [k, v] of Object.entries((attrs as Attrs) ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list' && k !== 'form') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]) {
  for (const c of children.flat(Infinity as 1) as Child[]) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function icon(name: string) {
  return h('span.msym', { 'aria-hidden': 'true' }, name);
}
