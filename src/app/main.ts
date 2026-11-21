import './styles.css';
import { nanoState, downloadNano, appCheckMode, loadPolicy, realUser, onUserChange, googleSignIn, signOutUser, finishRedirect, type NanoState } from '../lib/firebase';
import { setNamespace } from '../lib/store';
import { createVault, unlock, lock, lockMemory, resume, vaultExists, getTwin, isUnlocked, commit, destroyVault } from '../lib/vault';
import { ingestNotes, ingestImage, forget, forgetTopic, consolidate } from '../lib/memory';
import { ask, detectMode, portrait, type Answer, type Mode, type Portrait } from '../lib/twin';
import { buildCard, publicGate, publish, unpublish, readInbox, deleteMessage, publicMemories, type Inbox } from '../lib/publish';
import { exportBackup, importBackup } from '../lib/backup';
import { DEMO_NAME, DEMO_NOTES } from '../lib/demo';
import { getStats, getEntries, resetLedger, onLedgerChange, type Stats, type CloudEntry } from '../lib/ledger';
import { runRedTeam, type RedTeamReport } from '../lib/redteam';
import { canListen, listen, speak, stopSpeaking, type Listener } from '../lib/voice';
import type { Step } from '../lib/cascade';
import type { Mem } from '../lib/memory';

type Tab = 'talk' | 'memory' | 'public' | 'ledger' | 'setup';
interface Turn { q: string; mode: Mode; steps: Step[]; a?: Answer; source?: 'on_device' | 'in_cloud'; hits?: Mem[]; err?: string }

const app = document.getElementById('app')!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

let tab: Tab = 'talk';
let nano: NanoState = 'unsupported';
let exists = false;
let err = '';
let who: { uid: string; email: string; name: string } | null = null;
let busy = false;
let draft = '';
let speakOn = true;
let deepOn = false;
let listener: Listener | null = null;
let listening = false;
let micNote = '';
const convo: Turn[] = [];
let ingestMsg = '';
let ingestSteps: Step[] = [];
let filter = '';
let stats: Stats | null = null;
let entries: CloudEntry[] = [];
let red: RedTeamReport | null = null;
let inbox: Inbox[] = [];
let inboxNote = '';
let publishNote = '';
let drafts: Record<string, string> = {};
let nanoProgress = '';
let mirror: Portrait | null = null;
let mirrorSource: 'on_device' | 'in_cloud' | undefined;
let mirrorSteps: Step[] = [];
let mirrorErr = '';
let setupNote = '';
let rcLoaded = false;

async function refresh() {
  nano = await nanoState();
  exists = await vaultExists();
  if (exists && !isUnlocked()) await resume();
  stats = await getStats();
  entries = await getEntries();
  render();
}
onLedgerChange(() => { void getStats().then((s) => { stats = s; }); void getEntries().then((e) => { entries = e; if (tab === 'ledger') render(); }); });

// ---------- views ----------

const AST = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><ellipse cx="12" cy="6.2" rx="2.3" ry="4.2"/><ellipse cx="12" cy="6.2" rx="2.3" ry="4.2" transform="rotate(72 12 12)"/><ellipse cx="12" cy="6.2" rx="2.3" ry="4.2" transform="rotate(144 12 12)"/><ellipse cx="12" cy="6.2" rx="2.3" ry="4.2" transform="rotate(216 12 12)"/><ellipse cx="12" cy="6.2" rx="2.3" ry="4.2" transform="rotate(288 12 12)"/></g></svg>';

function chipsHtml(): string {
  const nc = nano === 'available' ? ['good', 'Gemini Nano ready'] : nano === 'downloadable' ? ['warn', 'Nano needs download'] : nano === 'downloading' ? ['warn', 'Nano downloading'] : ['bad', 'No Nano. Cloud only'];
  return `<span class="chip ${nc[0]}">${nc[1]}</span><span class="chip ${isUnlocked() ? 'good' : 'warn'}">${isUnlocked() ? 'Vault open' : 'Vault locked'}</span>
  <span class="chip ${appCheckMode === 'off' ? 'bad' : 'good'}">App Check ${appCheckMode}</span>${who ? `<span class="chip good">${esc(who.email)}</span><button class="chipbtn" data-act="signout">Sign out</button>` : ''}`;
}

function header(): string {
  return `<div class="top"><div class="brand"><div class="logo">${AST}</div><div>twin.<small>Your digital twin on the internet</small></div></div>
  <div class="chips">${chipsHtml()}</div></div>`;
}

function donut(pctVal: number): string {
  const c = 2 * Math.PI * 26;
  return `<svg class="donut" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" class="track"/><circle cx="32" cy="32" r="26" class="val" stroke-dasharray="${(c * pctVal) / 100} ${c}" transform="rotate(-90 32 32)"/></svg>`;
}

