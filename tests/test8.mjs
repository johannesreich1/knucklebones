import pkg from 'playwright';
const { chromium, devices } = pkg;
import { shot } from './shot.mjs';
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
await shot(lp, 'v2-landscape');

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

/* ===== THE LANDSCAPE SEATING =====
   Side by side, a plate has an OUTSIDE and an INSIDE. Three user reports, one
   shape: the name (and its hue dot) belongs on the outer edge, the score on
   the inner one facing the table, and the right board is the left board
   mirrored — not a copy of it. Read as geometry, because "the classes are
   right" was true the whole time the right plate read inward-out. */
out.seating = await lp.evaluate(() => {
  const x = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect().x : null; };
  return {
    left:  { side: x('#sideTop'), dot: x('#plateTop .dot'), name: x('#nameTop'), tot: x('#totTop') },
    right: { side: x('#sideBot'), dot: x('#plateBot .dot'), name: x('#nameBot'), tot: x('#totBot') },
    totW: document.querySelector('#totBot').getBoundingClientRect().width,
  };
});
check(out.seating.left.dot < out.seating.left.name && out.seating.left.name < out.seating.left.tot,
  'the LEFT plate is not name-outside / score-inside', out.seating.left);
check(out.seating.right.tot < out.seating.right.name && out.seating.right.name < out.seating.right.dot,
  'the RIGHT plate is not mirrored — its score must face the table and its dot sit outermost', out.seating.right);
check(out.seating.left.dot < out.seating.right.dot && out.seating.left.tot < out.seating.right.tot,
  'the two plates are not on the sides they belong to', out.seating);

/* ===== NOTHING MOVES ON A HANDOVER =====
   The status line empties between turns and rewords per seat, and the score
   grows a digit at 10 and at 100. While the centre lane and the score box
   sized themselves to that, both boards slid 2px sideways and the stage die
   5.8px up on every single turn — small enough to read as "the board is
   twitching" rather than as a layout bug (user report). Sampled THROUGH a real
   handover, because the drift is transient. */
const sampleBoxes = async () => {
  const seen = [];
  for (let i = 0; i < 12; i++) {
    seen.push(await lp.evaluate(() => {
      const r = (q) => { const e = document.querySelector(q); if (!e) return null;
        const b = e.getBoundingClientRect(); return [+b.x.toFixed(2), +b.y.toFixed(2), +b.width.toFixed(2)]; };
      return { top: r('#topBoard'), bot: r('#botBoard'), centre: r('.center'), stage: r('#dieStage'),
               txt: (document.querySelector('#status') || {}).textContent,
               tick: getComputedStyle(document.querySelector('#status'), '::after').animationName };
    }));
    await lp.waitForTimeout(90);
  }
  const drift = {};
  for (const k of ['top', 'bot', 'centre', 'stage']) {
    const rs = seen.map((s) => s[k]).filter(Boolean);
    ['x', 'y', 'w'].forEach((dim, i) => {
      const v = rs.map((r) => r[i]);
      const spread = +(Math.max(...v) - Math.min(...v)).toFixed(2);
      if (spread > 0.5) (drift[k] = drift[k] || {})[dim] = spread;   // half a pixel is the eye's floor
    });
  }
  return { drift, texts: [...new Set(seen.map((s) => s.txt))],
           ticks: [...new Set(seen.map((s) => s.tick))] };
};
/* A REAL tap, deliberately not awaited so the samples run while the move and
   the handover are happening — and taken on the LIVE game left by the loop
   above. An earlier draft forced a 3-digit score by filling a board, which
   ends the match: the sampler then watched a finished game hold perfectly
   still and passed without ever seeing a handover. */
const live = await lp.evaluate(() => ({ phase: window.__kb.S.phase, turn: window.__kb.S.turn,
  free: window.__kb.S.boards[1].findIndex((c) => c.length < 3) }));
