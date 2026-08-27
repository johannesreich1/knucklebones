import pkg from 'playwright';
const { chromium, devices } = pkg;
import { serveTree } from './serve.mjs';
/* Served over LOCAL HTTP, not file:// — this suite's graduation coda reloads
   the page and asserts the tutorial flag came back, and Chromium's file://
   DOMStorage can hydrate a reloaded document from a STALE disk commit no
   matter what holds the area open: the keeper page below was added after runs
   32456842535/32459675455 lost the write, and run 32485862497 (plus its
   rerun) lost it straight through the keeper. An http origin's localStorage
   is one live area per origin — the reload reads it coherently, no disk race.
   The other file suites keep loading the artifact over file://, so the
   double-click path stays covered; only the reload assertion needed the
   protocol. The server is this suite's own: repo root, a port the kernel
   picks, gone when the process ends (tests/serve.mjs). run-all stays
   untouched, and a peer session's gate has no number to collide with — the
   old fixed port needed an "is this server MINE?" guard for exactly that
   reason. */
const { url } = await serveTree('.');   // the repo root: the single-file artifact is built there
const F = url + 'knucklebones-neon.html';
const browser = await chromium.launch();
const problems = [], errs = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true,
  locale: 'en-US' });
/* over http the single-file page would try to register its service worker
   (file:// never attempts it) and 404 on /sw.js — not this suite's subject,
   and the console error would fail the gate. Make the capability absent, the
   same world every file:// suite already runs in. */
await ctx.addInitScript(() => { try { delete Navigator.prototype.serviceWorker; } catch { /* strict hosts keep it */ } });
await ctx.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });   // an experienced player: tests/first-run-offer.mjs owns the first-run offer
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await page.goto(F); await page.waitForTimeout(500);

const snap = () => page.evaluate(() => ({
  phase: window.__kb.S.phase, turn: window.__kb.S.turn, die: window.__kb.S.die,
  b0: window.__kb.S.boards[0], b1: window.__kb.S.boards[1],
  tut: window.__kb.S.tut ? { turnNo: window.__kb.S.tut.turnNo, restrict: window.__kb.S.tut.restrict } : null,
  pills: document.querySelectorAll('.chip .dl.show').length,
  danger: document.querySelectorAll('.col.danger').length,
  legal: document.querySelectorAll('.col.legal').length,
  coach: !document.getElementById('coach').hidden,
  coachMsg: document.getElementById('coachMsg').textContent,
  // The pill lane is the GAP between the centre stage and your chip strip.
  // Measure the gap the player sees, not the margin property that happens to
  // carry it — the 4px board/chip separation moved to margin-BOTTOM on the
  // lower half (it was riding the centre stage 4px high as a margin-top).
  laneGap: Math.round(document.querySelector('#botCols').getBoundingClientRect().top
                    - document.querySelector('.center').getBoundingClientRect().bottom),
}));
async function waitChoose(maxMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = await snap();
    if (s.phase === 'choose') return s;
    if (s.phase === 'over') return s;
    await page.waitForTimeout(120);
  }
  return await snap();
}

// ===================== A. NO STRATEGY PREVIEWS IN NORMAL PLAY =====================
await page.evaluate(() => window.__kb.openPractice());  // local controls live in the Offline overlay now
await page.tap('#btnPlay'); await page.waitForTimeout(1500);
let s = await waitChoose();
out.cpuNormal = { pills: s.pills, danger: s.danger, legal: s.legal, laneGap: s.laneGap };
check(s.pills === 0, 'gain/kill pills shown in normal CPU play', s);
check(s.danger === 0, 'danger outline shown in normal CPU play', s);
check(s.legal === 3, 'legal affordance missing in normal play', s);
// the lane is a DELTA, not an absolute: how much space the gap gains is fixed,
// but the gap it starts from is whatever the device box leaves over. Asserted
// against the tutorial's gap below, so both directions are covered by one fact.

