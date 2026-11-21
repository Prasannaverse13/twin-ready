// Shared helpers for the service worker and the side panel.
// The Twin web app tab is the brain and the storage. These helpers find it and talk to it.

export const HOMES = {
  local: 'http://localhost:5173/',
  live: 'https://twin-hybrid-gm.web.app/',
};
const PATTERNS = ['http://localhost:5173/*', 'https://twin-hybrid-gm.web.app/*', 'https://twin-hybrid-gm.firebaseapp.com/*'];

export async function homeKey() {
  const { home } = await chrome.storage.local.get('home');
  return home === 'live' ? 'live' : 'local';
}

export async function setHome(key) {
  await chrome.storage.local.set({ home: key });
}

const isOwnerPage = (u = '') => !/\/t(\.html|\/)/.test(u);

/** Find the open Twin tab. If none is open and open is true, open it pinned in the background. */
export async function findTwinTab(open = true) {
  const key = await homeKey();
  const tabs = (await chrome.tabs.query({ url: PATTERNS })).filter((t) => isOwnerPage(t.url));
  const preferred = tabs.find((t) => t.url.startsWith(HOMES[key])) || tabs[0];
  if (preferred) return preferred;
  if (!open) return null;
  return chrome.tabs.create({ url: HOMES[key], pinned: true, active: false });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} took too long`)), ms))]);
}

async function send(tabId, op, payload, ms) {
  const msg = { type: 'twin', op, payload };
  try {
    return await withTimeout(chrome.tabs.sendMessage(tabId, msg), ms, op);
  } catch (e) {
    // The tab was open before the extension was installed. Add the bridge and try again.
    if (/Receiving end|Could not establish/i.test(String(e?.message || e))) {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['bridge.js'] });
      return withTimeout(chrome.tabs.sendMessage(tabId, msg), ms, op);
    }
    throw e;
  }
}

/** Wait until the web app answers a status ping. Returns the status. */
async function ready(tabId, tries = 20) {
  for (let i = 0; i < tries; i++) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        const s = await send(tabId, 'status', {}, 1500);
        if (s && s.ok) return s;
      }
    } catch { /* still loading */ }
    await sleep(700);
  }
  throw new Error('The Twin tab did not answer. Open it and reload.');
}

// The extension links to one account. A Google account or the guest twin.
// It only teaches and asks when the Twin tab is signed in as that same account.
export async function linkedTo() { return (await chrome.storage.local.get('boundTo')).boundTo || null; }
export async function unlink() { await chrome.storage.local.remove('boundTo'); }
async function mismatch(s) {
  const id = s.uid || 'guest';
  const bound = await linkedTo();
  if (!bound) { await chrome.storage.local.set({ boundTo: { id, label: s.user || 'guest twin' } }); return null; }
  if (bound.id === id) return null;
  return `This extension is linked to ${bound.label}. Sign in as ${bound.label} in the Twin app or press Switch account.`;
}

/** Status of the twin without opening a tab. */
export async function status() {
  const tab = await findTwinTab(false);
  if (!tab) return { ok: false, closed: true };
  try { const s = await ready(tab.id, 3); return { ...s, tabId: tab.id, mismatch: await mismatch(s) }; } catch (e) { return { ok: false, error: e.message, tabId: tab.id }; }
}

/** Call the twin. Opens the Twin tab when needed. Nano can take a minute on the first call. */
export async function callTwin(op, payload = {}) {
  const tab = await findTwinTab(true);
  const s = await ready(tab.id);
  const bad = await mismatch(s);
  if (bad && op !== 'status') return { ok: false, wrongAccount: true, error: bad };
  return send(tab.id, op, payload, 240000);
}

export async function focusTwin() {
  const tab = await findTwinTab(true);
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

/** Read the selection or the main text of a page. Runs in that page. */
export async function readPage(tabId) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const pick = document.querySelector('article, main, [role=main]') || document.body;
      const text = (pick?.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
      return { title: document.title, url: location.href, selection: String(getSelection() || '').trim(), text: text.slice(0, 20000) };
    },
  });
  return r.result;
}

// ---------- agent swarm ----------
const SKIP = /(^|\.)(mail\.|accounts\.|login\.|signin\.|auth\.)|bank|paypal|stripe\.com|razorpay|paytm|phonepe|wallet|checkout|payment|\/login|\/signin|\/checkout|chrome\.google\.com\/webstore|twin-hybrid-gm|localhost/i;

export function skipUrl(url = '') {
  return !/^https?:/.test(url) || SKIP.test(url);
}

/** Start the two agents on a tab. auto is true when it runs by itself while browsing. */
export async function runSwarm(tabId, opts = {}) {
  await chrome.scripting.executeScript({ target: { tabId }, func: (o) => { window.__twinSwarmOpts = o; }, args: [opts] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['swarm.js'] });
}

export async function autoOn() {
  const { auto } = await chrome.storage.local.get('auto');
  return auto === true;
}

export async function setAuto(on) {
  await chrome.storage.local.set({ auto: !!on });
}
