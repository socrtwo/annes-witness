import { h, clear } from './dom';

export interface Field {
  key: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'password' | 'date' | 'radio' | 'multiselect' | 'info';
  value?: any;
  options?: { value: string; label: string }[];
  placeholder?: string;
  help?: string;
  required?: boolean;
  rows?: number;
}

let openCount = 0;
export const isDialogOpen = () => openCount > 0;

export function modal(title: string, body: HTMLElement, buttons: { label: string; primary?: boolean; value: any }[], opts: { wide?: boolean; onKey?: (e: KeyboardEvent) => void } = {}): Promise<any> {
  return new Promise((resolve) => {
    openCount++;
    const prev = document.activeElement as HTMLElement | null;
    const close = (v: any) => {
      openCount--;
      back.remove();
      document.removeEventListener('keydown', key, true);
      prev?.focus?.();
      resolve(v);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
      else opts.onKey?.(e);
    };
    const dlg = h('div.dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, class: opts.wide ? 'dialog wide' : 'dialog' },
      h('h2', title),
      h('div.dialog-body', body),
      h('div.dialog-buttons', buttons.map((b) => h('button', { class: b.primary ? 'primary' : '', onclick: () => close(typeof b.value === 'function' ? b.value() : b.value) }, b.label))),
    );
    const back = h('div.backdrop', dlg);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(null); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(back);
    (dlg.querySelector('input,textarea,select,button.primary') as HTMLElement | null)?.focus();
  });
}

export async function form<T = Record<string, any>>(title: string, fields: Field[], ok = 'OK', intro?: string | HTMLElement): Promise<T | null> {
  const inputs: Record<string, () => any> = {};
  const body = h('div.form',
    intro ? (typeof intro === 'string' ? h('p.intro', intro) : intro) : null,
    fields.map((f) => {
      const id = 'f_' + f.key;
      let input: HTMLElement;
      switch (f.type) {
        case 'info':
          return h('div.field.info', f.label);
        case 'textarea':
          input = h('textarea', { id, rows: f.rows ?? 5, placeholder: f.placeholder ?? '', value: f.value ?? '' });
          inputs[f.key] = () => (input as HTMLTextAreaElement).value;
          break;
        case 'select':
          input = h('select', { id }, (f.options ?? []).map((o) => h('option', { value: o.value, selected: o.value === f.value }, o.label)));
          inputs[f.key] = () => (input as HTMLSelectElement).value;
          break;
        case 'multiselect': {
          const vals = new Set<string>(f.value ?? []);
          input = h('div.multi', { id }, (f.options ?? []).map((o) => h('label', h('input', { type: 'checkbox', value: o.value, checked: vals.has(o.value) }), ' ', o.label)));
          inputs[f.key] = () => [...input.querySelectorAll('input:checked')].map((i) => (i as HTMLInputElement).value);
          break;
        }
        case 'radio':
          input = h('div.radios', { id }, (f.options ?? []).map((o) => h('label', h('input', { type: 'radio', name: id, value: o.value, checked: o.value === f.value }), ' ', o.label)));
          inputs[f.key] = () => (input.querySelector('input:checked') as HTMLInputElement | null)?.value;
          break;
        case 'checkbox':
          input = h('input', { id, type: 'checkbox', checked: !!f.value });
          inputs[f.key] = () => (input as HTMLInputElement).checked;
          return h('div.field.check', h('label', input, ' ', f.label), f.help ? h('div.help', f.help) : null);
        default:
          input = h('input', { id, type: f.type ?? 'text', value: f.value ?? '', placeholder: f.placeholder ?? '', autocomplete: f.type === 'password' ? 'off' : undefined });
          inputs[f.key] = () => (f.type === 'number' ? Number((input as HTMLInputElement).value) : (input as HTMLInputElement).value);
      }
      return h('div.field', h('label', { for: id }, f.label), input, f.help ? h('div.help', f.help) : null);
    }),
  );
  const res = await modal(title, body, [
    { label: 'Cancel', value: null },
    { label: ok, primary: true, value: () => Object.fromEntries(Object.entries(inputs).map(([k, g]) => [k, g()])) },
  ], {
    onKey: (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || (e.target as HTMLElement).tagName === 'INPUT')) {
        (body.closest('.dialog')?.querySelector('button.primary') as HTMLButtonElement)?.click();
        e.preventDefault();
      }
    },
  });
  if (res) for (const f of fields) if (f.required && !String(res[f.key] ?? '').trim()) { await alertBox('Missing information', `${f.label} is required.`); return form(title, fields.map((x) => ({ ...x, value: res[x.key] ?? x.value })), ok, intro); }
  return res as T | null;
}

