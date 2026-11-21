// The Twin agent swarm. Two visible agents read the page for you.
//   Scout walks the page and reads each block.
//   Keeper follows, judges each block, and keeps what is worth remembering.
// Kept text goes to your own Twin tab, where Gemini Nano turns it into memories on the device.
(() => {
  if (window.__twinSwarm) return;
  window.__twinSwarm = true;
  const opts = window.__twinSwarmOpts || {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const finish = () => { window.__twinSwarm = false; };

  // Never read pages with a visible password box when running on its own.
  const pwd = [...document.querySelectorAll('input[type=password]')].some((i) => i.offsetParent !== null);
  if (opts.auto && pwd) return finish();

  // ---------- pick blocks ----------
  const scope = document.querySelector('article, main, [role=main]') || document.body;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 120 && r.height > 14 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const blocks = [...scope.querySelectorAll('h1, h2, h3, p, li, blockquote')]
    .filter((el) => !el.closest('nav, footer, aside, form, [role=navigation], #twin-swarm-host'))
    .filter((el) => { const t = el.innerText.trim(); return /^H\d$/.test(el.tagName) ? t.length >= 6 : t.length >= 70; })
    .filter(visible)
    .filter((el, i, all) => !all.some((o) => o !== el && o.contains(el)))
    .slice(0, opts.max || 22);
  if (!blocks.length) return finish();

  // ---------- overlay ----------
  const host = document.createElement('div');
  host.id = 'twin-swarm-host';
  Object.assign(host.style, { position: 'absolute', left: '0', top: '0', width: '0', height: '0', zIndex: '2147483647', pointerEvents: 'none' });
  const root = host.attachShadow({ mode: 'open' });
  const arrow = (c) => `<svg width="22" height="24" viewBox="0 0 22 24"><path d="M2 2 L2 20 L7 15.5 L10.5 22.5 L13.6 21 L10.2 14.2 L17 14 Z" fill="${c}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  root.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; font-family: 'Inter Tight', ui-sans-serif, system-ui, 'Segoe UI', sans-serif; }
    .box { position: absolute; border: 1.5px dashed rgba(125,47,53,.75); background: rgba(125,47,53,.05); border-radius: 4px; transition: all .35s ease; }
    .box .tag { position: absolute; top: -11px; right: 8px; font: 600 10px/1 ui-monospace, Consolas, monospace; padding: 4px 6px; border-radius: 3px; background: #7d2f35; color: #fff; letter-spacing: .02em; text-transform: uppercase; }
    .box.kept { border: 1.5px solid #4f7a55; background: rgba(110,150,105,.12); box-shadow: 0 0 0 4px rgba(110,150,105,.12); }
    .box.kept .tag { background: #4f7a55; }
    .box.skip { opacity: 0; transform: scale(.98); }
    .agent { position: absolute; left: 0; top: 0; transition: transform .6s cubic-bezier(.3,.7,.2,1); filter: drop-shadow(0 3px 5px rgba(0,0,0,.25)); }
    .agent .name { position: absolute; left: 16px; top: 18px; font: 600 11px/1 'Inter Tight', system-ui, sans-serif; color: #fff; padding: 5px 8px; border-radius: 3px; white-space: nowrap; }
    .agent .name small { font-weight: 400; opacity: .8; margin-left: 5px; }
    .hud { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; padding: 8px 8px 8px 12px; background: #2f1715; color: #efe6dc; border-radius: 8px; font-size: 13px; box-shadow: 0 14px 40px rgba(47,23,21,.35); pointer-events: auto; white-space: nowrap; }
    .dots { display: flex; }
    .dots i { width: 18px; height: 18px; border-radius: 50%; border: 2px solid #2f1715; margin-left: -6px; display: grid; place-items: center; font: 700 9px/1 system-ui; font-style: normal; color: #fff; }
    .dots i:first-child { margin-left: 0; }
    .hud b { font-weight: 600; }
    .hud .sep { width: 1px; height: 16px; background: rgba(239,230,220,.2); }
    .hud .msg { color: rgba(239,230,220,.75); }
    .hud button { all: unset; cursor: pointer; font-size: 12px; font-weight: 600; background: #7d2f35; color: #fff; padding: 7px 11px; border-radius: 5px; }
    .hud .logo { width: 22px; height: 22px; border-radius: 5px; background: #efe6dc; color: #1c1613; display: grid; place-items: center; font-weight: 700; font-size: 13px; }
  </style>
  <div class="layer"></div>
  <div class="agent" id="scout">${arrow('#7d2f35')}<span class="name" style="background:#7d2f35">Scout<small>reading</small></span></div>
  <div class="agent" id="keeper">${arrow('#5d7a58')}<span class="name" style="background:#5d7a58">Keeper<small>judging</small></span></div>
  <div class="hud"><span class="logo">✻</span><span class="dots"><i style="background:#7d2f35">S</i><i style="background:#5d7a58">K</i></span>
    <span><b>2 agents</b></span><span class="sep"></span><span id="count"><b>0</b>/${blocks.length} read</span><span class="sep"></span><span id="kept"><b>0</b> kept</span>
    <span class="sep"></span><span class="msg" id="msg">Reading this page for your twin</span><button id="stop">Stop</button></div>`;
  document.documentElement.appendChild(host);
  const $ = (id) => root.getElementById(id);
  const layer = root.querySelector('.layer');
  let stopped = false;
  $('stop').addEventListener('click', () => { stopped = true; cleanup(0); });

  const startY = scrollY;
  const pos = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; };
  const move = (agent, x, y) => { $(agent).style.transform = `translate(${x}px, ${y}px)`; };
  const say = (agent, text) => { $(agent).querySelector('small').textContent = text; };
  const vp = { x: scrollX + innerWidth / 2, y: scrollY + innerHeight / 2 };
  move('scout', vp.x - 40, vp.y); move('keeper', vp.x + 40, vp.y + 30);

  // ---------- Keeper's judgement ----------
  const titleWords = new Set(document.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  function judge(el) {
    const t = el.innerText.trim();
    if (el.tagName === 'H1') return { keep: true };
    if (/^H\d$/.test(el.tagName)) return { keep: false };
    if (kept.length >= 8) return { keep: false };
    const words = t.toLowerCase().split(/\W+/);
    let s = Math.min(0.6, t.length / 600);
    s += Math.min(0.4, words.filter((w) => titleWords.has(w)).length * 0.1);
    if (/\b(i|my|we|our)\b/i.test(t)) s += 0.3;
    if (/\d/.test(t)) s += 0.05;
    if (/cookie|subscribe|sign up|newsletter|advert|all rights reserved|privacy policy/i.test(t)) s -= 1;
    return { keep: s >= 0.75 };
  }

  // ---------- the two agents ----------
  const queue = [];
  const kept = [];
  let read = 0;
  let scoutDone = false;

  async function scout() {
    for (const el of blocks) {
      if (stopped) return;
      const p = pos(el);
      if (p.y < scrollY + 80 || p.y + Math.min(p.h, 200) > scrollY + innerHeight - 90) {
        scrollTo({ top: Math.max(0, p.y - innerHeight * 0.3), behavior: 'smooth' });
        await sleep(450);
      }
      const q = pos(el);
      move('scout', q.x + Math.min(q.w - 30, 40 + Math.random() * q.w * 0.5), q.y + Math.min(q.h - 6, 10 + Math.random() * 12));
      say('scout', 'reading');
      const box = document.createElement('div');
      box.className = 'box';
      Object.assign(box.style, { left: `${q.x - 6}px`, top: `${q.y - 5}px`, width: `${q.w + 12}px`, height: `${q.h + 10}px` });
      box.innerHTML = '<span class="tag">reading</span>';
      layer.appendChild(box);
      await sleep(opts.fast ? 260 : 520);
      read++; $('count').innerHTML = `<b>${read}</b>/${blocks.length} read`;
      queue.push({ el, box });
    }
    scoutDone = true;
  }

  async function keeper() {
    while (!stopped) {
      const item = queue.shift();
      if (!item) { if (scoutDone) return; await sleep(120); continue; }
      const p = pos(item.el);
      move('keeper', p.x + p.w - 60, p.y + p.h - 12);
      say('keeper', 'judging');
      await sleep(opts.fast ? 240 : 420);
      const j = judge(item.el);
      if (j.keep) {
        item.box.className = 'box kept';
        item.box.querySelector('.tag').textContent = 'kept';
        kept.push(item.el.innerText.trim().replace(/\s+/g, ' ').slice(0, 700));
        $('kept').innerHTML = `<b>${kept.length}</b> kept`;
        say('keeper', 'kept');
      } else {
        item.box.querySelector('.tag').textContent = 'skip';
        item.box.className = 'box skip';
        say('keeper', 'skip');
      }
    }
  }

  function cleanup(delay) {
    setTimeout(() => { host.remove(); chrome.runtime.onMessage.removeListener(onResult); finish(); }, delay);
  }

  function onResult(m) {
    if (m?.type !== 'swarm-result') return;
    const r = m.result || {};
    say('keeper', r.ok ? 'done' : 'error');
    $('msg').textContent = r.ok ? `Your twin learned ${r.added} new memor${r.added === 1 ? 'y' : 'ies'} with Gemini Nano` : (r.error || 'Your twin could not learn this page');
    $('stop').textContent = 'Close';
    cleanup(r.ok ? 6000 : 9000);
  }

  (async () => {
    await Promise.all([scout(), keeper()]);
    if (stopped) return;
    scrollTo({ top: startY, behavior: 'smooth' });
    root.querySelectorAll('.box.skip').forEach((b) => b.remove());
    if (!kept.length) {
      $('msg').textContent = 'Nothing worth remembering here';
      cleanup(3500);
      return;
    }
    say('scout', 'done'); say('keeper', 'sending');
    $('msg').textContent = 'Keeper is handing notes to your twin. Nano reads them on your device';
    chrome.runtime.onMessage.addListener(onResult);
    const text = `Key points:\n${kept.map((k) => `- ${k}`).join('\n')}`.slice(0, 9000);
    chrome.runtime.sendMessage({ type: 'swarm-done', title: document.title, url: location.href, text, kept: kept.length, read });
  })();
})();
