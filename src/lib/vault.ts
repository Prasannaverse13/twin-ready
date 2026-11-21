// The Private Vault. Everything the twin knows about you (identity, memories, style) is
// encrypted with AES-GCM using a key derived from your passphrase (PBKDF2, 310k rounds).
// Only ciphertext is written to disk. The key lives in memory while the tab is open.
import { load, save, remove } from './store';
import type { Mem, StyleCard } from './memory';

export interface Identity { displayName: string; email?: string; phone?: string; address?: string }

export interface TwinData {
  v: 1;
  identity: Identity;
  memories: Mem[];
  style: StyleCard;
  samples: string; // recent writing samples used for the style card. Device only.
  nextId: number;
  publicId?: string; // id of the published public twin, if any
  publicNote?: string; // owner written line shown on the public page
}

interface Sealed { salt: string; iv: string; ct: string; v: 1 }

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(pass: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 310_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

let key: CryptoKey | null = null;
let salt: Uint8Array | null = null;
let twin: TwinData | null = null;

export const vaultExists = async () => !!(await load<Sealed | null>('vault', null));
export const isUnlocked = () => !!key && !!twin;
export function getTwin(): TwinData {
  if (!twin) throw new Error('Vault is locked');
  return twin;
}

export const emptyStyle = (): StyleCard => ({
  stats: { avgWords: 0, emojiRate: 0, lowercaseStart: 0, exclaim: 0, question: 0, contractions: 0, slang: 0, topPhrases: [] },
  description: 'No writing samples yet. Plain and friendly.',
});

export async function createVault(pass: string, identity: Identity): Promise<TwinData> {
  if (pass.length < 8) throw new Error('Use at least 8 characters');
  if (!identity.displayName.trim()) throw new Error('Add a display name');
  salt = crypto.getRandomValues(new Uint8Array(16));
  key = await deriveKey(pass, salt);
  twin = { v: 1, identity, memories: [], style: emptyStyle(), samples: '', nextId: 1 };
  await commit();
  await remember();
  return twin;
}

export async function unlock(pass: string): Promise<TwinData> {
  const sealed = await load<Sealed | null>('vault', null);
  if (!sealed) throw new Error('No vault yet');
  const s = unb64(sealed.salt);
  const k = await deriveKey(pass, s);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) as BufferSource }, k, unb64(sealed.ct) as BufferSource);
    twin = JSON.parse(new TextDecoder().decode(pt));
  } catch {
    throw new Error('Wrong passphrase');
  }
  key = k;
  salt = s;
  await remember();
  return twin!;
}

// Stay unlocked on this device. The key is a non extractable CryptoKey kept in IndexedDB.
// Page code can use it but cannot read its bytes. It expires after 8 hours or when you press Lock.
const STAY_MS = 8 * 3600 * 1000;
interface Session { key: CryptoKey; salt: string; until: number }

async function remember(): Promise<void> {
  if (!key || !salt) return;
  try { await save<Session>('session', { key, salt: b64(salt), until: Date.now() + STAY_MS }); } catch { /* no session then */ }
}

/** Reopen the vault after a reload without asking for the passphrase again. */
export async function resume(): Promise<boolean> {
  if (isUnlocked()) return true;
  try {
    const ses = await load<Session | null>('session', null);
    const sealed = await load<Sealed | null>('vault', null);
    if (!ses || !sealed || ses.until < Date.now()) { if (ses) await remove('session'); return false; }
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) as BufferSource }, ses.key, unb64(sealed.ct) as BufferSource);
    twin = JSON.parse(new TextDecoder().decode(pt));
    key = ses.key;
    salt = unb64(ses.salt);
    return true;
  } catch {
    await remove('session');
    return false;
  }
}

/** Clears memory only. Used when the signed in person changes. */
export function lockMemory(): void {
  key = null;
  twin = null;
}

/** Full lock. Also forgets the saved session so a passphrase is needed again. */
export function lock(): void {
  lockMemory();
  void remove('session');
}

/** Call after changing the twin object. Encrypts and writes it. */
export async function commit(): Promise<void> {
  if (!key || !salt || !twin) throw new Error('Vault is locked');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(JSON.stringify(twin))),
  );
  await save<Sealed>('vault', { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) });
}

export async function destroyVault(): Promise<void> {
  lock();
  await remove('vault');
  await remove('session');
}
