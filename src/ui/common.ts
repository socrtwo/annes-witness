import { app } from './app';
import { alertBox } from './dialogs';
import { Claim, Source } from '../core/types';
import { makeBackend, AiBackend } from '../ai/backend';
import { providerWithKey } from '../ai/settings';

export class UserError extends Error {}
export function need<T>(v: T | undefined | null | false, msg: string): T {
  if (!v) throw new UserError(msg);
  return v as T;
}
export const needClaim = (): Claim => need(app.claim, 'Select a claim first.');
export const needSource = (): Source => need(app.source ?? (app.store.evidence.length === 1 ? app.store.evidence[0] : undefined), 'Select a source first.');
export const needDoc = (): Source => need(app.document, 'Link a document first (Claims ▸ Link Document).');

let current: AbortController | null = null;
export function aiAbort(): AbortSignal {
  current = new AbortController();
  return current.signal;
}
export function stopAi() { current?.abort(); current = null; }

export function backend(id = app.ai.active): AiBackend {
  const cfg = providerWithKey(app.ai, id);
  if (!cfg) throw new UserError('Set up AI first: AI ▸ Set Up AI.');
  if (cfg.kind === 'anthropic' && !cfg.apiKey) throw new UserError('The API key is not available in this session. Run AI ▸ Set Up AI to enter it again, or unlock saved keys.');
  return makeBackend(cfg);
}

export function extraBackends(): AiBackend[] {
  const e = app.ai.ensemble;
  if (e.mode === 'single') return [];
  return e.members.filter((m) => m !== app.ai.active && app.ai.providers[m]).map((m) => backend(m));
}

export async function showError(id: string, e: unknown) {
  const msg = e instanceof UserError ? e.message : `${(e as Error)?.message ?? e}`;
  await alertBox(e instanceof UserError ? 'Cannot do that yet' : `Problem running ${id}`, msg);
}

export function confirmAiSend(what: string): boolean {
  void what;
  return true;
}

export function slug(s: string) {
  return s.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'case';
}
