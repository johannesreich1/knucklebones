import pkg from 'playwright';
const { chromium, devices } = pkg;
import { shot } from './shot.mjs';
import { servedBase } from './serve.mjs';
// service workers refuse file://, so this suite needs an origin. Whose port it
// is, is nobody's business: run-all passes its own in KB_URL, a hand-run starts
// one here — either way it is THIS tree, never a peer gate's (tests/serve.mjs).
const URL = await servedBase() + 'index.html';
const errs = [], problems = [];
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true,
  locale: 'en-US' });
await ctx.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });   // an experienced player: the first-run tutorial offer is test19's subject
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
  // Budget is generous on purpose: random destruction-heavy endgames run long
  // and loaded machines/CI run slow. 400 flaked here just like it did in
  // test6/test8/test10 — never "optimize" these down.
  for (let i = 0; i < 1200; i++) {
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
await page.evaluate(() => window.__kb.openPractice());
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
  diffOn: document.querySelector('#diffSeg button.on').dataset.d,
}));
check(after.wins === before.wins && after.losses === before.losses, 'record did not survive reload', { before, after });
check(after.best === before.best, 'best score did not survive reload', { before, after });
check(after.diffOn === 'medium', 'difficulty preference not restored', after);
/* The Best/Record line above Play was removed 2026-08-22 (user call), so no
   surface states the record any more. The restored difficulty above is what a
   player can SEE of the reload; the values themselves still assert that the
   deliberately-unshown history survived. */
await shot(page, 'pwa-start');

// ---- 4. offline: cut the network entirely and reload ----
await ctx.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' }).catch(e => errs.push('OFFLINE RELOAD: ' + e.message));
await page.waitForTimeout(1200);
const offline = await page.evaluate(() => ({
  booted: !!window.__kb,
  title: document.querySelector('#ovStart h1') ? document.querySelector('#ovStart h1').textContent : null,
  dice: document.querySelectorAll('#homeDuel .die').length,   // the hero duel: JS built these
  cell: getComputedStyle(document.getElementById('kbroot')).getPropertyValue('--cell').trim(),
  best: window.__kb ? window.__kb.S.best : null,
}));
check(offline.booted, 'game did not boot offline', offline);
check(offline.dice === 2, 'offline boot did not run scripts fully', offline);
// and it must still be playable offline, not just render
await page.evaluate(() => window.__kb.openPractice());
await page.tap('#btnPlay');
await page.waitForTimeout(2000);
const offlinePlay = await page.evaluate(() => ({ phase: window.__kb.S.phase, die: window.__kb.S.die }));
check(['choose', 'roll', 'anim'].includes(offlinePlay.phase), 'game did not start offline', offlinePlay);
await shot(page, 'pwa-offline');
await ctx.setOffline(false);

// ---- 5. desktop viewport sanity (same bundle, wider screen) ----
const ctx2 = await browser.newContext({ viewport: { width: 1024, height: 800 }, locale: 'en-US' });
await ctx2.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });   // an experienced player: the first-run tutorial offer is test19's subject
const p2 = await ctx2.newPage();
p2.on('pageerror', e => errs.push('DESKTOP PAGEERROR: ' + e.message));
await p2.goto(URL);
await p2.waitForTimeout(600);
await p2.evaluate(() => window.__kb.openPractice());
await p2.click('#btnPlay');
await p2.waitForTimeout(1800);
const desk = await p2.evaluate(() => ({
  cell: getComputedStyle(document.getElementById('kbroot')).getPropertyValue('--cell').trim(),
  scrollH: document.documentElement.scrollHeight, innerH: window.innerHeight,
}));
check(desk.scrollH <= desk.innerH + 1, 'desktop layout scrolls', desk);
await shot(p2, 'pwa-desktop');

console.log(JSON.stringify({ sw, man: { ...man, icons: man.icons.map(i => i.status) }, appleIcon,
  finished, before: { ...before, stored: before.stored ? before.stored.slice(0, 80) + '…' : null },
  after, offline, offlinePlay, desk, problems, errs }, null, 2));
await browser.close();