const handover = (live.phase === 'choose' && live.turn === 1 && live.free >= 0)
  ? lp.tap(`#botBoard .col[data-col="${live.free}"]`).catch(() => {}) : Promise.resolve();
const sampled = await sampleBoxes();
await handover;
out.handoverDrift = sampled.drift;
out.handoverTexts = sampled.texts;
/* THE STATUS LINE NEVER TICKS. "AI thinking…" animated its ellipsis offline
   while the identical online wait sat still, because setStatus took a flag
   whose only job was to let the two callers disagree. Sampled here because
   this window contains the AI's turn, and because the ellipsis was a ::after
   animation — invisible to anything reading textContent. */
out.statusTicks = sampled.ticks;
check(sampled.ticks.every((t) => t === 'none'),
  'the status line animates an ellipsis — offline and online must say the wait the same way', sampled.ticks);
check(sampled.texts.length > 1,
  'the drift sample never saw a turn change, so it proves nothing', { live, texts: sampled.texts });
check(Object.keys(sampled.drift).length === 0,
  'the board moves during a turn handover — the centre lane or the score box is sizing itself to its contents',
  sampled.drift);

/* The other half of the same rule, measured directly rather than by timing: a
   score box may not resize with its digits. Boards stay one die short of full,
   because a full board ends the match. */
out.scoreBox = await lp.evaluate(() => {
  const k = window.__kb;
  const read = () => {
    const g = (q) => { const b = document.querySelector(q).getBoundingClientRect(); return [+b.x.toFixed(2), +b.width.toFixed(2)]; };
    return { tot: g('#totBot'), name: g('#nameBot'), dot: g('#plateBot .dot'),
             text: document.querySelector('#totBot').textContent };
  };
  const at = (b) => { k.S.boards[1] = b; k.renderAll(false); return read(); };
  return { one: at([[1], [], []]), two: at([[6, 6], [6, 6], []]), three: at([[6, 6, 6], [6, 6, 6], [6, 6]]) };
});
{
  const { one, two, three } = out.scoreBox;
  check(three.text.length === 3 && one.text.length === 1, 'the score-box probe did not reach three digits', out.scoreBox);
  check(one.tot[0] === two.tot[0] && two.tot[0] === three.tot[0] && one.tot[1] === three.tot[1],
    'the score box moves or resizes as the score gains digits', out.scoreBox);
  check(one.name[0] === three.name[0] && one.dot[0] === three.dot[0],
    'the name or its dot is pushed by the score', out.scoreBox);
}

/* ===== A CHIP SITS ON ITS BAND =====
   Landscape lays the chip strip BESIDE the board, but the portrait rules that
   separate a strip from its own board (.side.top/.bot .cols margins) are two
   classes deep and outranked the landscape reset — so every chip sat 2px off
   the band it labels, one way on the near side and the other on the far one.
   Row modes then opened a rail lane above the board and, until the lane was
   opened on the strip too, that error grew to 13px. */
out.chipBands = await lp.evaluate(() => {
  const k = window.__kb;
  const off = (sc) => {
    k.S.scoring = sc;
    k.S.boards[1] = [[4, 6, 3], [4, 6, 5], [1, 6, 3]];
    k.S.boards[0] = [[2, 5, 1], [2, 5, 4], [6, 5, 1]];
    k.renderAll(false); k.applySides(); k.fit();
    const cy = (e) => { const b = e.getBoundingClientRect(); return Math.round(b.top + b.height / 2); };
    const side = (s) => {
      const chips = [...document.querySelectorAll(`#${s}Cols .chip`)].map(cy);
      const bands = [...document.querySelectorAll(`#${s}Board .col`)].map(cy);
      return chips.map((c, i) => c - bands[i]);
    };
    return { bot: side('bot'), top: side('top') };
  };
  return { classic: off(0), rowmult: off(2), rowswitch: off(1) };
});
for (const [mode, o] of Object.entries(out.chipBands)) {
  check([...o.bot, ...o.top].every((d) => d === 0),
    `a column chip does not line up with its band in landscape (${mode})`, o);
}

