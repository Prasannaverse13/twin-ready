// The Memory Engine. Turns raw private notes into durable memories on the device.
//   Extraction: Gemini Nano (device only) with a JSON schema. A grounding check drops anything
//   the notes do not support. Without Nano a heuristic extractor still works.
//   Retrieval: BM25 over memories with a small weight and recency boost. No embeddings leave the device.
//   Style: deterministic writing statistics so the twin sounds like you.
import { runTask, parseJson, type StepFn } from './cascade';
import { nanoReady, deviceReadImage } from './firebase';
import { bump } from './ledger';
import type { TwinData } from './vault';

export type Kind = 'fact' | 'preference' | 'decision' | 'value' | 'routine' | 'relationship';
export const KINDS: Kind[] = ['fact', 'preference', 'decision', 'value', 'routine', 'relationship'];

export interface Ent { text: string; type: string }
export interface Mem {
  id: string;
  kind: Kind;
  text: string;
  entities: Ent[];
  at: number;
  weight: number;
  public: boolean;
}

export interface StyleStats {
  avgWords: number; emojiRate: number; lowercaseStart: number; exclaim: number;
  question: number; contractions: number; slang: number; topPhrases: string[];
}
export interface StyleCard { stats: StyleStats; description: string }

// ---------- text helpers ----------

const STOP = new Set(('a an the and or but if then so to of in on at for with from by as is are was were be been am i me my mine we our you your he she it they them this that these those ' +
  'not no do does did have has had will would can could should just very really also than too into about over after before out up down off again more most some any each ' +
  'user the-user what when where who why how which there here its their his her').split(' '));

export const tokenize = (s: string): string[] =>
  (s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter((t) => t.length > 1 && !STOP.has(t));

const stem = (t: string) => t.slice(0, 5);

// ---------- BM25 retrieval ----------

export function search(mems: Mem[], query: string, k = 8): Mem[] {
  const q = tokenize(query).map(stem);
  if (!q.length || !mems.length) return [];
  const docs = mems.map((m) => tokenize(m.text + ' ' + m.entities.map((e) => e.text).join(' ')).map(stem));
  const avg = docs.reduce((a, d) => a + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const now = Date.now();
  const scored = mems.map((m, i) => {
    const d = docs[i];
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const t of new Set(q)) {
      const f = tf.get(t) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (mems.length - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      s += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.length / avg))));
    }
    const ageDays = (now - m.at) / 86_400_000;
    return { m, s: s * (0.85 + 0.15 * Math.min(2, m.weight) / 2) * (1 + 0.1 / (1 + ageDays / 30)) };
  });
  return scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.m);
}

// ---------- heuristic extractor (works without Nano) ----------

