// Tiny key value store on IndexedDB with an in memory fallback (tests, private windows).
const mem = new Map<string, unknown>();
const hasIDB = typeof indexedDB !== 'undefined';
let dbp: Promise<IDBDatabase> | null = null;

// Each signed in person gets their own private slice of the device store.
// Guests use the empty namespace so older data keeps working.
let ns = '';
export function setNamespace(id: string): void { ns = id ? id + ':' : ''; }
const k = (key: string) => ns + key;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('twin', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const req = fn(db.transaction('kv', mode).objectStore('kv'));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function load<T>(key0: string, fallback: T): Promise<T> {
  const key = k(key0);
  if (!hasIDB) return mem.has(key) ? (mem.get(key) as T) : fallback;
  try {
    const v = await run<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
    return v ?? fallback;
  } catch {
    return mem.has(key) ? (mem.get(key) as T) : fallback;
  }
}

export async function save<T>(key0: string, value: T): Promise<void> {
  const key = k(key0);
  mem.set(key, value);
  if (!hasIDB) return;
  try { await run('readwrite', (s) => s.put(value, key)); } catch { /* memory copy still holds */ }
}

export async function remove(key0: string): Promise<void> {
  const key = k(key0);
  mem.delete(key);
  if (!hasIDB) return;
  try { await run('readwrite', (s) => s.delete(key)); } catch { /* ignore */ }
}