function circuits(): string {
  const keys = [[120, 470, 'dot'], [150, 650, 'v'], [470, 650, 'bars'], [160, 880, 'dots'], [1175, 650, 'grid'], [1495, 650, 'dash'], [1520, 478, 'x'], [1490, 890, 'grid']];
  return `<svg class="circuits" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="1.4">
  <path d="M0 400 H180 q20 0 20 20 V610 q0 20 20 20 H340"/><path d="M0 720 H100 q20 0 20 -20 V670 q0 -20 20 -20 H600"/><path d="M0 800 H130 q20 0 20 -20 V755 q0 -20 20 -20 H560"/>
  <path d="M0 880 H160 V820 q0 -20 20 -20 H560"/><path d="M340 900 V500 q0 -20 -20 -20 H0"/><path d="M180 900 V820"/>
  <path d="M1600 400 H1460 q-20 0 -20 20 V610 q0 20 -20 20 H1290"/><path d="M1290 900 V500 q0 -20 20 -20 H1600"/><path d="M1000 650 H1600"/>
  <path d="M1040 740 H1460 q20 0 20 20 V790 q0 20 20 20 H1600"/><path d="M1040 805 H1440 q20 0 20 20 V880 H1600"/><path d="M1500 650 V700 q0 20 20 20 H1600"/>
  </g>
  ${keys.map(([x, y, k]) => `<g class="key" transform="translate(${x} ${y})"><rect x="-26" y="-18" width="${k === 'bars' || k === 'dash' || k === 'grid' || k === 'dots' ? 58 : 36}" height="36" rx="10"/><text x="${k === 'bars' || k === 'dash' || k === 'grid' || k === 'dots' ? 3 : -8}" y="5">${k === 'dot' ? '◆' : k === 'v' ? '|' : k === 'bars' ? '| | |' : k === 'dots' ? '• • •' : k === 'grid' ? '▪▪' : k === 'dash' ? '▪—▪' : '×'}</text></g>`).join('')}
  </svg>`;
}

function landing(): string {
  const s = stats;
  const total = (s?.deviceCalls ?? 0) + (s?.cloudCalls ?? 0);
  const dev = total ? Math.round(((s?.deviceCalls ?? 0) / total) * 100) : 0;
  return `<div class="site">
  <nav class="nav"><div class="navbrand"><span class="logo">${AST}</span><b>twin.</b><span class="menu"><i></i><i></i></span></div>
    <div class="navright"><button class="btn primary" data-act="go-gate">${exists ? 'Unlock' : 'Create twin'}</button><button class="btn light" data-act="go-about">How it works</button><a class="btn light" href="/twin-extension.zip" download>Get the extension</a></div></nav>
  <section class="hero-l">${circuits()}
    <div class="eyebrow">Built with <span class="fb">F</span> Firebase AI Logic and Gemini Nano</div>
    <h1>Your Private <span class="soft">Digital</span><br/>Twin</h1>
    <p class="sub">It learns who you are on your own device.<br/>Then it speaks for you on the internet.</p>
    <div class="cta"><button class="btn primary big" data-act="go-gate">${exists ? 'Unlock my twin' : 'Create my twin'}</button><button class="btn light big" data-act="go-about">See how it works</button><a class="btn light big" href="/twin-extension.zip" download>Get the Chrome extension</a></div>
    <div class="floatkey">${AST}</div>
    <div class="stage"><div class="halo"></div><div class="pebble"><div class="glyph">${AST}</div><div class="port"></div></div><div class="shadow"></div></div>
    <div class="info"><div class="mono">${AST} /info/</div>
      <p>Twin turns your notes into a private memory that never leaves your laptop, <span class="soft">answers in your voice with Gemini Nano, and only asks the cloud with every name masked.</span></p></div>
    <div class="dash">
      <div class="dcard"><div class="dhead"><div><b>On device share</b><small>Live from your privacy ledger</small></div><span class="dtag">Total</span></div>
        <div class="dval">${total ? dev + '%' : 'Ready'}</div><div class="drow"><span class="dbadge">${s?.deviceCalls ?? 0} Nano</span><span>${s?.cloudCalls ?? 0} masked cloud calls</span></div>
        <div class="dfoot">${donut(total ? dev : 100)}<ul><li><i class="a"></i>Gemini Nano<b>${s?.deviceCalls ?? 0}</b></li><li><i class="b"></i>Cloud Gemini<b>${s?.cloudCalls ?? 0}</b></li></ul></div></div>
      <div class="dcard"><div class="dhead"><div><b>Private values masked</b><small>Names, phones, places</small></div><span class="dtag">Total</span></div>
        <div class="dval">${s?.piiShielded ?? 0}</div><div class="drow"><span class="dbadge">${s?.egressBlocked ?? 0} blocked</span><span>${s?.bytesToCloud ?? 0} bytes sent</span></div>
        <div class="dfoot">${donut(100)}<ul><li><i class="a"></i>Leaked<b>0</b></li><li><i class="b"></i>Firewall<b>On</b></li></ul></div></div>
    </div>
  </section>
  <section class="about" id="about">
    <div class="tagpill">${AST} HOW IT WORKS</div>
    <h2>Twin <span class="keys"><span>${AST}</span><span>${AST}</span><span>${AST}</span></span> keeps your memory on your device, answers in your voice, <span class="soft">and gives you a public twin that only knows what you chose to share.</span></h2>
    <div class="nums"><div><b>0</b><span>Raw memories uploaded</span></div><div><b>2</b><span>Brains. Nano and Gemini</span></div><div><b>4</b><span>Firebase products</span></div></div>
    <div class="steps3">
      <div><em>01</em><h3>Teach</h3><p>Paste notes or a photo of a page. Gemini Nano turns them into encrypted memories on this laptop.</p></div>
      <div><em>02</em><h3>Ask</h3><p>Your twin answers like you. Hard questions go to cloud Gemini with every name swapped for a tag.</p></div>
      <div><em>03</em><h3>Share</h3><p>Publish a public twin. Friends open the link on any phone and talk to it. It refuses private questions.</p></div>
    </div>
  </section>
  <section class="gate" id="gate"><div class="gatebox">${gate()}</div><div class="chips">${chipsHtml()}</div></section>
  <footer class="foot"><span class="logo">${AST}</span> twin. Private memory on your device. A cloud brain that forgets.</footer>
  </div>`;
}