const FIRST = /\b(i|i'm|i've|i'd|my|me|we|our|mine)\b/i;
const MONTHS = new Set('January February March April May June July August September October November December Monday Tuesday Wednesday Thursday Friday Saturday Sunday'.split(' '));

function classify(s: string): Kind {
  if (/\b(decid|chose|choose|went with|picked|opted|switched|joined|quit|moved)\w*/i.test(s)) return 'decision';
  if (/\b(prefer|favou?rite|love|like|hate|enjoy|can't stand|into)\b/i.test(s)) return 'preference';
  if (/\b(always|usually|every (day|week|morning|night)|daily|weekly|routine)\b/i.test(s)) return 'routine';
  if (/\b(believe|important|matters|value|never|principle)\b/i.test(s)) return 'value';
  if (/\bmy (mom|mother|dad|father|wife|husband|partner|friend|boss|brother|sister|son|daughter|manager|team)\b/i.test(s)) return 'relationship';
  return 'fact';
}

function guessEntities(s: string): Ent[] {
  const out: Ent[] = [];
  const words = s.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const w = words[i].replace(/^[("']+|[.,!?;:)"']+$/g, '');
    if (/^[A-Z][a-z]{2,}$/.test(w) && !MONTHS.has(w) && w !== 'I') {
      const prev = out[out.length - 1];
      if (prev && prev.text.endsWith(words[i - 1].replace(/[.,!?;:]+$/g, '')) && /^[A-Z]/.test(words[i - 1])) prev.text += ' ' + w;
      else out.push({ text: w, type: 'PERSON' });
    }
  }
  return out;
}

export interface Cand { kind: Kind; text: string; entities: Ent[] }

export function heuristicExtract(text: string): Cand[] {
  const sents = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/);
  const out: Cand[] = [];
  for (const raw of sents) {
    const s = raw.trim();
    if (s.length < 20 || s.length > 320 || !FIRST.test(s)) continue;
    const third = s
      .replace(/\bI'm\b/g, 'The user is').replace(/\bI've\b/g, 'The user has').replace(/\bI'd\b/g, 'The user would')
      .replace(/\bI\b/g, 'The user').replace(/\b[Mm]y\b/g, "the user's").replace(/\b[Mm]e\b/g, 'the user')
      .replace(/\b[Ww]e\b/g, 'the user and others').replace(/\b[Oo]ur\b/g, "the user's");
    out.push({ kind: classify(s), text: third.charAt(0).toUpperCase() + third.slice(1), entities: guessEntities(s) });
  }
  return out;
}

// ---------- Nano extractor ----------

const ENT_TYPES = ['PERSON', 'PLACE', 'ORG', 'ADDRESS', 'ID', 'HEALTH', 'MONEY'];
const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    memories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: KINDS },
          text: { type: 'string' },
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: { text: { type: 'string' }, type: { type: 'string', enum: ENT_TYPES } },
              required: ['text', 'type'],
            },
          },
        },
        required: ['kind', 'text', 'entities'],
      },
    },
  },
  required: ['memories'],
};

const WEAK = new Set(['user', 'prefers', 'prefer', 'likes', 'chose', 'decided', 'wants', 'usually', 'always', 'enjoys']);

/** Grounding check. A memory passes when most of its words appear in the source chunk. */
export function grounded(memText: string, source: string): boolean {
  const have = new Set(tokenize(source).map(stem));
  const need = tokenize(memText).filter((t) => !WEAK.has(t)).map(stem);
  if (!need.length) return false;
  return need.filter((t) => have.has(t)).length / need.length >= 0.5;
}

function chunks(text: string, max = 1800): string[] {
  const out: string[] = [];
  let cur = '';
  for (const para of text.split(/\n{2,}|\r\n{2,}/)) {
    if ((cur + '\n\n' + para).length > max && cur) { out.push(cur); cur = ''; }
    cur = cur ? cur + '\n\n' + para : para;
    while (cur.length > max) { out.push(cur.slice(0, max)); cur = cur.slice(max); }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

async function nanoExtract(chunk: string, step: StepFn): Promise<Cand[]> {
  const r = await runTask<{ memories: Cand[] }>(
    {
      type: 'extract-memories',
      baseComplexity: 0.4,
      content: chunk,
      deviceOnly: true,
      json: EXTRACT_SCHEMA,
      build: (c) =>
        "Read the writer's private notes. Extract up to 8 durable memories about the writer: facts about their life, things they prefer, " +
        'choices they made with the reason, routines, values, and people who matter to them. ' +
        "Write each memory as one short sentence that starts with 'The user'. Copy names exactly as written. " +
        'List every person, place, organization and ID you used in entities. Skip small talk. Do not invent anything.\n\nNOTES:\n' + c,
      parse: (t) => parseJson<{ memories: Cand[] }>(t),
      check: (o) => {
        const ok = (o.memories ?? []).filter((m) => m?.text && grounded(m.text, chunk));
        return { ok: ok.length > 0, why: `${ok.length} of ${(o.memories ?? []).length} memories are supported by the notes` };
      },
    },
    {},
    step,
  );
  return (r.out.memories ?? []).filter((m) => m?.text && grounded(m.text, chunk));
}

// ---------- ingest ----------

const jaccard = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n || 1);
};

