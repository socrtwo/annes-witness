// Ribbon, classic menu bar (one menu per tab, including AI), Quick Access Bar, command search, status bar.
import { h, clear, icon } from './dom';
import { PLAN, ICONS, isRegistered, isEnabled, isChecked, run, shortcutOf, searchCommands, commandMeta, keyName, commandForKey } from './registry';
import { app } from './app';
import { modal, isDialogOpen } from './dialogs';
import { statusCounts } from '../core/status';
import { STATUS_LABEL, Status } from '../core/types';

const QAT_KEY = 'annes-witness.qat';
const MENUS_KEY = 'annes-witness.menus';
const TAB_KEY = 'annes-witness.tab';
const CUSTOM_TAB_KEY = 'annes-witness.customTab';

export const DEFAULT_QAT = ['file.save', 'edit.undo', 'edit.redo', 'tie.create', 'nav.nextOpen', 'check.all', 'ai.attributionWizard', 'review.verifyDrafts'];

export function getQat(): string[] {
  try { return JSON.parse(localStorage.getItem(QAT_KEY) ?? 'null') ?? DEFAULT_QAT; } catch { return DEFAULT_QAT; }
}
export function setQat(ids: string[]) { localStorage.setItem(QAT_KEY, JSON.stringify(ids)); renderShell(); }
export function getMenusMode(): 'ribbon' | 'menus' | 'both' { return (localStorage.getItem(MENUS_KEY) as any) ?? 'ribbon'; }
export function setMenusMode(m: 'ribbon' | 'menus' | 'both') { localStorage.setItem(MENUS_KEY, m); renderShell(); }
export function getCustomTab(): { name: string; ids: string[] } | null {
  try { return JSON.parse(localStorage.getItem(CUSTOM_TAB_KEY) ?? 'null'); } catch { return null; }
}
export function setCustomTab(t: { name: string; ids: string[] } | null) { localStorage.setItem(CUSTOM_TAB_KEY, JSON.stringify(t)); renderShell(); }

let activeTab = localStorage.getItem(TAB_KEY) ?? 'home';
export function setActiveTab(key: string) { activeTab = key; localStorage.setItem(TAB_KEY, key); renderShell(); }

function cmdButton(id: string, small = false) {
  const m = commandMeta(id);
  if (!m) return null;
  const reg = isRegistered(id);
  const en = reg && isEnabled(id);
  const sc = shortcutOf(id);
  const title = `${m.label}${sc ? ` (${sc})` : ''}${reg ? '' : ' — planned, not yet available'}\n${m.notes}`;
  return h('button.cmd', {
    class: `cmd${small ? ' small' : ''}${isChecked(id) ? ' checked' : ''}${reg ? '' : ' planned'}`,
    disabled: !en, title, 'aria-pressed': isChecked(id) ? 'true' : undefined, dataset: { cmd: id },
    onclick: () => run(id),
  }, small ? null : icon(ICONS[id.split('.')[0]] ?? 'bolt'), h('span.lbl', m.label.replace(/…$/, '…')));
}

function ribbon() {
  const custom = getCustomTab();
  const tabs = [...PLAN.tabs.filter((t) => t.key !== 'file'), ...(custom ? [{ key: 'custom', name: custom.name, description: 'Your tab', groups: [{ name: custom.name, commands: custom.ids.map((i) => commandMeta(i)!).filter(Boolean) }] }] : [])];
  const tab = tabs.find((t) => t.key === activeTab) ?? tabs[0];
  const strip = h('div.tabs', { role: 'tablist' },
    h('button.tab.filetab', { role: 'tab', 'aria-selected': 'false', 'aria-haspopup': 'dialog', title: 'File: create, open, save, protect, print', onclick: () => run('file.backstage' as any).catch(() => {}) || openBackstage() }, 'File'),
    tabs.map((t) => h('button.tab', { role: 'tab', 'aria-selected': t.key === tab.key ? 'true' : 'false', class: t.key === tab.key ? 'tab active' : 'tab', title: t.description, onclick: () => setActiveTab(t.key) }, t.name)));
  strip.addEventListener('keydown', (e) => {
    const btns = [...strip.querySelectorAll('button.tab')] as HTMLButtonElement[];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowRight' && i >= 0) { btns[(i + 1) % btns.length].focus(); e.preventDefault(); }
    if (e.key === 'ArrowLeft' && i >= 0) { btns[(i - 1 + btns.length) % btns.length].focus(); e.preventDefault(); }
  });
  const body = h('div.ribbon-body', { role: 'tabpanel' },
    tab.groups.map((g) => h('div.group', h('div.group-cmds', g.commands.filter((c) => c.inTabs).map((c) => cmdButton(c.id, false))), h('div.group-name', g.name))));
  return h('div.ribbon', strip, body);
}

