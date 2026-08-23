export async function runLayoutScenarios(suite) {
  const { browser, F, problems, page, out, check, SPELLS, newGame, waitChoose, table } = suite;
  /* ---------- 10b. ANVIL: the forge lands on the die the RULE names ----------
     The rule picks WHICH die (lowest face, ties to the centre), so the screen
     has to show the new face standing where the old one stood — a state-only
     assertion would pass while the board still drew the 1. */
  await newGame({ spell: 'anvil' }); await waitChoose();
  await table([[6, 6, 1], [2], []], [[], [], []], 6);
  out.anvil = await page.evaluate(async () => {
    const k = window.__kb;
    const faces = () => [...document.querySelectorAll('#botBoard .col[data-col="0"] .die')]
      .map((d) => d.dataset.v).join(',');
    const drawnBefore = faces();
    // a column with room left is NOT forgeable — place into it instead
    const roomy = await k.spells.cast('anvil', 1);
    const forged = await k.spells.cast('anvil', 0);
    return { drawnBefore, roomy, forged, drawn: faces(),
             mine: JSON.stringify(k.S.boards[1]),
             die: k.S.die, charges: JSON.stringify(k.S.spellCharges) };
  });
  check(out.anvil.roomy === false, 'a column with room left must refuse the forge', out.anvil);
  check(out.anvil.forged === true, 'the full column refused a legal forge', out.anvil);
  check(out.anvil.mine === '[[6,6,6],[2],[]]', 'the LOWEST die did not take the face in hand', out.anvil);
  check(out.anvil.drawn.split(',').sort().join() === '6,6,6',
    'THE BOARD STILL DRAWS THE OLD FACE — the forge is invisible', out.anvil);
  check(out.anvil.die === 6, 'a cast is not a move: the die in hand must survive it', out.anvil);
  check(out.anvil.charges === '[{"anvil":1},{"anvil":0}]', 'the forge was not charged', out.anvil);

  /* ---------- 11. the tutorial is a scripted lesson: no spells in it ---------- */
  await newGame({ tutorial: true }); await page.waitForTimeout(900);
  out.tut = await page.evaluate(() => ({
    charges: JSON.stringify(window.__kb.S.spellCharges),
    runeShown: !!document.querySelector('.rune[data-seat="1"]:not([hidden])')?.offsetParent,
  }));
  check(out.tut.charges === '[{},{}]', 'the tutorial dealt spells', out.tut);
  check(!out.tut.runeShown, 'the rune showed up in the tutorial', out.tut);


  /* ---------- 12. the armed line fits the lane it was given ----------
     The status has a RESERVED box, and the reserve is the whole rule: ONE line
     in portrait, TWO in landscape's fixed 104px lane (`.status` / `.land
     .status` min-height). A box that sizes itself to its text walks the stage
     die up the screen — the drift test8 guards for ordinary turns. The ARMED
     line is that same box with longer words in it and was never measured:
     ANVIL's "Tap a filled column to recast its weakest die" took FOUR lines in
     landscape (die shoved 12.6px) and TWO in portrait on a 320px phone (user
     report), with WARD and PILFER quietly over in landscape.

     Measured through arm(), the path a real press takes, once per REGISTRY
     entry — so the next spell is measured the day it is written rather than
     the day someone plays it on a small phone. The budget is READ FROM THE
     CSS, never typed here, so the reserve and its guard cannot drift apart.
     Two viewports are the whole family: the narrowest portrait phone (the box
     is shrink-to-fit there, so the narrowest lane is the one that wraps first)
     and any landscape (that lane is a fixed 104px — the wrap depends on the
     words alone). */
  for (const view of [{ name: 'portrait', w: 320, h: 568 }, { name: 'landscape', w: 667, h: 375 }]) {
    const vctx = await browser.newContext({ viewport: { width: view.w, height: view.h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await vctx.addInitScript(() => { const k = 'knucklebones.v1', c = JSON.parse(localStorage.getItem(k) || '{}'); c.played = true; localStorage.setItem(k, JSON.stringify(c)); });
    const vp = await vctx.newPage();
    vp.on('pageerror', e => problems.push('PAGEERROR(' + view.name + '): ' + e.message));
    await vp.goto(F); await vp.waitForTimeout(400);
    await vp.evaluate(() => window.__kb.openPractice());
    await vp.tap('#btnPlay'); await vp.waitForTimeout(2200);
    /* one synchronous pass: nothing re-renders between two arms, so every row
       is measured against the same resting stage. Line boxes are counted with
       a Range, not by dividing by line-height — portrait's line-height is
       `normal`, which parses to NaN and quietly makes every row look fine. */
    const lane = await vp.evaluate((ids) => {
      const st = document.getElementById('status'), stage = document.getElementById('dieStage');
      const reserve = parseFloat(getComputedStyle(st).minHeight);
      const restY = stage.getBoundingClientRect().y;
      const lines = () => { const rg = document.createRange(); rg.selectNodeContents(st); return rg.getClientRects().length; };
      const rows = ids.map((id) => {
        window.__kb.spells.arm(id);
        const b = st.getBoundingClientRect();
        return { id, text: st.textContent, lines: lines(), h: +b.height.toFixed(1), w: +b.width.toFixed(1),
                 offscreen: b.right > window.innerWidth + 0.5 || b.left < -0.5,
                 dieMoved: +Math.abs(stage.getBoundingClientRect().y - restY).toFixed(1) };
      });
      window.__kb.spells.disarm();
      return { land: document.getElementById('kbroot').classList.contains('land'), reserve, rows };
    }, SPELLS.map((s) => s.id));
    out['aimLane_' + view.name] = lane;
    check(lane.land === (view.name === 'landscape'), 'the aim-lane probe was in the wrong orientation', { view, land: lane.land });
    check(lane.rows.every((r) => r.text), 'an armed rune said nothing', lane.rows);
    check(lane.rows.every((r) => r.h <= lane.reserve + 0.5),
      'an armed line outgrows the box ' + view.name + ' reserves for it',
      { reserve: lane.reserve, over: lane.rows.filter((r) => r.h > lane.reserve + 0.5) });
    check(lane.rows.every((r) => !r.offscreen),
      'an armed line runs off the edge of a ' + view.name + ' phone',
      lane.rows.filter((r) => r.offscreen));
    check(lane.rows.every((r) => r.dieMoved <= 0.5),
      'arming a rune walked the stage die off its place in ' + view.name,
      lane.rows.filter((r) => r.dieMoved > 0.5));
    await vctx.close();
  }

}
