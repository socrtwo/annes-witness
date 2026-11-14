// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/readers/pdf', () => ({ readPdf: vi.fn(), renderPdfPage: vi.fn(), pdfTextRects: vi.fn(), openPdf: vi.fn(), pageItemsToText: vi.fn() }));
vi.mock('../src/ui/query', () => ({ queryCase: vi.fn() }));

describe('command catalog', () => {
  it('registers only planned commands, and every AI-tab essential', async () => {
    const reg = await import('../src/ui/registry');
    const { registerFileCommands } = await import('../src/ui/cmd-file');
    const { registerCaseCommands } = await import('../src/ui/cmd-case');
    const { registerCheckCommands } = await import('../src/ui/cmd-check');
    const { registerAiCommands } = await import('../src/ui/cmd-ai');
    registerFileCommands(); registerCaseCommands(); registerCheckCommands(); registerAiCommands();
    const ids = reg.registeredIds();
    const planned = new Set(reg.allCommands().map((c) => c.id));
    for (const id of ids) expect(planned.has(id)).toBe(true);
    for (const id of ['ai.setup', 'ai.attributionWizard', 'review.verifyDrafts', 'ai.privacy', 'ai.history', 'ai.stop', 'tie.confirm', 'tie.reject'])
      expect(reg.isRegistered(id)).toBe(true);
    expect(ids.length).toBeGreaterThan(250);
    // Shortcuts in the plan are unique.
    const keys = reg.allCommands().map((c) => c.shortcut.toLowerCase()).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
