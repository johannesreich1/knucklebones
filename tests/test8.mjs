import pkg from 'playwright';
const { chromium, devices } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones.html';
const browser = await chromium.launch();
const problems = [], errs = [];
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };
const out = {};

// ================= LANDSCAPE =================
const land = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const lp = await land.newPage();
lp.on('pageerror', e => errs.push('LAND: ' + e.message));
await lp.goto(F); await lp.waitForTimeout(500);
await lp.tap('#btnPlay'); await lp.waitForTimeout(2400);
out.landscape = await lp.evaluate(() => {
  const r = e => document.getElementById(e).getBoundingClientRect();
  const app = r('app'), top = r('sideTop'), bot = r('sideBot'), hud = document.querySelector('.hud').getBoundingClientRect();
  const overlap = (a, b) => !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5);
  return {
    isLand: document.documentElement.classList.contains('land'),
    cell: getComputedStyle(document.documentElement).getPropertyValue('--cell').trim(),
    sidesOverlap: overlap(top, bot),
    topOverlapsHud: overlap(top, hud),
    botOverlapsHud: overlap(bot, hud),
    fitsVert: top.top >= -0.5 && bot.bottom <= window.innerHeight + 0.5 && top.bottom <= window.innerHeight + 0.5,
    fitsHoriz: top.left >= -0.5 && bot.right <= window.innerWidth + 0.5,
    scrollH: document.documentElement.scrollHeight, winH: window.innerHeight,
    scrollW: document.documentElement.scrollWidth, winW: window.innerWidth,
    // facing columns must share a horizontal band in landscape
    rowsAligned: [0, 1, 2].every(c => {
      const a = document.querySelector(`#topBoard .col[data-col="${c}"]`).getBoundingClientRect();
      const b = document.querySelector(`#botBoard .col[data-col="${c}"]`).getBoundingClientRect();
      return Math.abs(a.top - b.top) < 2;
    }),
  };
});
check(out.landscape.isLand, 'landscape class not applied', out.landscape);
check(!out.landscape.sidesOverlap, 'the two boards overlap in landscape', out.landscape);
check(!out.landscape.topOverlapsHud && !out.landscape.botOverlapsHud, 'a board overlaps the HUD in landscape', out.landscape);
check(out.landscape.fitsVert && out.landscape.fitsHoriz, 'landscape layout does not fit the screen', out.landscape);
check(out.landscape.scrollH <= out.landscape.winH + 1 && out.landscape.scrollW <= out.landscape.winW + 1, 'landscape scrolls', out.landscape);
check(out.landscape.rowsAligned, 'facing columns do not align in landscape', out.landscape);
await lp.screenshot({ path: './v2-landscape.png' });

// play a few moves in landscape to be sure it is usable, not just laid out
let placed = 0;
for (let i = 0; i < 60 && placed < 3; i++) {
  const s = await lp.evaluate(() => ({ p: window.__kb.S.phase, t: window.__kb.S.turn, b: window.__kb.S.boards[1] }));
  if (s.p === 'over') break;
  if (s.p === 'choose' && s.t === 1) {
    const lg = s.b.map((c, j) => c.length < 3 ? j : -1).filter(j => j >= 0);
    await lp.tap(`#botBoard .col[data-col="${lg[0]}"]`);
    placed++;
  }
  await lp.waitForTimeout(120);
}
out.landscapePlaced = placed;
check(placed === 3, 'could not place dice in landscape', { placed });

// rotate back to portrait mid-game: layout must recover
await lp.setViewportSize({ width: 390, height: 844 });
await lp.waitForTimeout(600);
out.rotateBack = await lp.evaluate(() => ({
  isLand: document.documentElement.classList.contains('land'),
  cell: getComputedStyle(document.documentElement).getPropertyValue('--cell').trim(),
  dom: document.querySelectorAll('.board .die').length,
  state: window.__kb.S.boards[0].flat().length + window.__kb.S.boards[1].flat().length,
  scrollH: document.documentElement.scrollHeight, winH: window.innerHeight,
}));
check(!out.rotateBack.isLand, 'still in landscape after rotating back', out.rotateBack);
check(out.rotateBack.dom === out.rotateBack.state, 'dice lost when rotating', out.rotateBack);
check(out.rotateBack.scrollH <= out.rotateBack.winH + 1, 'portrait scrolls after rotation', out.rotateBack);
await lp.screenshot({ path: './v2-rotated-back.png' });

