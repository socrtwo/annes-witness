// Desktop shell: serves the built web app from dist/ over a private app:// scheme, with a
// sandboxed renderer and a small IPC API (electron/preload.cjs) for files and page capture.
const { app, BrowserWindow, protocol, net, shell, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const FILTERS = [{ name: "Anne's Witness case", extensions: ['witness'] }, { name: 'All files', extensions: ['*'] }];
const MAX_RECENT = 20;
let windowCount = 0;

function distRoot() {
  // Staged app (build/desktop-app): dist/ sits beside electron/. Development: ../dist.
  return path.resolve(__dirname, '..', 'dist');
}

function createWindow() {
  windowCount++;
  const win = new BrowserWindow({
    width: 1400, height: 900, title: "Anne's Witness",
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  // Each extra window gets its own autosave slot (?w=…) so windows do not overwrite each other.
  win.loadURL('app://local/index.html' + (windowCount > 1 ? `?w=desktop${windowCount}` : ''));
  return win;
}

// --- recent files -------------------------------------------------------------------------
const recentPath = () => path.join(app.getPath('userData'), 'recent.json');
function readRecent() {
  try {
    const list = JSON.parse(fs.readFileSync(recentPath(), 'utf8'));
    return Array.isArray(list) ? list.filter((r) => r && typeof r.path === 'string') : [];
  } catch { return []; }
}
function writeRecent(list) {
  fs.mkdirSync(path.dirname(recentPath()), { recursive: true });
  fs.writeFileSync(recentPath(), JSON.stringify(list, null, 1));
}
function addRecent(p) {
  const list = readRecent();
  const old = list.find((r) => r.path === p);
  const next = [{ path: p, name: path.basename(p), pinned: old?.pinned ?? false, opened: new Date().toISOString() }, ...list.filter((r) => r.path !== p)];
  const pinned = next.filter((r) => r.pinned), rest = next.filter((r) => !r.pinned).slice(0, MAX_RECENT);
  writeRecent([...pinned, ...rest]);
  try { app.addRecentDocument(p); } catch { /* not on every platform */ }
}

const str = (v) => { if (typeof v !== 'string' || !v) throw new Error('Expected a non-empty string'); return v; };
const bytesOf = (v) => {
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (v instanceof ArrayBuffer) return Buffer.from(new Uint8Array(v));
  throw new Error('Expected bytes');
};

function registerIpc() {
  ipcMain.handle('witness:openCase', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openFile'], filters: FILTERS });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = r.filePaths[0];
    addRecent(p);
    return { path: p, name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(p)) };
  });
  ipcMain.handle('witness:saveCase', async (e, bytes, p) => {
    const data = bytesOf(bytes);
    let target = typeof p === 'string' && p ? p : null;
    if (!target) {
      const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath: 'case.witness', filters: FILTERS });
      if (r.canceled || !r.filePath) return null;
      target = r.filePath.endsWith('.witness') ? r.filePath : r.filePath + '.witness';
    }
    fs.writeFileSync(target, data);
    addRecent(target);
    return target;
  });
  ipcMain.handle('witness:recentFiles', () => readRecent().map((r) => ({ ...r, exists: fs.existsSync(r.path) })));
  ipcMain.handle('witness:addRecent', (_e, p) => { addRecent(str(p)); return true; });
  ipcMain.handle('witness:pin', (_e, p, pinned) => {
    const target = str(p);
    const list = readRecent();
    if (!list.some((r) => r.path === target)) list.unshift({ path: target, name: path.basename(target), pinned: false, opened: new Date().toISOString() });
    writeRecent(list.map((r) => (r.path === target ? { ...r, pinned: !!pinned } : r)));
    return true;
  });
  ipcMain.handle('witness:readFile', (_e, p) => {
    const target = str(p);
    // Only files the user opened or saved through the app (the recent list) may be read back.
    if (!readRecent().some((r) => r.path === target)) throw new Error('That file is not in the recent list.');
    addRecent(target);
    return { path: target, name: path.basename(target), bytes: new Uint8Array(fs.readFileSync(target)) };
  });
  ipcMain.handle('witness:showInFolder', (_e, p) => { shell.showItemInFolder(str(p)); return true; });
  ipcMain.handle('witness:openWithSystem', async (_e, bytes, fileName) => {
    const safe = path.basename(str(fileName)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'file';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'annes-witness-'));
    const file = path.join(dir, safe);
    fs.writeFileSync(file, bytesOf(bytes));
    const err = await shell.openPath(file);
    if (err) throw new Error(err);
    return file;
  });
  ipcMain.handle('witness:fetchPage', async (_e, url) => {
    const u = new URL(str(url));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https addresses can be captured.');
    const res = await net.fetch(u.toString(), { redirect: 'follow' });
    const html = await res.text();
    return { html, finalUrl: res.url || u.toString(), status: res.status };
  });
  ipcMain.handle('witness:newWindow', () => { createWindow(); return true; });
}

app.whenReady().then(() => {
  const root = distRoot();
  protocol.handle('app', (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.resolve(root, '.' + p);
    if (!file.startsWith(root)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
