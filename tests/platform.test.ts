// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { updateRecent, sortRecent, MAX_RECENT, storageKey, windowId, desktop, platformFetch, WebRecent } from '../src/platform/index';

vi.mock('../src/readers/pdf', () => ({ readPdf: vi.fn(), renderPdfPage: vi.fn(), pdfTextRects: vi.fn(), openPdf: vi.fn(), pageItemsToText: vi.fn() }));

const at = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();

describe('web recent files', () => {
  it('adds, refreshes and caps unpinned entries while keeping pinned ones', () => {
    let list: WebRecent[] = [];
    for (let i = 0; i < MAX_RECENT + 5; i++) list = updateRecent(list, { id: `id${i}`, name: `case${i}.witness`, opened: '' }, at(i)).list;
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0].name).toBe(`case${MAX_RECENT + 4}.witness`);
    // Pin the oldest kept entry, then add more: it survives.
    const oldest = list[list.length - 1];
    list = list.map((r) => (r.id === oldest.id ? { ...r, pinned: true } : r));
    for (let i = 100; i < 110; i++) list = updateRecent(list, { id: `n${i}`, name: `n${i}.witness`, opened: '' }, at(i)).list;
    expect(list.some((r) => r.id === oldest.id && r.pinned)).toBe(true);
    expect(list.filter((r) => !r.pinned)).toHaveLength(MAX_RECENT);
  });
  it('refreshes an existing entry by name instead of duplicating it, and reports removals', () => {
    let { list } = updateRecent([], { id: 'a', name: 'x.witness', opened: '' }, at(1));
    const r = updateRecent(list, { id: 'b', name: 'x.witness', opened: '' }, at(2));
    list = r.list;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('b');
    expect(r.removed).toContain('a');
  });
  it('sorts pinned first, then newest', () => {
    const s = sortRecent([
      { id: '1', name: 'a', pinned: false, opened: at(5) },
      { id: '2', name: 'b', pinned: true, opened: at(1) },
      { id: '3', name: 'c', pinned: false, opened: at(9) },
    ]);
    expect(s.map((x) => x.id)).toEqual(['2', '3', '1']);
  });
});

describe('windows and desktop detection', () => {
  it('namespaces autosave keys by window', () => {
    expect(windowId('?w=abc')).toBe('abc');
    expect(windowId('')).toBe('');
    expect(storageKey('current', '')).toBe('current');
    expect(storageKey('blobs', 'abc')).toBe('blobs:abc');
  });
  it('uses the desktop page fetch when the preload API is present', async () => {
    expect(desktop()).toBeNull();
    (window as any).witnessDesktop = { fetchPage: vi.fn(async () => ({ html: '<title>T</title>', finalUrl: 'https://example.org/final', status: 200 })) };
    const res = await platformFetch()('https://example.org/');
    expect(res.status).toBe(200);
    expect(res.url).toBe('https://example.org/final');
    expect(await res.text()).toContain('<title>T</title>');
    delete (window as any).witnessDesktop;
  });
});

describe('platform commands', () => {
  it('registers the five platform commands; Show in Folder is desktop-only', async () => {
    const reg = await import('../src/ui/registry');
    const { registerPlatformCommands } = await import('../src/ui/cmd-platform');
    registerPlatformCommands();
    for (const id of ['file.openRecent', 'file.pinned', 'file.newWindow', 'file.revealInFolder', 'tools.openInApp']) expect(reg.isRegistered(id)).toBe(true);
    expect(reg.isEnabled('file.revealInFolder')).toBe(false);
    (window as any).witnessDesktop = {};
    expect(reg.isEnabled('file.revealInFolder')).toBe(true);
    delete (window as any).witnessDesktop;
  });
});