// duo: same check
await page.tap('#btnLeave'); await page.waitForTimeout(300); await page.tap('#btnAskYes'); await page.waitForTimeout(400);
await page.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
await page.tap('#modeSeg button[data-m="duo"]'); await page.waitForTimeout(200);
await page.tap('#btnPlay'); await page.waitForTimeout(1400);
s = await waitChoose();
out.duoNormal = { pills: s.pills, danger: s.danger };
check(s.pills === 0 && s.danger === 0, 'previews shown in duo play', s);
const quitVia = await page.evaluate(() => document.getElementById('ovPass').classList.contains('on'));
if (quitVia) { await page.tap('#ovPass'); await page.waitForTimeout(400); }
await page.tap('#btnLeave'); await page.waitForTimeout(300); await page.tap('#btnAskYes'); await page.waitForTimeout(400);
// ===================== B. THE TUTORIAL, WALKED END TO END (from the home strip) =====================
// the tutorial now lives one level in, behind HOW TO PLAY
await page.tap('#btnLearn'); await page.waitForTimeout(320);
await page.tap('#btnLearnTut'); await page.waitForTimeout(500);
s = await snap();
check(s.coach && /Welcome/.test(s.coachMsg), 'welcome step missing', s);
check(s.laneGap - out.cpuNormal.laneGap >= 10,
      'tutorial pill lane not applied (or not reclaimed in normal play)',
      { tutorial: s.laneGap, normal: out.cpuNormal.laneGap });
out.tag = await page.evaluate(() => document.getElementById('tagTop').textContent);
check(out.tag === 'TUTORIAL', 'CPU plate not tagged TUTORIAL', out.tag);
// the game must be paused on the welcome card
await page.waitForTimeout(1200);
s = await snap();
check(s.phase === 'roll' && s.die === 0, 'game did not wait for the welcome tap', s);

await page.tap('#coach');                                  // begin
s = await waitChoose();
check(s.die === 4, 'first scripted roll is not a 4', s);
check(s.pills === 3, 'tutorial gain pills missing', s);
check(s.tut && s.tut.turnNo === 0 && s.tut.restrict === null, 'step 1 state wrong', s.tut);
out.step1 = { die: s.die, pills: s.pills, msg: s.coachMsg.slice(0, 30) };

await page.tap('#botBoard .col[data-col="0"]');            // place first 4 in column 0
await page.waitForTimeout(600);
s = await snap();
check(JSON.stringify(s.b1[0]) === '[4]', 'first placement missing', s.b1);

s = await waitChoose();                                     // CPU scripted move happened
check(JSON.stringify(s.b0[2]) === '[2]', 'CPU scripted move 1 wrong (want die 2 in col 2)', s.b0);
check(s.die === 4, 'second scripted roll is not a 4', s);
check(s.tut.restrict === 0, 'multiplier step not restricted to first column', s.tut);
check(s.legal === 1, 'restricted step outlines more than one column', s);

// wrong column by touch must be refused
await page.tap('#botBoard .col[data-col="1"]'); await page.waitForTimeout(500);
s = await snap();
check(s.phase === 'choose' && s.b1[1].length === 0, 'touch restriction not enforced', s);
// wrong column by keyboard must be refused too (the old bypass)
await page.keyboard.press('3'); await page.waitForTimeout(500);
s = await snap();
check(s.phase === 'choose' && s.b1[2].length === 0, 'keyboard restriction not enforced', s);
out.restriction = 'both input paths refused';

await page.tap('#botBoard .col[data-col="0"]');            // stack the multiplier
await page.waitForTimeout(700);
s = await snap();
check(JSON.stringify(s.b1[0]) === '[4,4]', 'multiplier stack failed', s.b1);
out.multChip = await page.evaluate(() => {
  const chip = document.querySelectorAll('#botCols .chip')[0];
  return { score: chip.querySelector('.cs').textContent, mx: chip.querySelector('.mx').textContent };
});
check(out.multChip.score === '16' && out.multChip.mx === '×2', 'multiplier not scored 16 ×2', out.multChip);

s = await waitChoose();                                     // CPU placed its 5
check(JSON.stringify(s.b0[1]) === '[5]', 'CPU scripted move 2 wrong (want die 5 in col 1)', s.b0);
check(s.die === 5, 'third scripted roll is not a 5', s);
check(s.tut.restrict === 1, 'destruction step not restricted to middle column', s.tut);
out.killPreview = await page.evaluate(() => ({
  kill: [...document.querySelectorAll('#topCols .chip .dl.show')].map(d => d.textContent),
  danger: document.querySelectorAll('#topBoard .col.danger').length,
}));
check(out.killPreview.kill.includes('−5') && out.killPreview.danger === 1, 'destruction preview missing', out.killPreview);  // −POINTS (the CPU's lone 5), not dice count

