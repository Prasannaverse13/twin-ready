// Side panel. Chat with your twin and teach it from the page you are reading.
// Every request goes to the Twin web app tab, which holds the encrypted vault and runs Gemini Nano.
import { autoOn, callTwin, focusTwin, homeKey, runSwarm, setAuto, setHome, skipUrl, status, unlink } from './shared.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let busy = false;

async function refresh() {
  const s = await status();
  if (s.ok && s.unlocked) chrome.runtime.sendMessage({ type: 'flush' }).catch(() => {});
  const dot = $('dot');
  dot.className = 'dot';
  if (s.ok && s.mismatch) {
    dot.classList.add('bad');
    $('stext').textContent = 'Different account';
    $('ssub').innerHTML = `${s.mismatch}<br/><button class="btn" data-switch>Switch account</button>`;
  } else if (s.ok && s.unlocked) {
    dot.classList.add('good');
    $('stext').textContent = `${s.name || 'Your'} twin is ready`;
    $('ssub').textContent = `${s.user || 'Guest twin'}. ${s.memories} memories. ${s.nano === 'available' ? 'Gemini Nano on this device.' : 'Nano not ready. Cloud only with masking.'}`;
  } else if (s.ok && !s.unlocked) {
    $('stext').textContent = s.exists ? 'Your twin is locked' : 'No twin yet';
    $('ssub').innerHTML = `${s.exists ? 'Unlock it in the Twin tab. Your passphrase never leaves that tab.' : 'Create your twin in the Twin app first.'}<br/><button class="btn" data-open>Open Twin</button>`;
  } else {
    dot.classList.add('bad');
    $('stext').textContent = s.closed ? 'Twin app is not open' : 'Twin app is not answering';
    $('ssub').innerHTML = `The Twin app is where your memory lives. Open it once and keep the tab.<br/><button class="btn" data-open>Open Twin</button>`;
  }
}

function add(html, cls) {
  const log = $('log');
  log.querySelector('.empty')?.remove();
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

async function ask() {
  const q = $('q').value.trim();
  if (!q || busy) return;
  busy = true; $('send').disabled = true; $('q').value = '';
  add(esc(q), 'me');
  const wait = add('Your twin is thinking. The first Nano answer can take a minute.', 'thinking');
  try {
    const r = await callTwin('ask', { q, deep: $('deep').checked });
    wait.remove();
    if (!r?.ok) throw new Error(r?.error || 'No answer');
    const dev = r.source === 'on_device';
    add(`<div class="a">${esc(r.answer)}</div><div class="why">${esc(r.why)}</div>
      <div class="strip ${dev ? 'device' : 'cloud'}"><i></i>${dev ? 'Answered by Gemini Nano on your device' : 'Answered by cloud Gemini with names masked'}</div>
      <details><summary>What happened to your data</summary>${(r.steps || []).map((s) => `<div>${esc(s)}</div>`).join('')}</details>`, 'tw');
  } catch (e) {
    wait.remove();
    add(esc(e.message), 'tw err');
  }
  busy = false; $('send').disabled = false; $('q').focus();
  refresh();
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error('Open a normal web page first');
  return tab;
}

async function run() {
  // Asking for page access must happen first, inside the click.
  const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
  if (!granted) { note('Page access is needed so the agents can read the page.', true); return; }
  try {
    const tab = await activeTab();
    if (skipUrl(tab.url)) throw new Error('The agents skip this kind of page to protect you');
    await runSwarm(tab.id, { auto: false });
    note('Scout and Keeper are reading the page. Watch them work.');
  } catch (e) { note(e.message, true); }
}

async function toggleAuto(e) {
  if (e.target.checked) {
    const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
    if (!granted) { e.target.checked = false; note('Page access is needed for auto learning.', true); return; }
  }
  await setAuto(e.target.checked);
  note(e.target.checked ? 'Auto learn is on. The agents read each new page you open.' : 'Auto learn is off.');
}

function note(text, err = false) { const n = $('tnote'); n.textContent = text; n.className = err ? 'note err' : 'note'; }

$('send').addEventListener('click', ask);
$('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
$('run').addEventListener('click', run);
$('auto').addEventListener('change', toggleAuto);
$('open').addEventListener('click', () => focusTwin());
document.addEventListener('click', (e) => { if (e.target.closest('[data-switch]')) unlink().then(refresh); });
document.addEventListener('click', (e) => { if (e.target.closest('[data-open]')) focusTwin().then(() => setTimeout(refresh, 2500)); });
$('home').addEventListener('change', async (e) => { await setHome(e.target.value); refresh(); });
chrome.runtime.onMessage.addListener((m) => {
  if (m?.type === 'taught') { const r = m.result; note(r?.ok ? `Your twin learned ${r.added} memor${r.added === 1 ? 'y' : 'ies'}${m.title ? ` from ${m.title}` : ''}.` : r?.error || 'Could not teach', !r?.ok); refresh(); }
});

(async () => { $('home').value = await homeKey(); $('auto').checked = await autoOn(); refresh(); setInterval(refresh, 8000); })();
