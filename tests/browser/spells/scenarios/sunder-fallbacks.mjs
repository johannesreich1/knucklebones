export async function runSunderFallbackScenarios(suite) {
  const { page, out, check, newGame, waitChoose, table, guard, sidePage } = suite;

  /* SINGLE STRIKE is another visible-planner trap: of two matching dice only
     logical index zero (the centre-nearest die) is genuinely doomed. */
  await newGame({ spell: 'sunder', mode: 4 });
  check(await waitChoose(), 'game never reached choose (SU6 single strike)');
  await table([[], [], []], [[4, 6, 4], [], []], 4);
  await page.evaluate(() => { void window.__kb.spells.cast('sunder', -1); });
  await page.waitForTimeout(160);
  out.sunderSingle = await page.evaluate(() => {
    const marked = [...document.querySelectorAll('#topBoard .col[data-col="0"] .die.sunder-doomed')];
    return { count: marked.length, slot: marked[0]?.parentElement?.dataset.slot,
      all: [...document.querySelectorAll('#topBoard .col[data-col="0"] .die')]
        .map((die) => ({ v: die.dataset.v, slot: die.parentElement.dataset.slot,
          doomed: die.classList.contains('sunder-doomed') })) };
  });
  check(out.sunderSingle.count === 1 && out.sunderSingle.slot === '2',
    'SU6 marked more than SINGLE STRIKE can destroy, or chose the outer match', out.sunderSingle);

  /* A cast may be abandoned by starting another duel. The charged stage is
     presentation, not durable game state, and must disappear synchronously
     with resetSpells rather than tinting the next opening roll. */
  await newGame({ spell: 'nudge' });
  out.sunderRestart = await page.evaluate(() => ({
    charged: document.getElementById('dieStage').classList.contains('sundered'),
    residue: document.querySelectorAll('.sunder-doomed,.sunder-doomed-slot,.sunder-returning-slot,.sunder-collapse,.sunder-embers').length,
    marks: JSON.stringify(window.__kb.S.charm.sunder),
  }));
  check(!out.sunderRestart.charged && out.sunderRestart.residue === 0
      && out.sunderRestart.marks === '[false,false]',
    'a restarted game inherited SUNDER presentation or charm state', out.sunderRestart);

  /* Reduced motion keeps the exact static warning but runs no tremor, swell,
     haze, ember, or collapse choreography. Protected matches stay unmarked. */
  const reduced = await sidePage({ name: 'SU6 reduced', w: 390, h: 844,
    opts: { reducedMotion: 'reduce' } });
  try {
    await newGame({ spell: 'sunder', mode: 3 }, reduced.page);
    check(await waitChoose(reduced.page), 'game never reached choose (SU6 reduced)');
    await table([[], [], []], [[4, 4], [4, 2], [4, 1, 4]], 4, reduced.page);
    await guard(1, 0, reduced.page);
    await reduced.page.evaluate(() => window.__kb.spells.cast('sunder', -1));
    out.sunderReduced = await reduced.page.evaluate(async () => {
      /* The shared reduced-motion policy retains one 60ms property settle.
         Sample its resting pixels, not the old tile at transition time zero. */
      await new Promise((resolve) => setTimeout(resolve, 140));
      const marked = [...document.querySelectorAll('.die.sunder-doomed')];
      const stage = document.getElementById('dieStage');
      const transparent = (color) => {
        if (color === 'transparent') return true;
        const alpha = color.match(/(?:,|\/)\s*([\d.]+)\s*\)$/);
        return !!alpha && Number(alpha[1]) <= .005;
      };
      const staticDetails = marked.map((die) => {
        const slotStyle = getComputedStyle(die.parentElement);
        return {
          transform: getComputedStyle(die).transform,
          background: slotStyle.backgroundColor,
          border: slotStyle.borderTopColor,
          emberOpacity: [...die.querySelectorAll(':scope > .sunder-embers > i')]
            .map((ember) => Number(getComputedStyle(ember).opacity)),
        };
      });
      return {
        reduced: window.__kb.reduced,
        columns: [...document.querySelectorAll('#topBoard .col')]
          .map((col) => col.querySelectorAll('.die.sunder-doomed').length),
        charged: stage.classList.contains('sundered'),
        running: [...stage.getAnimations({ subtree: true }),
          ...marked.flatMap((die) => die.getAnimations({ subtree: true }))]
          /* Board repaint may still be finishing its universal 60ms pip
             transition. Only SU6-owned motion is forbidden by this contract. */
          .filter((animation) => String(animation.animationName || '').startsWith('su6')
            && animation.playState === 'running').length,
        staticDetails,
        staticWarning: staticDetails.every((detail) => detail.transform !== 'none'
          && transparent(detail.background) && transparent(detail.border)
          && detail.emberOpacity.length === 2 && detail.emberOpacity.every((opacity) => opacity >= .8)),
      };
    });
    check(out.sunderReduced.reduced && String(out.sunderReduced.columns) === '2,0,0'
        && out.sunderReduced.charged && out.sunderReduced.running === 0
        && out.sunderReduced.staticWarning,
      'SU6 reduced motion lost its exact static warning or kept moving', out.sunderReduced);
    out.sunderReducedRelease = await reduced.page.evaluate(async () => {
      const k = window.__kb;
      await k.place(1, 0);
      return {
        theirs: JSON.stringify(k.S.boards[0]),
        wards: JSON.stringify(k.S.charm.wards),
        armed: k.S.charm.sunder[1],
        residue: document.querySelectorAll(
          '.sunder-doomed,.sunder-doomed-slot,.sunder-returning-slot,.sunder-collapse,.sunder-embers,.ward-strike-ghost').length,
        running: [...document.querySelectorAll('.sunder-doomed-slot,.sunder-returning-slot,.sunder-doomed,.sunder-embers')]
          .flatMap((node) => node.getAnimations({ subtree: true }))
          .filter((animation) => String(animation.animationName || '').startsWith('su6')
            && animation.playState === 'running').length,
      };
    });
    check(out.sunderReducedRelease.theirs === '[[],[4,2],[4,1,4]]'
        && JSON.parse(out.sunderReducedRelease.wards)[0][1] === 0
        && !out.sunderReducedRelease.armed && out.sunderReducedRelease.residue === 0
        && out.sunderReducedRelease.running === 0,
      'SU6 reduced motion did not resolve immediately and cleanly after placement',
      out.sunderReducedRelease);
  } finally {
    await reduced.ctx.close();
  }
}