function signInCard(): string {
  if (who) return `<div class="card"><p class="muted">Signed in as <b>${esc(who.email)}</b>. This twin belongs only to you on this device.</p></div>`;
  return `<div class="card hero"><span class="tab-accent"></span><h2>Sign in to get your own twin</h2>
  <p class="muted">Each person gets a private twin. Your memories stay encrypted on this device. Google only tells us who you are.</p>
  <div class="row"><button class="btn primary big" data-act="google">Continue with Google</button></div>
  <p class="muted">No account? You can also continue as a guest on this device below.</p>${err ? `<div class="err">${esc(err)}</div>` : ''}</div>`;
}

function gate(): string {
  return signInCard() + gateForm();
}

function gateForm(): string {
  if (!exists) {
    return `<div class="card hero"><span class="tab-accent"></span><h2>Create your twin</h2>
    <p class="muted">Everything the twin learns is encrypted with your passphrase and stays on this device. The passphrase cannot be recovered.</p>
    <div class="grid2"><label class="f">Display name (this is public)<input type="text" id="g-name" autocomplete="off" value="${esc(who?.name ?? '')}"/></label>
    <label class="f">Passphrase (8+ characters)<input type="password" id="g-pass" autocomplete="new-password"/></label></div>
    <p class="muted">Optional private details. They help the shield hide them from the cloud.</p>
    <div class="grid2"><label class="f">Email<input type="text" id="g-email" value="${esc(who?.email ?? '')}"/></label><label class="f">Phone<input type="text" id="g-phone"/></label></div>
    <label class="f">Home address<input type="text" id="g-addr"/></label>
    <div class="row"><button class="btn primary" data-act="create">Create my twin</button><button class="btn" data-act="demo-fill">Use demo person</button></div>
    ${err ? `<div class="err">${esc(err)}</div>` : ''}</div>
    <div class="card"><h3>Moving from another device?</h3><div class="row"><input type="file" id="restore" accept=".json"/><button class="btn" data-act="restore">Restore backup</button></div></div>`;
  }
  return `<div class="card hero"><span class="tab-accent"></span><h2>Unlock your twin</h2><label class="f">Passphrase<input type="password" id="g-pass" autocomplete="current-password"/></label>
  <div class="row"><button class="btn primary" data-act="unlock">Unlock</button></div>${err ? `<div class="err">${esc(err)}</div>` : ''}</div>`;
}

const pill = (s?: 'on_device' | 'in_cloud') => (s ? `<span class="pill ${s === 'on_device' ? 'device' : 'cloud'}">${s === 'on_device' ? 'Answered on your device' : 'Masked cloud'}</span>` : '');
const strip = (s?: 'on_device' | 'in_cloud') => (s ? `<div class="strip ${s === 'on_device' ? 'device' : 'cloud'}"><span class="dot"></span>${s === 'on_device' ? 'Answered by Gemini Nano on your device' : 'Answered by cloud Gemini with names masked'}</div>` : '');
const trace = (steps: Step[]) => `<div class="trace">${steps.map((s) => `<div class="step ${s.actor}${s.ok === false ? ' fail' : ''}"><b>${s.actor}</b><span>${esc(s.msg)}</span></div>`).join('')}</div>`;

