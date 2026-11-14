// Commands that depend on the platform: recent and pinned cases, new windows, the file manager,
// and opening files with the system's own programs.
import { register } from './registry';
import { app } from './app';
import { choose, toast, download, confirmBox, alertBox } from './dialogs';
import { need, UserError } from './common';
import { openCaseBytes } from './cmd-file';
import { desktop, webRecent, readWebHandle, supportsHandles, pinWebFile, sortRecent } from '../platform/index';

async function openPath(path: string) {
  const d = desktop()!;
  const f = await d.readFile(path);
  await openCaseBytes(f.bytes, f.name, false, null, f.path);
}

export function registerPlatformCommands() {
  register('file.openRecent', async () => {
    const d = desktop();
    if (d) {
      const list = sortRecent((await d.recentFiles()).map((r) => ({ id: r.path, name: r.name, pinned: r.pinned, opened: r.opened, exists: r.exists } as any)));
      if (!list.length) throw new UserError('No recent cases yet.');
      const pick = await choose('Recent Cases', list.map((r: any) => ({ label: `${r.pinned ? '📌 ' : ''}${r.name}`, value: r.id, detail: `${r.id}${r.exists === false ? ' — missing' : ''}` })));
      if (pick) await openPath(pick);
      return;
    }
    const list = await webRecent();
    if (!list.length) throw new UserError(supportsHandles() ? 'No recent cases yet. Cases you open or save from now on are listed here.' : 'This browser cannot reopen files by itself. Use File ▸ Open, or the desktop app.');
    const pick = await choose('Recent Cases', list.map((r) => ({ label: `${r.pinned ? '📌 ' : ''}${r.name}`, value: r.id, detail: `last opened ${r.opened.slice(0, 16).replace('T', ' ')}${r.handle ? '' : ' — reopen with File ▸ Open'}` })));
    if (!pick) return;
    const entry = list.find((r) => r.id === pick)!;
    const bytes = await readWebHandle(entry);
    if (!bytes) throw new UserError(`“${entry.name}” cannot be reopened directly in this browser (no permission or no stored handle). Use File ▸ Open.`);
    await openCaseBytes(bytes, entry.name, false, entry.handle ?? null);
  });

  register('file.pinned', async () => {
    const d = desktop();
    const current: string = app.filePath ?? app.fileName;
    const list = d
      ? (await d.recentFiles()).map((r) => ({ key: r.path, name: r.name, pinned: r.pinned }))
      : (await webRecent()).map((r) => ({ key: r.name, name: r.name, pinned: r.pinned }));
    const pinned = list.filter((r) => r.pinned);
    const isPinned = list.some((r) => r.key === current && r.pinned);
    const pick = await choose('Pinned Cases', [
      { label: isPinned ? `Unpin the current case (${app.fileName})` : `Pin the current case (${app.fileName})`, value: '__toggle' },
      ...pinned.map((r) => ({ label: `📌 ${r.name}`, value: r.key, detail: d ? r.key : 'open' })),
    ], pinned.length ? 'Pinned cases stay at the top of Recent Cases.' : 'No pinned cases yet.');
    if (!pick) return;
    if (pick === '__toggle') {
      if (d) {
        need(app.filePath, 'Save the case to a file first, then pin it.');
        await d.pin(current, !isPinned);
      } else await pinWebFile(app.fileName, !isPinned);
      toast(isPinned ? 'Unpinned.' : 'Pinned.');
      return;
    }
    if (d) await openPath(pick);
    else {
      const entry = (await webRecent()).find((r) => r.name === pick);
      const bytes = entry ? await readWebHandle(entry) : null;
      if (!bytes) throw new UserError('This browser cannot reopen that file directly. Use File ▸ Open.');
      await app.openBytes(bytes, entry!.name);
    }
  });

  register('file.newWindow', async () => {
    const d = desktop();
    if (d) { await d.newWindow(); return; }
    const id = Math.random().toString(36).slice(2, 8);
    const w = window.open(`${location.pathname}?w=${id}`, '_blank');
    if (!w) throw new UserError('The browser blocked the new window. Allow pop-ups for this site and try again.');
  });

  register('file.revealInFolder', {
    run: async () => {
      const p = need(app.filePath as string | undefined, 'Save the case to a file first.');
      await desktop()!.showInFolder(p);
    },
    enabled: () => !!desktop(),
  });

  register('tools.openInApp', async () => {
    const s = need(app.sel.sourceId ? app.data.sources[app.sel.sourceId] : app.document, 'Select a source, or link a document.');
    const bytes = need(app.blobs.get(s.id), `The file of “${s.title}” is not stored in this case.`);
    const name = s.fileName ?? `${s.title}`;
    const d = desktop();
    if (d) {
      await d.openWithSystem(bytes, name);
      toast(`Opened “${name}” with its program. Changes made there do not change the source in the case; use Replace with Better Copy to bring a new version in.`);
      return;
    }
    if (await confirmBox('Open in Its App', `A browser cannot start other programs. Download “${name}” to open it yourself?`, 'Download')) download(bytes, name, s.mime);
    else await alertBox('Open in Its App', 'In the desktop app this opens the file directly in its own program.');
  });
}
