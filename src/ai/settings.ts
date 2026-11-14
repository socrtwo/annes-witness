// AI settings and keys. Keys never go into the case file or exported settings.
import { Effort, ProviderConfig } from './backend';

export interface EnsembleSettings {
  mode: 'single' | 'master' | 'consensus';
  members: string[];
  master: string;
  maxRounds: number;
  showDeliberation: boolean;
}

export interface AiSettings {
  active: string;
  providers: Record<string, Omit<ProviderConfig, 'apiKey'>>;
  ensemble: EnsembleSettings;
  remember: 'session' | 'passphrase';
}

const SETTINGS_KEY = 'annes-witness.ai';
const KEY_PREFIX = 'annes-witness.key.';
const VAULT = 'annes-witness.vault';

export const SERVICES = [
  {
    kind: 'anthropic' as const, id: 'anthropic', label: 'Claude (Anthropic)', group: 'Paid', recommended: true,
    keyPage: 'https://platform.claude.com/settings/keys', priceInfo: 'https://www.anthropic.com/pricing',
    note: 'Recommended. Claude returns citations that point into your sources, which the app re-checks.',
    defaultModel: 'claude-opus-5-5',
  },
  {
    kind: 'openai-compatible' as const, id: 'ollama', label: 'Ollama (your computer)', group: 'Free · your computer', recommended: false,
    keyPage: 'https://ollama.com/download', baseUrl: 'http://localhost:11434/v1', note: 'Runs a model on your own computer. No citations; proposals are checked by quote matching only.',
    defaultModel: 'llama3.1',
  },
  {
    kind: 'openai-compatible' as const, id: 'lmstudio', label: 'LM Studio (your computer)', group: 'Free · your computer', recommended: false,
    keyPage: 'https://lmstudio.ai/', baseUrl: 'http://localhost:1234/v1', note: 'Local server. No citations; proposals are checked by quote matching only.',
    defaultModel: 'local-model',
  },
  {
    kind: 'openai-compatible' as const, id: 'custom', label: 'Other OpenAI-compatible service', group: 'Other', recommended: false,
    keyPage: '', baseUrl: '', note: 'Any server that implements chat completions.', defaultModel: '',
  },
];

export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

function ls(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
function ss(): Storage | null {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

export function loadAiSettings(): AiSettings {
  const def: AiSettings = { active: '', providers: {}, ensemble: { mode: 'single', members: [], master: '', maxRounds: 3, showDeliberation: true }, remember: 'session' };
  try {
    const raw = ls()?.getItem(SETTINGS_KEY);
    return raw ? { ...def, ...JSON.parse(raw), ensemble: { ...def.ensemble, ...JSON.parse(raw).ensemble } } : def;
  } catch {
    return def;
  }
}

export function saveAiSettings(s: AiSettings) {
  ls()?.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// --- keys --------------------------------------------------------------------
let unlocked: Record<string, string> | null = null;

async function deriveKey(passphrase: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function hasVault(): boolean { return !!ls()?.getItem(VAULT); }

export async function unlockVault(passphrase: string): Promise<boolean> {
  const raw = ls()?.getItem(VAULT);
  if (!raw) { unlocked = {}; return true; }
  const v = JSON.parse(raw);
  try {
    const key = await deriveKey(passphrase, unb64(v.salt));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) as BufferSource }, key, unb64(v.data) as BufferSource);
    unlocked = JSON.parse(new TextDecoder().decode(plain));
    return true;
  } catch {
    return false;
  }
}

async function writeVault(passphrase: string, keys: Record<string, string>) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(JSON.stringify(keys))));
  ls()?.setItem(VAULT, JSON.stringify({ salt: b64(salt), iv: b64(iv), data: b64(data) }));
}

export async function setKey(providerId: string, apiKey: string, mode: 'session' | 'passphrase', passphrase?: string) {
  if (mode === 'session') {
    ss()?.setItem(KEY_PREFIX + providerId, apiKey);
    return;
  }
  if (!passphrase) throw new Error('A passphrase is needed to remember keys on this device.');
  if (hasVault() && !unlocked && !(await unlockVault(passphrase))) throw new Error('Wrong passphrase.');
  const keys = { ...(unlocked ?? {}), [providerId]: apiKey };
  await writeVault(passphrase, keys);
  unlocked = keys;
}

export function getKey(providerId: string): string | undefined {
  return ss()?.getItem(KEY_PREFIX + providerId) ?? unlocked?.[providerId];
}

export function forgetKeys() {
  const s = ss();
  if (s) for (const k of Object.keys(s)) if (k.startsWith(KEY_PREFIX)) s.removeItem(k);
  ls()?.removeItem(VAULT);
  unlocked = null;
}

export function providerWithKey(s: AiSettings, id = s.active): ProviderConfig | null {
  const p = s.providers[id];
  if (!p) return null;
  return { ...p, apiKey: getKey(id) };
}