/* ===== THE SCORE FACES THE TABLE ON BOTH HALVES =====
   .pright is a cluster — rune, bounty tally, score — so mirroring the plate
   without mirroring it left the rune and the tally between the score and the
   table: 65px off the inner edge against the other half's 3px. */
out.scoreFacing = await lp.evaluate(() => {
  const k = window.__kb;
  k.S.scoring = 5; k.S.bounty = [3, 2];                 // BOUNTY: the tally lane is live
  k.S.boards[0] = [[6, 6], [5, 5], [4]]; k.S.boards[1] = [[6, 6], [5, 5], [4]];
  k.renderAll(false); k.applySides();
  document.querySelectorAll('.plate .runeslot').forEach((e) => {   // as a spell game dresses it
    e.classList.add('live'); e.innerHTML = '<span style="width:20px;height:20px;display:block"></span>'; });
  const box = (q) => { const b = document.querySelector(q).getBoundingClientRect();
    return { L: Math.round(b.left), R: Math.round(b.right) }; };
  return { leftGap: box('#sideTop').R - box('#totTop').R,     // score to the inner edge
           rightGap: box('#totBot').L - box('#sideBot').L,
           leftRune: box('#plateTop .runeslot').L, leftTot: box('#totTop').L,
           rightRune: box('#plateBot .runeslot').L, rightTot: box('#totBot').L };
});
check(Math.abs(out.scoreFacing.leftGap - out.scoreFacing.rightGap) <= 1,
  'the two scores are not the same distance from the table', out.scoreFacing);
check(out.scoreFacing.leftTot > out.scoreFacing.leftRune && out.scoreFacing.rightTot < out.scoreFacing.rightRune,
  'the rune sits between a score and the table — .pright is not mirrored', out.scoreFacing);

/* ===== ROW MODES KEEP THEIR RAIL =====
   Landscape transposes the board, and the rail used to be hidden outright
   there. In ROW SWITCH that hides the ONLY score the mode has; in ROW MULTIPLY
   it hides the row bonus, which is the entire reason to play it (user report).
   It has to be visible AND carry the numbers, over the right rows. */
out.landRail = await lp.evaluate(() => {
  const k = window.__kb;
  k.S.scoring = 2;                                   // ROWMULT
  k.S.boards[1] = [[4, 6, 3], [4, 6, 5], [1, 6, 3]];  // ×2 pair · ×3 row · ×2 through a stranger
  k.renderAll(false); k.applySides(); k.fit();
  const rail = document.querySelector('#botRows'), board = document.querySelector('#botBoard');
  const rb = rail.getBoundingClientRect(), bb = board.getBoundingClientRect();
  const cs = getComputedStyle(rail);
  return { shown: cs.display !== 'none' && rb.height > 0,
           text: [...rail.querySelectorAll('.rc')].map((e) => e.textContent.trim()),
           aboveBoard: rb.bottom <= bb.top + 1, spansBoard: Math.abs(rb.width - bb.width) < 2,
           plateBottom: document.querySelector('#plateBot').getBoundingClientRect().bottom, railTop: rb.top };
});
check(out.landRail.shown, 'ROW MULTIPLY has no row rail in landscape — the bonus cannot be read at all', out.landRail);
check(out.landRail.text.join(' ') === '16×2 54×3 12×2', 'the landscape rail shows the wrong row scores', out.landRail);
check(out.landRail.aboveBoard && out.landRail.spansBoard, 'the landscape rail is not a strip over the board', out.landRail);
check(out.landRail.railTop >= out.landRail.plateBottom - 1, 'the landscape rail overlaps the nameplate', out.landRail);
await shot(lp, 'v2-landscape-rowmult');

