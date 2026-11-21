// The Learning Router.
// For each task it scores two things: how private the input is and how hard the task is.
// It also remembers how often Gemini Nano passed the checker for this kind of task
// (a Beta(1,1) prior, so new task types start at 50 percent). The more Nano succeeds,
// the more work stays on the device. Weights come from Remote Config.
import type { Policy } from './config';

export type Target = 'device' | 'cloud';

export interface TaskStats { tries: number; passes: number }

export interface RouteInput {
  taskType: string;
  text: string;
  piiCount: number;
  baseComplexity: number; // 0 easy to 1 hard, set per task type
  deviceReady: boolean;
}

export interface RouteDecision {
  target: Target;
  reason: string;
  privacy: number;
  complexity: number;
  nanoSuccess: number;
  score: number;
  tokens: number;
}

const SENSITIVE_TASKS = new Set(['twin-ask', 'twin-reply', 'twin-decide', 'twin-portrait', 'extract-memories']);

export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

export function nanoSuccessRate(stats?: TaskStats): number {
  return stats ? (stats.passes + 1) / (stats.tries + 2) : 0.5;
}

export function decide(input: RouteInput, stats: TaskStats | undefined, p: Policy): RouteDecision {
  const tokens = estimateTokens(input.text);
  const privacy = Math.min(1, input.piiCount * 0.12 + (SENSITIVE_TASKS.has(input.taskType) ? 0.4 : 0));
  const lengthLoad = Math.min(1, tokens / p.deviceTokenLimit);
  const complexity = Math.min(1, 0.6 * input.baseComplexity + 0.4 * lengthLoad);
  const nanoSuccess = nanoSuccessRate(stats);
  const score = nanoSuccess + p.privacyWeight * privacy - p.complexityWeight * complexity;
  const base = { privacy, complexity, nanoSuccess, score, tokens };

  if (!input.deviceReady) return { ...base, target: 'cloud', reason: 'Gemini Nano is not ready on this device' };
  if (tokens > p.deviceTokenLimit) return { ...base, target: 'cloud', reason: `Input is ${tokens} tokens which is over the Nano budget` };
  if (score >= p.routerThreshold) {
    return { ...base, target: 'device', reason: `Score ${score.toFixed(2)} is at or over ${p.routerThreshold} so Nano goes first` };
  }
  return { ...base, target: 'cloud', reason: `Score ${score.toFixed(2)} is under ${p.routerThreshold} so masked cloud goes first` };
}

export function learn(stats: TaskStats | undefined, passed: boolean): TaskStats {
  const s = stats ?? { tries: 0, passes: 0 };
  return { tries: s.tries + 1, passes: s.passes + (passed ? 1 : 0) };
}
