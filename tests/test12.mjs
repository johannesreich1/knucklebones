import pkg from 'playwright';
const { chromium, devices } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones-neon.html';
const browser = await chromium.launch();
const problems = [], errs = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };
const ROT = t => t === 'matrix(-1, 0, 0, -1, 0, 0)';   // computed rotate(180deg)

const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true,
  locale: 'en-US' });
await ctx.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });   // an experienced player: the first-run tutorial offer is test19's subject
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

// ===== B. a face-to-face game =====
await page.tap('#btnPlay'); await page.waitForTimeout(800);
const snap = () => page.evaluate(() => ({
  phase: window.__kb.S.phase, turn: window.__kb.S.turn, bottom: window.__kb.S.bottom,
  pass: document.getElementById('ovPass').classList.contains('on'),
  end: document.getElementById('ovEnd').classList.contains('on'),
  face: document.getElementById('kbroot').classList.contains('face'),
  p2turn: document.getElementById('kbroot').classList.contains('p2turn'),
  topIdle: document.getElementById('sideTop').classList.contains('idle'),
  botIdle: document.getElementById('sideBot').classList.contains('idle'),
  b0: window.__kb.S.boards[0], b1: window.__kb.S.boards[1],
}));

/* rotations of the top half's readable parts. The plate turns by its PARTS,
   never by its own box: transforming the box would make it the containing
   block for the absolutely-positioned score cluster inside it (see the
   nameplate geometry check below), so what must read upside-down here is the
   name and the points — and what must NOT be transformed is the plate. */
out.rot = await page.evaluate(() => ({
  plateTop: getComputedStyle(document.getElementById('plateTop')).transform,
  whoTop: getComputedStyle(document.querySelector('#plateTop .who')).transform,
  whoBot: getComputedStyle(document.querySelector('#plateBot .who')).transform,
  plateBot: getComputedStyle(document.getElementById('plateBot')).transform,
  chipTop: getComputedStyle(document.querySelector('#topCols .chip')).transform,
  numTop: getComputedStyle(document.querySelector('#topBoard .die .num') || document.createElement('i')).transform,
}));
check(ROT(out.rot.whoTop), 'the far player\'s name is not turned toward them', out.rot);
check(out.rot.whoBot === 'none', 'the near player\'s name is wrongly turned', out.rot);
check(out.rot.plateTop === 'none',
  'THE PLATE BOX IS TRANSFORMED — it becomes the containing block for its score cluster', out.rot);
check(out.rot.plateBot === 'none', 'bottom plate wrongly rotated', out.rot);
check(ROT(out.rot.chipTop), 'top chips not rotated', out.rot);

// geometry: facing columns still physically aligned
out.aligned = await page.evaluate(() => [0, 1, 2].every(c => {
  const a = document.querySelector(`#topBoard .col[data-col="${c}"]`).getBoundingClientRect();
  const b = document.querySelector(`#botBoard .col[data-col="${c}"]`).getBoundingClientRect();
  return Math.abs((a.left + a.width / 2) - (b.left + b.width / 2)) < 2;
}));
check(out.aligned, 'facing columns misaligned in face mode', out.aligned);

/* BOTH NAMEPLATES OBEY THE SAME GEOMETRY. The far half turns for the player
   opposite, and turning it by transforming the PLATE made that plate the
   containing block for its absolutely-positioned score cluster — so the far
   player's points and rune stopped resolving against the side and landed in
   the top-left corner instead of the gutter (measured x=10,y=31 against the
   near seat's x=333,y=186), and moved whenever the plate's own box changed
   (user report). The turn belongs to the plate's PARTS, never its box. */