let openMenu: HTMLElement | null = null;
function closeMenus() { openMenu?.remove(); openMenu = null; }

function menubar() {
  return h('div.menubar', { role: 'menubar' },
    PLAN.tabs.map((t) => h('button.menu-title', {
      role: 'menuitem', 'aria-haspopup': 'true',
      onclick: (e: MouseEvent) => {
        closeMenus();
        const btn = e.currentTarget as HTMLElement;
        const r = btn.getBoundingClientRect();
        const items: HTMLElement[] = [];
        t.groups.forEach((g, gi) => {
          if (gi) items.push(h('div.sep', { role: 'separator' }));
          for (const c of g.commands) {
            const reg = isRegistered(c.id);
            items.push(h('button.menu-item', {
              role: 'menuitem', disabled: !(reg && isEnabled(c.id)), title: reg ? c.notes : 'Planned, not yet available',
              class: `menu-item${reg ? '' : ' planned'}`,
              onclick: () => { closeMenus(); run(c.id); },
            }, h('span', (isChecked(c.id) ? '✓ ' : '') + c.label), h('span.key', shortcutOf(c.id))));
          }
        });
        openMenu = h('div.menu', { role: 'menu', style: { left: r.left + 'px', top: r.bottom + 'px' } }, items);
        document.body.appendChild(openMenu);
        (openMenu.querySelector('button:not([disabled])') as HTMLElement)?.focus();
        openMenu.addEventListener('keydown', (ev) => {
          const list = [...openMenu!.querySelectorAll('button:not([disabled])')] as HTMLElement[];
          const i = list.indexOf(document.activeElement as HTMLElement);
          if (ev.key === 'ArrowDown') { list[(i + 1) % list.length]?.focus(); ev.preventDefault(); }
          if (ev.key === 'ArrowUp') { list[(i - 1 + list.length) % list.length]?.focus(); ev.preventDefault(); }
          if (ev.key === 'Escape') { closeMenus(); btn.focus(); }
        });
        e.stopPropagation();
      },
    }, t.name)));
}
document.addEventListener('click', () => closeMenus());

function qat() {
  return h('div.qat', { 'aria-label': 'Quick Access Bar' },
    getQat().map((id) => {
      const b = cmdButton(id, true);
      if (b) b.querySelector('.lbl')!.textContent = commandMeta(id)!.label.replace('…', '');
      return b;
    }),
    h('button.cmd.small', { title: 'Customize Quick Access Bar', onclick: () => run('view.customizeQat') }, '▾'),
    h('div.search', h('input', {
      type: 'search', placeholder: 'Search commands (Alt+Q)', id: 'cmdsearch', 'aria-label': 'Search commands',
      onfocus: (e: FocusEvent) => openSearch((e.target as HTMLInputElement).value),
    })),
    h('span.title', `${app.data.settings.title}${app.store.dirty ? ' •' : ''} — Anne's Witness`),
  );
}