function talk(): string {
  const t = getTwin();
  const hint = t.memories.length ? '' : '<p class="muted">Add notes in the Memory tab first. A twin with no memories can only guess.</p>';
  return `<div class="card hero"><span class="tab-accent"></span><div class="orbwrap"><button class="orb ${listening ? 'live' : ''}" data-act="mic" ${canListen() ? '' : 'disabled'}>${listening ? 'Listening...' : canListen() ? 'Tap and talk' : 'No mic support'}</button></div>
  <div class="muted" style="text-align:center">${esc(micNote)}</div>${hint}
  <div class="row"><input class="grow" type="text" id="q" placeholder="Ask your twin. What would I choose?" value="${esc(draft)}"/><button class="btn primary" data-act="send" ${busy ? 'disabled' : ''}>Ask</button></div>
  <div class="row"><label class="muted"><input type="checkbox" id="speak" ${speakOn ? 'checked' : ''}/> Speak answers</label>
  <label class="muted"><input type="checkbox" id="deep" ${deepOn ? 'checked' : ''}/> Deep think in cloud (names masked)</label>
  <span class="muted">Try: Should I join Rahul's startup or stay? | What do I do when I am stressed? | Draft a reply to Rahul about Saturday</span></div></div>
  ${convo.map((c) => `<div class="card turn"><span class="glowbar"></span><div class="q"><span class="av"></span>${esc(c.q)}</div>
    ${c.err ? `<div class="err">${esc(c.err)}</div>` : ''}
    ${c.a ? `<div class="a">${esc(c.a.answer)}</div><div class="muted">${esc(c.a.why)}</div>
    ${strip(c.source)}<div class="row"><span class="pill">${c.mode}</span><span class="pill">Confidence ${Math.round((c.a.confidence ?? 0) * 100)}%</span>${(c.a.used ?? []).map((u) => `<span class="pill">${esc(u)}</span>`).join('')}</div>` : c.err ? '' : '<div class="muted">Thinking...</div>'}
    <details><summary>What happened to your data</summary>${trace(c.steps)}</details></div>`).join('')}`;
}

function memory(): string {
  const t = getTwin();
  const list = t.memories.filter((m) => !filter || (m.text + m.kind).toLowerCase().includes(filter.toLowerCase())).slice().reverse();
  return `<div class="card hero"><span class="tab-accent"></span><h2>Teach your twin</h2>
  <p class="muted">Paste journals, notes, chat exports or anything you wrote. ${nano === 'available' ? 'Gemini Nano reads it on this device.' : 'Nano is not ready so a simple extractor is used. Open Setup to enable Nano.'} Nothing is sent anywhere.</p>
  <textarea id="notes" placeholder="Paste your notes here...">${esc(draftNotes)}</textarea>
  <div class="row"><input type="file" id="file" accept=".txt,.md,.json,.csv"/><button class="btn primary" data-act="ingest" ${busy ? 'disabled' : ''}>Build memories</button><button class="btn" data-act="demo-notes">Load demo notes</button></div>
  <div class="row"><span class="muted">Photo of a handwritten note (Nano only):</span><input type="file" id="photo" accept="image/png,image/jpeg"/><button class="btn" data-act="photo" ${busy ? 'disabled' : ''}>Read photo</button></div>
  <div class="muted">${esc(ingestMsg)}</div>${ingestSteps.length ? `<details><summary>Extraction log</summary>${trace(ingestSteps.slice(-12))}</details>` : ''}</div>
  <div class="card"><h2>Your writing style</h2><div class="muted">${esc(t.style.description)}</div></div>
  <div class="card"><div class="row"><h2 class="grow">Mirror</h2><button class="btn" data-act="mirror" ${busy ? 'disabled' : ''}>Show me who I am</button></div>
  <p class="muted">Your twin describes your values and patterns. Names are masked before any cloud call.</p>
  ${mirrorErr ? `<div class="err">${esc(mirrorErr)}</div>` : ''}
  ${mirror ? `<div class="a">${esc(mirror.summary)}</div>${pill(mirrorSource)}
    <div class="grid2"><div><b>Values</b><ul>${mirror.values.map((v) => `<li>${esc(v)}</li>`).join('')}</ul></div><div><b>Patterns</b><ul>${mirror.patterns.map((v) => `<li>${esc(v)}</li>`).join('')}</ul></div></div>
    <div><b>Blind spots</b><ul>${mirror.blindSpots.map((v) => `<li>${esc(v)}</li>`).join('')}</ul></div>` : ''}
  ${mirrorSteps.length ? `<details><summary>What happened to your data</summary>${trace(mirrorSteps)}</details>` : ''}</div>
  <div class="card"><div class="row"><h2 class="grow">Memories (${t.memories.length})</h2><input type="text" id="filter" placeholder="Filter" value="${esc(filter)}" style="max-width:200px"/></div>
  <div class="row"><input class="grow" type="text" id="forget" placeholder="Forget a topic, for example rent"/><button class="btn danger" data-act="forget">Forget</button><button class="btn" data-act="tidy">Tidy memories</button></div>
  ${list.map((m) => `<div class="mem"><span class="pill">${m.kind}</span><div>${esc(m.text)}<div class="muted">${m.id}${m.entities.length ? ' | ' + esc(m.entities.map((e) => e.text).join(', ')) : ''}</div></div>
    <label class="muted"><input type="checkbox" data-pub="${m.id}" ${m.public ? 'checked' : ''}/> Public</label><button class="btn danger" data-del="${m.id}">x</button></div>`).join('') || '<div class="muted">No memories yet.</div>'}</div>`;
}
let draftNotes = '';

