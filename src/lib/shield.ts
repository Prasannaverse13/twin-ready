// The Privacy Shield.
// Three layers find private data before any text can leave the device:
//   1. Vault match: exact values from the user's encrypted profile (strongest signal).
//   2. Pattern detectors: email, phone, card (Luhn checked), Aadhaar, PAN, IFSC, IP, dates.
//   3. Gemini Nano entity finder (injected): names, addresses, orgs, IDs, health, money.
// Every hit becomes a stable tag like [PERSON_1]. Tags go to the cloud. The real values
// never do. Answers come back with tags and are rehydrated on the device.

export type PiiType =
  | 'EMAIL' | 'PHONE' | 'CARD' | 'AADHAAR' | 'PAN' | 'IFSC' | 'IP' | 'DATE'
  | 'PERSON' | 'ADDRESS' | 'ORG' | 'ID' | 'HEALTH' | 'MONEY' | 'URL';

export interface Finding { type: PiiType; tag: string; layer: 'vault' | 'pattern' | 'nano' }
export interface Entity { text: string; type: string }
export type EntityFinder = (text: string) => Promise<Entity[]>;

const digits = (s: string) => s.replace(/\D/g, '');

function luhn(s: string): boolean {
  const d = digits(s);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (dbl) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

interface Detector { type: PiiType; re: RegExp; check?: (m: string) => boolean }

// Order matters: stricter detectors run first so their matches are tagged before looser ones run.
export const DETECTORS: Detector[] = [
  { type: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { type: 'URL', re: /\bhttps?:\/\/(?:www\.)?(?:linkedin\.com\/in|github\.com|twitter\.com|x\.com|instagram\.com)\/[^\s)\]]+/gi },
  { type: 'CARD', re: /\b\d(?:[ -]?\d){12,18}\b/g, check: luhn },
  { type: 'AADHAAR', re: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g },
  { type: 'PAN', re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  { type: 'IFSC', re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
  { type: 'IP', re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { type: 'DATE', re: /\b(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g },
  {
    type: 'PHONE',
    re: /(?:\+\d{1,3}[ -]?)?(?:\(\d{2,5}\)[ -]?)?\d[\d -]{5,14}\d/g,
    check: (m) => { const n = digits(m).length; return n >= 10 && n <= 13; },
  },
];

const TAG_RE = /\[[A-Z]+_\d+\]/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Build a regex that finds a vault value even if spacing, dashes or case differ.
function valueRegex(value: string): RegExp | null {
  const v = value.trim();
  if (v.length < 3) return null;
  const d = digits(v);
  if (d.length >= 6 && d.length >= v.replace(/\s/g, '').length - 3) {
    // mostly numeric: allow any separators between digits
    return new RegExp(d.split('').map(escapeRe).join('[\\s().+-]*'), 'g');
  }
  return new RegExp(escapeRe(v).replace(/\s+/g, '\\s+'), 'gi');
}

const vaultKeyType = (key: string): PiiType => {
  const pre = key.match(/^(person|place|org|address|id|health|money|email|phone)_/);
  if (pre) return pre[1] === 'place' ? 'ADDRESS' : (pre[1].toUpperCase() as PiiType);
  if (/name/i.test(key)) return 'PERSON';
  if (/email/i.test(key)) return 'EMAIL';
  if (/phone|mobile/i.test(key)) return 'PHONE';
  if (/address|pincode|zip/i.test(key)) return 'ADDRESS';
  if (/company|university|org/i.test(key)) return 'ORG';
  if (/salary/i.test(key)) return 'MONEY';
  if (/birth|dob/i.test(key)) return 'DATE';
  if (/linkedin|github|website|url/i.test(key)) return 'URL';
  return 'ID';
};

export class Shield {
  private toTag = new Map<string, string>();
  private fromTag = new Map<string, string>();
  private counters = new Map<string, number>();
  readonly findings: Finding[] = [];

  /** secrets: vault key to value. Only secret keys should be passed in. */
  constructor(private secrets: Record<string, string> = {}) {}

  private tagFor(value: string, type: PiiType, layer: Finding['layer']): string {
    const norm = value.trim().toLowerCase();
    const hit = this.toTag.get(norm);
    if (hit) return hit;
    const n = (this.counters.get(type) ?? 0) + 1;
    this.counters.set(type, n);
    const tag = `[${type}_${n}]`;
    this.toTag.set(norm, tag);
    this.fromTag.set(tag, value.trim());
    this.findings.push({ type, tag, layer });
    return tag;
  }

  /** Replace matches outside of existing tags. */
  private replaceOutsideTags(text: string, re: RegExp, fn: (m: string) => string | null): string {
    const parts = text.split(/(\[[A-Z]+_\d+\])/g);
    return parts
      .map((p, i) => (i % 2 === 1 ? p : p.replace(re, (m) => fn(m) ?? m)))
      .join('');
  }

  /** Layers 1 and 2. Fast and synchronous. */
  redactSync(text: string): string {
    let out = text;
    const vaultEntries = Object.entries(this.secrets)
      .filter(([, v]) => v && v.trim().length >= 3)
      .sort((a, b) => b[1].length - a[1].length);
    for (const [key, value] of vaultEntries) {
      const re = valueRegex(value);
      if (!re) continue;
      out = this.replaceOutsideTags(out, re, () => this.tagFor(value, vaultKeyType(key), 'vault'));
    }
    for (const det of DETECTORS) {
      out = this.replaceOutsideTags(out, new RegExp(det.re.source, det.re.flags), (m) =>
        !det.check || det.check(m) ? this.tagFor(m, det.type, 'pattern') : null,
      );
    }
    return out;
  }

  /** All three layers. The Nano entity finder runs only on the device. */
  async redact(text: string, finder?: EntityFinder): Promise<string> {
    let out = this.redactSync(text);
    if (!finder) return out;
    let entities: Entity[] = [];
    try {
      entities = await finder(out);
    } catch {
      return out; // shield still holds with layers 1 and 2
    }
    const allowed: Record<string, PiiType> = {
      PERSON: 'PERSON', ADDRESS: 'ADDRESS', ORG: 'ORG', ID: 'ID', HEALTH: 'HEALTH', MONEY: 'MONEY',
    };
    for (const e of entities.sort((a, b) => b.text.length - a.text.length)) {
      const t = e.text?.trim();
      const type = allowed[e.type?.toUpperCase?.() ?? ''];
      if (!t || !type || t.length < 3 || TAG_RE.test(t)) { TAG_RE.lastIndex = 0; continue; }
      TAG_RE.lastIndex = 0;
      if (!out.includes(t)) continue; // never trust entities the model invented
      out = this.replaceOutsideTags(out, new RegExp(escapeRe(t), 'g'), () => this.tagFor(t, type, 'nano'));
    }
    return out;
  }

  rehydrate(text: string): string {
    let out = text;
    for (const [tag, value] of this.fromTag) out = out.split(tag).join(value);
    return out;
  }

  get size(): number { return this.fromTag.size; }
  get tags(): string[] { return [...this.fromTag.keys()]; }
}

export interface Leak { type: string; sample: string }

/**
 * Egress check. Returns every private value still visible in a payload.
 * Used as a fail closed firewall right before any cloud call.
 */
export function findLeaks(payload: string, secrets: string[]): Leak[] {
  const leaks: Leak[] = [];
  const clean = payload.replace(TAG_RE, ' ');
  for (const s of secrets) {
    const re = valueRegex(s);
    if (re && re.test(clean)) leaks.push({ type: 'VAULT', sample: mask(s) });
  }
  for (const det of DETECTORS) {
    const re = new RegExp(det.re.source, det.re.flags);
    for (const m of clean.match(re) ?? []) {
      if (!det.check || det.check(m)) leaks.push({ type: det.type, sample: mask(m) });
    }
  }
  return leaks;
}

export function mask(s: string): string {
  const t = s.trim();
  if (t.length <= 4) return '****';
  return t.slice(0, 2) + '*'.repeat(Math.min(8, t.length - 4)) + t.slice(-2);
}
