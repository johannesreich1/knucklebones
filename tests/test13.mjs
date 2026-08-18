// SINGLE STRIKE regression: the survivors must be VISIBLE, not merely present.
//
// The bug this guards (shipped once, reported by the player as "single strike
// deletes all"): renderSide reuses a die element whenever the face matches, and
// a survivor compacting into a slot whose die had just died inherited `.dying`
// — an animation that ends at opacity 0 with `forwards`. State and DOM agreed
// perfectly; only the PIXELS were wrong, which is why an earlier probe that
// compared dataset.v passed while the mode was visibly broken.
//
// Hence the rule this suite exists to enforce: assert what the player can SEE
// (computed opacity), never merely what the DOM contains.
import pkg from 'playwright';
const { chromium, devices } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones-neon.html';   // the single-file build
const browser = await chromium.launch();
const problems = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };
try {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push('PAGEERROR: ' + e.message));
  await page.goto(F); await page.waitForTimeout(500);
  // 2-player + face seating: no CPU reply races the assertion
  await page.evaluate(() => {
    const k = window.__kb;
    k.S.localMode = 4; k.S.mode = 'duo'; k.S.seat = 'face'; k.openPractice();
  });
  await page.tap('#btnPlay'); await page.waitForTimeout(1500);
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => window.__kb.S.phase) === 'choose') break;
    await page.waitForTimeout(150);
  }

  // count what a PLAYER can actually see in the enemy column
  const seen = () => page.evaluate(() => {
    const col = document.querySelectorAll('#topBoard .col')[0];
    const dice = [...col.querySelectorAll('.die')];
    return {
      state: JSON.stringify(window.__kb.S.boards[0][0]),
      present: dice.length,
      visible: dice.filter(d => +getComputedStyle(d).opacity > 0.05).length,
      dying: dice.filter(d => d.classList.contains('dying')).length,
    };
  });

  const strike = async (col0, die) => {
    await page.evaluate(([c0, dv]) => {
      const k = window.__kb;
      k.S.boards[0] = [c0, [], []];
      k.S.boards[1] = [[], [], []];
      k.renderAll(false);
      k.S.turn = 1; k.S.bottom = 1; k.S.busy = false; k.S.phase = 'choose';
      k.applySides(); k.S.die = dv; k.setStageDie(dv, 1);
    }, [col0, die]);
    await page.tap('#botBoard .col[data-col="0"]');
    await page.waitForTimeout(1500);
    return seen();
  };

  // the exact shapes the audit reproduced: a same-face survivor compacts in
  out.pair = await strike([4, 4], 4);            // → [4], one die, VISIBLE
  check(out.pair.state === '[4]', 'strike removed the wrong count', out.pair);
  check(out.pair.visible === 1, 'SURVIVOR IS INVISIBLE after a strike', out.pair);
  check(out.pair.dying === 0, 'a kept die still wears .dying', out.pair);

  out.triple = await strike([4, 4, 4], 4);       // → [4,4], both VISIBLE
  check(out.triple.state === '[4,4]', 'strike removed the wrong count', out.triple);
  check(out.triple.visible === 2, 'a survivor is invisible', out.triple);

  out.mixed = await strike([2, 4, 4], 4);        // → [2,4], both VISIBLE
  check(out.mixed.visible === 2, 'a survivor is invisible', out.mixed);

  // classic control: every match dies, nothing lingers
  await page.evaluate(() => { window.__kb.S.scoring = 0; });
  out.classic = await strike([4, 4], 4);
  check(out.classic.state === '[]' && out.classic.visible === 0, 'classic destruction changed', out.classic);

  console.log(JSON.stringify({ out, problems }, null, 2));
} finally { await browser.close(); }
process.exit(problems.length ? 1 : 0);
