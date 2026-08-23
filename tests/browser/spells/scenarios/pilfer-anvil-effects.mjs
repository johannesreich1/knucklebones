/* Player-visible contracts for PI5 PILFER and the AN2/AN3-border ANVIL hybrid.
   State assertions pin the reveal beat; geometry and running animations pin
   what the player actually sees on that beat. */
export async function runPilferAnvilEffectScenarios(suite) {
  const { page, out, check, newGame, waitChoose, table, tapCol, tapRune, sidePage } = suite;

  out.pilferSnatch = [];
  for (const height of [1, 2, 3]) {
    await newGame({ spell: 'pilfer' });
    check(await waitChoose(), `game never reached choose (PI5 height ${height})`);
    const theirs = Array.from({ length: height }, (_, index) => index + 1);
    await table([[4], [], []], [theirs, [], []], 5);
    await page.evaluate(() => { void window.__kb.spells.cast('pilfer', 0); });
    await page.waitForTimeout(215);

    const tension = await page.evaluate(() => {
      const column = document.querySelector('#topBoard .col[data-col="0"]');
      const ghost = document.querySelector('.pilfer-ghost');
      const blockers = [...column.querySelectorAll('.pilfer-blocker')];
      const moved = blockers.filter((die) => {
        const transform = getComputedStyle(die).transform;
        return transform !== 'none' && transform !== 'matrix(1, 0, 0, 1, 0, 0)';
      }).length;
      return {
        declared: +(column.dataset.pilferCollisions || -1),
        blockers: blockers.length,
        blockerAnimations: blockers.filter((die) => die.getAnimations()
          .some((animation) => animation.id === 'kb-spell-motion')).length,
        moved,
        ghost: !!ghost,
        enemyColour: ghost?.classList.contains('p2') && !ghost.classList.contains('p1'),
        sourceHidden: getComputedStyle(column.querySelector('.slot .die')).visibility === 'hidden',
        particles: document.querySelectorAll('.particle').length,
        boardShake: document.getElementById('app').getAnimations()
          .some((animation) => animation.playState === 'running'),
      };
    });
    const expected = height - 1;
    check(tension.declared === expected && tension.blockers === expected
      && tension.blockerAnimations === expected,
    `PI5 height ${height} did not expose exactly ${expected} resistance beat(s)`, tension);
    check(tension.moved === (expected ? 1 : 0),
      `PI5 height ${height} is not visibly meeting its first blocker`, tension);
    check(tension.ghost && tension.enemyColour && tension.sourceHidden,
      'the stolen die did not lift as one enemy-coloured copy', tension);
    check(tension.particles === 0 && !tension.boardShake,
      'PILFER taught a strike with particles or a board shake', tension);

    let elapsed = 215;
    let secondCollision = null;
    if (height === 3) {
      await page.waitForTimeout(165);
      elapsed += 165;
      secondCollision = await page.evaluate(() => {
        const die = document.querySelector('[data-pilfer-collision="2"]');
        const transform = die ? getComputedStyle(die).transform : 'none';
        return {
          transform,
          moved: transform !== 'none' && transform !== 'matrix(1, 0, 0, 1, 0, 0)',
        };
      });
      check(secondCollision.moved,
        'PI5 never visibly met its second real blocker', secondCollision);
    }

    const arrivalMs = 350 + expected * 185;
    await page.waitForTimeout(Math.max(0, arrivalMs + 30 - elapsed));
    const arrival = await page.evaluate(() => {
      const die = document.querySelector('#botBoard .col[data-col="0"] .pilfer-soft-settle');
      return {
        mine: JSON.stringify(window.__kb.S.boards[1][0]),
        theirs: JSON.stringify(window.__kb.S.boards[0][0]),
        settling: !!die && die.getAnimations()
          .some((animation) => animation.id === 'kb-spell-motion'),
        transform: die ? getComputedStyle(die).transform : 'none',
        particles: document.querySelectorAll('.particle').length,
        flash: document.getElementById('flash').getAnimations().length,
        boardShake: document.getElementById('app').getAnimations().length,
      };
    });
    check(arrival.mine === JSON.stringify([4, height])
      && arrival.theirs === JSON.stringify(theirs.slice(0, -1)),
    'PILFER did not repaint both boards at the arrival beat', arrival);
    check(arrival.settling && arrival.transform !== 'none',
      'PI5 arrived without its soft die-only settle', arrival);
    check(arrival.particles === 0 && arrival.flash === 0 && arrival.boardShake === 0,
      'the PI5 arrival still reads as a destructive strike', arrival);

    await page.waitForTimeout(230);
    const cleaned = await page.evaluate(() => ({
      ghosts: document.querySelectorAll('.pilfer-ghost').length,
      strain: document.querySelectorAll('.pilfer-straining,.pilfer-blocker,.pilfer-soft-settle').length,
      hidden: [...document.querySelectorAll('#topBoard .die,#botBoard .die')]
        .filter((die) => getComputedStyle(die).visibility === 'hidden').length,
    }));
    check(cleaned.ghosts === 0 && cleaned.strain === 0 && cleaned.hidden === 0,
      'PI5 left a ghost, tension marker, or hidden die behind', cleaned);
    out.pilferSnatch.push({ height, tension, secondCollision, arrival, cleaned });
  }

  /* A superseding generation must lift the temporary source visibility and
     remove all fixed/absolute FX before the nominal two-collision flight ends. */
  await newGame({ spell: 'pilfer' });
  check(await waitChoose(), 'game never reached choose (PI5 cleanup)');
  await table([[4], [], []], [[1, 2, 3], [], []], 5);
  await page.evaluate(() => { void window.__kb.spells.cast('pilfer', 0); });
  await page.waitForTimeout(120);
  await page.evaluate(() => { window.__kb.S.gen++; });
  await page.waitForTimeout(100);
  out.pilferInterrupted = await page.evaluate(() => ({
    ghost: document.querySelectorAll('.pilfer-ghost').length,
    marks: document.querySelectorAll('.pilfer-straining,.pilfer-blocker').length,
    sourceVisibility: getComputedStyle(document.querySelector('#topBoard .col[data-col="0"] .die')).visibility,
    mine: JSON.stringify(window.__kb.S.boards[1][0]),
    theirs: JSON.stringify(window.__kb.S.boards[0][0]),
  }));
  check(out.pilferInterrupted.ghost === 0 && out.pilferInterrupted.marks === 0
    && out.pilferInterrupted.sourceVisibility === 'visible',
  'a restarted PI5 remained over the replacement generation', out.pilferInterrupted);
  check(out.pilferInterrupted.mine === '[4]' && out.pilferInterrupted.theirs === '[1,2,3]',
    'an interrupted pre-arrival PILFER mutated the board', out.pilferInterrupted);

  /* ANVIL marks the exact weakest die, then changes [2,3,3] at the white-hot
     midpoint without moving its visual centre or introducing a roll gesture. */
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
  check(out.anvilPreview.count === 1 && out.anvilPreview.value === 2 && out.anvilPreview.heat > .4,
    'ANVIL did not visibly mark the 2 in [2,3,3]', out.anvilPreview);
  check(out.anvilPreview.committed && out.anvilPreview.charges === '[{"anvil":1},{"anvil":0}]',
    'showing the ANVIL mark did not commit its charge', out.anvilPreview);

  /* Once the answer is painted, Escape, an off-board tap and pressing the
     committed rune again are all refusals — none may refund the charge or
     hide the markings. */
  await page.keyboard.press('Escape');
  await page.tap('#status');
  await tapRune();
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
    const rect = document.querySelector('#botBoard .col[data-col="0"] .slot[data-slot="0"] .die')
      .getBoundingClientRect();
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

  /* Live-rect motion must transpose rather than carry portrait assumptions. */
  const landscape = await sidePage({ name: 'PI5 landscape', w: 844, h: 390 });
  try {
    await newGame({ spell: 'pilfer' }, landscape.page);
    check(await waitChoose(landscape.page), 'game never reached choose (PI5 landscape)');
    await table([[4], [], []], [[1, 2, 3], [], []], 5, landscape.page);
    await landscape.page.evaluate(() => { void window.__kb.spells.cast('pilfer', 0); });
    await landscape.page.waitForTimeout(215);
    out.pilferLandscape = await landscape.page.evaluate(() => {
      const source = document.querySelector('#topBoard .col[data-col="0"] .slot .die')
        ?.getBoundingClientRect();
      const target = document.querySelector('#botBoard .col[data-col="0"] .slot:empty')
        ?.getBoundingClientRect();
      return {
        land: document.getElementById('kbroot').classList.contains('land'),
        blockers: document.querySelectorAll('.pilfer-blocker').length,
        horizontal: !!source && !!target
          && Math.abs(target.x - source.x) > Math.abs(target.y - source.y),
      };
    });
    check(out.pilferLandscape.land && out.pilferLandscape.blockers === 2
      && out.pilferLandscape.horizontal,
    'PI5 did not transpose its two real blocker beats in landscape', out.pilferLandscape);
  } finally {
    await landscape.ctx.close();
  }

  const reduced = await sidePage({
    name: 'spell effects reduced motion', w: 390, h: 844,
    opts: { reducedMotion: 'reduce' },
  });
  try {
    await newGame({ spell: 'pilfer' }, reduced.page);
    check(await waitChoose(reduced.page), 'game never reached choose (PI5 reduced)');
    await table([[4], [], []], [[1, 2, 3], [], []], 5, reduced.page);
    await reduced.page.evaluate(() => window.__kb.spells.cast('pilfer', 0));
    await newGame({ spell: 'anvil' }, reduced.page);
    check(await waitChoose(reduced.page), 'game never reached choose (ANVIL reduced)');
    await table([[2, 3, 3], [], []], [[1], [], []], 3, reduced.page);
    await reduced.page.evaluate(() => window.__kb.spells.cast('anvil', 0));
    out.spellEffectsReduced = await reduced.page.evaluate(() => ({
      column: JSON.stringify(window.__kb.S.boards[1][0]),
      ghosts: document.querySelectorAll('.pilfer-ghost,.anvil-workpiece').length,
      hidden: [...document.querySelectorAll('#topBoard .die,#botBoard .die,#dieStage>.die')]
        .filter((die) => getComputedStyle(die).visibility === 'hidden').length,
    }));
    check(out.spellEffectsReduced.column === '[3,3,3]'
      && out.spellEffectsReduced.ghosts === 0 && out.spellEffectsReduced.hidden === 0,
    'reduced motion did not resolve both effects to a clean readable result', out.spellEffectsReduced);
  } finally {
    await reduced.ctx.close();
  }
}
