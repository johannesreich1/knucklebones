import pkg from 'playwright';
const { chromium, devices } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones-neon.html';
const browser = await chromium.launch();
const problems = [], errs = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };
const ROT = t => t === 'matrix(-1, 0, 0, -1, 0, 0)';   // computed rotate(180deg)

const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await page.goto(F); await page.waitForTimeout(500);

// ===== A. the seating option =====
out.seatHiddenCpu = await page.evaluate(() => document.getElementById('seatCard').hidden);
await page.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
await page.tap('#modeSeg button[data-m="duo"]'); await page.waitForTimeout(250);
out.seatShownDuo = await page.evaluate(() => ({
  shown: !document.getElementById('seatCard').hidden,
  onBtn: document.querySelector('#seatSeg button.on')?.dataset.seat,
}));
check(out.seatHiddenCpu && out.seatShownDuo.shown && out.seatShownDuo.onBtn === 'pass',
      'seat card visibility/default wrong', out);
await page.tap('#seatSeg button[data-seat="face"]'); await page.waitForTimeout(250);
out.note = await page.evaluate(() => document.getElementById('duoNote').textContent);
check(/flat between you/.test(out.note), 'duo note not updated for face mode', out.note);

// ===== B. a face-to-face game =====
await page.tap('#btnPlay'); await page.waitForTimeout(800);
const snap = () => page.evaluate(() => ({
  phase: window.__kb.S.phase, turn: window.__kb.S.turn, bottom: window.__kb.S.bottom,
  pass: document.getElementById('ovPass').classList.contains('on'),
  end: document.getElementById('ovEnd').classList.contains('on'),
  face: document.documentElement.classList.contains('face'),
  p2turn: document.documentElement.classList.contains('p2turn'),
  topIdle: document.getElementById('sideTop').classList.contains('idle'),
  botIdle: document.getElementById('sideBot').classList.contains('idle'),
  b0: window.__kb.S.boards[0], b1: window.__kb.S.boards[1],
}));

// rotations of the top half's readable parts
out.rot = await page.evaluate(() => ({
  plateTop: getComputedStyle(document.getElementById('plateTop')).transform,
  plateBot: getComputedStyle(document.getElementById('plateBot')).transform,
  chipTop: getComputedStyle(document.querySelector('#topCols .chip')).transform,
  numTop: getComputedStyle(document.querySelector('#topBoard .die .num') || document.createElement('i')).transform,
}));
check(ROT(out.rot.plateTop), 'top plate not rotated for facing player', out.rot);
check(out.rot.plateBot === 'none', 'bottom plate wrongly rotated', out.rot);
check(ROT(out.rot.chipTop), 'top chips not rotated', out.rot);

// geometry: facing columns still physically aligned
out.aligned = await page.evaluate(() => [0, 1, 2].every(c => {
  const a = document.querySelector(`#topBoard .col[data-col="${c}"]`).getBoundingClientRect();
  const b = document.querySelector(`#botBoard .col[data-col="${c}"]`).getBoundingClientRect();
  return Math.abs((a.left + a.width / 2) - (b.left + b.width / 2)) < 2;
}));
check(out.aligned, 'facing columns misaligned in face mode', out.aligned);

// play a full game: each player taps their OWN half, no pass card ever
let p2Placed = 0, sawPass = false, bottomMoved = false, turnChecks = [];
for (let i = 0; i < 1200; i++) {  // generous on purpose: random endgames + slow machines (see test6)
  const s = await snap();
  if (s.pass) sawPass = true;
  if (s.bottom !== 1) bottomMoved = true;
  if (s.end || s.phase === 'over') break;
  if (s.phase === 'choose') {
    // turn indication must match the mover
    const stage = await page.evaluate(() => getComputedStyle(document.getElementById('dieStage')).transform);
    if (s.turn === 0) turnChecks.push(s.p2turn && s.botIdle && !s.topIdle && ROT(stage) ? 'p2ok' : 'p2BAD:' + JSON.stringify({ s, stage }));
    else turnChecks.push(!s.p2turn && s.topIdle && !s.botIdle && stage === 'none' ? 'p1ok' : 'p1BAD:' + JSON.stringify({ s, stage }));
    const board = s.turn === 0 ? s.b0 : s.b1;
    const lg = board.map((c, j) => c.length < 3 ? j : -1).filter(j => j >= 0);
    const pick = lg[(Math.random() * lg.length) | 0];
    await page.tap(`#${s.turn === 0 ? 'top' : 'bot'}Board .col[data-col="${pick}"]`);
    if (s.turn === 0) p2Placed++;
  }
  await page.waitForTimeout(100);
}
await page.waitForTimeout(1600);
out.game = {
  sawPass, bottomMoved, p2Placed,
  badTurns: turnChecks.filter(t => t.includes('BAD')).slice(0, 2),
  end: await page.evaluate(() => ({
    shown: document.getElementById('ovEnd').classList.contains('on'),
    you: +document.getElementById('endYou').textContent,
    cpu: +document.getElementById('endCpu').textContent,
    realP1: window.__kb.boardTotal(window.__kb.S.boards[1]),
    realP2: window.__kb.boardTotal(window.__kb.S.boards[0]),
  })),
};
check(!sawPass, 'pass card appeared in face mode', out.game);
check(!bottomMoved, 'halves swapped in face mode', out.game);
check(p2Placed >= 3, 'player 2 could not place on the top board', out.game);
check(out.game.badTurns.length === 0, 'turn indication wrong', out.game.badTurns);
check(out.game.end.shown && out.game.end.you === out.game.end.realP1 && out.game.end.cpu === out.game.end.realP2,
      'face game did not finish cleanly', out.game.end);

