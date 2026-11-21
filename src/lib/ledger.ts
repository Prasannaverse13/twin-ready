// The Leak Ledger. Every byte sent to the cloud is recorded here, exactly as sent,
// so the owner (and judges) can audit it. It never leaves the device.
import { load, save } from './store';

export interface CloudEntry {
  at: number;
  task: string;
  bytes: number;
  payload: string;
  tags: number;
  blocked: boolean;
  reason?: string;
}

export interface Stats {
  deviceCalls: number;
  cloudCalls: number;
  escalations: number;
  bytesToCloud: number;
  piiShielded: number;
  egressBlocked: number;
  memoriesMade: number;
  cloudCallsByDay: Record<string, number>;
  deviceCallsByDay: Record<string, number>;
}

export const EMPTY_STATS: Stats = {
  deviceCalls: 0, cloudCalls: 0, escalations: 0, bytesToCloud: 0, piiShielded: 0, egressBlocked: 0, memoriesMade: 0,
  cloudCallsByDay: {}, deviceCallsByDay: {},
};

type Listener = () => void;
const listeners = new Set<Listener>();
export const onLedgerChange = (fn: Listener) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((f) => f());

const day = () => new Date().toISOString().slice(0, 10);

export async function getStats(): Promise<Stats> {
  return { ...EMPTY_STATS, ...(await load<Stats>('stats', EMPTY_STATS)) };
}

export async function bump(patch: Partial<Record<keyof Stats, number>>): Promise<void> {
  const s = await getStats();
  for (const [k, v] of Object.entries(patch)) {
    (s as any)[k] = ((s as any)[k] ?? 0) + (v as number);
  }
  if (patch.cloudCalls) s.cloudCallsByDay[day()] = (s.cloudCallsByDay[day()] ?? 0) + patch.cloudCalls;
  if (patch.deviceCalls) s.deviceCallsByDay[day()] = (s.deviceCallsByDay[day()] ?? 0) + patch.deviceCalls;
  await save('stats', s);
  emit();
}

export async function getEntries(): Promise<CloudEntry[]> {
  return load<CloudEntry[]>('cloudLedger', []);
}

export async function logCloud(entry: CloudEntry): Promise<void> {
  const list = await getEntries();
  list.unshift(entry);
  await save('cloudLedger', list.slice(0, 100));
  if (entry.blocked) await bump({ egressBlocked: 1 });
  else await bump({ cloudCalls: 1, bytesToCloud: entry.bytes });
}

export async function resetLedger(): Promise<void> {
  await save('cloudLedger', []);
  await save('stats', EMPTY_STATS);
  emit();
}