export async function openSearch(initial = '') {
  const input = h('input', { type: 'search', value: initial, placeholder: 'Type a command name…', 'aria-label': 'Command' }) as HTMLInputElement;
  const list = h('div.search-results', { role: 'listbox' });
  let idx = 0;
  let items: ReturnType<typeof searchCommands> = [];
  const draw = () => {
    items = searchCommands(input.value).slice(0, 40);
    idx = Math.min(idx, Math.max(0, items.length - 1));
    clear(list);
    items.forEach((c, i) => list.appendChild(h('div.result', {
      role: 'option', 'aria-selected': i === idx ? 'true' : 'false', class: `result${i === idx ? ' sel' : ''}${isRegistered(c.id) ? '' : ' planned'}`,
      onclick: () => go(c.id),
    }, h('strong', c.label), h('span.where', ` ${c.tab} ▸ ${c.group}`), h('span.key', shortcutOf(c.id)), isRegistered(c.id) ? null : h('em', ' planned'), h('div.notes', c.notes))));
  };
  let close: (v: any) => void = () => {};
  const go = (id: string) => { close(null); setTimeout(() => run(id), 0); };
  input.addEventListener('input', () => { idx = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); draw(); e.preventDefault(); }
    if (e.key === 'Enter' && items[idx]) { go(items[idx].id); e.preventDefault(); }
  });
  draw();
  const p = modal('Search Commands', h('div', input, list), [{ label: 'Close', value: null }], { wide: true });
  close = () => (document.querySelector('.backdrop:last-child .dialog-buttons button') as HTMLButtonElement)?.click();
  setTimeout(() => input.focus(), 0);
  await p;
}

export function openBackstage() {
  const groups = PLAN.tabs.find((t) => t.key === 'file')!.groups;
  const body = h('div.backstage', groups.map((g) => h('section', h('h3', g.name), g.commands.map((c) => {
    const b = cmdButton(c.id, false);
    b?.addEventListener('click', () => (document.querySelector('.backdrop:last-child .dialog-buttons button') as HTMLButtonElement)?.click());
    return b;
  }))));
  return modal('File', body, [{ label: 'Close', value: null }], { wide: true });
}

function statusBar() {
  const counts = statusCounts(app.statuses());
  const drafts = app.store.ties.filter((t) => t.state === 'proposed').length;
  const errs = app.findings.filter((f) => f.severity === 'error').length;
  return h('div.statusbar', { role: 'status' },
    (Object.keys(counts) as Status[]).map((s) => h('button.badge', { class: `badge st-${s}`, title: `Show ${STATUS_LABEL[s]} claims`, onclick: () => { app.filter.status = app.filter.status === s ? '' : s; app.render(); } }, `${STATUS_LABEL[s]} ${counts[s]}`)),
    h('button.badge.drafts', { onclick: () => run('review.verifyDrafts'), title: 'Proposed ties waiting for a person' }, `Drafts ${drafts}`),
    h('span', ` · ${app.store.evidence.length} sources · ${app.store.documents.length} documents · ${app.store.anchors.length} anchors · ${app.store.ties.filter((t) => t.state === 'confirmed').length} confirmed ties`),
    errs ? h('span.err', ` · ${errs} problems`) : null,
    app.blind ? h('span.blind', ' · Second Reader Mode') : null,
    h('span.ai', ` · AI: ${app.ai.active ? app.ai.providers[app.ai.active]?.label + ' ' + (app.ai.providers[app.ai.active]?.model ?? '') : 'not set up'}`),
  );
}

let root: { top: HTMLElement; bottom: HTMLElement } | null = null;
export function mountShell(top: HTMLElement, bottom: HTMLElement) { root = { top, bottom }; }

export function renderShell() {
  if (!root) return;
  const mode = getMenusMode();
  clear(root.top).append(qat(), ...(mode !== 'ribbon' ? [menubar()] : []), ...(mode !== 'menus' ? [ribbon()] : []));
  clear(root.bottom).append(statusBar());
}

export function installKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'q' || e.key === 'Q')) { e.preventDefault(); openSearch(); return; }
    if (isDialogOpen()) return;
    const name = keyName(e);
    if (!name) return;
    const t = e.target as HTMLElement;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const id = commandForKey(name);
    if (!id) return;
    // While typing, let editing keys behave normally.
    if (typing && /^(Ctrl\+[CVXZYA]|Delete|Backspace|Alt\+Left|Alt\+Right)$/.test(name)) return;
    if (typing && !name.includes('Ctrl') && !name.includes('Alt') && !/^F\d+/.test(name)) return;
    if (isRegistered(id)) { e.preventDefault(); run(id); }
  });
}
