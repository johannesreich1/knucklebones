import pkg from 'playwright';
const { chromium, devices } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones-neon.html';
const browser = await chromium.launch();
const problems = [], errs = [];
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };
const out = {};

// ================= LANDSCAPE =================
const land = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await land.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });   // an experienced player: the first-run tutorial offer is test19's subject
const lp = await land.newPage();
lp.on('pageerror', e => errs.push('LAND: ' + e.message));
await lp.goto(F); await lp.waitForTimeout(500);
await lp.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
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
await ctx.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });   // an experienced player: the first-run tutorial offer is test19's subject
const p = await ctx.newPage();
p.on('pageerror', e => errs.push('RESUME: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await p.goto(F); await p.waitForTimeout(400);
await p.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
await p.tap('#btnPlay'); await p.waitForTimeout(2000);
for (let i = 0; i < 3; i++) {
  const s = await p.evaluate(() => ({ ph: window.__kb.S.phase, t: window.__kb.S.turn, b: window.__kb.S.boards[1] }));
  if (s.ph === 'choose' && s.t === 1) {
    const lg = s.b.map((c, j) => c.length < 3 ? j : -1).filter(j => j >= 0);
    await p.tap(`#botBoard .col[data-col="${lg[0]}"]`);
  }
  await p.waitForTimeout(1500);
}
// ================= PLACE ON RELEASE =================
const g = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
await g.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });   // an experienced player: the first-run tutorial offer is test19's subject
const gp = await g.newPage();
gp.on('pageerror', e => errs.push('INPUT: ' + e.message));
await gp.goto(F); await gp.waitForTimeout(400);
// numerals is a HOME setting now — the in-game gear became the quit modal (test11)
await gp.tap('#btnSettingsHome'); await gp.waitForTimeout(400);
await gp.tap('#faceSeg button[data-f="nums"]'); await gp.waitForTimeout(250);
await gp.tap('#btnCloseSettings'); await gp.waitForTimeout(400);
const settingsClosed = await gp.evaluate(() => !document.getElementById('ovSettings').classList.contains('on'));
await gp.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
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

// numerals: toggled from home before the game — here we check the board obeys
out.numerals = await gp.evaluate(() => {
  const d = document.querySelector('.board .die');
  return { on: document.documentElement.classList.contains('numerals'),
           numShown: d ? getComputedStyle(d.querySelector('.num')).display : null,
           pipHidden: d ? getComputedStyle(d.querySelector('.pip')).display : null };
});
out.numerals.settingsClosed = settingsClosed;
check(out.numerals.on && out.numerals.numShown === 'flex' && out.numerals.pipHidden === 'none' && out.numerals.settingsClosed, 'numerals toggle broken', out.numerals);
// the LOADING die is exempt: it tells time in pips whatever the face setting
// says. Numerals once out-specified its chase (.numerals .die .pip is three
// classes, the chase rule was two) and every wait showed a blank square.
out.loaderNumerals = await gp.evaluate(() => {
  const d = window.__kb.loaderDie(24);
  document.body.appendChild(d);
  const pip = d.querySelector('.pip');
  const res = { pipDisplay: getComputedStyle(pip).display, pipOpacity: +getComputedStyle(pip).opacity,
                pipWidth: pip.getBoundingClientRect().width,
                numDisplay: getComputedStyle(d.querySelector('.num')).display };
  d.remove();
  return res;
});
check(out.loaderNumerals.pipDisplay !== 'none' && out.loaderNumerals.pipOpacity > 0.1
      && out.loaderNumerals.pipWidth > 0 && out.loaderNumerals.numDisplay === 'none',
      'the loading die obeys the numerals setting', out.loaderNumerals);
await gp.screenshot({ path: './v2-numerals.png' });

// ================= REDUCED MOTION =================
const rm = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
await rm.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });   // an experienced player: the first-run tutorial offer is test19's subject
const rp = await rm.newPage();
rp.on('pageerror', e => errs.push('RM: ' + e.message));
await rp.goto(F); await rp.waitForTimeout(400);
await rp.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
await rp.tap('#btnPlay'); await rp.waitForTimeout(2500);
out.reduced = await rp.evaluate(() => ({
  jsFlag: window.__kb.reduced,
  particlesAfterBurst: (window.__kb.burst(100, 100, '#fff', 20), document.querySelectorAll('#fx .particle').length),
  playable: window.__kb.S.phase,
}));
check(out.reduced.jsFlag === true, 'reduced-motion not detected in JS', out.reduced);
check(out.reduced.particlesAfterBurst === 0, 'particles still spawn under reduced motion', out.reduced);

// ================= SAFE AREAS (notched phones, PWA + native shell) =================
// fit() sizes the cell from #app.clientHeight, which INCLUDES #app's padding —
// and that padding carries the Dynamic Island and home-indicator strips. Counted
// as usable, the board grew until the near nameplate sat UNDER the home
// indicator: measured 9px under on a 390x844 iPhone, 10px on a 375x812. The cell
// cap hid it on the largest phones, which is why it survived so long.
const SAFE_DEVICES = [
  { w: 375, h: 812, top: 47, bottom: 34, name: 'iPhone X / 13 mini' },
  { w: 390, h: 844, top: 47, bottom: 34, name: 'iPhone 14 / 15 / 16' },
  { w: 440, h: 956, top: 62, bottom: 34, name: 'iPhone 17 Pro Max' },
];
out.safeAreas = [];
for (const d of SAFE_DEVICES) {
  const sc = await browser.newContext({ viewport: { width: d.w, height: d.h }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
await sc.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });   // an experienced player: the first-run tutorial offer is test19's subject
  const sp = await sc.newPage();
  sp.on('pageerror', e => errs.push('SAFE: ' + e.message));
  await sp.goto(F); await sp.waitForTimeout(400);
  await sp.evaluate(() => window.__kb.openPractice());
  await sp.tap('#btnPlay'); await sp.waitForTimeout(1500);
  const r = await sp.evaluate(([top, bottom, h]) => {
    // emulate the device insets the way iOS hands them to env(safe-area-inset-*)
    const app = document.getElementById('app');
    app.style.paddingTop = `calc(${top}px + 6px)`;
    app.style.paddingBottom = `calc(${bottom}px + 6px)`;
    window.__kb.fit();
    const hud = document.querySelector('.hud').getBoundingClientRect();
    const plate = document.getElementById('plateBot').getBoundingClientRect();
    return { cell: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell')),
             clearTop: +(hud.top - top).toFixed(1), clearBottom: +((h - bottom) - plate.bottom).toFixed(1) };
  }, [d.top, d.bottom, d.h]);
  out.safeAreas.push({ name: d.name, ...r });
  check(r.clearBottom >= 0, `${d.name}: board runs under the home indicator`, r);
  check(r.clearTop >= 0, `${d.name}: hud runs under the notch`, r);
  await sc.close();
}

console.log(JSON.stringify({ out, problems, errs }, null, 2));
await browser.close();
