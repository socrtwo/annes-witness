// Exposes a small, typed desktop API to the sandboxed renderer as window.witnessDesktop.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('witnessDesktop', {
  platform: process.platform,
  openCase: () => ipcRenderer.invoke('witness:openCase'),
  saveCase: (bytes, path) => ipcRenderer.invoke('witness:saveCase', bytes, path ?? null),
  recentFiles: () => ipcRenderer.invoke('witness:recentFiles'),
  addRecent: (path) => ipcRenderer.invoke('witness:addRecent', path),
  pin: (path, pinned) => ipcRenderer.invoke('witness:pin', path, !!pinned),
  readFile: (path) => ipcRenderer.invoke('witness:readFile', path),
  showInFolder: (path) => ipcRenderer.invoke('witness:showInFolder', path),
  openWithSystem: (bytes, fileName) => ipcRenderer.invoke('witness:openWithSystem', bytes, fileName),
  fetchPage: (url) => ipcRenderer.invoke('witness:fetchPage', url),
  newWindow: () => ipcRenderer.invoke('witness:newWindow'),
});
