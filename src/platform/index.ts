// The platform layer: desktop features through the Electron preload API when present,
// browser equivalents otherwise.

export interface RecentEntry { path: string; name: string; pinned: boolean; opened: string; exists?: boolean }

export interface WitnessDesktop {
  platform: string;
  openCase(): Promise<{ path: string; name: string; bytes: Uint8Array } | null>;
  saveCase(bytes: Uint8Array, path?: string | null): Promise<string | null>;
  recentFiles(): Promise<RecentEntry[]>;
  addRecent(path: string): Promise<boolean>;
  pin(path: string, pinned: boolean): Promise<boolean>;
  readFile(path: string): Promise<{ path: string; name: string; bytes: Uint8Array }>;
  showInFolder(path: string): Promise<boolean>;
  openWithSystem(bytes: Uint8Array, fileName: string): Promise<string>;
  fetchPage(url: string): Promise<{ html: string; finalUrl: string; status: number }>;
  newWindow(): Promise<boolean>;
}

/** The desktop API, or null in a browser or the mobile app. */
export function desktop(): WitnessDesktop | null {
  return ((globalThis as any).window?.witnessDesktop as WitnessDesktop | undefined) ?? null;
}

/** A fetch for capturing web pages: on desktop it runs in the main process, so other sites' pages are not blocked by CORS. */
export function platformFetch(): typeof fetch {
  const d = desktop();
  if (!d) return (...a: Parameters<typeof fetch>) => fetch(...a);
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const r = await d.fetchPage(url);
    const res = new Response(r.html, { status: r.status, headers: { 'content-type': 'text/html; charset=utf-8' } });
    Object.defineProperty(res, 'url', { value: r.finalUrl });
    return res;
  }) as typeof fetch;
}

/** The window id of this browser window (?w=…); '' for the main window. */
export function windowId(search = (globalThis as any).location?.search ?? ''): string {
  try { return new URLSearchParams(search).get('w') ?? ''; } catch { return ''; }
}
export const storageKey = (base: string, w = windowId()) => (w ? `${base}:${w}` : base);

// --- saving and opening ----------------------------------------------------------------------

/** Save through the desktop dialog. Returns the path, or null when cancelled; throws on the web (use the browser path). */
export async function saveBytes(bytes: Uint8Array, _suggestedName: string, currentPath?: string | null): Promise<string | null> {
  const d = desktop();
  if (!d) throw new Error('Not on desktop');
  return d.saveCase(bytes, currentPath ?? null);
}

/** Open through the desktop dialog; null when cancelled or not on desktop. */
export async function openBytesDialog(): Promise<{ path: string; name: string; bytes: Uint8Array } | null> {
  const d = desktop();
  return d ? d.openCase() : null;
}

// --- recent files in the browser (File System Access handles kept in IndexedDB) ----------------

export interface WebRecent { id: string; name: string; pinned: boolean; opened: string; handle?: unknown }

const DB = 'annes-witness-recent';
const STORE = 'recent';
export const MAX_RECENT = 20;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((res) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
  });
}

async function all(db: IDBDatabase): Promise<WebRecent[]> {
  return new Promise((res) => {
    const r = db.transaction(STORE).objectStore(STORE).getAll();
    r.onsuccess = () => res((r.result as WebRecent[]) ?? []);
    r.onerror = () => res([]);
  });
}

async function write(db: IDBDatabase, puts: WebRecent[], deletes: string[]) {
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    for (const p of puts) st.put(p);
    for (const d of deletes) st.delete(d);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

/** Pure bookkeeping: add or refresh an entry, keep pinned entries, keep at most MAX_RECENT unpinned ones. */
export function updateRecent(list: WebRecent[], entry: Omit<WebRecent, 'pinned'> & { pinned?: boolean }, now = new Date().toISOString()): { list: WebRecent[]; removed: string[] } {
  const old = list.find((r) => r.id === entry.id || r.name === entry.name);
  const fresh: WebRecent = { ...old, ...entry, pinned: entry.pinned ?? old?.pinned ?? false, opened: now };
  const others = list.filter((r) => r !== old);
  const next = [fresh, ...others].sort((a, b) => (a.opened < b.opened ? 1 : -1));
  const pinned = next.filter((r) => r.pinned);
  const unpinned = next.filter((r) => !r.pinned);
  const keep = [...pinned, ...unpinned.slice(0, MAX_RECENT)];
  const removed = next.filter((r) => !keep.includes(r)).map((r) => r.id);
  if (old && old.id !== fresh.id) removed.push(old.id);
  return { list: keep, removed };
}

export function sortRecent(list: WebRecent[]): WebRecent[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.opened < b.opened ? 1 : -1));
}

export async function webRecent(): Promise<WebRecent[]> {
  const db = await openDb();
  return db ? sortRecent(await all(db)) : [];
}

export async function rememberWebFile(name: string, handle?: unknown): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const cur = await all(db);
  const id = cur.find((r) => r.name === name)?.id ?? `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const { list, removed } = updateRecent(cur, { id, name, handle, opened: '' });
  await write(db, list, removed);
}

export async function pinWebFile(name: string, pinned: boolean): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const cur = await all(db);
  const hit = cur.find((r) => r.name === name);
  if (hit) await write(db, [{ ...hit, pinned }], []);
  else await write(db, [{ id: `r_${Date.now().toString(36)}`, name, pinned, opened: new Date().toISOString() }], []);
}

/** Read a remembered browser file, asking for permission again if needed. */
export async function readWebHandle(entry: WebRecent): Promise<Uint8Array | null> {
  const h = entry.handle as any;
  if (!h?.getFile) return null;
  if (h.queryPermission && (await h.queryPermission({ mode: 'read' })) !== 'granted') {
    if (!h.requestPermission || (await h.requestPermission({ mode: 'read' })) !== 'granted') return null;
  }
  const f: File = await h.getFile();
  return new Uint8Array(await f.arrayBuffer());
}

export const supportsHandles = () => typeof (globalThis as any).window?.showOpenFilePicker === 'function';