/* ===== ONLY THE TABLE AND ITS OWN SCREENS TURN =====
   Landscape belongs to the board and to the two screens that dress it — the
   setup and the result. A menu keeps its portrait column, because a menu that
   reflows sideways is a second layout to maintain and only the board gains
   from the width (user call). And whatever the orientation, a short viewport
   may not put a control out of reach: .ov centres its column and does not
   scroll, which is how the offline setup screen kept its Play button below the
   fold with no way down to it. */
out.orientation = {};
const atScreen = async (name, go) => {
  await go(); await lp.waitForTimeout(400);
  out.orientation[name] = await lp.evaluate(() => {
    const doc = document.documentElement;
    const on = [...document.querySelectorAll('.ov.on')].filter((o) => !['ovAsk', 'ovLoad', 'ovFirst'].includes(o.id));
    const ov = on[on.length - 1];
    const scroller = ov ? (ov.querySelector('.pbody') || ov) : null;
    const last = ov ? [...ov.querySelectorAll('.btn')].pop() : null;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;     // as a player would
    const fits = (e) => { const b = e.getBoundingClientRect();
      return b.bottom <= window.innerHeight + 1 && b.top >= -1; };
    return { screen: ov ? ov.id : '(table)', land: doc.classList.contains('land'),
             shortv: doc.classList.contains('shortv'),
             lastBtn: last ? last.textContent.trim().slice(0, 20) : null,
             lastBtnReachable: last ? fits(last) : null };
  });
};
await atScreen('home', async () => { await lp.evaluate(() => window.__kb.goHome()); });
await atScreen('practice', async () => { await lp.evaluate(() => window.__kb.openPractice()); });
await atScreen('settings', async () => { await lp.evaluate(() => window.__kb.goHome()); await lp.tap('#btnSettingsHome'); });
await lp.tap('#btnSettingsBack');
check(out.orientation.home.land === false && out.orientation.settings.land === false,
  'a MENU turned landscape — only the table and its setup/result screens may', out.orientation);
check(out.orientation.practice.land === true,
  'the setup screen refuses landscape, though it is one of the screens that may turn', out.orientation);
check(out.orientation.home.shortv && out.orientation.practice.shortv,
  'a short viewport is not being reported to the overlays', out.orientation);
for (const [name, o] of Object.entries(out.orientation)) {
  if (o.lastBtn) check(o.lastBtnReachable, `${name}: the last control cannot be reached on a short screen`, o);
}

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
await shot(lp, 'v2-rotated-back');

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
await gp.tap('#btnSettingsBack'); await gp.waitForTimeout(400);
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
  window.__ldprobe = d;
  document.body.appendChild(d);
  const pip = d.querySelector('.pip');
  return { pipDisplay: getComputedStyle(pip).display, pipOpacity: +getComputedStyle(pip).opacity,
           pipWidth: pip.getBoundingClientRect().width,
           numDisplay: getComputedStyle(d.querySelector('.num')).display,
           // read at insertion: the grace (ldreveal) must be holding it invisible
           graceOpacity: +getComputedStyle(d).opacity };
});
// past the grace and the fade (200ms + 250ms), a real wait must be fully lit
await gp.waitForTimeout(700);
out.loaderNumerals.shownOpacity = await gp.evaluate(() => {
  const o = +getComputedStyle(window.__ldprobe).opacity;
  window.__ldprobe.remove(); delete window.__ldprobe;
  return o;
});
check(out.loaderNumerals.pipDisplay !== 'none' && out.loaderNumerals.pipOpacity > 0.1
      && out.loaderNumerals.pipWidth > 0 && out.loaderNumerals.numDisplay === 'none',
      'the loading die obeys the numerals setting', out.loaderNumerals);
check(out.loaderNumerals.graceOpacity < 0.05 && out.loaderNumerals.shownOpacity > 0.95,
      'the loader grace is broken: it must be invisible at insertion and lit after it', out.loaderNumerals);
await shot(gp, 'v2-numerals');

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
