/* AN2 forge heat combined with AN3's expanding border. The authoritative
   [2,3,3] case also pins commitment and the no-take-back rule. */
export async function runAnvilEffectScenarios(suite) {
  const { page, out, check, newGame, waitChoose, table, tapCol, tapRune, sidePage } = suite;

  await newGame({ spell: 'anvil' });
  check(await waitChoose(), 'game never reached choose (AN2 hybrid)');
  await table([[2, 3, 3], [], []], [[1], [], []], 3);
  await tapRune();
  await page.waitForTimeout(100);
  out.anvilPreview = await page.evaluate(() => {
    const preview = document.querySelector('.die.anvilpreview');
    const rune = document.querySelector('.rune[data-seat="1"]:not([hidden])');
    return {
      count: document.querySelectorAll('.die.anvilpreview').length,
      value: +(preview?.dataset.v || 0),
      heat: preview ? +getComputedStyle(preview, '::after').opacity : 0,
      committed: rune?.classList.contains('committed'),
      charges: JSON.stringify(window.__kb.S.spellCharges),
    };
  });
  check(out.anvilPreview.count === 1 && out.anvilPreview.value === 2
    && out.anvilPreview.heat > .4,
  'ANVIL did not visibly mark the 2 in [2,3,3]', out.anvilPreview);
  check(out.anvilPreview.committed && out.anvilPreview.charges === '[{"anvil":1},{"anvil":0}]',
    'showing the ANVIL mark did not commit its charge', out.anvilPreview);

  /* Once the answer is painted, every attempted retreat is a refusal. */
  await page.keyboard.press('Escape');
  await page.tap('#status');
  await page.evaluate(() => {
    const rune = document.querySelector('.rune[data-seat="1"]:not([hidden])');
    rune.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  await page.waitForTimeout(80);
  out.anvilLocked = await page.evaluate(() => ({
    armed: window.__kb.S.spellArmed,
    committed: window.__kb.S.spellAimCommitted,
    charges: JSON.stringify(window.__kb.S.spellCharges),
    previews: document.querySelectorAll('.die.anvilpreview').length,
    runeClass: document.querySelector('.rune[data-seat="1"]:not([hidden])')?.className,
  }));
  check(out.anvilLocked.armed === 'anvil' && out.anvilLocked.committed?.id === 'anvil'
      && out.anvilLocked.charges === '[{"anvil":1},{"anvil":0}]'
      && out.anvilLocked.previews === 1 && /\bcommitted\b/.test(out.anvilLocked.runeClass),
    'ANVIL backed out after its weakest-die markings appeared', out.anvilLocked);

  const centreBefore = await page.evaluate(() => {
    const rect = document.querySelector(
      '#botBoard .col[data-col="0"] .slot[data-slot="0"] .die').getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await tapCol(0);
  await page.waitForTimeout(140);
  out.anvilHeating = await page.evaluate((before) => {
    const workpiece = document.querySelector('.anvil-workpiece');
    const face = workpiece?.querySelector('.anvil-workpiece-face');
    const heatLayer = workpiece?.querySelector('.anvil-forge-heat');
    const rect = workpiece?.getBoundingClientRect();
    const heatRect = heatLayer?.getBoundingClientRect();
    const frames = [...(workpiece?.querySelectorAll('*') || []), workpiece]
      .filter(Boolean).flatMap((element) => element.getAnimations())
      .flatMap((animation) => animation.effect?.getKeyframes?.() || []);
    return {
      face: +(face?.dataset.v || 0),
      pips: face?.querySelectorAll('.pip').length || 0,
      numeral: face?.querySelector('.num')?.textContent,
      heat: +(heatLayer ? getComputedStyle(heatLayer).opacity : 0),
      heatCoverError: rect && heatRect ? Math.max(
        Math.abs(rect.left - heatRect.left), Math.abs(rect.top - heatRect.top),
        Math.abs(rect.right - heatRect.right), Math.abs(rect.bottom - heatRect.bottom),
      ) : 999,
      centreError: rect ? Math.hypot(rect.x + rect.width / 2 - before.x,
        rect.y + rect.height / 2 - before.y) : 999,
      rotates: frames.some((frame) => String(frame.transform || '').includes('rotate')),
      state: JSON.stringify(window.__kb.S.boards[1][0]),
    };
  }, centreBefore);
  check(out.anvilHeating.face === 2 && out.anvilHeating.pips === 9
    && out.anvilHeating.numeral === '2' && out.anvilHeating.heat > .1
    && out.anvilHeating.heatCoverError < .5,
  'AN2 did not heat the complete old die face', out.anvilHeating);
  check(out.anvilHeating.centreError < .75 && !out.anvilHeating.rotates
    && out.anvilHeating.state === '[2,3,3]',
  'ANVIL moved/rotated the die or revealed before white heat', out.anvilHeating);

  await page.waitForTimeout(215);
  out.anvilReveal = await page.evaluate((before) => {
    const workpiece = document.querySelector('.anvil-workpiece');
    const face = workpiece?.querySelector('.anvil-workpiece-face');
    const ring = workpiece?.querySelector('.anvil-recast-ring');
    const rect = workpiece?.getBoundingClientRect();
    const frames = [...(workpiece?.querySelectorAll('*') || []), workpiece]
      .filter(Boolean).flatMap((element) => element.getAnimations())
      .flatMap((animation) => animation.effect?.getKeyframes?.() || []);
    return {
      state: JSON.stringify(window.__kb.S.boards[1][0]),
      face: +(face?.dataset.v || 0),
      m3: document.querySelectorAll('#botBoard .col[data-col="0"] .die.m3').length,
      score: document.querySelector('#botCols .chip .cs')?.textContent,
      ringSolid: ring ? getComputedStyle(ring).borderStyle === 'solid' : false,
      ringMoving: !!ring && ring.getAnimations()
        .some((animation) => animation.id === 'kb-spell-motion'),
      targetHidden: getComputedStyle(document.querySelector(
        '#botBoard .col[data-col="0"] .slot[data-slot="0"] .die')).visibility,
      centreError: rect ? Math.hypot(rect.x + rect.width / 2 - before.x,
        rect.y + rect.height / 2 - before.y) : 999,
      rotates: frames.some((frame) => String(frame.transform || '').includes('rotate')),
      particles: document.querySelectorAll('.particle').length,
      boardShake: document.getElementById('app').getAnimations().length,
    };
  }, centreBefore);
  check(out.anvilReveal.state === '[3,3,3]' && out.anvilReveal.face === 3
    && out.anvilReveal.m3 === 3 && out.anvilReveal.score === '27',
  'ANVIL did not synchronize face, multiplier and score at the reveal', out.anvilReveal);
  check(out.anvilReveal.ringSolid && out.anvilReveal.ringMoving
    && out.anvilReveal.targetHidden === 'hidden',
  'the AN3 solid expanding border did not accompany the protected repaint', out.anvilReveal);
  check(out.anvilReveal.centreError < .75 && !out.anvilReveal.rotates
    && out.anvilReveal.particles === 0 && out.anvilReveal.boardShake === 0,
  'ANVIL introduced rotation, displacement, particles, or a board strike', out.anvilReveal);

  await page.waitForTimeout(420);
  out.anvilCooled = await page.evaluate(() => ({
    workpieces: document.querySelectorAll('.anvil-workpiece').length,
    state: JSON.stringify(window.__kb.S.boards[1][0]),
    visible: [...document.querySelectorAll('#botBoard .col[data-col="0"] .die')]
      .filter((die) => getComputedStyle(die).visibility === 'visible').length,
    previews: document.querySelectorAll('.anvilpreview').length,
  }));
  check(out.anvilCooled.workpieces === 0 && out.anvilCooled.visible === 3
    && out.anvilCooled.previews === 0 && out.anvilCooled.state === '[3,3,3]',
  'ANVIL did not cool back to one clean authoritative column', out.anvilCooled);

  const reduced = await sidePage({
    name: 'spell effects reduced motion', w: 390, h: 844,
    opts: { reducedMotion: 'reduce' },
  });
  try {
    await newGame({ spell: 'anvil' }, reduced.page);
    check(await waitChoose(reduced.page), 'game never reached choose (ANVIL reduced)');
    await table([[2, 3, 3], [], []], [[1], [], []], 3, reduced.page);
    await reduced.page.evaluate(() => window.__kb.spells.cast('anvil', 0));
    out.spellEffectsReduced = await reduced.page.evaluate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        column: JSON.stringify(window.__kb.S.boards[1][0]),
        ghosts: document.querySelectorAll('.pilfer-ghost,.anvil-workpiece,.rune-played').length,
        outlines: [...document.querySelectorAll('#spellBar .rune:not([hidden]) .rune-empty')]
          .filter((outline) => !outline.hidden).length,
        hidden: [...document.querySelectorAll('#topBoard .die,#botBoard .die,#dieStage>.die')]
          .filter((die) => getComputedStyle(die).visibility === 'hidden').length,
      };
    });
    check(out.spellEffectsReduced.column === '[3,3,3]'
      && out.spellEffectsReduced.ghosts === 0 && out.spellEffectsReduced.hidden === 0
      && out.spellEffectsReduced.outlines === 1,
    'reduced motion did not resolve both effects to a clean readable result',
    out.spellEffectsReduced);
  } finally {
    await reduced.ctx.close();
  }
}