function pub(): string {
  const t = getTwin();
  const card = buildCard(t);
  const leaks = publicGate(card, t);
  const link = t.publicId ? `${location.origin}/t.html?id=${t.publicId}` : '';
  return `<div class="card hero"><span class="tab-accent"></span><h2>Your twin on the internet</h2>
  <p class="muted">A second twin that anyone can talk to. It knows only the memories you mark Public. Your private memories never leave this device. The Publish Gate blocks anything private.</p>
  <label class="f">A line for visitors<input type="text" id="note" value="${esc(t.publicNote ?? '')}" placeholder="Hi, I am the twin of ${esc(t.identity.displayName)}."/></label>
  <div class="muted">Public memories: ${publicMemories(t).length}. Mark them in the Memory tab.</div>
  <pre>${esc(card.about || '(nothing public yet)')}</pre>
  <div class="${leaks.length ? 'err' : 'ok'}">${leaks.length ? 'Gate blocked: ' + esc(leaks.map((l) => `${l.type} ${l.sample}`).join(', ')) : 'Publish Gate passed. No private value found.'}</div>
  <div class="row"><button class="btn primary" data-act="publish" ${busy || leaks.length ? 'disabled' : ''}>${t.publicId ? 'Update public twin' : 'Publish my twin'}</button>
  ${t.publicId ? '<button class="btn danger" data-act="unpublish">Take it down</button>' : ''}</div>
  ${publishNote ? `<div class="muted">${esc(publishNote)}</div>` : ''}
  ${link ? `<div>Share this link: <a class="link" href="${esc(link)}" target="_blank">${esc(link)}</a></div>` : ''}</div>
  ${t.publicId ? `<div class="card"><div class="row"><h2 class="grow">Messages left for you</h2><button class="btn" data-act="inbox">Refresh</button></div>
  <p class="muted">Visitors can leave you a message. Your private twin can draft the reply on this device.</p>${inboxNote ? `<div class="muted">${esc(inboxNote)}</div>` : ''}
  ${inbox.map((m) => `<div class="mem" style="grid-template-columns:1fr auto"><div><b>${esc(m.from)}</b>: ${esc(m.text)}${drafts[m.id] ? `<pre>${esc(drafts[m.id])}</pre>` : ''}</div><div class="row"><button class="btn" data-reply="${m.id}">Draft reply</button><button class="btn danger" data-delmsg="${m.id}">x</button></div></div>`).join('')}</div>` : ''}`;
}

function ledger(): string {
  const s = stats;
  const total = (s?.deviceCalls ?? 0) + (s?.cloudCalls ?? 0);
  const dev = total ? Math.round(((s?.deviceCalls ?? 0) / total) * 100) : 0;
  const mark = (p: string) => esc(p).replace(/\[[A-Z]+_\d+\]/g, (m) => `<mark>${m}</mark>`);
  return `<div class="card hero"><span class="tab-accent"></span><h2>Privacy ledger</h2><p class="muted">Every byte sent to the cloud is listed here exactly as sent. Highlighted tags replaced your private values.</p>
  <div class="stats"><div class="stat"><b>${s?.deviceCalls ?? 0}</b><span>On device calls</span></div><div class="stat"><b>${s?.cloudCalls ?? 0}</b><span>Cloud calls</span></div>
  <div class="stat"><b>${s?.piiShielded ?? 0}</b><span>Values masked</span></div><div class="stat"><b>${s?.egressBlocked ?? 0}</b><span>Blocked by firewall</span></div></div>
  <div class="bar"><div style="width:${dev}%"></div></div><div class="muted">${dev}% of AI work stayed on your device. ${s?.bytesToCloud ?? 0} bytes went to the cloud.</div>
  <div class="row"><button class="btn" data-act="red">Run red team test</button><button class="btn danger" data-act="reset">Clear ledger</button></div></div>
  ${red ? `<div class="card"><h2>Red team</h2><div class="${red.leaked === 0 ? 'ok' : 'err'}">${red.questions} questions with a fake identity. ${red.masked} private values masked. ${red.leaked} leaked.</div>
  ${red.rows.map((r) => `<details><summary>${esc(r.q)}</summary><pre>${mark(r.sent)}</pre>${r.leaks.length ? `<div class="err">${esc(r.leaks.join(', '))}</div>` : ''}</details>`).join('')}</div>` : ''}
  <div class="card"><h2>Cloud calls</h2>${entries.length ? entries.slice(0, 10).map((e) => `<div class="entry"><div class="muted">${new Date(e.at).toLocaleTimeString()} | ${esc(e.task)} | ${e.bytes} bytes | ${e.tags} tags ${e.blocked ? '| BLOCKED ' + esc(e.reason ?? '') : ''}</div><pre>${mark(e.payload)}</pre></div>`).join('') : '<div class="muted">No cloud calls yet.</div>'}</div>`;
}

