import { waitForStableGeometry } from '../../support/stable-geometry.mjs';

/* NOTHING IN THE CENTRE RAIL OR THE SCORE CLUSTER MOVES.
   The only family in the spell suite that measures PIXELS rather than charges:
   the rail's resting spot as it changes owner, the score plate's width as it
   fills, and the marks that ride beside a growing number. Every regression
   these blocks were written for reached the player as drift, so they read
   getBoundingClientRect and wait out the bump rather than trusting the DOM. */
export async function runRailStillnessScenarios(suite) {
  const { page, out, check, newGame, waitChoose, table } = suite;
  /* ---------- 10. the shared rail and scores hold still ----------
     The rail changes owner without entering either plate. Handover must move
     neither score nor the fixed slot aligned with the right board column. */
  await newGame({ spell: 'fate' }); check(await waitChoose(), 'game never reached choose (plate)');
  out.plateHold = { ys: [], turns: [] };
  for (const turn of [1, 0, 1, 0]) {
    await page.evaluate((nextTurn) => {
      const k = window.__kb;
      k.S.turn = nextTurn; k.S.phase = 'choose'; k.S.busy = false;
      k.applySides(); k.spells.render(); k.renderAll(false);
    }, turn);
    await waitForStableGeometry(page, [
      '#sideTop', '#sideBot', '#totTop', '#totBot', '#spellBar',
    ]);
    const resting = await page.evaluate(() => ({
      y: [+document.getElementById('totTop').getBoundingClientRect().y.toFixed(1),
        +document.getElementById('totBot').getBoundingClientRect().y.toFixed(1),
        +document.getElementById('spellBar').getBoundingClientRect().y.toFixed(1)].join('/'),
      turn: getComputedStyle(document.getElementById('spellBar')).transform,
    }));
    out.plateHold.ys.push(resting.y);
    out.plateHold.turns.push(resting.turn);
  }
  out.plateHold.distinct = [...new Set(out.plateHold.ys)].length;
  check(out.plateHold.distinct === 1, 'THE SCORE MOVES WHEN THE RUNE CHANGES HANDS', out.plateHold);
  check(out.plateHold.turns[0] === 'none' && out.plateHold.turns[1] !== 'none'
      && out.plateHold.turns[2] === 'none' && out.plateHold.turns[3] !== 'none',
    'portrait face-to-face did not turn the card rail toward the active seat', out.plateHold);

  /* Score width changes may not leak into the centre rail. */
  await newGame({ spell: 'fate' }); check(await waitChoose(), 'game never reached choose (cluster)');
  out.clusterFixed = await page.evaluate(async () => {
    const k = window.__kb;
    const widths = new Set(), spots = new Set(), scores = [];
    for (const b of [[[], [], []], [[6], [], []], [[6, 6], [5], []],
                     [[6, 6, 6], [5, 5, 5], []], [[6, 6, 6], [5, 5, 5], [4, 4, 4]]]) {
      k.S.boards[0] = b; k.renderAll(false); k.spells.render();
      await new Promise((r) => setTimeout(r, 420));      // past .plate.bump
      widths.add(document.querySelector('#plateTop .pright').getBoundingClientRect().width.toFixed(3));
      const r = document.getElementById('spellBar').getBoundingClientRect();
      spots.add(r.x.toFixed(4) + ',' + r.y.toFixed(4));
      scores.push(document.getElementById('totTop').textContent);
    }
    return { widths: [...widths], spots: [...spots], scores };
  });
  check(out.clusterFixed.widths.length === 1,
    'the score cluster still grows with its contents — every child will drift', out.clusterFixed);
  check(out.clusterFixed.spots.length === 1,
    'THE CARD RAIL SHIFTS WHEN A SCORE CHANGES WIDTH', out.clusterFixed);
  // and a spell-free game reserves nothing anywhere
  await newGame({ spell: '' }); check(await waitChoose(), 'game never reached choose (plate none)');
  out.plateNone = await page.evaluate(() => {
    const rail = document.getElementById('spellBar');
    return { slots: document.querySelectorAll('.runeslot').length,
      live: rail.classList.contains('live'), display: getComputedStyle(rail).display };
  });
  check(out.plateNone.slots === 0 && !out.plateNone.live && out.plateNone.display === 'none',
    'a spell-free game reserved a rail or nameplate hole', out.plateNone);

  /* ---------- 10b. the marks hold still too ----------
     The chip CENTRES its contents, so the score and its ×k badge change width
     on every placement — a mark riding in that row jumped a dozen pixels each
     time (user report). Ward and shield sit at the chip's ends instead. */
  await newGame({ spell: 'ward' }); check(await waitChoose(), 'game never reached choose (chip)');
  await table([[6], [], []], [[1], [], []], 3);
  await page.evaluate(() => window.__kb.spells.cast('ward', 0));
  await page.waitForTimeout(700);
  out.chipHold = await page.evaluate(async () => {
    const k = window.__kb, xs = [];
    for (const col of [[6], [6, 6], [6, 6, 6]]) {          // 6 → 24 ×2 → 54 ×3
      k.S.boards[1][0] = col; k.renderAll(false);
      await new Promise((r) => setTimeout(r, 80));
      const wd = document.querySelectorAll('#botCols .chip')[0].querySelector('.wd');
      xs.push(+wd.getBoundingClientRect().x.toFixed(1));
    }
    return { xs, distinct: [...new Set(xs)].length };
  });
  check(out.chipHold.distinct === 1, 'THE WARD MARK MOVES WHEN THE SCORE GROWS', out.chipHold);

  /* BOUNTY joins the score cluster but must not disturb it or the centre rail. */
  out.btyHold = await page.evaluate(async () => {
    const k = window.__kb;
    k.S.spell = 'ward'; k.S.localMode = 5; k.S.mode = 'cpu'; k.S.seat = 'pass';
    k.newGame();
    for (let i = 0; i < 60; i++) { if (k.S.phase === 'choose') break; await new Promise((r) => setTimeout(r, 100)); }
    // let fit()/ResizeObserver finish sizing the table before measuring — a
    // layout still settling drifts on its own and would read as a tally jump
    await new Promise((r) => setTimeout(r, 700));
    const at = () => {
      const rail = document.getElementById('spellBar');
      return [+rail.getBoundingClientRect().y.toFixed(1),
              +document.getElementById('totTop').getBoundingClientRect().y.toFixed(1)].join('/');
    };
    const ys = [];
    // 0 → 2 → 11 → back to 0: if the last reading equals the first, the tally
    // is not moving anything; a drift that never returns is the layout settling
    for (const banked of [0, 2, 11, 0]) {
      k.S.bounty = [banked, 0]; k.renderAll(false); k.spells.render();
      // WAIT OUT THE BUMP. Banking changes the total, and a changed total
      // scales the number for 190ms (.plate.bump) — sampling inside that
      // window measures the celebration, not the layout, and reads as drift.
      await new Promise((r) => setTimeout(r, 420));
      ys.push(at());
    }
    return { ys, distinct: [...new Set(ys)].length, returned: ys[0] === ys[3] };
  });
  check(out.btyHold.distinct === 1, 'THE BOUNTY TALLY SHOVES THE SCORE OR CARD RAIL', out.btyHold);
}
