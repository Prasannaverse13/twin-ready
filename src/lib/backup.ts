// Encrypted backup. Moves your twin to a new device. The file holds only ciphertext.
// Without your passphrase it is useless, so it is safe to keep in any cloud drive.
import { load, save } from './store';

interface Sealed { salt: string; iv: string; ct: string; v: 1 }

export async function exportBackup(): Promise<Blob> {
  const sealed = await load<Sealed | null>('vault', null);
  if (!sealed) throw new Error('No twin on this device yet');
  return new Blob([JSON.stringify({ app: 'twin', v: 1, vault: sealed })], { type: 'application/json' });
}

export async function importBackup(file: File): Promise<void> {
  const d = JSON.parse(await file.text());
  const s = d?.vault as Sealed | undefined;
  if (d?.app !== 'twin' || !s?.salt || !s?.iv || !s?.ct) throw new Error('This is not a Twin backup file');
  await save('vault', s);
}
