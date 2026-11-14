// Password protection of a whole case file (AES-GCM, key from PBKDF2-SHA-256).
const MAGIC = new TextEncoder().encode('AWITENC1');

export function isProtected(bytes: Uint8Array): boolean {
  return bytes.length > MAGIC.length && MAGIC.every((b, i) => bytes[i] === b);
}

async function key(pass: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function protect(bytes: Uint8Array, pass: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await key(pass, salt), bytes as BufferSource));
  const out = new Uint8Array(MAGIC.length + 28 + ct.length);
  out.set(MAGIC, 0);
  out.set(salt, MAGIC.length);
  out.set(iv, MAGIC.length + 16);
  out.set(ct, MAGIC.length + 28);
  return out;
}

export async function unprotect(bytes: Uint8Array, pass: string): Promise<Uint8Array> {
  const salt = bytes.slice(MAGIC.length, MAGIC.length + 16);
  const iv = bytes.slice(MAGIC.length + 16, MAGIC.length + 28);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await key(pass, salt), bytes.slice(MAGIC.length + 28) as BufferSource));
  } catch {
    throw new Error('Wrong password, or the file is damaged.');
  }
}