export function addMemories(twin: TwinData, cands: Cand[]): number {
  let added = 0;
  for (const c of cands) {
    if (!c.text || !KINDS.includes(c.kind)) c.kind = 'fact';
    const toks = new Set(tokenize(c.text).map(stem));
    const dup = twin.memories.find((m) => jaccard(toks, new Set(tokenize(m.text).map(stem))) > 0.7);
    if (dup) { dup.weight = Math.min(3, dup.weight + 0.5); continue; }
    const ents = (c.entities ?? []).filter((e) => e?.text && e.text.trim().length >= 3 && c.text.toLowerCase().includes(e.text.toLowerCase().slice(0, 3)));
    twin.memories.push({ id: `m${twin.nextId++}`, kind: c.kind, text: c.text.trim(), entities: ents, at: Date.now(), weight: 1, public: false });
    added++;
  }
  return added;
}

export interface IngestResult { added: number; via: 'nano' | 'heuristic' | 'mixed'; chunks: number }

export async function ingestNotes(
  twin: TwinData,
  text: string,
  step: StepFn,
  onProgress?: (done: number, total: number) => void,
): Promise<IngestResult> {
  const parts = chunks(text.slice(0, 40_000));
  const useNano = await nanoReady();
  let added = 0;
  let nanoUsed = 0;
  for (let i = 0; i < parts.length; i++) {
    let cands: Cand[] = [];
    if (useNano) {
      try { cands = await nanoExtract(parts[i], step); nanoUsed++; } catch (e) {
        step({ actor: 'Nano', msg: `Nano could not read chunk ${i + 1}. Using the simple extractor. ${(e as Error).message}`, ok: false });
      }
    }
    if (!cands.length) cands = heuristicExtract(parts[i]);
    added += addMemories(twin, cands);
    onProgress?.(i + 1, parts.length);
  }
  twin.samples = (twin.samples + '\n\n' + text).slice(-20_000);
  twin.style = styleOf(twin.samples);
  await bump({ memoriesMade: added });
  return { added, via: nanoUsed === 0 ? 'heuristic' : nanoUsed === parts.length ? 'nano' : 'mixed', chunks: parts.length };
}

// ---------- style ----------

