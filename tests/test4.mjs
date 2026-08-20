import pkg from 'playwright';
const { chromium, devices } = pkg;
const browser = await chromium.launch();
const errs = [];
const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
await ctx.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });   // an experienced player: the first-run tutorial offer is test19's subject
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await page.goto('file://' + process.cwd() + '/knucklebones-neon.html');
await page.waitForTimeout(400);

const snap = () => page.evaluate(() => {
  const k = window.__kb, S = k.S;
  const owner = s => +document.getElementById(s).dataset.owner;
  const diceOn = side => [...document.querySelectorAll('#' + side + 'Board .die')].map(d => +d.dataset.v);
  return {
    phase: S.phase, turn: S.turn, bottom: S.bottom, mode: S.mode,
    b0: S.boards[0], b1: S.boards[1],
    ownerTop: owner('sideTop'), ownerBot: owner('sideBot'),
    domTop: diceOn('top').length, domBot: diceOn('bot').length,
    passOn: document.getElementById('ovPass').classList.contains('on'),
    endOn: document.getElementById('ovEnd').classList.contains('on'),
    nameTop: document.getElementById('nameTop').textContent,
    nameBot: document.getElementById('nameBot').textContent,
    totTop: document.getElementById('totTop').textContent,
    totBot: document.getElementById('totBot').textContent,
    // colour classes must follow the PLAYER, not the half of the screen
    p1DiceInTop: document.querySelectorAll('#topBoard .die.p1').length,
    p2DiceInTop: document.querySelectorAll('#topBoard .die.p2').length,
    p1DiceInBot: document.querySelectorAll('#botBoard .die.p1').length,
    p2DiceInBot: document.querySelectorAll('#botBoard .die.p2').length,
  };
});

const problems = [];
function check(cond, msg, ctx) { if (!cond) problems.push(msg + ' :: ' + JSON.stringify(ctx)); }

function audit(s, where) {
  // 1. the half a player occupies must hold exactly that player's dice
  const topWho = s.ownerTop, botWho = s.ownerBot;
  check(topWho !== botWho, where + ': both halves claim the same owner', s);
  const topCount = (topWho === 0 ? s.b0 : s.b1).flat().length;
  const botCount = (botWho === 0 ? s.b0 : s.b1).flat().length;
  check(s.domTop === topCount, where + ': top DOM dice != owner state', { dom: s.domTop, state: topCount, ...s });
  check(s.domBot === botCount, where + ': bot DOM dice != owner state', { dom: s.domBot, state: botCount, ...s });
  // 2. colour class follows identity: player 1 dice are .p1 wherever they are
  const p1Where = topWho === 1 ? 'top' : 'bot';
  check((p1Where === 'top' ? s.p2DiceInTop : s.p2DiceInBot) === 0, where + ': p2-coloured dice on p1 board', s);
  check((p1Where === 'top' ? s.p1DiceInBot : s.p1DiceInTop) === 0, where + ': p1-coloured dice on p2 board', s);
  // 3. totals shown next to each half belong to that half's owner
  const tot = w => (w === 0 ? s.b0 : s.b1).reduce((a, c) => {
    const m = {}; c.forEach(v => m[v] = (m[v] || 0) + 1);
    return a + Object.entries(m).reduce((x, [v, k]) => x + (+v) * k * k, 0);
  }, 0);
  check(+s.totTop === tot(topWho), where + ': top total mismatch', { shown: s.totTop, real: tot(topWho), ...s });
  check(+s.totBot === tot(botWho), where + ': bot total mismatch', { shown: s.totBot, real: tot(botWho), ...s });
  // 4. in duo mode, while choosing, the active player must be on the bottom
  if (s.mode === 'duo' && s.phase === 'choose') check(s.turn === s.bottom, where + ': active player not on bottom', s);
}

// ================= DUO GAME =================
await page.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
await page.click('#modeSeg button[data-m="duo"]');
const diffHidden = await page.evaluate(() => document.getElementById('diffCard').hidden &&
  getComputedStyle(document.getElementById('diffCard')).display === 'none');
await page.click('#btnPlay');
await page.waitForTimeout(900);

