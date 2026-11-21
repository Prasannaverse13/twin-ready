// The Private Twin. Answers questions the way you would, using only your own memories.
//   1. Retrieve the best memories on the device (BM25).
//   2. The cascade routes: Nano first for easy or very private asks, masked cloud Gemini for hard ones.
//   3. On the cloud path the shield masks names and IDs, the firewall verifies, and the answer
//      is rehydrated on the device. Cloud Gemini is stateless. It never owns your memory.
import { runTask, parseJson, type StepFn, type TaskResult } from './cascade';
import { search, secretsOf, type Mem } from './memory';
import type { TwinData } from './vault';

export interface Answer { answer: string; why: string; used: string[]; confidence: number }

const SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    why: { type: 'string' },
    used: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
  },
  required: ['answer', 'why', 'used', 'confidence'],
};

export interface Context { hits: Mem[]; content: string }

/** The exact private text the cascade works on. Shared with the red team test. */
export function buildContext(twin: TwinData, question: string): Context {
  const hits = search(twin.memories, question, 8);
  const mems = hits.length ? hits.map((h) => `${h.id} [${h.kind}] ${h.text}`).join('\n') : '(no matching memories)';
  const content =
    `WRITING STYLE: ${twin.style.description}\n` +
    `MEMORIES ABOUT THE USER:\n${mems}\n` +
    `QUESTION: ${question}`;
  return { hits, content };
}

export type Mode = 'ask' | 'reply' | 'decide';

export async function ask(
  twin: TwinData,
  question: string,
  step: StepFn,
  mode: Mode = 'ask',
  forceCloud = false,
): Promise<TaskResult<Answer> & { hits: Mem[] }> {
  const { hits, content } = buildContext(twin, question);
  const ids = new Set(hits.map((h) => h.id));
  const r = await runTask<Answer>(
    {
      type: mode === 'reply' ? 'twin-reply' : mode === 'decide' ? 'twin-decide' : 'twin-ask',
      baseComplexity: mode === 'decide' ? 0.75 : mode === 'reply' ? 0.55 : 0.5,
      content,
      forceCloud,
      json: SCHEMA,
      build: (c) =>
        'You are the digital twin of the user described by the MEMORIES. ' +
        (mode === 'reply'
          ? 'Write the reply the user would send to the message in QUESTION. '
          : mode === 'decide'
            ? 'The QUESTION is a choice. Pick the option the user would most likely pick, weigh it against their values and past decisions, and say what would change the choice. '
            : 'Answer the QUESTION the way the user would answer it. ') +
        'Speak in first person in the WRITING STYLE. Use only the memories as evidence. ' +
        'If the memories do not cover it, say you are not sure and give your best lean with the reason. ' +
        'Return JSON with answer, why (one sentence that names the memory ids you used), used (memory ids), and confidence from 0 to 1.\n\n' + c,
      parse: (t) => parseJson<Answer>(t),
      check: (o) => {
        if (!o?.answer?.trim()) return { ok: false, why: 'Empty answer' };
        const used = (o.used ?? []).filter((u) => ids.has(u));
        if (hits.length && o.confidence > 0.6 && !used.length) return { ok: false, why: 'Confident answer cites no real memory' };
        return { ok: true, why: `Answer cites ${used.length} real memor${used.length === 1 ? 'y' : 'ies'}. Confidence ${Math.round((o.confidence ?? 0) * 100)}%` };
      },
    },
    secretsOf(twin),
    step,
  );
  r.out.used = (r.out.used ?? []).filter((u) => ids.has(u));
  return { ...r, hits };
}

/** Guess the mode from the words so the voice flow needs no buttons. */
export function detectMode(q: string): Mode {
  if (/^(draft|write|reply|respond)\b|\breply to\b/i.test(q.trim())) return 'reply';
  if (/\b(should i|or should|which (one|option)|choose between|\bvs\b|versus|take the|accept the)\b/i.test(q)) return 'decide';
  return 'ask';
}

export interface Portrait { summary: string; values: string[]; patterns: string[]; blindSpots: string[] }

const PORTRAIT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    values: { type: 'array', items: { type: 'string' } },
    patterns: { type: 'array', items: { type: 'string' } },
    blindSpots: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'values', 'patterns', 'blindSpots'],
};

/** A mirror. What the twin has learned about you, with patterns you may not see yourself. */
export async function portrait(twin: TwinData, step: StepFn): Promise<TaskResult<Portrait>> {
  const top = [...twin.memories].sort((a, b) => b.weight - a.weight || b.at - a.at).slice(0, 30);
  if (top.length < 3) throw new Error('Add a few more memories first');
  const content = top.map((m) => `[${m.kind}] ${m.text}`).join('\n');
  return runTask<Portrait>(
    {
      type: 'twin-portrait',
      baseComplexity: 0.8,
      content,
      json: PORTRAIT_SCHEMA,
      build: (c) =>
        'These are memories about one person. Write a short honest portrait of them in second person (you). ' +
        'summary: 2 sentences. values: up to 4 things they care about. patterns: up to 4 habits in how they decide. ' +
        'blindSpots: up to 3 gentle, fair observations they may not notice. Use only the memories.\n\nMEMORIES:\n' + c,
      parse: (t) => parseJson<Portrait>(t),
      check: (o) => (o?.summary?.trim() && Array.isArray(o.values) ? { ok: true, why: 'Portrait is complete' } : { ok: false, why: 'Portrait is missing parts' }),
    },
    secretsOf(twin),
    step,
  );
}