export function styleOf(text: string): StyleCard {
  const clean = text.trim();
  if (!clean) return { stats: { avgWords: 0, emojiRate: 0, lowercaseStart: 0, exclaim: 0, question: 0, contractions: 0, slang: 0, topPhrases: [] }, description: 'No writing samples yet. Plain and friendly.' };
  const sents = clean.split(/[.!?\n]+/).map((s) => s.trim()).filter((s) => s.length > 2);
  const words = clean.match(/[\p{L}\p{N}']+/gu) ?? [];
  const n = Math.max(1, sents.length);
  const emoji = (clean.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  const lower = sents.filter((s) => /^[a-z]/.test(s)).length;
  const contr = (clean.match(/\b\w+'(?:s|t|re|ve|ll|d|m)\b/gi) ?? []).length;
  const slang = (clean.match(/\b(lol|bro|tbh|idk|gonna|wanna|yaar|da|machi|btw|imo|ngl|kinda|sorta)\b/gi) ?? []).length;
  const toks = words.map((w) => w.toLowerCase());
  const grams = new Map<string, number>();
  for (let i = 0; i < toks.length - 1; i++) {
    if (STOP.has(toks[i]) && STOP.has(toks[i + 1])) continue;
    const g = `${toks[i]} ${toks[i + 1]}`;
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  const topPhrases = [...grams].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);
  const stats: StyleStats = {
    avgWords: Math.round((words.length / n) * 10) / 10,
    emojiRate: Math.round((emoji / Math.max(1, words.length)) * 1000) / 10,
    lowercaseStart: Math.round((lower / n) * 100) / 100,
    exclaim: Math.round(((clean.match(/!/g) ?? []).length / n) * 100) / 100,
    question: Math.round(((clean.match(/\?/g) ?? []).length / n) * 100) / 100,
    contractions: Math.round((contr / Math.max(1, words.length)) * 1000) / 10,
    slang: Math.round((slang / Math.max(1, words.length)) * 1000) / 10,
    topPhrases,
  };
  const bits: string[] = [];
  bits.push(stats.avgWords < 9 ? 'short punchy sentences' : stats.avgWords > 18 ? 'long detailed sentences' : 'medium length sentences');
  if (stats.lowercaseStart > 0.5) bits.push('often starts in lowercase');
  if (stats.emojiRate > 0.8) bits.push('uses emojis');
  if (stats.exclaim > 0.3) bits.push('upbeat with exclamation marks');
  if (stats.contractions > 1.5) bits.push('casual with contractions');
  if (stats.slang > 0.5) bits.push('uses slang');
  if (topPhrases.length) bits.push(`favorite phrases: ${topPhrases.join(', ')}`);
  return { stats, description: bits.join('. ') + '.' };
}

// ---------- secrets for the shield ----------

/** Every private value the shield and the egress firewall must hide. Names, places, IDs and the identity card. */
export function secretsOf(twin: TwinData): Record<string, string> {
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  let i = 0;
  const add = (v: string | undefined, type: string) => {
    const t = v?.trim();
    if (!t || t.length < 3 || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    out[`${type.toLowerCase()}_${i++}`] = t;
  };
  const id = twin.identity;
  add(id.displayName, 'person'); add(id.email, 'email'); add(id.phone, 'phone'); add(id.address, 'address');
  for (const part of id.displayName.split(/\s+/)) add(part, 'person');
  for (const m of twin.memories) for (const e of m.entities) add(e.text, ENT_TYPES.includes(e.type) ? e.type : 'id');
  return out;
}

export function forget(twin: TwinData, id: string): boolean {
  const n = twin.memories.length;
  twin.memories = twin.memories.filter((m) => m.id !== id);
  return twin.memories.length < n;
}

/** Forget everything matching a topic. Returns how many were removed. */
export function forgetTopic(twin: TwinData, topic: string): number {
  const hits = new Set(search(twin.memories, topic, 50).map((m) => m.id));
  const n = twin.memories.length;
  twin.memories = twin.memories.filter((m) => !hits.has(m.id));
  return n - twin.memories.length;
}

// ---------- photos of notes (device only) ----------

/** Reads a photo of a handwritten note or a screenshot with Gemini Nano. The image never leaves the device. */
export async function ingestImage(twin: TwinData, file: File, step: StepFn): Promise<IngestResult> {
  if (!(await nanoReady())) throw new Error('Reading photos only runs on Gemini Nano. Open Setup to download it.');
  step({ actor: 'Router', msg: 'Photo of private notes. Device only. It will never be uploaded.' });
  const r = await deviceReadImage(file, 'Transcribe every word written in this image exactly. Return only the text.');
  await bump({ deviceCalls: 1 });
  step({ actor: 'Nano', msg: `Read the photo on the device in ${r.ms} ms. ${r.text.length} characters.`, ok: true, ms: r.ms });
  if (!r.text.trim()) throw new Error('No text found in the photo');
  return ingestNotes(twin, r.text, step);
}

// ---------- consolidation ----------

/** Merges near duplicates and lets old unused memories fade. Runs on the device with no model. */
export function consolidate(twin: TwinData): { merged: number; faded: number } {
  let merged = 0;
  const keep: Mem[] = [];
  for (const m of [...twin.memories].sort((a, b) => b.weight - a.weight)) {
    const toks = new Set(tokenize(m.text).map(stem));
    const twinOf = keep.find((k) => k.kind === m.kind && jaccard(toks, new Set(tokenize(k.text).map(stem))) > 0.55);
    if (twinOf) {
      twinOf.weight = Math.min(3, twinOf.weight + m.weight * 0.5);
      for (const e of m.entities) if (!twinOf.entities.some((x) => x.text === e.text)) twinOf.entities.push(e);
      twinOf.public = twinOf.public && m.public;
      merged++;
    } else keep.push(m);
  }
  let faded = 0;
  const now = Date.now();
  for (const m of keep) {
    const months = (now - m.at) / (30 * 86_400_000);
    if (months > 6 && m.weight > 0.5) { m.weight = Math.max(0.5, m.weight - 0.25); faded++; }
  }
  twin.memories = keep.sort((a, b) => a.at - b.at);
  return { merged, faded };
}