let handoffs = 0, placements = 0, seenBottoms = new Set();
for (let i = 0; i < 1200; i++) {  // generous on purpose: random endgames + slow machines (see test6)
  const s = await snap();
  audit(s, 'duo#' + i);
  seenBottoms.add(s.bottom);
  if (s.endOn || s.phase === 'over') break;
  if (s.passOn) {
    handoffs++;
    await page.click('#ovPass');
    await page.waitForTimeout(260);
    const after = await snap();
    audit(after, 'postpass#' + i);
    check(after.bottom === after.turn, 'hand-off did not move active player to bottom', after);
    check(after.nameBot === window_name(after.bottom), 'bottom nameplate wrong after pass', after);
    continue;
  }
  if (s.phase === 'choose') {
    const who = s.turn;
    const board = who === 0 ? s.b0 : s.b1;
    const legal = board.map((c, j) => c.length < 3 ? j : -1).filter(j => j >= 0);
    check(legal.length > 0, 'no legal column while choosing', s);
    const pick = legal[(Math.random() * legal.length) | 0];
    // must tap the BOTTOM board (active player's half)
    await page.click(`#botBoard .col[data-col="${pick}"]`, { force: true });
    placements++;
  }
  await page.waitForTimeout(95);
}
function window_name(w) { return w === 1 ? 'PLAYER 1' : 'PLAYER 2'; }

await page.waitForTimeout(1800);
const duoEnd = await page.evaluate(() => ({
  shown: document.getElementById('ovEnd').classList.contains('on'),
  title: document.getElementById('endTitle').textContent,
  cls: document.getElementById('endTitle').className,
  you: +document.getElementById('endYou').textContent,
  cpu: +document.getElementById('endCpu').textContent,
  realP1: window.__kb.boardTotal(window.__kb.S.boards[1]),
  realP2: window.__kb.boardTotal(window.__kb.S.boards[0]),
  rec: document.getElementById('rec').textContent.trim(),
  endRec: document.getElementById('endMeta').textContent.trim(),
  someoneFull: window.__kb.isFull(window.__kb.S.boards[0]) || window.__kb.isFull(window.__kb.S.boards[1]),
}));
await page.screenshot({ path: './duo-end.png' });

// ---- a tap on the OPPONENT's half must do nothing ----
await page.click('#btnAgain'); await page.waitForTimeout(1100);
let guard = 0;
while (guard++ < 60) { const s = await snap(); if (s.passOn) { await page.click('#ovPass'); await page.waitForTimeout(250); } else if (s.phase === 'choose') break; await page.waitForTimeout(100); }
const beforeIllegal = await snap();
await page.click('#topBoard .col[data-col="0"]', { force: true });
await page.waitForTimeout(500);
const afterIllegal = await snap();
check(JSON.stringify(beforeIllegal.b0) === JSON.stringify(afterIllegal.b0) &&
  JSON.stringify(beforeIllegal.b1) === JSON.stringify(afterIllegal.b1),
  'tapping the far half changed the board', { beforeIllegal, afterIllegal });
await page.screenshot({ path: './duo-mid.png' });

// ================= CPU MODE REGRESSION =================
await page.click('#btnLeave'); await page.waitForTimeout(300); await page.click('#btnQuitYes'); await page.waitForTimeout(400);
await page.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
await page.click('#modeSeg button[data-m="cpu"]');
await page.waitForTimeout(200);
const diffBack = await page.evaluate(() => !document.getElementById('diffCard').hidden);
await page.click('#btnPlay'); await page.waitForTimeout(900);
let cpuTurns = 0;
for (let i = 0; i < 1200; i++) {  // generous on purpose: random endgames + slow machines (see test6)
  const s = await snap();
  audit(s, 'cpu#' + i);
  check(!s.passOn, 'pass card appeared in CPU mode', s);
  check(s.bottom === 1, 'CPU mode moved the player off the bottom', s);
  if (s.endOn || s.phase === 'over') break;
  if (s.phase === 'choose' && s.turn === 1) {
    const legal = s.b1.map((c, j) => c.length < 3 ? j : -1).filter(j => j >= 0);
    await page.click(`#botBoard .col[data-col="${legal[(Math.random() * legal.length) | 0]}"]`, { force: true });
    cpuTurns++;
  }
  await page.waitForTimeout(95);
}
await page.waitForTimeout(1800);
const cpuEnd = await page.evaluate(() => ({
  shown: document.getElementById('ovEnd').classList.contains('on'),
  title: document.getElementById('endTitle').textContent,
  rec: document.getElementById('rec').textContent.trim(),
  you: +document.getElementById('endYou').textContent, cpu: +document.getElementById('endCpu').textContent,
  realYou: window.__kb.boardTotal(window.__kb.S.boards[1]), realCpu: window.__kb.boardTotal(window.__kb.S.boards[0]),
  nameTop: document.getElementById('nameTop').textContent,
  tagShown: !document.getElementById('tagTop').hidden,
}));

console.log(JSON.stringify({
  diffHidden, diffBack,
  duo: { handoffs, placements, bottomsSeen: [...seenBottoms], end: duoEnd },
  cpu: { turns: cpuTurns, end: cpuEnd },
  problems, errs
}, null, 2));
await browser.close();