function setup(): string {
  return `<div class="card"><h2>Gemini Nano</h2><div class="muted">Status: ${nano}. Needs desktop Chrome 139 or newer and about 22 GB free disk for the install.</div>
  <div class="row"><button class="btn primary" data-act="nano" ${nano === 'available' || nano === 'unsupported' ? 'disabled' : ''}>Download Nano</button></div><div class="muted">${esc(nanoProgress)}</div></div>
  <div class="card"><h2>App Check</h2><div class="muted">Mode: ${appCheckMode}. The live site uses reCAPTCHA Enterprise. Localhost uses a registered debug token.</div></div>
  <div class="card"><h2>Voice</h2><div class="muted">Speech output uses your local voices. Speech input asks Chrome to recognize on the device. If your Chrome cannot, the mic note says audio goes to the browser vendor.</div></div>
  <div class="card"><h2>Backup</h2><div class="muted">Download your twin as an encrypted file. It is useless without your passphrase.</div>
  <div class="row"><button class="btn" data-act="backup">Download backup</button></div><div class="muted">${esc(setupNote)}</div></div>
  <div class="card"><h2>Router policy</h2><div class="muted">${rcLoaded ? 'Loaded from Remote Config.' : 'Using built in defaults.'}</div></div>
  <div class="card"><h2>Danger zone</h2><div class="row"><button class="btn" data-act="lock">Lock</button><button class="btn danger" data-act="destroy">Delete my twin from this device</button></div></div>`;
}

function render() {
  const tabs: [Tab, string][] = [['talk', 'Talk'], ['memory', 'Memory'], ['public', 'Public twin'], ['ledger', 'Ledger'], ['setup', 'Setup']];
  const body = !isUnlocked() ? '' : tab === 'talk' ? talk() : tab === 'memory' ? memory() : tab === 'public' ? pub() : tab === 'ledger' ? ledger() : setup();
  const active = document.activeElement as HTMLInputElement | null;
  const keep = active?.id;
  app.innerHTML = !isUnlocked() ? landing() : `<div class="wrap">${header()}<div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>${body}</div>`;
  document.body.classList.toggle('in-app', isUnlocked());
  if (keep) { const el = document.getElementById(keep) as HTMLInputElement | null; if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* not a text input */ } } }
}

// ---------- actions ----------

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';

async function send(q: string) {
  if (!q.trim() || busy) return;
  busy = true; draft = '';
  const mode = detectMode(q);
  const turn: Turn = { q, mode, steps: [] };
  convo.unshift(turn); render();
  try {
    const r = await ask(getTwin(), q, (s) => { turn.steps.push(s); render(); }, mode, deepOn);
    turn.a = r.out; turn.source = r.source; turn.hits = r.hits;
    if (speakOn) speak(r.out.answer);
  } catch (e) { turn.err = (e as Error).message; }
  busy = false; render();
}

