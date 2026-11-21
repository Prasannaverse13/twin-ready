// Content script. Runs only inside the Twin web app tab.
// It relays requests from the extension to the web app with window.postMessage
// and sends the web app's answer back. The web app holds the vault and runs Nano.
if (!window.__twinBridge) {
  window.__twinBridge = true;
  const pending = new Map();

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.source !== 'twin-app' || typeof d.id !== 'string') return;
    const done = pending.get(d.id);
    if (done) { pending.delete(d.id); done(d.result); }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'twin' || sender.id !== chrome.runtime.id) return;
    const id = crypto.randomUUID();
    pending.set(id, sendResponse);
    window.postMessage({ ...(msg.payload || {}), source: 'twin-ext', id, op: msg.op }, location.origin);
    return true; // the answer comes later
  });
}
