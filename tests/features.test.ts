import { describe, it, expect } from 'vitest';
import { detectMode } from '../src/lib/twin';
import { consolidate, heuristicExtract, addMemories, search } from '../src/lib/memory';
import { DEMO_NOTES } from '../src/lib/demo';
import { createVault, unlock, lock, getTwin, commit } from '../src/lib/vault';
import { exportBackup, importBackup } from '../src/lib/backup';
import { emptyStyle, type TwinData } from '../src/lib/vault';

describe('voice mode detection', () => {
  it('routes by wording', () => {
    expect(detectMode('Should I join the startup or stay?')).toBe('decide');
    expect(detectMode('Draft a reply to Rahul about Saturday')).toBe('reply');
    expect(detectMode('What do I do when I am stressed?')).toBe('ask');
  });
});

describe('demo notes', () => {
  it('give useful memories without Nano', () => {
    const t: TwinData = { v: 1, identity: { displayName: 'Prasanna' }, memories: [], style: emptyStyle(), samples: '', nextId: 1 };
    const n = addMemories(t, heuristicExtract(DEMO_NOTES));
    expect(n).toBeGreaterThan(8);
    expect(search(t.memories, 'stressed', 2)[0].text).toMatch(/stress/i);
    expect(t.memories.some((m) => m.kind === 'decision')).toBe(true);
  });
});

describe('consolidation', () => {
  it('merges near duplicates', () => {
    const t: TwinData = { v: 1, identity: { displayName: 'A B' }, memories: [], style: emptyStyle(), samples: '', nextId: 1 };
    addMemories(t, [
      { kind: 'routine', text: 'The user goes for a run at 6 am before work every day.', entities: [] },
      { kind: 'routine', text: 'The user goes for a run at 6 am before work.', entities: [] },
      { kind: 'preference', text: 'The user loves filter coffee.', entities: [] },
    ]);
    const before = t.memories.length;
    const r = consolidate(t);
    expect(t.memories.length).toBe(before - r.merged);
  });
});

describe('encrypted backup', () => {
  it('round trips and needs the passphrase', async () => {
    await createVault('long passphrase 1', { displayName: 'Test User' });
    addMemories(getTwin(), [{ kind: 'fact', text: 'The user has a secret garden.', entities: [] }]);
    await commit();
    const blob = await exportBackup();
    const text = await blob.text();
    expect(text).not.toMatch(/secret garden/);
    lock();
    await importBackup(new File([text], 'b.json'));
    await expect(unlock('wrong passphrase')).rejects.toThrow();
    const t = await unlock('long passphrase 1');
    expect(t.memories[0].text).toMatch(/secret garden/);
  });
});
