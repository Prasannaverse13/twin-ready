// Red team. A fake person with fake private data runs through the same masking path the
// cloud calls use. It reports how many private values would have reached the cloud.
// This runs without the cloud and without Nano, so it tests layers 1 and 2 (vault and patterns).
import { Shield, findLeaks } from './shield';
import { addMemories, secretsOf, styleOf, type Cand } from './memory';
import { buildContext } from './twin';
import { emptyStyle, type TwinData } from './vault';

const E = (text: string, type = 'PERSON') => ({ text, type });

export function fakeTwin(): TwinData {
  const twin: TwinData = {
    v: 1,
    identity: { displayName: 'Ananya Raghavan', email: 'ananya.raghavan@example.com', phone: '+91 98765 43210', address: '14 Lotus Lane Adyar Chennai' },
    memories: [],
    style: emptyStyle(),
    samples: '',
    nextId: 1,
  };
  const cands: Cand[] = [
    { kind: 'relationship', text: 'The user is very close to her sister Kavitha Menon who lives in Pune.', entities: [E('Kavitha Menon'), E('Pune', 'PLACE')] },
    { kind: 'decision', text: 'The user left Orbitech in March because her manager Rohan Iyer ignored her ideas.', entities: [E('Orbitech', 'ORG'), E('Rohan Iyer')] },
    { kind: 'preference', text: 'The user prefers filter coffee over tea and starts work at 7 am.', entities: [] },
    { kind: 'fact', text: 'The user takes thyroid medicine every morning after a diagnosis last year.', entities: [E('thyroid', 'HEALTH')] },
    { kind: 'value', text: 'The user believes honest feedback matters more than comfort.', entities: [] },
    { kind: 'fact', text: 'The user pays rent of 32000 rupees to landlord Mr Subramanian.', entities: [E('Subramanian'), E('32000', 'MONEY')] },
  ];
  addMemories(twin, cands);
  twin.memories[2].public = true;
  twin.memories[4].public = true;
  twin.style = styleOf('lol that is so true. i always say honest feedback first. gonna send it today!');
  return twin;
}

export const QUESTIONS = [
  'Should I call Kavitha Menon about moving to Pune?',
  'Draft a message to Mr Subramanian about the rent. My email is ananya.raghavan@example.com',
  'Would I stay at Orbitech if Rohan Iyer apologised?',
  'Call me on +91 98765 43210 about the thyroid medicine plan',
  'What do I value most at work?',
];

export interface RedTeamReport {
  questions: number;
  privateValues: number;
  masked: number;
  leaked: number;
  rows: { q: string; sent: string; leaks: string[] }[];
}

export function runRedTeam(twin: TwinData = fakeTwin()): RedTeamReport {
  const secrets = secretsOf(twin);
  const values = Object.values(secrets);
  const rows: RedTeamReport['rows'] = [];
  let masked = 0;
  let leaked = 0;
  for (const q of QUESTIONS) {
    const { content } = buildContext(twin, q);
    const shield = new Shield(secrets);
    const sent = shield.redactSync(content);
    masked += shield.size;
    const lk = findLeaks(sent, values).map((l) => `${l.type} ${l.sample}`);
    // Also check by plain substring so the test cannot pass on a blind spot in the detector.
    for (const v of values) if (v.length >= 4 && sent.toLowerCase().includes(v.toLowerCase())) lk.push(`RAW ${v.slice(0, 2)}***`);
    leaked += lk.length;
    rows.push({ q, sent, leaks: lk });
  }
  return { questions: QUESTIONS.length, privateValues: values.length, masked, leaked, rows };
}
