// Service worker. Right click menus, the shortcut, auto learning and the hand off to the Twin tab.
import { autoOn, callTwin, readPage, runSwarm, skipUrl } from './shared.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'teach-sel', title: 'Teach my twin this', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'run-agents', title: 'Let my twin agents read this page', contexts: ['page'] });
  });
});

async function badge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 6000);
}

// Notes that arrive while the twin is locked wait here. Nothing is lost.
async function park(payload) {
  const { pending = [] } = await chrome.storage.local.get('pending');
  pending.push({ ...payload, text: String(payload.text || '').slice(0, 24000), at: Date.now() });
  await chrome.storage.local.set({ pending: pending.slice(-15) });
}

let flushing = false;
async function flush() {
  if (flushing) return;
  const { pending = [] } = await chrome.storage.local.get('pending');
  if (!pending.length) return;
  flushing = true;
  try {
    const s = await callTwin('status', {}).catch(() => null);
    if (!s?.ok || !s.unlocked) return;
    await chrome.storage.local.set({ pending: [] });
    let added = 0;
    for (const p of pending) {
      const r = await teach(p);
      if (r?.ok) added += r.added || 0;
    }
    tell({ type: 'taught', result: { ok: true, added, total: 0 }, title: 'Saved pages', kept: pending.length });
  } finally { flushing = false; }
}
chrome.alarms.create('flush', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'flush') flush(); });

// Only one teach at a time. The Twin tab runs Nano one job after another.
let chain = Promise.resolve();
function teach(payload) {
  const job = chain.then(async () => {
    await badge('...', '#7d2f35');
    const keep = setInterval(() => chrome.runtime.getPlatformInfo(), 20000); // keep the worker awake while Nano works
    try {
      const r = await callTwin('teach', payload);
      if (r && r.ok === false && r.locked) {
        await park(payload);
        await badge('wait', '#b07a1f');
        return { ok: false, parked: true, error: 'Saved for later. Unlock your twin and it will learn this by itself.' };
      }
      await badge(r?.ok ? `+${r.added}` : '!', r?.ok ? '#3e7a55' : '#a3363a');
      return r;
    } catch (e) {
      await park(payload);
      await badge('wait', '#b07a1f');
      return { ok: false, parked: true, error: 'Saved for later. It will learn when the Twin tab is open and unlocked.' };
    } finally { clearInterval(keep); }
  });
  chain = job.catch(() => {});
  return job;
}

const tell = (m) => chrome.runtime.sendMessage(m).catch(() => {});

chrome.runtime.onMessage.addListener((m, sender) => {
  if (m?.type === 'flush') { flush(); return; }
  if (m?.type !== 'swarm-done' || !sender.tab?.id) return;
  const tabId = sender.tab.id;
  (async () => {
    const r = await teach({ kind: 'page', text: m.text, title: m.title, url: m.url });
    chrome.tabs.sendMessage(tabId, { type: 'swarm-result', result: r }).catch(() => {});
    tell({ type: 'taught', result: r, title: m.title, kept: m.kept });
    if (r?.ok) {
      const { seen = {} } = await chrome.storage.local.get('seen');
      seen[m.url] = Date.now();
      for (const k of Object.keys(seen)) if (Date.now() - seen[k] > 86400000) delete seen[k];
      await chrome.storage.local.set({ seen });
    }
  })();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'teach-sel' && info.selectionText) {
    const r = await teach({ kind: 'selection', text: info.selectionText, title: tab?.title, url: tab?.url });
    tell({ type: 'taught', result: r });
  } else if (info.menuItemId === 'run-agents' && tab?.id) {
    runSwarm(tab.id, { auto: false }).catch(() => badge('!', '#a3363a'));
  }
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd === 'run-agents' && tab?.id) runSwarm(tab.id, { auto: false }).catch(() => badge('!', '#a3363a'));
});

// Auto learn as I browse. Runs only when the user turned it on and gave page access.
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || skipUrl(tab.url) || tab.incognito) return;
  if (!(await autoOn())) return;
  if (!(await chrome.permissions.contains({ origins: ['<all_urls>'] }))) return;
  const { seen = {} } = await chrome.storage.local.get('seen');
  if (seen[tab.url] && Date.now() - seen[tab.url] < 86400000) return;
  setTimeout(() => runSwarm(tabId, { auto: true }).catch(() => {}), 2500);
});

