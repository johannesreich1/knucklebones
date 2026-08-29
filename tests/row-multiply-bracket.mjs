// ROW MULTIPLY's row-match mark: a SPAN, bracketed at its ends.
//
// The mark it replaces was one rule for every row match, so a ×2 and a ×3 wore
// the same ring — the state was right and the board still lied about the score.
// What has to be true now is entirely about pixels:
//
//   - only the ENDS of a match carry ink; every die between them stays clean,
//   - a match that jumps a stranger (cols 1 and 3) still brackets the pair, not
//     the stranger,
//   - a ×2 and a ×3 are told apart without reading the row rail,
//   - and no other mode grows a bracket — ROW SWITCH marks its rows with the
//     standard multiplier glow, and CLASSIC has no row scoring at all.
//
// Asserting the CLASSES would prove none of it: the middle die of a ×3 wore a
// solid slab through a stylesheet that set every class correctly, because an
// absolutely positioned ::before with no left/right still paints. So this reads
// computed pseudo-element pixels, per the rule single-strike-visibility exists
// to enforce.
import pkg from 'playwright';
import { emitReport } from './support/emit-report.mjs';
const { chromium, devices } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones-neon.html';   // the single-file build
const browser = await chromium.launch();
const problems = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };
const lit = (c) => !!c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c);
try {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true,
    locale: 'en-US' });
  await ctx.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push('PAGEERROR: ' + e.message));
  await page.goto(F); await page.waitForTimeout(500);
  // 2-player seating: no CPU reply races the assertion
  await page.evaluate(() => {
    const k = window.__kb;
    k.S.localMode = 2; k.S.mode = 'duo'; k.S.seat = 'face'; k.openPractice();   // 2 = ROWMULT
  });
  await page.tap('#btnPlay'); await page.waitForTimeout(1200);

  /* One board, every case at once — the same board the design cards are judged
     on: a ×2 pair, a ×3 row, and a ×2 whose partners sit either side of a
     stranger. Columns are top-down, so col[c][r] is row r. */
  const paint = (scoring) => page.evaluate((sc) => {
    const k = window.__kb;
    k.S.scoring = sc;
    k.S.boards[1] = [[4, 6, 3], [4, 6, 5], [1, 6, 3]];
    k.S.boards[0] = [[], [], []];
    k.renderAll(false); k.applySides();
    const seen = [];
    for (let c = 0; c < 3; c++) {
      const col = document.querySelector(`#botBoard .col[data-col="${c}"]`);
      const dice = [...col.querySelectorAll('.die')];
      for (let r = 0; r < dice.length; r++) {
        const d = dice[r], a = getComputedStyle(d, '::after'), b = getComputedStyle(d, '::before');
        seen.push({
          c, r, v: +d.dataset.v,
          left: a.content === 'none' ? '' : a.borderLeftColor,
          right: a.content === 'none' ? '' : a.borderRightColor,
          head: b.content === 'none' ? '' : b.backgroundColor,
          headW: b.content === 'none' ? 0 : Math.round(parseFloat(b.width)),
        });
      }
    }
    return seen;
  }, scoring);

  const at = (seen, c, r) => seen.find((s) => s.c === c && s.r === r) || {};

  // ===== ROW MULTIPLY =====
  const rm = out.rowmult = await paint(2);

  // the ×2 pair (row 0, cols 0-1): the pair's outer edges, and nothing on col 2
  check(lit(at(rm, 0, 0).left) && !lit(at(rm, 0, 0).right), '×2 left end is not bracketed on its outer edge', at(rm, 0, 0));
  check(lit(at(rm, 1, 0).right) && !lit(at(rm, 1, 0).left), '×2 right end is not bracketed on its outer edge', at(rm, 1, 0));
  check(at(rm, 0, 0).headW > 0 && at(rm, 1, 0).headW > 0, 'a ×2 end is missing its head', [at(rm, 0, 0), at(rm, 1, 0)]);
  check(!lit(at(rm, 2, 0).left) && !lit(at(rm, 2, 0).right) && !at(rm, 2, 0).headW,
    'an UNMATCHED die wears the row mark', at(rm, 2, 0));

  // the ×3 (row 1): ends only — the middle die is the one this mark must leave alone
  check(lit(at(rm, 0, 1).left) && lit(at(rm, 2, 1).right), '×3 is not bracketed at its ends', [at(rm, 0, 1), at(rm, 2, 1)]);
  check(!lit(at(rm, 1, 1).left) && !lit(at(rm, 1, 1).right) && !at(rm, 1, 1).headW,
    'THE MIDDLE DIE OF A ×3 IS INKED — the span promises it stays clean', at(rm, 1, 1));

  // ×2 and ×3 must be tellable apart without reading the rail
  check(at(rm, 0, 0).left !== at(rm, 0, 1).left,
    'a ×2 and a ×3 wear the SAME mark — the bug the ring had', [at(rm, 0, 0).left, at(rm, 0, 1).left]);

  // the gap case (row 2): cols 0 and 2 match THROUGH col 1
  check(lit(at(rm, 0, 2).left) && at(rm, 0, 2).headW > 0, 'a gapped ×2 lost its left end', at(rm, 0, 2));
  check(lit(at(rm, 2, 2).right) && at(rm, 2, 2).headW > 0, 'a gapped ×2 lost its right end', at(rm, 2, 2));
  check(!lit(at(rm, 1, 2).left) && !lit(at(rm, 1, 2).right) && !at(rm, 1, 2).headW,
    'the STRANGER between a gapped match is bracketed as if it matched', at(rm, 1, 2));

  // ===== the mark belongs to ROW MULTIPLY alone =====
  // ROW SWITCH scores rows with the standard multiplier glow; CLASSIC has no
  // row scoring at all. Either growing a bracket would be a mode telling a lie.
  for (const [name, sc] of [['rowswitch', 1], ['classic', 0]]) {
    const seen = out[name] = await paint(sc);
    const inked = seen.filter((s) => lit(s.left) || lit(s.right) || s.headW > 0);
    check(inked.length === 0, `${name} grew a ROW MULTIPLY bracket`, inked);
  }

  // ===== the mark wears the HEAT, never a colour =====
  // A ×2 is gold and a ×3 hot orange — unless that side's player wears that
  // hue, when only THEIR multiplied dice fall back to ice / hot red, so a
  // doubled die can never pass for their plain one. Colour blind mode pins
  // both fallbacks on both sides. A mark with a literal in it would be
  // invisible to all of that, and this is the one thing about the bracket a
  // player can change from the settings screen.
  const heats = () => page.evaluate(() => {
    const k = window.__kb;
    k.S.scoring = 2;
    k.S.boards[1] = [[4, 6], [4, 6], [1, 6]];
    k.S.boards[0] = [[4, 6], [4, 6], [1, 6]];
    k.renderAll(false); k.applySides();
    const read = (sel) => {
      const d = document.querySelector(sel);
      const cs = getComputedStyle(d);
      return { mark: getComputedStyle(d, '::after').borderLeftColor,
               head: getComputedStyle(d, '::before').backgroundColor,
               token: cs.getPropertyValue(d.classList.contains('rm3') ? '--mx3-rgb' : '--mx2-rgb').trim() };
    };
    return { botX2: read('#botBoard .col[data-col="0"] .die.rm2.rms'),
             botX3: read('#botBoard .col[data-col="0"] .die.rm3.rms'),
             topX2: read('#topBoard .col[data-col="0"] .die.rm2.rms') };
  });

  const wears = (r) => {
    const [rr, gg, bb] = r.token.split(',').map((n) => n.trim());
    return r.mark === `rgba(${rr}, ${gg}, ${bb}, 0.95)` && r.head === r.mark;
  };
  const settings = async (fn) => {
    await page.evaluate(() => window.__kb.goHome());
    await page.tap('#btnSettingsHome'); await page.waitForTimeout(300);
    await fn();
    await page.waitForTimeout(200);
    await page.tap('#btnSettingsBack'); await page.waitForTimeout(300);
    await page.evaluate(() => window.__kb.openPractice());
    await page.tap('#btnPlay'); await page.waitForTimeout(900);
  };

  // the default pair: nobody wears a heat, so the true heats stand
  out.heatsDefault = await heats();
  check(wears(out.heatsDefault.botX2) && wears(out.heatsDefault.botX3),
    'the bracket does not follow the multiplier heat', out.heatsDefault);
  check(out.heatsDefault.botX2.mark !== out.heatsDefault.botX3.mark,
    'a ×2 and a ×3 bracket are the same colour', out.heatsDefault);

  // a player PICKS gold: only that side's ×2 falls back to ice, the foe keeps gold
  await settings(async () => { await page.tap('#p1Pick button[data-h="gold"]'); });
  out.heatsGold = await heats();
  check(wears(out.heatsGold.botX2) && wears(out.heatsGold.botX3),
    'the bracket ignores a picked hue — it must follow --mx2 / --mx3', out.heatsGold);
  check(out.heatsGold.botX2.token !== out.heatsDefault.botX2.token,
    'picking gold did not move that side onto the ice fallback', [out.heatsGold.botX2.token, out.heatsDefault.botX2.token]);
  check(out.heatsGold.topX2.token !== out.heatsGold.botX2.token,
    'ONE side picking gold recoloured the other side\'s bracket too', out.heatsGold);

  // colour blind mode pins ice + red on BOTH sides
  await settings(async () => { await page.tap('#cbSeg button[data-b="1"]'); });
  out.heatsCb = await heats();
  check(wears(out.heatsCb.botX2) && wears(out.heatsCb.botX3),
    'the bracket does not follow the heat in colour blind mode', out.heatsCb);
  check(out.heatsCb.topX2.token === out.heatsCb.botX2.token,
    'colour blind mode did not pin the same fallback on both sides', out.heatsCb);
  check(out.heatsCb.botX2.mark !== out.heatsCb.botX3.mark,
    'ice and hot red collapsed into one bracket colour', out.heatsCb);

} finally { await browser.close(); }
emitReport({ out, problems }, problems.length);