export function alertBox(title: string, message: string | HTMLElement) {
  return modal(title, typeof message === 'string' ? h('p.pre', message) : message, [{ label: 'OK', primary: true, value: true }]);
}

export function confirmBox(title: string, message: string, ok = 'OK') {
  return modal(title, h('p.pre', message), [{ label: 'Cancel', value: false }, { label: ok, primary: true, value: true }]).then(Boolean);
}

export async function promptBox(title: string, label: string, value = '', type: Field['type'] = 'text'): Promise<string | null> {
  const r = await form<{ v: string }>(title, [{ key: 'v', label, value, type }]);
  return r ? r.v : null;
}

export function showPanel(title: string, content: HTMLElement, wide = true, buttons?: { label: string; primary?: boolean; value: any }[]) {
  return modal(title, content, buttons ?? [{ label: 'Close', primary: true, value: true }], { wide });
}

export interface Progress { update(text: string, done?: number, total?: number): void; close(): void; signal: AbortSignal }

export function progress(title: string): Progress {
  const ac = new AbortController();
  const text = h('div.progress-text', 'Starting…');
  const bar = h('progress', { max: 1, value: 0 }) as HTMLProgressElement;
  const back = h('div.backdrop', h('div.dialog', { role: 'dialog', 'aria-label': title }, h('h2', title), text, bar,
    h('div.dialog-buttons', h('button', { onclick: () => { ac.abort(); text.textContent = 'Stopping…'; } }, 'Stop'))));
  document.body.appendChild(back);
  return {
    signal: ac.signal,
    update(t, done, total) { text.textContent = t; if (total) { bar.max = total; bar.value = done ?? 0; } else bar.removeAttribute('value'); },
    close() { back.remove(); },
  };
}

export function toast(message: string, ms = 3500) {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div#toasts', { role: 'status', 'aria-live': 'polite' }); document.body.appendChild(host); }
  const t = h('div.toast', message);
  host.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function pickFiles(accept = '*/*', multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, multiple, style: { display: 'none' } }) as HTMLInputElement;
    inp.addEventListener('change', () => { resolve([...(inp.files ?? [])]); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  });
}

export function pickFolder(): Promise<File[]> {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', style: { display: 'none' } }) as HTMLInputElement;
    (inp as any).webkitdirectory = true;
    inp.addEventListener('change', () => { resolve([...(inp.files ?? [])]); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  });
}

export function download(data: Uint8Array | string, name: string, mime = 'application/octet-stream') {
  const blob = new Blob([typeof data === 'string' ? data : (data as BlobPart)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.appendChild(a);
  (a as HTMLAnchorElement).click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

export function openHtmlWindow(html: string) {
  const w = window.open('', '_blank');
  if (w) { w.document.open(); w.document.write(html); w.document.close(); } else download(html, 'report.html', 'text/html');
}

export function choose(title: string, items: { label: string; value: string; detail?: string }[], message?: string): Promise<string | null> {
  const list = h('div.choose', message ? h('p', message) : null, items.map((it) =>
    h('button.choice', { onclick: () => { (list.closest('.backdrop') as any)?.__resolve?.(it.value); } }, h('strong', it.label), it.detail ? h('span', ' — ' + it.detail) : null)));
  return new Promise((resolve) => {
    const p = modal(title, list, [{ label: 'Cancel', value: null }], { wide: true });
    const back = list.closest('.backdrop') as any;
    if (back) back.__resolve = (v: string) => { back.querySelector('.dialog-buttons button')?.dispatchEvent(new MouseEvent('click')); resolve(v); };
    p.then((v) => { if (v === null) resolve(null); });
  });
}

export { clear };