out.plates = await page.evaluate(() => {
  const seen = {};
  for (const half of ['Top', 'Bot']) {
    const pr = document.querySelector(`#plate${half} .pright`);
    const side = document.getElementById('side' + half);
    const r = pr.getBoundingClientRect(), sr = side.getBoundingClientRect();
    seen[half] = { anchor: pr.offsetParent?.id || 'none',
      fromRight: +(sr.right - r.right).toFixed(1),
      onScreen: r.x >= -0.5 && r.right <= window.innerWidth + 0.5,
      turned: /matrix\(-1/.test(getComputedStyle(pr).transform) };
  }
  return seen;
});
check(out.plates.Top.anchor === 'sideTop' && out.plates.Bot.anchor === 'sideBot',
  'A NAMEPLATE CLUSTER IS ANCHORED TO ITS PLATE, NOT ITS SIDE', out.plates);
check(Math.abs(out.plates.Top.fromRight - out.plates.Bot.fromRight) < 1.5,
  'the two seats place their points differently in face mode', out.plates);
check(out.plates.Top.onScreen && out.plates.Bot.onScreen,
  'a nameplate cluster left the screen in face mode', out.plates);
check(out.plates.Top.turned && !out.plates.Bot.turned,
  'the far seat must turn its points for the player opposite, the near one must not', out.plates);

// The JS that rotates score floats must ask the SAME question the CSS asks —
// #kbroot.face — not re-derive it from S.mode/S.seat. Online sets S.mode='duo'
// for input gating and clears the class, so a re-derived predicate printed every
// ranked +points upside down for anyone whose local seating was face-to-face.
out.faceSrc = await page.evaluate(() => {
  const k = window.__kb, root = document.getElementById('kbroot');
  const seated = { css: root.classList.contains('face'), js: k.faceRotated(0) };
  root.classList.remove('face');                 // exactly what enterMatch() does
  const online = { css: root.classList.contains('face'), js: k.faceRotated(0) };
  root.classList.toggle('face', seated.css);     // put it back
  return { seated, online, settingsStillFace: k.S.seat === 'face' && k.S.mode === 'duo' };
});
check(out.faceSrc.seated.js, 'face seating no longer rotates the far half', out.faceSrc);
check(out.faceSrc.settingsStillFace && !out.faceSrc.online.js,
      'score floats rotate off a stale local setting instead of #kbroot.face', out.faceSrc);

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

// ===== C. play again keeps the face seating (also sets up D's live game) =====
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
out.faceReplay = await page.evaluate(() => ({
  seat: window.__kb.S.seat, bottom: window.__kb.S.bottom,
  face: document.getElementById('kbroot').classList.contains('face'),
}));
check(out.faceReplay.seat === 'face' && out.faceReplay.bottom === 1 && out.faceReplay.face,
      'play again lost the face seating', out.faceReplay);

// ===== D. pass mode still works after switching back =====
await page.tap('#btnLeave'); await page.waitForTimeout(300); await page.tap('#btnAskYes'); await page.waitForTimeout(400);
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
out.passModeBack = await page.evaluate((sawPassCard) => ({
  sawPassCard,
  faceClass: document.getElementById('kbroot').classList.contains('face'),
  handoffVisible: document.getElementById('ovPass').classList.contains('on'),
  passQuitAbsent: document.getElementById('passQuit') === null,
  controls: document.querySelectorAll('#ovPass button').length,
}), sawPassCard);
check(sawPassCard && !out.passModeBack.faceClass, 'pass mode broken after face mode', out.passModeBack);
check(out.passModeBack.passQuitAbsent && out.passModeBack.controls === 0,
      'pass hand-off still has a corner control', out.passModeBack);
if (out.passModeBack.handoffVisible) {
  await page.tap('#ovPass');
  await page.waitForFunction(() => document.getElementById('ovPass').classList.contains('on') === false
    && window.__kb.S.phase !== 'pass', null, { timeout: 3000 }).catch(() => {});
}
out.passModeBack.afterTap = await page.evaluate(() => ({
  handoffVisible: document.getElementById('ovPass').classList.contains('on'),
  phase: window.__kb.S.phase,
}));
check(out.passModeBack.handoffVisible && !out.passModeBack.afterTap.handoffVisible
      && out.passModeBack.afterTap.phase !== 'pass',
      'tapping the pass hand-off did not advance to the board', out.passModeBack);
await page.tap('#btnLeave'); await page.waitForTimeout(300); await page.tap('#btnAskYes'); await page.waitForTimeout(400);

// ===== E. small screen: duo title with 3 cards must stay reachable =====
const small = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true,
  isMobile: true, locale: 'en-US' });
await small.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });   // an experienced player: the first-run tutorial offer is test19's subject
const sp = await small.newPage();
sp.on('pageerror', e => errs.push('SMALL: ' + e.message));
await sp.goto(F); await sp.waitForTimeout(400);
await sp.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
await sp.tap('#modeSeg button[data-m="duo"]'); await sp.waitForTimeout(300);
/* What matters is that the LAST thing on home can be tapped on the smallest
   screen — by scrolling to it or by it simply fitting. It used to require a
   scroll; since the foot was pinned to the bottom the column fits, so asserting
   "scrollable" would now be asserting the old layout rather than the goal. */
out.small = await sp.evaluate(() => {
  const ov = document.getElementById('ovStart');
  const b = document.getElementById('btnImprint').getBoundingClientRect();
  return { scrollable: ov.scrollHeight > ov.clientHeight, sh: ov.scrollHeight, ch: ov.clientHeight,
           lastVisible: b.bottom <= innerHeight + 1 && b.top >= 0 };
});
await sp.evaluate(() => window.__kb.goHome());
await sp.tap('#btnImprint'); await sp.waitForTimeout(400);
const legalOpened = await sp.evaluate(() => document.getElementById('ovImprint').classList.contains('on'));
check(legalOpened, 'the last button on home is unreachable on a small screen', out.small);
out.small.legalOpened = legalOpened;
/* ...and it is a PAGE, not a sheet (user call, 2026-08-22): reached from Home
   and returning there, so it wears Home's ‹ and carries no bottom dismissal.
   test17 §nav holds the general rule; this holds the door it came through. */
out.legalPage = await sp.evaluate(() => {
  const head = document.querySelector('#ovImprint .shead');
  return { back: document.querySelector('#ovImprint #btnImprintBack')?.textContent ?? '',
           first: head.firstElementChild.id,
           gotIt: [...document.querySelectorAll('#ovImprint .btn')].map((b) => b.textContent.trim()) };
});
check(out.legalPage.back === '\u2039' && out.legalPage.first === 'btnImprintBack',
      'Impressum is not a page: its ‹ is missing or not on the left', out.legalPage);
check(out.legalPage.gotIt.length === 0,
      'Impressum still carries a bottom dismissal — the bottom of a screen is actions only', out.legalPage);
await sp.tap('#btnImprintBack'); await sp.waitForTimeout(300);
out.legalPage.closed = await sp.evaluate(() => !document.getElementById('ovImprint').classList.contains('on')
                                            && document.getElementById('ovStart').classList.contains('on'));
check(out.legalPage.closed, 'Impressum\u2019s ‹ did not return to Home', out.legalPage);

console.log(JSON.stringify({ out, problems, errs }, null, 2));
await browser.close();
