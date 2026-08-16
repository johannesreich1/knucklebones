import pkg from 'playwright';
const { chromium, devices } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones-neon.html';
const browser = await chromium.launch();
const problems = [], errs = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
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
  colsMargin: getComputedStyle(document.querySelector('#botCols')).marginTop,
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
// fresh state: tutorial should be the primary button
out.freshPrimary = await page.evaluate(() => ({
  tut: document.getElementById('btnTut').classList.contains('primary'),
  play: document.getElementById('btnPlay').classList.contains('primary'),
}));
check(out.freshPrimary.tut && !out.freshPrimary.play, 'tutorial not primary on first launch', out.freshPrimary);

await page.tap('#btnPlay'); await page.waitForTimeout(1500);
let s = await waitChoose();
out.cpuNormal = { pills: s.pills, danger: s.danger, legal: s.legal, colsMargin: s.colsMargin };
check(s.pills === 0, 'gain/kill pills shown in normal CPU play', s);
check(s.danger === 0, 'danger outline shown in normal CPU play', s);
check(s.legal === 3, 'legal affordance missing in normal play', s);
check(s.colsMargin === '4px', 'pill lane space not reclaimed in normal play', s);

// duo: same check
await page.tap('#btnMenu'); await page.waitForTimeout(400);
await page.tap('#modeSeg button[data-m="duo"]'); await page.waitForTimeout(200);
await page.tap('#btnPlay'); await page.waitForTimeout(1400);
s = await waitChoose();
out.duoNormal = { pills: s.pills, danger: s.danger };
check(s.pills === 0 && s.danger === 0, 'previews shown in duo play', s);
const quitVia = await page.evaluate(() => document.getElementById('ovPass').classList.contains('on'));
await page.tap(quitVia ? '#passQuit' : '#btnMenu'); await page.waitForTimeout(400);
await page.tap('#modeSeg button[data-m="cpu"]'); await page.waitForTimeout(200);

// ===================== B. THE TUTORIAL, WALKED END TO END =====================
await page.tap('#btnTut'); await page.waitForTimeout(500);
s = await snap();
check(s.coach && /Welcome/.test(s.coachMsg), 'welcome step missing', s);
check(s.colsMargin === '15px', 'tutorial pill lane not applied', s);
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
check(out.killPreview.kill.includes('−1') && out.killPreview.danger === 1, 'destruction preview missing', out.killPreview);

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
  endRec: document.getElementById('endRec').textContent,
  sub: document.getElementById('endSub').textContent,
  rec: document.getElementById('rec').textContent.trim(),
  stats: (() => { const k = window.__kb.S; return k.wins + k.losses + k.draws + k.p1 + k.p2; })(),
  best: window.__kb.S.best,
  tutDone: window.__kb.S.tutDone,
  tutCleared: !window.__kb.S.tut,
  gameSave: localStorage.getItem('knucklebones.game.v1'),
}));
check(out.end.shown && out.end.endRec === 'TUTORIAL COMPLETE', 'tutorial end screen wrong', out.end);
check(out.end.stats === 0 && out.end.best === 0, 'tutorial polluted the record', out.end);
check(out.end.tutDone && out.end.tutCleared, 'tutorial completion state wrong', out.end);
check(!out.end.gameSave, 'tutorial left a resumable save', out.end);

// after graduating, Play is primary again and previews stay off
await page.reload(); await page.waitForTimeout(600);
out.afterGrad = await page.evaluate(() => ({
  tutPrimary: document.getElementById('btnTut').classList.contains('primary'),
  playPrimary: document.getElementById('btnPlay').classList.contains('primary'),
  tutDone: window.__kb.S.tutDone,
}));
check(!out.afterGrad.tutPrimary && out.afterGrad.playPrimary && out.afterGrad.tutDone,
      'post-tutorial button priority wrong', out.afterGrad);

// ===================== C. TUTORIAL MUST NOT EAT A REAL SAVED GAME =====================
await page.tap('#btnPlay'); await page.waitForTimeout(1600);
s = await waitChoose();
await page.tap(`#botBoard .col[data-col="0"]`); await page.waitForTimeout(1500);
await waitChoose();                                        // roll saved with the game
const savedBefore = await page.evaluate(() => localStorage.getItem('knucklebones.game.v1'));
check(!!savedBefore, 'no save to protect', {});
await page.tap('#btnMenu'); await page.waitForTimeout(400);
await page.tap('#btnTut'); await page.waitForTimeout(500); // welcome card up
await page.tap('#coach');
s = await waitChoose();
await page.tap('#botBoard .col[data-col="0"]'); await page.waitForTimeout(800);
const savedDuring = await page.evaluate(() => localStorage.getItem('knucklebones.game.v1'));
check(savedDuring === savedBefore, 'tutorial touched the real save', { savedBefore: !!savedBefore, savedDuring: !!savedDuring });
await page.tap('#btnMenu'); await page.waitForTimeout(500);
out.saveProtected = await page.evaluate(() => ({
  resumeShown: !document.getElementById('btnResume').hidden,
  label: document.getElementById('btnResume').textContent,
}));
check(out.saveProtected.resumeShown, 'resume lost after a tutorial detour', out.saveProtected);

console.log(JSON.stringify({ out, problems, errs }, null, 2));
await browser.close();