await page.tap('#botBoard .col[data-col="1"]');            // smash it
await page.waitForTimeout(1200);
s = await snap();
check(s.b0[1].length === 0, 'destruction lesson: CPU die survived', s.b0);
check(JSON.stringify(s.b1[1]) === '[5]', 'player 5 not placed', s.b1);

s = await waitChoose();
check(s.tut && s.tut.turnNo === 3 && /whole game/.test(s.coachMsg), 'wrap-up lesson missing', s);
check(s.tut.restrict === null, 'free play still restricted', s.tut);

// finish the round. The budget is generous on purpose: free play is random,
// and a destruction-heavy endgame can run well past the typical ~20s.
for (let i = 0; i < 900; i++) {
  s = await snap();
  if (s.phase === 'over') break;
  if (s.phase === 'choose' && s.turn === 1) {
    const lg = s.b1.map((c, j) => c.length < 3 ? j : -1).filter(j => j >= 0);
    await page.tap(`#botBoard .col[data-col="${lg[(Math.random() * lg.length) | 0]}"]`);
  }
  await page.waitForTimeout(100);
}
await page.waitForTimeout(1800);
out.end = await page.evaluate(() => ({
  shown: document.getElementById('ovEnd').classList.contains('on'),
  endRec: document.getElementById('endMeta').textContent,
  sub: document.getElementById('endSub').textContent,
  rec: document.getElementById('rec').textContent.trim(),
  stats: (() => { const k = window.__kb.S; return k.wins + k.losses + k.draws + k.p1 + k.p2; })(),
  best: window.__kb.S.best,
  tutDone: window.__kb.S.tutDone,
  tutCleared: !window.__kb.S.tut,
}));
check(out.end.shown && out.end.endRec === 'TUTORIAL COMPLETE', 'tutorial end screen wrong', out.end);
check(out.end.stats === 0 && out.end.best === 0, 'tutorial polluted the record', out.end);
check(out.end.tutDone && out.end.tutCleared, 'tutorial completion state wrong', out.end);

// After graduating, the flag persists across reload. WAIT FOR THE WRITE, not
// a fixed beat: on CI's slow runners this reload raced the save three times
// in one evening (2026-08-20) — green locally every time, red ~1-in-2 on the
// runner. Polling localStorage for the flag makes the wait deterministic, and
// separates the two failures a fixed sleep conflates: "the save never
// happened" (times out HERE, before the reload) vs "the boot did not read it
// back" (the check below).
await page.waitForFunction(() => {
  try { return JSON.parse(localStorage.getItem('knucklebones.v1') ?? '{}').tutDone === true; }
  catch { return false; }
}, null, { timeout: 8000 }).catch(() => { /* the check below names the failure */ });
out.saved = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('knucklebones.v1') ?? '{}').tutDone === true);
check(out.saved, 'tutorial completion was never SAVED — the write itself is missing', out);
// The reload must not be the origin's LAST document: over file:// this page
// is the only thing holding the DOMStorage area open, and tearing it down
// races Chromium's rate-limited disk commit — CI watched the poll above pass
// and the reloaded page still read defaults (runs 32456842535/32459675455,
// 2026-08-21). A keeper page pins the area in memory across the reload, and
// the read-back is POLLED, not slept for.
const keeper = await ctx.newPage();
await keeper.goto(F);
await keeper.evaluate(() => localStorage.length);   // binds the storage area
await page.reload();
await page.waitForFunction(() => window.__kb?.S?.tutDone === true, null, { timeout: 8000 })
  .catch(() => { /* the check below names the failure */ });
// on red, the raw value rides along to say WHICH half broke: lost from
// storage across the reload vs present but not read back by boot
out.afterGrad = await page.evaluate(() => ({
  tutDone: window.__kb.S.tutDone,
  ...(window.__kb.S.tutDone ? {} : { raw: localStorage.getItem('knucklebones.v1') }),
}));
await keeper.close();
check(out.afterGrad.tutDone, 'tutorial completion did not persist', out.afterGrad);

console.log(JSON.stringify({ out, problems, errs }, null, 2));
await browser.close();   // the server is in-process and unref'd — it goes with us
