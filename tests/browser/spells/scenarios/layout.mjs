export async function runLayoutScenarios(suite) {
  const { browser, F, problems, page, out, check, SPELLS, spellCopy, newGame, waitChoose, table, sidePage } = suite;
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
    const vctx = await browser.newContext({ viewport: { width: view.w, height: view.h }, hasTouch: true,
      isMobile: true, deviceScaleFactor: 2, locale: 'en-US' });
    await vctx.addInitScript(() => { const k = 'knucklebones.v1', c = JSON.parse(localStorage.getItem(k) || '{}'); c.played = true; localStorage.setItem(k, JSON.stringify(c)); });
    const vp = await vctx.newPage();
    vp.on('pageerror', e => problems.push('PAGEERROR(' + view.name + '): ' + e.message));
    await vp.goto(F); await vp.waitForTimeout(400);
    /* Give every registry entry its own real hand and legal board. Reusing one
       deal made arm() correctly refuse every spell except the dealt one; once
       ANVIL gained committed aim it could also lock all later rows. Line boxes are counted with
       a Range, not by dividing by line-height — portrait's line-height is
       `normal`, which parses to NaN and quietly makes every row look fine. */
    const rows = [];
    let reserve = 0;
    let land = false;
    for (const spell of SPELLS) {
      await newGame({ spell: spell.id }, vp);
      check(await waitChoose(vp), `game never reached choose (aim lane ${view.name}/${spell.id})`);
      await table([[2, 3, 3], [], []], [[], [6, 6], []], 4, vp);
      const row = await vp.evaluate((id) => {
        const st = document.getElementById('status'), stage = document.getElementById('dieStage');
        const cssReserve = parseFloat(getComputedStyle(st).minHeight);
        const restY = stage.getBoundingClientRect().y;
        const lines = () => { const rg = document.createRange(); rg.selectNodeContents(st); return rg.getClientRects().length; };
        const armed = window.__kb.spells.arm(id);
        const b = st.getBoundingClientRect();
        const result = { id, armed, text: st.textContent, lines: lines(), h: +b.height.toFixed(1),
          w: +b.width.toFixed(1), cssReserve,
          land: document.getElementById('kbroot').classList.contains('land'),
          offscreen: b.right > window.innerWidth + 0.5 || b.left < -0.5,
          dieMoved: +Math.abs(stage.getBoundingClientRect().y - restY).toFixed(1) };
        window.__kb.spells.disarm(true);
        return result;
      }, spell.id);
      rows.push(row);
      reserve = row.cssReserve;
      land = row.land;
      const expectedAim = spellCopy(spell.id).aim;
      check(row.armed && row.text === expectedAim,
        `the aim-lane probe never armed ${spell.id}`, { row, expected: expectedAim });
    }
    const lane = { land, reserve, rows };
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

  /* ---------- 13. the paired rail follows the board's third column ------
     Portrait gives the fixed rail a board-derived x coordinate, not an
     eyeballed gap from the die. Its two cards deliberately fan around that
     anchor. Landscape keeps the same compact rail above the stage. */
  for (const view of [
    { name: 'card portrait 320', w: 320, h: 568, land: false },
    { name: 'card portrait 390', w: 390, h: 844, land: false },
    { name: 'card landscape', w: 667, h: 375, land: true },
  ]) {
    const probe = await sidePage(view);
    try {
      await newGame({ spell: 'pilfer' }, probe.page);
      check(await waitChoose(probe.page), `game never reached choose (${view.name})`);
      await table([[2], [], []], [[6], [], []], 4, probe.page);
      const measured = await probe.page.evaluate(() => {
        const box = (selector) => document.querySelector(selector)?.getBoundingClientRect();
        const rail = box('#spellBar');
        const cards = [...document.querySelectorAll('#spellBar .rune:not([hidden])')]
          .filter((card) => !!card.offsetParent)
          .map((card) => ({ seat: card.dataset.seat,
            active: card.classList.contains('hand-active'), rect: card.getBoundingClientRect() }));
        const die = box('#dieStage');
        const third = box('#botBoard .col[data-col="2"]');
        const centerX = (rect) => rect.left + rect.width / 2;
        const centerY = (rect) => rect.top + rect.height / 2;
        const land = document.getElementById('kbroot').classList.contains('land');
        return { land,
          count: cards.length,
          activeSeat: cards.find((card) => card.active)?.seat,
          x: Math.abs(centerX(rail) - centerX(land ? die : third)),
          y: Math.abs(centerY(rail) - centerY(die)),
          above: die.top - rail.bottom,
          left: Math.min(...cards.map((card) => card.rect.left)),
          right: Math.max(...cards.map((card) => card.rect.right)),
          viewport: innerWidth };
      });
      out[view.name.replaceAll(' ', '_')] = measured;
      check(measured.land === view.land, `${view.name} chose the wrong orientation`, measured);
      check(measured.count === 2 && measured.activeSeat === '1',
        `${view.name} did not keep both seat hands around the active player`, measured);
      check(measured.x <= 0.5, `${view.name} rail is not horizontally centred on its target`, measured);
      if (view.land) {
        check(measured.above >= 0, 'the landscape rail overlaps the die', measured);
      } else {
        check(measured.y <= 0.5, `${view.name} rail is not vertically beside the die`, measured);
        check(measured.left >= -0.5 && measured.right <= measured.viewport + 0.5,
          `${view.name} paired cards run off screen`, measured);
      }
    } finally {
      await probe.ctx.close();
    }
  }

}
