export async function runSunderOverloadScenarios(suite) {
  const { page, out, check, newGame, waitChoose, table, guard, sidePage } = suite;

  /* SU6 asks the real destruction planner before it marks anything. This one
     scene carries all three answers: two matching dice truly doomed, matching
     dice spared by a Ward, and matching dice silent behind COLUMN SHIELD. */
  await newGame({ spell: 'sunder', mode: 3 });
  check(await waitChoose(), 'game never reached choose (SU6 preview)');
  await table([[], [], []], [[4, 4], [4, 2], [4, 1, 4]], 4);
  await guard(1, 0);
  await page.evaluate(() => { void window.__kb.spells.cast('sunder', -1); });
  await page.waitForTimeout(140);
  out.sunderPreview = await page.evaluate(() => {
    const columns = [...document.querySelectorAll('#topBoard .col')].map((col) => ({
      doomed: col.querySelectorAll('.die.sunder-doomed').length,
      values: [...col.querySelectorAll('.die.sunder-doomed')].map((die) => die.dataset.v),
      identities: [...col.querySelectorAll('.die.sunder-doomed')]
        .map((die) => [...die.classList].filter((name) => /^(p[12]|m[23])$/.test(name)).sort().join(':')),
    }));
    const stage = document.getElementById('dieStage');
    const ring = getComputedStyle(stage, '::after');
    return {
      columns,
      charged: stage.classList.contains('sundered'),
      ring: { content: ring.content, style: ring.borderStyle },
      stageAnimations: stage.getAnimations({ subtree: true }).map((a) => a.animationName).sort(),
      victimAnimations: [...document.querySelectorAll('.die.sunder-doomed')]
        .flatMap((die) => die.getAnimations().map((a) => a.animationName)),
      wards: JSON.stringify(window.__kb.S.charm.wards),
      armed: window.__kb.S.charm.sunder[1],
    };
  });
  check(String(out.sunderPreview.columns.map((c) => c.doomed)) === '2,0,0',
    'SU6 marked dice that Ward/Column Shield will spare, or missed real victims', out.sunderPreview);
  check(out.sunderPreview.columns[0].identities.every((identity) => identity === 'm2:p2'),
    'SU6 replaced the doomed dice owner/multiplier identity', out.sunderPreview.columns[0]);
  check(out.sunderPreview.charged && out.sunderPreview.ring.content !== 'none'
      && out.sunderPreview.ring.style === 'dashed'
      && out.sunderPreview.stageAnimations.includes('su6swell')
      && out.sunderPreview.stageAnimations.includes('su6strain'),
    'the die in hand did not visibly overcharge against its containment ring', out.sunderPreview);
  check(out.sunderPreview.victimAnimations.includes('su6tremor') && out.sunderPreview.armed,
    'the authoritative victims did not begin failing when SUNDER committed', out.sunderPreview);

  /* Tremor is an alarm, not a permanent accessibility tax. After its two short
     cycles the marked dice stay crooked and ember-bordered, but no tremor is
     still running. */
  await page.waitForTimeout(1050);
  out.sunderCalm = await page.evaluate(() => [...document.querySelectorAll('.die.sunder-doomed')].map((die) => ({
    transform: getComputedStyle(die).transform,
    tremor: die.getAnimations().filter((a) => a.animationName === 'su6tremor').map((a) => a.playState),
  })));
  check(out.sunderCalm.length === 2 && out.sunderCalm.every((die) => die.transform !== 'none'
      && die.tremor.every((state) => state !== 'running')),
    'SU6 kept trembling continuously instead of settling into a static warning', out.sunderCalm);

  /* Placement finishes the same visual language: the already-marked pair
     collapses with a stagger, the Warded column gets the one real contact copy,
     and every transient marker is gone before the next turn. */
  out.sunderRelease = await page.evaluate(async () => {
    const k = window.__kb;
    let maxCollapse = 0, sawFail = false, sawWardGhost = false;
    const placement = k.place(1, 0);
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 30));
      const collapsing = [...document.querySelectorAll('.die.sunder-collapse')];
      maxCollapse = Math.max(maxCollapse, collapsing.length);
      sawFail ||= collapsing.some((die) => die.getAnimations().some((a) => a.animationName === 'su6fail'));
      sawWardGhost ||= !!document.querySelector('.ward-strike-ghost');
    }
    await placement;
    return {
      maxCollapse, sawFail, sawWardGhost,
      theirs: JSON.stringify(k.S.boards[0]),
      wards: JSON.stringify(k.S.charm.wards),
      armed: k.S.charm.sunder[1],
      charged: document.getElementById('dieStage').classList.contains('sundered'),
      residue: document.querySelectorAll('.sunder-doomed,.sunder-doomed-slot,.sunder-collapse,.ward-strike-ghost').length,
    };
  });
  check(out.sunderRelease.maxCollapse === 2 && out.sunderRelease.sawFail,
    'SU6 did not collapse its marked pair as a staggered continuation', out.sunderRelease);
  check(out.sunderRelease.sawWardGhost,
    'SUNDER did not send its real Ward-blocked strike into the clasp', out.sunderRelease);
  check(out.sunderRelease.theirs === '[[],[4,2],[4,1,4]]'
      && JSON.parse(out.sunderRelease.wards)[0][1] === 0,
    'SU6 visuals disagreed with the authoritative Ward/Shield outcome', out.sunderRelease);
  check(!out.sunderRelease.armed && !out.sunderRelease.charged && out.sunderRelease.residue === 0,
    'SU6 leaked its charge or doomed markers into the next turn', out.sunderRelease);

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
    residue: document.querySelectorAll('.sunder-doomed,.sunder-doomed-slot,.sunder-collapse').length,
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
    out.sunderReduced = await reduced.page.evaluate(() => {
      const marked = [...document.querySelectorAll('.die.sunder-doomed')];
      const stage = document.getElementById('dieStage');
      return {
        reduced: window.__kb.reduced,
        columns: [...document.querySelectorAll('#topBoard .col')]
          .map((col) => col.querySelectorAll('.die.sunder-doomed').length),
        charged: stage.classList.contains('sundered'),
        running: [...stage.getAnimations({ subtree: true }),
          ...marked.flatMap((die) => die.getAnimations())]
          /* Board repaint may still be finishing its universal 60ms pip
             transition. Only SU6-owned motion is forbidden by this contract. */
          .filter((animation) => String(animation.animationName || '').startsWith('su6')
            && animation.playState === 'running').length,
        staticWarning: marked.every((die) => getComputedStyle(die).transform !== 'none'),
      };
    });
    check(out.sunderReduced.reduced && String(out.sunderReduced.columns) === '2,0,0'
        && out.sunderReduced.charged && out.sunderReduced.running === 0
        && out.sunderReduced.staticWarning,
      'SU6 reduced motion lost its exact static warning or kept moving', out.sunderReduced);
  } finally {
    await reduced.ctx.close();
  }
}