// ===== C. resume keeps the seating =====
await page.tap('#btnAgain'); await page.waitForTimeout(900);
for (let i = 0; i < 60; i++) {
  const s = await snap();
  if (s.phase === 'choose') {
    const board = s.turn === 0 ? s.b0 : s.b1;
    const lg = board.map((c, j) => c.length < 3 ? j : -1).filter(j => j >= 0);
    await page.tap(`#${s.turn === 0 ? 'top' : 'bot'}Board .col[data-col="${lg[0]}"]`);
    if ((s.turn === 0 ? s.b0 : s.b1).flat().length >= 0 && i > 8) break;
  }
  await page.waitForTimeout(150);
}
await page.waitForTimeout(800);
await page.reload(); await page.waitForTimeout(700);
const resumeShown = await page.evaluate(() => !document.getElementById('btnResume').hidden);
check(resumeShown, 'no resume offered for face game', resumeShown);
await page.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
await page.tap('#btnResume'); await page.waitForTimeout(1000);
out.resumed = await page.evaluate(() => ({
  seat: window.__kb.S.seat, bottom: window.__kb.S.bottom,
  face: document.documentElement.classList.contains('face'),
  pass: document.getElementById('ovPass').classList.contains('on'),
}));
check(out.resumed.seat === 'face' && out.resumed.bottom === 1 && out.resumed.face && !out.resumed.pass,
      'resume lost the seating', out.resumed);

// ===== D. pass mode still works after switching back =====
await page.tap('#btnSettings'); await page.waitForTimeout(300); await page.tap('#btnMenu'); await page.waitForTimeout(400);
await page.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
await page.tap('#seatSeg button[data-seat="pass"]'); await page.waitForTimeout(200);
await page.tap('#btnPlay'); await page.waitForTimeout(900);
let sawPassCard = false;
for (let i = 0; i < 120; i++) {
  const s = await snap();
  if (s.pass) { sawPassCard = true; break; }
  if (s.phase === 'choose') {
    const board = s.turn === 0 ? s.b0 : s.b1;
    const lg = board.map((c, j) => c.length < 3 ? j : -1).filter(j => j >= 0);
    await page.tap(`#botBoard .col[data-col="${lg[0]}"]`);   // pass mode: active is on the bottom
  }
  await page.waitForTimeout(120);
}
out.passModeBack = { sawPassCard, faceClass: await page.evaluate(() => document.documentElement.classList.contains('face')) };
check(sawPassCard && !out.passModeBack.faceClass, 'pass mode broken after face mode', out.passModeBack);
const quitVia = await page.evaluate(() => document.getElementById('ovPass').classList.contains('on'));
if (quitVia) { await page.tap('#passQuit'); } else { await page.tap('#btnSettings'); await page.waitForTimeout(300); await page.tap('#btnMenu'); } await page.waitForTimeout(400);

// ===== E. small screen: duo title with 3 cards must stay reachable =====
const small = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true });
const sp = await small.newPage();
sp.on('pageerror', e => errs.push('SMALL: ' + e.message));
await sp.goto(F); await sp.waitForTimeout(400);
await sp.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
await sp.tap('#modeSeg button[data-m="duo"]'); await sp.waitForTimeout(300);
out.small = await sp.evaluate(() => {
  const ov = document.getElementById('ovStart');
  return { scrollable: ov.scrollHeight > ov.clientHeight, sh: ov.scrollHeight, ch: ov.clientHeight };
});
await sp.evaluate(() => window.__kb.goHome());
await sp.tap('#btnHow'); await sp.waitForTimeout(400);     // bottom button reachable (auto-scrolls)
const rulesOpened = await sp.evaluate(() => document.getElementById('ovRules').classList.contains('on'));
check(rulesOpened, 'bottom title button unreachable on small screen', out.small);
out.small.rulesOpened = rulesOpened;

console.log(JSON.stringify({ out, problems, errs }, null, 2));
await browser.close();
