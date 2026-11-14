// Commands are data: the plan (docs/commands-plan.json) gives labels, tabs, groups and keys;
// a command is registered only when it works. Unregistered commands show as planned.
import plan from '../../docs/commands-plan.json';

export interface PlanCommand { id: string; label: string; shortcut: string; origins: string[]; notes: string; inTabs: boolean }
export interface PlanGroup { name: string; commands: PlanCommand[] }
export interface PlanTab { key: string; name: string; description: string; groups: PlanGroup[] }

export const PLAN = plan as unknown as { tabs: PlanTab[]; origins: Record<string, string> };

export interface CommandImpl {
  run: () => unknown | Promise<unknown>;
  enabled?: () => boolean;
  checked?: () => boolean;
  icon?: string;
}

const impls = new Map<string, CommandImpl>();
const meta = new Map<string, PlanCommand & { tab: string; group: string }>();
for (const t of PLAN.tabs) for (const g of t.groups) for (const c of g.commands) meta.set(c.id, { ...c, tab: t.name, group: g.name });

export function register(id: string, impl: CommandImpl | (() => unknown)) {
  if (!meta.has(id)) throw new Error(`Command ${id} is not in the plan`);
  impls.set(id, typeof impl === 'function' ? { run: impl } : impl);
}

export const isRegistered = (id: string) => impls.has(id);
export const commandMeta = (id: string) => meta.get(id);
export const allCommands = () => [...meta.values()];
export const registeredIds = () => [...impls.keys()];

export function isEnabled(id: string) {
  const c = impls.get(id);
  if (!c) return false;
  try { return c.enabled ? c.enabled() : true; } catch { return false; }
}
export function isChecked(id: string) {
  try { return !!impls.get(id)?.checked?.(); } catch { return false; }
}

type Hook = (id: string) => void;
const before: Hook[] = [];
const after: Hook[] = [];
export const onBeforeRun = (f: Hook) => before.push(f);
export const onAfterRun = (f: Hook) => after.push(f);
let errorHandler: (id: string, e: unknown) => void = (id, e) => console.error(id, e);
export const onError = (f: typeof errorHandler) => { errorHandler = f; };

export async function run(id: string) {
  const c = impls.get(id);
  if (!c || !isEnabled(id)) return;
  for (const f of before) f(id);
  try {
    await c.run();
  } catch (e) {
    if ((e as any)?.name !== 'AbortError') errorHandler(id, e);
  } finally {
    for (const f of after) f(id);
  }
}

/** Normalize a key event to the plan's shortcut notation, e.g. "Ctrl+Shift+K". */
export function keyName(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let k = e.key;
  if (k === ' ') k = 'Space';
  else if (k.length === 1) k = k.toUpperCase();
  else if (k === 'ArrowLeft') k = 'Left';
  else if (k === 'ArrowRight') k = 'Right';
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return '';
  if (e.code === 'Equal' && (e.ctrlKey || e.metaKey)) k = '=';
  if (e.code === 'Minus' && (e.ctrlKey || e.metaKey)) k = '-';
  if (e.code === 'Period' && e.altKey) k = '.';
  parts.push(k);
  return parts.join('+');
}

const BIND_KEY = 'annes-witness.keys';
export function customBindings(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(BIND_KEY) ?? '{}'); } catch { return {}; }
}
export function setCustomBindings(b: Record<string, string>) {
  localStorage.setItem(BIND_KEY, JSON.stringify(b));
}

export function shortcutOf(id: string): string {
  const custom = customBindings();
  if (id in custom) return custom[id];
  return meta.get(id)?.shortcut ?? '';
}

export function commandForKey(name: string): string | null {
  const custom = customBindings();
  for (const [id, k] of Object.entries(custom)) if (k && k.toLowerCase() === name.toLowerCase()) return id;
  for (const m of meta.values()) if (m.shortcut && m.shortcut.toLowerCase() === name.toLowerCase() && !(m.id in custom)) return m.id;
  return null;
}

/** Commands for search: label, id, tab, notes. */
export function searchCommands(q: string): (PlanCommand & { tab: string; group: string })[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return allCommands()
    .map((c) => {
      const hay = `${c.label} ${c.id} ${c.tab} ${c.group} ${c.notes}`.toLowerCase();
      let score = 0;
      for (const w of words) {
        if (!hay.includes(w)) return { c, score: -1 };
        score += c.label.toLowerCase().includes(w) ? 3 : 1;
        if (c.label.toLowerCase().startsWith(w)) score += 2;
      }
      return { c, score: score + (isRegistered(c.id) ? 1 : 0) };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);
}

export const ICONS: Record<string, string> = {
  file: 'description', home: 'home', source: 'folder_open', claim: 'format_quote', tie: 'link', check: 'fact_check',
  resolve: 'balance', report: 'summarize', review: 'rate_review', view: 'visibility', tools: 'build', ai: 'auto_awesome', dev: 'code', help: 'help',
};