// ================= RESUME =================
const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
const p = await ctx.newPage();
p.on('pageerror', e => errs.push('RESUME: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await p.goto(F); await p.waitForTimeout(400);
await p.tap('#btnPlay'); await p.waitForTimeout(2000);
for (let i = 0; i < 3; i++) {
  const s = await p.evaluate(() => ({ ph: window.__kb.S.phase, t: window.__kb.S.turn, b: window.__kb.S.boards[1] }));
  if (s.ph === 'choose' && s.t === 1) {
    const lg = s.b.map((c, j) => c.length < 3 ? j : -1).filter(j => j >= 0);
    await p.tap(`#botBoard .col[data-col="${lg[0]}"]`);
  }
  await p.waitForTimeout(1500);
}
// wait for the human's turn so a die is showing, then reload
for (let i = 0; i < 40; i++) {
  const s = await p.evaluate(() => ({ ph: window.__kb.S.phase, t: window.__kb.S.turn }));
  if (s.ph === 'choose' && s.t === 1) break;
  await p.waitForTimeout(150);
}
const beforeReload = await p.evaluate(() => ({
  boards: window.__kb.S.boards, die: window.__kb.S.die, turn: window.__kb.S.turn,
  dice: window.__kb.S.boards[0].flat().length + window.__kb.S.boards[1].flat().length,
}));
await p.reload(); await p.waitForTimeout(800);
const resumeUi = await p.evaluate(() => ({
  resumeShown: !document.getElementById('btnResume').hidden,
  resumeLabel: document.getElementById('btnResume').textContent,
  playLabel: document.getElementById('btnPlay').textContent,
}));
check(resumeUi.resumeShown, 'no resume button after reload', resumeUi);
await p.tap('#btnResume'); await p.waitForTimeout(1200);
const afterResume = await p.evaluate(() => ({
  boards: window.__kb.S.boards, die: window.__kb.S.die, turn: window.__kb.S.turn, phase: window.__kb.S.phase,
  dom: document.querySelectorAll('.board .die').length,
  state: window.__kb.S.boards[0].flat().length + window.__kb.S.boards[1].flat().length,
}));
check(JSON.stringify(afterResume.boards) === JSON.stringify(beforeReload.boards), 'board not restored', { beforeReload, afterResume });
check(afterResume.die === beforeReload.die, 'die changed across resume (reroll exploit)', { beforeReload, afterResume });
check(afterResume.dom === afterResume.state, 'restored board does not match DOM', afterResume);
out.resume = { beforeReload: { dice: beforeReload.dice, die: beforeReload.die }, resumeUi, afterResume: { die: afterResume.die, phase: afterResume.phase, dice: afterResume.state } };

// a finished game must not offer resume
for (let i = 0; i < 400; i++) {
  const s = await p.evaluate(() => ({ ph: window.__kb.S.phase, t: window.__kb.S.turn, b: window.__kb.S.boards[1] }));
  if (s.ph === 'over') break;
  if (s.ph === 'choose' && s.t === 1) {
    const lg = s.b.map((c, j) => c.length < 3 ? j : -1).filter(j => j >= 0);
    await p.tap(`#botBoard .col[data-col="${lg[(Math.random() * lg.length) | 0]}"]`);
  }
  await p.waitForTimeout(95);
}
await p.waitForTimeout(1500);
await p.reload(); await p.waitForTimeout(700);
out.afterFinish = await p.evaluate(() => ({
  resumeShown: !document.getElementById('btnResume').hidden,
  stored: localStorage.getItem('knucklebones.game.v1'),
  statLine: document.getElementById('statLine').textContent.trim(),
}));
check(!out.afterFinish.resumeShown && !out.afterFinish.stored, 'finished game still offers resume', out.afterFinish);

// corrupt save must be ignored, not crash
out.corrupt = await p.evaluate(() => {
  localStorage.setItem('knucklebones.game.v1', '{"boards":[[[9,9,9],[],[]],[[],[],[]]],"turn":1,"bottom":1,"mode":"cpu"}');
  let a = null; try { a = window.__kb.loadGame(); } catch (e) { return { threw: e.message }; }
  localStorage.setItem('knucklebones.game.v1', 'not json at all');
  let b = null; try { b = window.__kb.loadGame(); } catch (e) { return { threw: e.message }; }
  localStorage.removeItem('knucklebones.game.v1');
  return { badDice: a, badJson: b };
});
check(out.corrupt.badDice === null && out.corrupt.badJson === null, 'corrupt save not rejected', out.corrupt);

// ================= PLACE ON RELEASE =================
const g = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
const gp = await g.newPage();
gp.on('pageerror', e => errs.push('INPUT: ' + e.message));
await gp.goto(F); await gp.waitForTimeout(400);
await gp.tap('#btnPlay'); await gp.waitForTimeout(2200);
for (let i = 0; i < 40; i++) {
  const s = await gp.evaluate(() => ({ ph: window.__kb.S.phase, t: window.__kb.S.turn }));
  if (s.ph === 'choose' && s.t === 1) break;
  await gp.waitForTimeout(150);
}
const n0 = await gp.evaluate(() => window.__kb.S.boards[1].flat().length);
// press on column 0, slide onto the HUD, release: must NOT place
const box0 = await gp.locator('#botBoard .col[data-col="0"]').boundingBox();
const away = await gp.locator('.hud').boundingBox();
await gp.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
await gp.mouse.down();
await gp.waitForTimeout(80);
await gp.mouse.move(away.x + away.width / 2, away.y + away.height / 2, { steps: 6 });
await gp.mouse.up();
await gp.waitForTimeout(700);
const nCancel = await gp.evaluate(() => window.__kb.S.boards[1].flat().length);
check(nCancel === n0, 'sliding off the column still placed a die', { n0, nCancel });
// now a clean press+release on the same column: must place exactly one
await gp.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
await gp.mouse.down(); await gp.waitForTimeout(60); await gp.mouse.up();
await gp.waitForTimeout(1200);
const nPlaced = await gp.evaluate(() => window.__kb.S.boards[1].flat().length);
check(nPlaced === n0 + 1, 'clean press did not place exactly one die', { n0, nCancel, nPlaced });
out.input = { n0, nCancel, nPlaced };

// ================= ACCESSIBILITY =================
out.a11y = await gp.evaluate(() => ({
  colLabels: [...document.querySelectorAll('.col')].map(c => c.getAttribute('aria-label')).filter(Boolean).length,
  sampleCol: document.querySelector('#botBoard .col').getAttribute('aria-label'),
  diceLabelled: [...document.querySelectorAll('.board .die')].every(d => d.getAttribute('aria-label')),
  sampleDie: document.querySelector('.board .die') ? document.querySelector('.board .die').getAttribute('aria-label') : null,
  statusLive: document.getElementById('status').getAttribute('aria-live'),
  buttonsLabelled: [...document.querySelectorAll('.ico')].every(b => b.getAttribute('aria-label')),
}));
check(out.a11y.colLabels === 6, 'columns not all labelled', out.a11y);
check(out.a11y.diceLabelled, 'dice missing labels', out.a11y);
check(out.a11y.statusLive === 'polite', 'status not a live region', out.a11y);
check(out.a11y.buttonsLabelled, 'icon buttons unlabelled', out.a11y);

// numerals toggle, via the settings panel
await gp.tap('#btnSettings'); await gp.waitForTimeout(400);
await gp.tap('#faceSeg button[data-f="nums"]'); await gp.waitForTimeout(250);
await gp.tap('#btnCloseSettings'); await gp.waitForTimeout(400);
out.numerals = await gp.evaluate(() => {
  const d = document.querySelector('.board .die');
  return { on: document.documentElement.classList.contains('numerals'),
           numShown: d ? getComputedStyle(d.querySelector('.num')).display : null,
           pipHidden: d ? getComputedStyle(d.querySelector('.pip')).display : null,
           settingsClosed: !document.getElementById('ovSettings').classList.contains('on') };
});
check(out.numerals.on && out.numerals.numShown === 'flex' && out.numerals.pipHidden === 'none' && out.numerals.settingsClosed, 'numerals toggle broken', out.numerals);
await gp.screenshot({ path: './v2-numerals.png' });

// ================= REDUCED MOTION =================
const rm = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
const rp = await rm.newPage();
rp.on('pageerror', e => errs.push('RM: ' + e.message));
await rp.goto(F); await rp.waitForTimeout(400);
await rp.tap('#btnPlay'); await rp.waitForTimeout(2500);
out.reduced = await rp.evaluate(() => ({
  jsFlag: window.__kb.reduced,
  particlesAfterBurst: (window.__kb.burst(100, 100, '#fff', 20), document.querySelectorAll('#fx .particle').length),
  playable: window.__kb.S.phase,
}));
check(out.reduced.jsFlag === true, 'reduced-motion not detected in JS', out.reduced);
check(out.reduced.particlesAfterBurst === 0, 'particles still spawn under reduced motion', out.reduced);

console.log(JSON.stringify({ out, problems, errs }, null, 2));
await browser.close();