async function act(a: string, el: HTMLElement) {
  if (a === 'go-gate' || a === 'go-about') { document.getElementById(a === 'go-gate' ? 'gate' : 'about')?.scrollIntoView({ behavior: 'smooth' }); return; }
  err = '';
  try {
    if (a === 'google') { await googleSignIn(); return; }
    if (a === 'signout') { await signOutUser(); return; }
    if (a === 'create') {
      await createVault(val('g-pass'), { displayName: val('g-name'), email: val('g-email') || undefined, phone: val('g-phone') || undefined, address: val('g-addr') || undefined });
      exists = true;
    } else if (a === 'unlock') await unlock(val('g-pass'));
    else if (a === 'demo-fill') {
      (document.getElementById('g-name') as HTMLInputElement).value = DEMO_NAME;
      (document.getElementById('g-email') as HTMLInputElement).value = 'prasanna@example.com';
      (document.getElementById('g-phone') as HTMLInputElement).value = '+91 90000 12345';
      return;
    } else if (a === 'restore') {
      const f = (document.getElementById('restore') as HTMLInputElement).files?.[0];
      if (!f) throw new Error('Choose a backup file');
      await importBackup(f); exists = true;
    } else if (a === 'demo-notes') { draftNotes = DEMO_NOTES; }
    else if (a === 'photo') {
      const f = (document.getElementById('photo') as HTMLInputElement).files?.[0];
      if (!f) throw new Error('Choose a photo');
      busy = true; ingestSteps = []; render();
      const r = await ingestImage(getTwin(), f, (s) => { ingestSteps.push(s); render(); });
      await commit(); busy = false; ingestMsg = `Added ${r.added} memories from the photo.`;
    } else if (a === 'tidy') { const r = consolidate(getTwin()); await commit(); ingestMsg = `Merged ${r.merged} and faded ${r.faded} old memories.`; }
    else if (a === 'mirror') {
      busy = true; mirrorSteps = []; mirrorErr = ''; render();
      try { const r = await portrait(getTwin(), (s) => { mirrorSteps.push(s); render(); }); mirror = r.out; mirrorSource = r.source; }
      catch (x) { mirrorErr = (x as Error).message; }
      busy = false;
    } else if (a === 'backup') {
      const blob = await exportBackup();
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement('a'), { href: url, download: `twin-backup-${new Date().toISOString().slice(0, 10)}.json` });
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); setupNote = 'Backup downloaded.';
    }
    else if (a === 'send') await send(val('q'));
    else if (a === 'mic') {
      if (listening) { listener?.stop(); return; }
      stopSpeaking(); listening = true; micNote = ''; render();
      listener = listen(
        (t, final) => { draft = t; const q = document.getElementById('q') as HTMLInputElement | null; if (q) q.value = t; if (final) void send(t); },
        (mode) => { listening = false; micNote = mode === 'on-device' ? 'Voice recognized on this device.' : 'Note: your browser sent this audio to its speech service. Typing keeps everything on device.'; render(); },
        (e) => { listening = false; micNote = `Mic problem: ${e}`; render(); },
      );
    } else if (a === 'ingest') {
      busy = true; draftNotes = val('notes'); ingestSteps = []; render();
      const file = (document.getElementById('file') as HTMLInputElement).files?.[0];
      const text = (draftNotes + '\n\n' + (file ? await file.text() : '')).trim();
      if (!text) throw new Error('Paste some notes or choose a file');
      const r = await ingestNotes(getTwin(), text, (s) => { ingestSteps.push(s); render(); }, (d, n) => { ingestMsg = `Reading chunk ${d} of ${n}...`; render(); });
      await commit(); draftNotes = '';
      ingestMsg = `Added ${r.added} memories using ${r.via === 'nano' ? 'Gemini Nano on your device' : r.via === 'mixed' ? 'Nano and the simple extractor' : 'the simple extractor'}.`;
      busy = false;
    } else if (a === 'forget') {
      const n = forgetTopic(getTwin(), val('forget')); await commit(); ingestMsg = `Forgot ${n} memories.`;
    } else if (a === 'publish') {
      busy = true; render(); const t = getTwin(); t.publicNote = val('note');
      const r = await publish(t); await commit();
      publishNote = r.leaks.length ? 'Blocked by the Publish Gate.' : 'Published. Your twin is live.'; busy = false;
    } else if (a === 'unpublish') { await unpublish(getTwin()); await commit(); publishNote = 'Your public twin is gone.'; inbox = []; }
    else if (a === 'inbox') { inboxNote = 'Loading...'; render(); inbox = await readInbox(getTwin().publicId!); inboxNote = inbox.length ? '' : 'No messages yet.'; }
    else if (a === 'red') red = runRedTeam();
    else if (a === 'reset') { await resetLedger(); red = null; }
    else if (a === 'nano') {
      nanoProgress = 'Starting...'; render();
      await downloadNano((p) => { nanoProgress = `Downloading ${Math.round(p * 100)}%`; render(); });
      nano = await nanoState(); nanoProgress = 'Done.';
    } else if (a === 'lock') lock();
    else if (a === 'destroy') { if (confirm('Delete your twin and all memories from this device?')) { await destroyVault(); exists = false; } }
  } catch (e) { err = (e as Error).message; busy = false; ingestMsg = err; inboxNote = err; publishNote = err; }
  stats = await getStats(); entries = await getEntries();
  render();
  void el;
}

app.addEventListener('click', async (e) => {
  const el = (e.target as HTMLElement).closest('[data-act],[data-tab],[data-del],[data-reply],[data-delmsg]') as HTMLElement | null;
  if (!el) return;
  if (el.dataset.tab) { tab = el.dataset.tab as Tab; if (tab === 'ledger') { stats = await getStats(); entries = await getEntries(); } render(); }
  else if (el.dataset.delmsg) {
    try { await deleteMessage(getTwin().publicId!, el.dataset.delmsg); inbox = inbox.filter((m) => m.id !== el.dataset.delmsg); } catch (x) { inboxNote = (x as Error).message; }
    render();
  } else if (el.dataset.del) { forget(getTwin(), el.dataset.del); await commit(); render(); }
  else if (el.dataset.reply) {
    const m = inbox.find((x) => x.id === el.dataset.reply)!;
    drafts[m.id] = 'Drafting on your device...'; render();
    try {
      const r = await ask(getTwin(), `A visitor named ${m.from} left this message for me: "${m.text}". Draft the reply I would send.`, () => {}, 'reply');
      drafts[m.id] = r.out.answer + (r.source === 'in_cloud' ? '\n(Drafted with the masked cloud path.)' : '\n(Drafted on your device.)');
    } catch (x) { drafts[m.id] = (x as Error).message; }
    render();
  } else if (el.dataset.act) await act(el.dataset.act, el);
});

