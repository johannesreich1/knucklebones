// THE RESULT SCREEN: one screen, two treatments, and a celebration that only
// fires for a win.
//
// Winning and losing are not the same moment, so they do not get the same
// entrance: a win LANDS (endStamp + the shockwave hoop, design study A), a
// loss or a draw RISES from behind a line with a light bar sweeping through it
// (study F). The fireworks belong to the win alone — and in two-player,
// somebody always won, which is why any decided duo game celebrates.
//
// This is the suite that would have caught the celebration going missing from
// ranked play: it asserts the SCREEN's behaviour, which both flows now share.
import pkg from 'playwright';
const { chromium } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones-neon.html';
const browser = await chromium.launch();
const problems = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

/* each case fills MY grid on the last placement — that is what ends a game */
const cases = [
  ['cpu-win',  'cpu', [[6,6,6],[5,5,5],[4,4]], [[1],[2],[3]],         2, 'win'],
  ['cpu-lose', 'cpu', [[1,1,1],[1,1,1],[2,2]], [[6,6,6],[5,5,5],[4]], 2, 'lose'],
  ['duo-p2',   'duo', [[1,1,1],[1,1,1],[2,2]], [[6,6,6],[5,5,5],[4]], 2, 'win'],
  ['cpu-draw', 'cpu', [[2,2,2],[3,3,3],[1,1]], [[6,6,6],[],[]],       1, 'draw'],
];
try {
  for (const [label, mode, mine, theirs, die, want] of cases) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => problems.push('PAGEERROR ' + label + ': ' + e.message));
    await page.goto(F); await page.waitForTimeout(400);
    await page.evaluate((m) => {
      const k = window.__kb;
      k.S.spell = ''; k.S.timer = 0; k.S.mode = m; k.S.seat = 'face'; k.newGame();
    }, mode);
    for (let i = 0; i < 40; i++) {
      if (await page.evaluate(() => window.__kb.S.phase === 'choose')) break;
      await page.waitForTimeout(120);
    }
    await page.evaluate(([m, t, d]) => {
      const k = window.__kb;
      k.S.boards[1] = m; k.S.boards[0] = t;
      k.S.turn = 1; k.S.bottom = 1; k.S.busy = false; k.S.phase = 'choose'; k.S.die = d;
      k.applySides(); k.renderAll(false); k.setStageDie(d, 1);
    }, [mine, theirs, die]);
    await page.evaluate(() => window.__kb.place(1, 2));
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const ov = document.getElementById('ovEnd'), t = document.getElementById('endTitle');
      const anim = (el) => el ? el.getAnimations().map(a => a.animationName).filter(Boolean).join(',') : '';
      return {
        shown: ov.classList.contains('on'),
        outcome: [...ov.classList].filter(c => ['win', 'lose', 'draw'].includes(c)).join(''),
        title: t.textContent,
        titleAnim: anim(t),
        sweepAnim: anim(document.querySelector('#ovEnd .sweep')),
        shockAnim: anim(document.getElementById('endShock')),
        // the celebration draws into the SCREEN's own layer (#fx is below every
        // overlay — a burst drawn there fires behind this very screen)
        fireworks: document.querySelectorAll('#endFx .particle, #endFx .fwring').length,
      };
    });
    out[label] = r;
    check(r.shown, 'the result screen never appeared: ' + label, r);
    check(r.outcome === want, 'wrong outcome for ' + label, r);
    if (want === 'win') {
      check(/endStamp/.test(r.titleAnim), 'a win must LAND: ' + label, r);
      check(/endShock/.test(r.shockAnim), 'a win lost its shockwave: ' + label, r);
      check(r.fireworks > 0, 'A WIN WITHOUT FIREWORKS: ' + label, r);
    } else {
      check(/endRise/.test(r.titleAnim), 'a loss/draw must RISE: ' + label, r);
      check(/endSweep/.test(r.sweepAnim), 'the light bar never swept: ' + label, r);
      check(r.fireworks === 0, 'FIREWORKS FOR A NON-WIN: ' + label, r);
    }
    await ctx.close();
  }
  console.log(JSON.stringify({ out, problems }, null, 2));
} finally { await browser.close(); }
process.exit(problems.length ? 1 : 0);
