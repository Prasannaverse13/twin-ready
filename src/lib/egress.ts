// The Egress Firewall. The only path to the cloud model.
// It fails closed: if any private value is still visible in the payload, the call is blocked.
import { unsafeCloudGenerate, type GenResult } from './firebase';
import { findLeaks } from './shield';
import { logCloud } from './ledger';

export class EgressBlocked extends Error {
  constructor(public leaks: { type: string; sample: string }[]) {
    super(`Blocked: ${leaks.length} private value(s) still visible (${[...new Set(leaks.map((l) => l.type))].join(', ')})`);
  }
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

export async function cloudGenerate(task: string, payload: string, secrets: string[], json?: object): Promise<GenResult> {
  const leaks = findLeaks(payload, secrets);
  const tags = (payload.match(/\[[A-Z]+_\d+\]/g) ?? []).length;
  if (leaks.length) {
    await logCloud({ at: Date.now(), task, bytes: bytes(payload), payload: '(blocked, not stored)', tags, blocked: true, reason: leaks.map((l) => `${l.type} ${l.sample}`).join('; ') });
    throw new EgressBlocked(leaks);
  }
  await logCloud({ at: Date.now(), task, bytes: bytes(payload), payload, tags, blocked: false });
  return unsafeCloudGenerate(payload, json);
}