app.addEventListener('change', async (e) => {
  const t = e.target as HTMLInputElement;
  if (t.dataset.pub) { const m = getTwin().memories.find((x) => x.id === t.dataset.pub); if (m) { m.public = t.checked; await commit(); render(); } }
  if (t.id === 'speak') speakOn = t.checked;
  if (t.id === 'deep') deepOn = t.checked;
});

app.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'q') draft = t.value;
  if (t.id === 'notes') draftNotes = t.value;
  if (t.id === 'filter') { filter = t.value; render(); }
});

app.addEventListener('keydown', (e) => {
  const t = e.target as HTMLInputElement;
  if (e.key === 'Enter' && t.id === 'q') void send(t.value);
  if (e.key === 'Enter' && t.id === 'g-pass') void act(exists ? 'unlock' : 'create', t);
});

async function applyUser(u: { uid: string; email: string | null; displayName: string | null } | null) {
  if ((u?.uid ?? '') === (who?.uid ?? '')) return;
  lockMemory();
  setNamespace(u?.uid ?? '');
  who = u ? { uid: u.uid, email: u.email ?? 'Google user', name: u.displayName ?? '' } : null;
  tab = 'talk';
  await refresh();
}
void (async () => {
  await finishRedirect();
  await applyUser(await realUser());
  onUserChange((u) => { void applyUser(u); });
})();
void loadPolicy().then((ok) => { rcLoaded = ok; });
void refresh();

// ---------- extension bridge ----------
// The Twin Chrome extension is the hands. This tab is the brain and the storage.
// The extension's content script relays requests with window.postMessage.
// Only messages from this same window and origin with source 'twin-ext' are accepted.
let bridgeBusy = false;
window.addEventListener('message', async (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const d = e.data as { source?: string; id?: string; op?: string; text?: string; title?: string; url?: string; kind?: string; q?: string; deep?: boolean };
  if (!d || d.source !== 'twin-ext' || typeof d.id !== 'string') return;
  const reply = (result: unknown) => window.postMessage({ source: 'twin-app', id: d.id, result }, location.origin);
  try {
    if (d.op === 'status') {
      const t = isUnlocked() ? getTwin() : null;
      return reply({ ok: true, unlocked: !!t, exists, user: who?.email ?? '', uid: who?.uid ?? '', nano, name: t?.identity.displayName ?? '', memories: t?.memories.length ?? 0 });
    }
    if (!isUnlocked()) return reply({ ok: false, locked: true, error: 'Your twin is locked. Open the Twin tab and unlock it.' });
    // Requests wait their turn. Nano does one job at a time.
    for (let i = 0; i < 480 && (bridgeBusy || busy); i++) await new Promise((r) => setTimeout(r, 500));
    if (bridgeBusy || busy) return reply({ ok: false, error: 'Your twin is still busy. Try again in a moment.' });
    bridgeBusy = true;
    try {
      if (d.op === 'teach') {
        const body = String(d.text ?? '').slice(0, 24_000).trim();
        if (!body) return reply({ ok: false, error: 'Nothing to teach' });
        const head = d.kind === 'page' ? `A page I read: ${d.title ?? ''}\n` : d.title ? `A note I saved while reading ${d.title}\n` : '';
        ingestSteps = [];
        const r = await ingestNotes(getTwin(), head + body, (s) => { ingestSteps.push(s); }, (a, n) => { ingestMsg = `Extension: reading chunk ${a} of ${n}...`; render(); });
        await commit();
        ingestMsg = `Extension added ${r.added} memor${r.added === 1 ? 'y' : 'ies'} using ${r.via === 'nano' ? 'Gemini Nano on your device' : r.via === 'mixed' ? 'Nano and the simple extractor' : 'the simple extractor'}.`;
        stats = await getStats(); render();
        return reply({ ok: true, added: r.added, via: r.via, total: getTwin().memories.length });
      }
      if (d.op === 'ask') {
        const q = String(d.q ?? '').slice(0, 2000).trim();
        if (!q) return reply({ ok: false, error: 'Ask something' });
        const mode = detectMode(q);
        const turn: Turn = { q, mode, steps: [] };
        convo.unshift(turn); render();
        const r = await ask(getTwin(), q, (s) => { turn.steps.push(s); render(); }, mode, !!d.deep);
        turn.a = r.out; turn.source = r.source; turn.hits = r.hits;
        stats = await getStats(); render();
        return reply({ ok: true, answer: r.out.answer, why: r.out.why, source: r.source, confidence: r.out.confidence, steps: turn.steps.map((s) => `${s.actor}: ${s.msg}`) });
      }
      reply({ ok: false, error: 'Unknown request' });
    } finally { bridgeBusy = false; }
  } catch (x) { reply({ ok: false, error: (x as Error).message }); }
});
