import pkg from 'playwright';
const { chromium, devices } = pkg;
const URL = 'http://127.0.0.1:8123/index.html';
const errs = [], problems = [];
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

await page.goto(URL);
await page.waitForTimeout(500);

// ---- 1. service worker registers and takes control ----
const sw = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return { supported: false };
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  return {
    supported: true,
    registered: !!reg,
    scope: reg ? reg.scope : null,
    active: reg && reg.active ? reg.active.state : null,
  };
});
check(sw.registered && sw.active === 'activated', 'service worker did not activate', sw);

// ---- 2. manifest is reachable, valid, and its icons resolve ----
const man = await page.evaluate(async () => {
  const href = document.querySelector('link[rel=manifest]').href;
  const r = await fetch(href);
  const j = await r.json();
  const icons = [];
  for (const i of j.icons) {
    const res = await fetch(new URL(i.src, href).href);
    icons.push({ src: i.src, status: res.status, type: res.headers.get('content-type') });
  }
  return { status: r.status, ctype: r.headers.get('content-type'), name: j.name,
           display: j.display, start: j.start_url, icons,
           hasMaskable: j.icons.some(i => (i.purpose || '').includes('maskable')),
           has192: j.icons.some(i => i.sizes === '192x192'),
           has512: j.icons.some(i => i.sizes === '512x512') };
});
check(man.status === 200, 'manifest not served', man);
check(man.display === 'standalone', 'manifest display is not standalone', man);
check(man.has192 && man.has512 && man.hasMaskable, 'manifest icon set incomplete for install', man);
check(man.icons.every(i => i.status === 200), 'a manifest icon 404s', man.icons);
const appleIcon = await page.evaluate(async () => {
  const l = document.querySelector('link[rel="apple-touch-icon"]');
  const r = await fetch(l.href);
  return { href: l.getAttribute('href'), status: r.status };
});
check(appleIcon.status === 200, 'apple-touch-icon missing', appleIcon);

// ---- 3. stats persist across a reload ----
async function playToEnd(p) {
  for (let i = 0; i < 400; i++) {
    const s = await p.evaluate(() => ({ ph: window.__kb.S.phase, t: window.__kb.S.turn, b: window.__kb.S.boards[1] }));
    if (s.ph === 'over') return true;
    if (s.ph === 'choose' && s.t === 1) {
      const lg = s.b.map((c, j) => c.length < 3 ? j : -1).filter(j => j >= 0);
      await p.tap(`#botBoard .col[data-col="${lg[(Math.random() * lg.length) | 0]}"]`);
    }
    await p.waitForTimeout(95);
  }
  return false;
}
await page.tap('#modeSeg button[data-m="cpu"]');
await page.tap('#diffSeg button[data-d="medium"]');
await page.tap('#btnPlay');
await page.waitForTimeout(1600);
const finished = await playToEnd(page);
await page.waitForTimeout(1500);
const before = await page.evaluate(() => ({
  wins: window.__kb.S.wins, losses: window.__kb.S.losses, draws: window.__kb.S.draws,
  best: window.__kb.S.best, diff: window.__kb.S.diff,
  stored: localStorage.getItem('knucklebones.v1'),
}));
check(!!before.stored, 'nothing written to storage after a game', before);
check(before.best > 0, 'best score not recorded', before);

await page.reload();
await page.waitForTimeout(700);
const after = await page.evaluate(() => ({
  wins: window.__kb.S.wins, losses: window.__kb.S.losses, draws: window.__kb.S.draws,
  best: window.__kb.S.best, diff: window.__kb.S.diff,
  statLine: document.getElementById('statLine').textContent.trim(),
  statHidden: document.getElementById('statLine').hidden,
  diffOn: document.querySelector('#diffSeg button.on').dataset.d,
}));
check(after.wins === before.wins && after.losses === before.losses, 'record did not survive reload', { before, after });
check(after.best === before.best, 'best score did not survive reload', { before, after });
check(after.diffOn === 'medium', 'difficulty preference not restored', after);
check(!after.statHidden && after.statLine.length > 0, 'stat line not shown after reload', after);
await page.screenshot({ path: './pwa-start.png' });

// ---- 4. offline: cut the network entirely and reload ----
await ctx.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' }).catch(e => errs.push('OFFLINE RELOAD: ' + e.message));
await page.waitForTimeout(1200);
const offline = await page.evaluate(() => ({
  booted: !!window.__kb,
  title: document.querySelector('#ovStart h1') ? document.querySelector('#ovStart h1').textContent : null,
  dice: document.querySelectorAll('#startDice .die').length,
  cell: getComputedStyle(document.documentElement).getPropertyValue('--cell').trim(),
  best: window.__kb ? window.__kb.S.best : null,
}));
check(offline.booted, 'game did not boot offline', offline);
check(offline.dice === 3, 'offline boot did not run scripts fully', offline);
// and it must still be playable offline, not just render
await page.tap('#btnPlay');
await page.waitForTimeout(2000);
const offlinePlay = await page.evaluate(() => ({ phase: window.__kb.S.phase, die: window.__kb.S.die }));
check(['choose', 'roll', 'anim'].includes(offlinePlay.phase), 'game did not start offline', offlinePlay);
await page.screenshot({ path: './pwa-offline.png' });
await ctx.setOffline(false);

// ---- 5. desktop viewport sanity (same bundle, wider screen) ----
const ctx2 = await browser.newContext({ viewport: { width: 1024, height: 800 } });
const p2 = await ctx2.newPage();
p2.on('pageerror', e => errs.push('DESKTOP PAGEERROR: ' + e.message));
await p2.goto(URL);
await p2.waitForTimeout(600);
await p2.click('#btnPlay');
await p2.waitForTimeout(1800);
const desk = await p2.evaluate(() => ({
  cell: getComputedStyle(document.documentElement).getPropertyValue('--cell').trim(),
  scrollH: document.documentElement.scrollHeight, innerH: window.innerHeight,
}));
check(desk.scrollH <= desk.innerH + 1, 'desktop layout scrolls', desk);
await p2.screenshot({ path: './pwa-desktop.png' });

console.log(JSON.stringify({ sw, man: { ...man, icons: man.icons.map(i => i.status) }, appleIcon,
  finished, before: { ...before, stored: before.stored ? before.stored.slice(0, 80) + '…' : null },
  after, offline, offlinePlay, desk, problems, errs }, null, 2));
await browser.close();
