export async function runStageEffectScenarios(suite) {
  const { page, out, check, newGame, waitChoose, table, sidePage } = suite;

  /* NU1: the wrap is the expensive case. Six old cells must drain, the centre
     must land, and the die shell itself may not move. */
  await newGame({ spell: 'nudge' });
  check(await waitChoose(), 'game never reached choose (NU1 wrap)');
  await table([[2], [], []], [[5], [], []], 6);
  const nudgeBefore = await page.locator('#dieStage > .die').boundingBox();
  await page.evaluate(() => {
    const started = performance.now();
    window.__nudgeCastElapsed = null;
    void window.__kb.spells.cast('nudge', -1).finally(() => {
      window.__nudgeCastElapsed = performance.now() - started;
    });
  });
  await page.waitForTimeout(70);
  out.nudgePips = await page.evaluate(() => {
    const stage = document.getElementById('dieStage');
    const die = stage.querySelector(':scope > .die');
    const box = die.getBoundingClientRect();
    const allAnimations = die.getAnimations({ subtree: true });
    const pipAnimations = [...die.querySelectorAll('.pip')]
      .flatMap((pip) => pip.getAnimations());
    const timingFor = (animations, name) => {
      const animation = animations.find((candidate) => candidate.animationName === name);
      const timing = animation?.effect?.getTiming();
      return timing ? { duration: Number(timing.duration), delay: Number(timing.delay) } : null;
    };
    return {
      value: die.dataset.v,
      removed: die.querySelectorAll('.pip.spell-nudge-removed').length,
      shared: die.querySelectorAll('.pip.spell-nudge-shared').length,
      added: die.querySelectorAll('.pip.spell-nudge-added').length,
      shellTransform: getComputedStyle(die).transform,
      shellAnimations: die.getAnimations().map((animation) => animation.animationName || ''),
      pipAnimations: pipAnimations.map((animation) => animation.animationName || ''),
      nudgeTiming: {
        drain: timingFor(pipAnimations, 'spell-nudge-drain'),
        land: timingFor(pipAnimations, 'spell-nudge-land'),
        glow: timingFor(allAnimations, 'spell-nudge-glow'),
      },
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      pop: stage.classList.contains('pop'),
      particles: document.querySelectorAll('#fx .particle').length,
    };
  });
  check(out.nudgePips.value === '1' && out.nudgePips.removed === 6
      && out.nudgePips.shared === 0 && out.nudgePips.added === 1,
    'NU1 did not draw the canonical 6 → 1 pip difference', out.nudgePips);
  check(out.nudgePips.shellTransform === 'none'
      && Math.abs(out.nudgePips.box.x + out.nudgePips.box.width / 2
        - (nudgeBefore.x + nudgeBefore.width / 2)) < 0.5
      && Math.abs(out.nudgePips.box.y + out.nudgePips.box.height / 2
        - (nudgeBefore.y + nudgeBefore.height / 2)) < 0.5
      && out.nudgePips.shellAnimations.every((name) => name === 'spell-nudge-glow'),
    'NU1 moved the shell instead of rewriting its face', out.nudgePips);
  check(out.nudgePips.pipAnimations.includes('spell-nudge-drain')
      && out.nudgePips.pipAnimations.includes('spell-nudge-land')
      && !out.nudgePips.pop && out.nudgePips.particles === 0,
    'NU1 fell back to a whole-die pop/burst or lost its pip motion', out.nudgePips);
  check(Math.abs(out.nudgePips.nudgeTiming.drain?.duration - 616) < 1
      && Math.abs(out.nudgePips.nudgeTiming.drain?.delay) < 1
      && Math.abs(out.nudgePips.nudgeTiming.land?.duration - 504) < 1
      && Math.abs(out.nudgePips.nudgeTiming.land?.delay - 616) < 1
      && Math.abs(out.nudgePips.nudgeTiming.glow?.duration - 1176) < 1
      && Math.abs(out.nudgePips.nudgeTiming.glow?.delay) < 1
      && out.nudgePips.nudgeTiming.land.delay >= out.nudgePips.nudgeTiming.drain.duration,
    'NU1 no longer follows the selected removal-first timing', out.nudgePips.nudgeTiming);
  await page.waitForFunction(() => !document.querySelector('#dieStage .spell-nudge-rewrite'));
  await page.waitForFunction(() => window.__nudgeCastElapsed !== null);
  out.nudgeSettled = await page.evaluate(() => ({
    value: document.querySelector('#dieStage > .die')?.dataset.v,
    temporary: document.querySelectorAll('#dieStage [class*="spell-nudge-"]').length,
    elapsed: window.__nudgeCastElapsed,
  }));
  check(out.nudgeSettled.value === '1' && out.nudgeSettled.temporary === 0
      && out.nudgeSettled.elapsed >= 1170,
    'NU1 did not cleanly settle on its authoritative face', out.nudgeSettled);

  /* Numerals get the same arithmetic without leaking hidden pips through the
     accessibility preference: old number out, new number in, shell still. */
  await newGame({ spell: 'nudge' });
  check(await waitChoose(), 'game never reached choose (NU1 numerals)');
  await table([[2], [], []], [[5], [], []], 5);
  await page.evaluate(() => {
    document.getElementById('kbroot').classList.add('numerals');
    void window.__kb.spells.cast('nudge', -1);
  });
  await page.waitForTimeout(150);
  out.nudgeNumerals = await page.evaluate(() => {
    const die = document.querySelector('#dieStage > .die');
    const oldNumber = die.querySelector('.spell-nudge-number-old');
    const newNumber = die.querySelector('.spell-nudge-number-new');
    return {
      old: oldNumber?.textContent,
      next: newNumber?.textContent,
      oldDisplay: oldNumber ? getComputedStyle(oldNumber).display : null,
      nextDisplay: newNumber ? getComputedStyle(newNumber).display : null,
      pipDisplay: getComputedStyle(die.querySelector('.pip')).display,
      shellTransform: getComputedStyle(die).transform,
    };
  });
  check(out.nudgeNumerals.old === '5' && out.nudgeNumerals.next === '6'
      && out.nudgeNumerals.oldDisplay === 'flex' && out.nudgeNumerals.nextDisplay === 'flex'
      && out.nudgeNumerals.pipDisplay === 'none' && out.nudgeNumerals.shellTransform === 'none',
    'NU1 numeral mode did not perform a contained number handoff', out.nudgeNumerals);
  await page.waitForFunction(() => !document.querySelector('#dieStage .spell-nudge-rewrite'));
  await page.evaluate(() => document.getElementById('kbroot').classList.remove('numerals'));

  /* FA4: sample the whole pass. Equal transforms keep the two square faces
     edge-to-edge, so the clipped stage lane never exposes an empty frame. */
  await newGame({ spell: 'fate', mode: 6 });
  check(await waitChoose(), 'game never reached choose (FA4)');
  await table([[2], [], []], [[5], [], []], 1);
  await page.evaluate(() => {
    const k = window.__kb;
    k.S.pool = [6, 4];
    const bag = document.getElementById('bagStack');
    document.getElementById('bagNum').textContent = '2';
    bag.classList.remove('empty', 'tick');
    bag.querySelectorAll('.pile .die').forEach((die, index) => die.classList.toggle('gone', index >= 1));
  });
  await page.evaluate(() => { void window.__kb.spells.cast('fate', -1); });
  const passSamples = [];
  for (const pause of [35, 70, 70]) {
    await page.waitForTimeout(pause);
    passSamples.push(await page.evaluate(() => {
      const stage = document.getElementById('dieStage');
      const lane = stage.querySelector('.spell-fate-lane');
      const oldDie = lane?.querySelector('.spell-fate-old');
      const newDie = lane?.querySelector('.spell-fate-new');
      const sr = stage.getBoundingClientRect();
      const lr = lane?.getBoundingClientRect();
      const or = oldDie?.getBoundingClientRect();
      const nr = newDie?.getBoundingClientRect();
      return {
        seam: or && nr ? Math.abs(or.right - nr.left) : 99,
        laneFits: !!lr && Math.abs(lr.left - sr.left) < 0.5 && Math.abs(lr.right - sr.right) < 0.5,
        clipped: lane ? getComputedStyle(lane).overflow === 'hidden' : false,
        bag: document.getElementById('bagNum').textContent,
        stateBag: window.__kb.S.pool.length,
        liveHidden: getComputedStyle(stage.querySelector(':scope > .die')).visibility,
        cloneAria: [...(lane?.querySelectorAll('.spell-stage-copy') || [])]
          .every((die) => die.getAttribute('aria-hidden') === 'true'),
        cloneRooted: document.querySelectorAll('body > .spell-stage-copy').length === 0,
        rolling: stage.classList.contains('rolling') || stage.classList.contains('pop'),
      };
    }));
  }
  out.fatePass = passSamples;
  check(passSamples.every((sample) => sample.seam < 1.5 && sample.laneFits && sample.clipped),
    'FA4 exposed a blank or escaped its contained stage lane', passSamples);
  check(passSamples.every((sample) => sample.bag === '2' && sample.stateBag === 1
      && sample.liveHidden === 'hidden' && sample.cloneAria && sample.cloneRooted && !sample.rolling),
    'FA4 revealed its new stage/bag state early or created an unsafe clone', passSamples);
  await page.waitForTimeout(180);
  out.fateSettled = await page.evaluate(() => ({
    value: document.querySelector('#dieStage > .die')?.dataset.v,
    visible: getComputedStyle(document.querySelector('#dieStage > .die')).visibility,
    bag: document.getElementById('bagNum').textContent,
    lane: !!document.querySelector('#dieStage .spell-fate-lane'),
    stateBag: window.__kb.S.pool.length,
  }));
  check(out.fateSettled.value === '6' && out.fateSettled.visible === 'visible'
      && out.fateSettled.bag === '1' && out.fateSettled.stateBag === 1 && !out.fateSettled.lane,
    'FA4 did not reveal the authoritative die and bag together at arrival', out.fateSettled);

  /* JS and CSS both degrade: a reduced-motion cast resolves straight to one
     static canonical face with no transient clones or moving pips. */
  const reduced = await sidePage({ name: 'stage reduced', w: 390, h: 844,
    opts: { reducedMotion: 'reduce' } });
  try {
    await newGame({ spell: 'nudge' }, reduced.page);
    check(await waitChoose(reduced.page), 'game never reached choose (stage reduced)');
    await table([[2], [], []], [[5], [], []], 6, reduced.page);
    out.stageReduced = await reduced.page.evaluate(async () => {
      await window.__kb.spells.cast('nudge', -1);
      const stage = document.getElementById('dieStage');
      const die = stage.querySelector(':scope > .die');
      return {
        value: die.dataset.v,
        transient: stage.querySelectorAll('[class*="spell-nudge-"],[class*="spell-fate-"]').length,
        animations: stage.getAnimations({ subtree: true }).length,
      };
    });
    check(out.stageReduced.value === '1' && out.stageReduced.transient === 0
        && out.stageReduced.animations === 0,
      'reduced motion retained transient stage choreography', out.stageReduced);
  } finally {
    await reduced.ctx.close();
  }
}
