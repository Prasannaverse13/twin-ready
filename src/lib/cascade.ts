// The Cascade. Route, try Nano, check, escalate.
//   Router picks device or cloud.
//   Device path: Nano gets the raw input (it never leaves the laptop). A checker validates
//   the output. Pass means done with zero cloud cost. Fail means escalate.
//   Cloud path: the Shield masks the input, the Egress Firewall verifies it, cloud Gemini
//   answers with tags, and the answer is rehydrated on the device.
// Every step is streamed to the UI as a trace so the user sees exactly what happened.
import { deviceGenerate, nanoReady, type GenResult } from './firebase';
import { cloudGenerate, EgressBlocked } from './egress';
import { decide, learn, type RouteDecision, type TaskStats } from './router';
import { Shield, type EntityFinder } from './shield';
import { policy } from './config';
import { load, save } from './store';
import { bump } from './ledger';

export type Actor = 'Router' | 'Nano' | 'Checker' | 'Shield' | 'Firewall' | 'Cloud' | 'Twin';
export interface Step { actor: Actor; msg: string; ok?: boolean; ms?: number }
export type StepFn = (s: Step) => void;

export interface Check { ok: boolean; why: string }

export interface TaskSpec<T> {
  type: string;
  baseComplexity: number;
  /** The private content (page text, profile, fields). */
  content: string;
  /** Build the prompt. On the device it gets raw content. In the cloud it gets masked content. */
  build: (content: string, target: 'device' | 'cloud') => string;
  json?: object;
  parse: (text: string) => T;
  check: (out: T) => Check;
  /** Some tasks must never go to the cloud (for example reading an ID card). */
  deviceOnly?: boolean;
  /** The user asked for the stronger cloud brain. Names are still masked first. */
  forceCloud?: boolean;
}

export interface TaskResult<T> { out: T; source: 'on_device' | 'in_cloud'; decision: RouteDecision; escalated: boolean }

const CLOUD_RULES =
  'Text inside square brackets like [PERSON_1] or [EMAIL_2] are privacy placeholders. ' +
  'Keep every placeholder exactly as written. Never guess what they stand for.';

/** Nano powered entity finder for the shield. Runs only on the device. */
export const nanoEntityFinder: EntityFinder = async (text) => {
  const schema = {
    type: 'object',
    properties: {
      entities: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            type: { type: 'string', enum: ['PERSON', 'ADDRESS', 'ORG', 'ID', 'HEALTH', 'MONEY'] },
          },
          required: ['text', 'type'],
        },
      },
    },
    required: ['entities'],
  };
  const out: { text: string; type: string }[] = [];
  for (let i = 0; i < text.length && i < 24_000; i += 3000) {
    const chunk = text.slice(i, i + 3000);
    const r = await deviceGenerate(
      'List every piece of personal data in the text: names of people, street addresses, company or school names tied to a person, ' +
        'ID numbers, health details, and money amounts tied to a person. Copy each one exactly as it appears. ' +
        'Skip anything already in square brackets.\n\nTEXT:\n' + chunk,
      schema,
    );
    await bump({ deviceCalls: 1 });
    try { out.push(...(JSON.parse(r.text).entities ?? [])); } catch { /* ignore a bad chunk */ }
  }
  return out;
};

export function parseJson<T>(text: string): T {
  const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(t) as T;
}

export async function runTask<T>(spec: TaskSpec<T>, secrets: Record<string, string>, step: StepFn): Promise<TaskResult<T>> {
  const statsAll = await load<Record<string, TaskStats>>('routerStats', {});
  const deviceReady = await nanoReady();

  // Quick private data count for the router (layers 1 and 2 only, synchronous).
  const probe = new Shield(secrets);
  probe.redactSync(spec.content);

  let decision = decide(
    { taskType: spec.type, text: spec.content, piiCount: probe.size, baseComplexity: spec.baseComplexity, deviceReady },
    statsAll[spec.type],
    policy,
  );
  if (spec.forceCloud && !spec.deviceOnly && decision.target === 'device') {
    decision = { ...decision, target: 'cloud', reason: 'You asked for deep think so the masked cloud brain goes first' };
  }
  step({
    actor: 'Router',
    msg: `${decision.target === 'device' ? 'Gemini Nano' : 'Masked cloud'} first. Privacy ${pct(decision.privacy)}, difficulty ${pct(decision.complexity)}, Nano pass rate ${pct(decision.nanoSuccess)}. ${decision.reason}.`,
  });

  if (spec.deviceOnly && !deviceReady) throw new Error('This task only runs on the device and Gemini Nano is not ready. Open Setup.');

  let escalated = false;
  if (decision.target === 'device' || spec.deviceOnly) {
    try {
      const r = await deviceGenerate(spec.build(spec.content, 'device'), spec.json);
      await bump({ deviceCalls: 1 });
      step({ actor: 'Nano', msg: `Answered on the device in ${r.ms} ms. Nothing left the device.`, ok: true, ms: r.ms });
      const out = spec.parse(r.text);
      const c = spec.check(out);
      step({ actor: 'Checker', msg: c.why, ok: c.ok });
      statsAll[spec.type] = learn(statsAll[spec.type], c.ok);
      await save('routerStats', statsAll);
      if (c.ok || spec.deviceOnly) return { out, source: 'on_device', decision, escalated };
    } catch (e) {
      if (spec.deviceOnly) throw e;
      statsAll[spec.type] = learn(statsAll[spec.type], false);
      await save('routerStats', statsAll);
      step({ actor: 'Nano', msg: `Nano could not finish: ${(e as Error).message}`, ok: false });
    }
    escalated = true;
    await bump({ escalations: 1 });
    step({ actor: 'Router', msg: 'Escalating to the masked cloud path.' });
  }

  // Cloud path
  const shield = new Shield(secrets);
  const masked = await shield.redact(spec.content, deviceReady ? nanoEntityFinder : undefined);
  await bump({ piiShielded: shield.size });
  step({
    actor: 'Shield',
    msg: `Masked ${shield.size} private value(s) on the device${deviceReady ? ' with vault, patterns and Nano' : ' with vault and patterns'}. ${shield.tags.slice(0, 6).join(' ')}${shield.size > 6 ? ' ...' : ''}`,
    ok: true,
  });
  const prompt = CLOUD_RULES + '\n\n' + spec.build(masked, 'cloud');
  let r: GenResult;
  try {
    r = await cloudGenerate(spec.type, prompt, Object.values(secrets), spec.json);
  } catch (e) {
    step({ actor: e instanceof EgressBlocked ? 'Firewall' : 'Cloud', msg: (e as Error).message, ok: false });
    throw e;
  }
  step({ actor: 'Firewall', msg: `Egress check passed. ${prompt.length} chars sent and logged in the Ledger.`, ok: true });
  step({ actor: 'Cloud', msg: `Cloud Gemini answered in ${r.ms} ms using only placeholders.`, ok: true, ms: r.ms });
  const out = spec.parse(shield.rehydrate(r.text));
  const c = spec.check(out);
  step({ actor: 'Checker', msg: c.why, ok: c.ok });
  step({ actor: 'Shield', msg: `Put the real values back on the device.`, ok: true });
  return { out, source: 'in_cloud', decision, escalated };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
