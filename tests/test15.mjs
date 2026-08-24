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
//
// It also pins the ACTION STACK, which both flows fill from the same two slots
// (2026-08-22, user call): one primary, and ONE quiet secondary in the short
// cut. Offline used to carry three buttons — "Change difficulty" and "Home"
// under NEXT DUEL — for a screen whose whole question is "again or not", and
// the two secondaries landed a tap apart anyway (the setup screen's ‹ IS the
// way home). The short cut is read in PIXELS: a way out that stands as tall as
// NEXT DUEL is not a quiet one, whatever its class list says.
import pkg from 'playwright';
const { chromium } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones-neon.html';
const browser = await chromium.launch();
const problems = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

/* each case fills MY grid on the last placement — that is what ends a game */
const cases = [
  ['cpu-win',  'cpu', [[6,6,6],[5,5,5],[4,4]], [[1],[2],[3]],         2, 'win',  false],
  ['cpu-lose', 'cpu', [[1,1,1],[1,1,1],[2,2]], [[6,6,6],[5,5,5],[4]], 2, 'lose', false],
  ['duo-p2',   'duo', [[1,1,1],[1,1,1],[2,2]], [[6,6,6],[5,5,5],[4]], 2, 'win',  false],
  ['cpu-draw', 'cpu', [[2,2,2],[3,3,3],[1,1]], [[6,6,6],[],[]],       1, 'draw', false],
  ['still-win',  'cpu', [[6,6,6],[5,5,5],[4,4]], [[1],[2],[3]],         2, 'win',  true],
  ['still-lose', 'cpu', [[1,1,1],[1,1,1],[2,2]], [[6,6,6],[5,5,5],[4]], 2, 'lose', true],
  ['still-draw', 'cpu', [[2,2,2],[3,3,3],[1,1]], [[6,6,6],[],[]],       1, 'draw', true],
];
try {
  for (const [label, mode, mine, theirs, die, want, reduced] of cases) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
                                           locale: 'en-US',
                                           ...(reduced ? { reducedMotion: 'reduce' } : {}) });
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
    const reducedFrames = [];
    if (reduced) {
      await page.waitForSelector('#ovEnd.on');
      const frame = () => page.evaluate(() => {
        const ov = document.getElementById('ovEnd'), title = document.getElementById('endTitle');
        const style = getComputedStyle(title);
        const named = ov.getAnimations({ subtree: true }).map((a) => a.animationName).filter(Boolean);
        return {
          opacity: +style.opacity, transform: style.transform,
          shock: +getComputedStyle(document.getElementById('endShock')).opacity,
          sweep: +getComputedStyle(ov.querySelector('.sweep')).opacity,
          resultMotion: named.filter((name) => /^end(?:Stamp|Shock|Bloom|Rise|Sweep)$/.test(name)),
          fireworks: document.querySelectorAll('#endFx .particle, #endFx .fwring').length,
          flash: document.getElementById('flash').getAnimations().length,
        };
      });
      reducedFrames.push(await frame());
      await page.waitForTimeout(170); reducedFrames.push(await frame());
      await page.waitForTimeout(230); reducedFrames.push(await frame());
    } else {
      await page.waitForTimeout(1500);
    }
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
        /* the stack as the thumb meets it: every button the screen offers, in
           order, with the height that says which one is the quiet one */
        acts: [...ov.querySelectorAll('.btn')].filter(b => !b.hidden)
          .map(b => ({ id: b.id, label: b.textContent, h: Math.round(b.getBoundingClientRect().height) })),
      };
    });
    r.reducedFrames = reducedFrames;
    out[label] = r;
    check(r.shown, 'the result screen never appeared: ' + label, r);
    check(r.outcome === want, 'wrong outcome for ' + label, r);
    /* TWO buttons, never three — and the same two whichever seating played:
       what waits behind the secondary is the whole setup, not one segment, so
       there is one label rather than a duo/cpu pair. */
    check(r.acts.length === 2 && r.acts[0].id === 'btnAgain' && r.acts[1].id === 'btnEndQuiet',
          'the result screen is not offering exactly one primary and one quiet way on: ' + label, r.acts);
    check(r.acts[1].label === 'Change setup', 'the quiet way on lost its label: ' + label, r.acts);
    check(r.acts[1].h < r.acts[0].h, 'THE WAY OUT STANDS AS TALL AS NEXT DUEL: ' + label, r.acts);
    if (reduced) {
      check(r.reducedFrames.length === 3 && r.reducedFrames.every((f) => f.opacity > .95
            && f.transform === 'none' && f.shock === 0 && f.sweep === 0
            && f.resultMotion.length === 0 && f.fireworks === 0 && f.flash === 0),
            'REDUCED RESULT FLASHED INSTEAD OF ARRIVING AS A READABLE STILL: ' + label, r.reducedFrames);
    } else if (want === 'win') {
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
