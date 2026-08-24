/* PI5 — The snatch. These are computed-pixel contracts for its armed grip,
   bounded 0/1/2 resistance beats, straight flight and die-only landing. */
const FLIGHT_EASING = 'cubic-bezier(0.7,0,0.2,1)';
const STRAIN_EASING = 'cubic-bezier(0.5,0,0.3,1)';
const LANDING_EASING = 'cubic-bezier(0.2,1.7,0.4,1)';
const PI5_DEPTH = {
  1: { flight: 480, along: [0], times: [0, 480], strainTimes: [], strainScales: [] },
  2: {
    flight: 1504, along: [0, 10, -3, 13, 4],
    times: [0, 288, 544, 800, 1024, 1504],
    strainTimes: [0, 800, 1024, 1184, 1440, 1760],
    strainScales: [1, 1.045, 1.02, .975, 1.01, 1],
  },
  3: {
    flight: 2016, along: [0, 10, -3, 13, 4, 13, 4],
    times: [0, 288, 544, 800, 1024, 1312, 1536, 2016],
    strainTimes: [0, 800, 1024, 1184, 1312, 1536, 1696, 1952, 2272],
    strainScales: [1, 1.045, 1.02, .975, 1.045, 1.02, .975, 1.01, 1],
  },
};
const sameNumbers = (actual, expected, tolerance = .02) => actual.length === expected.length
  && actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);

/* Browser callbacks stay closure-free so Playwright can serialize them. */
function pilferGripProbe() {
  const previews = [...document.querySelectorAll('#topBoard .pilferpreview')];
  const preview = previews[0];
  const destination = document.querySelector('#botBoard')?.getBoundingClientRect();
  const rect = preview?.getBoundingClientRect();
  const animations = preview?.getAnimations({ subtree: true }) || [];
  const grip = animations.find((animation) => animation.animationName === 'pilfer-preview-grip');
  const lean = preview?.getAnimations()
    .find((animation) => animation.animationName === 'pilfer-preview-lean');
  const middle = lean?.effect?.getKeyframes?.()
    .find((frame) => Math.abs(Number(frame.computedOffset ?? frame.offset) - .5) < .001);
  const matrix = new DOMMatrixReadOnly(String(middle?.transform || 'none'));
  const toward = rect && destination ? {
    x: destination.x + destination.width / 2 - (rect.x + rect.width / 2),
    y: destination.y + destination.height / 2 - (rect.y + rect.height / 2),
  } : { x: 0, y: 0 };
  const dieStyle = preview ? getComputedStyle(preview) : null;
  const after = preview ? getComputedStyle(preview, '::after') : null;
  const gripAttached = (grip?.effect?.getKeyframes?.() || []).every((frame) => {
    const gripMatrix = new DOMMatrixReadOnly(String(frame.transform || 'none'));
    return Math.abs(gripMatrix.m41) < .01 && Math.abs(gripMatrix.m42) < .01;
  });
  const land = document.getElementById('kbroot').classList.contains('land');
  return {
    land, count: previews.length, value: +(preview?.dataset.v || 0),
    exactTop: +(preview?.dataset.v || 0) === window.__kb.S.boards[0][0].at(-1),
    gripAnimation: !!grip, leanAnimation: !!lean, animations: animations.length,
    gripVector: [matrix.m41, matrix.m42],
    gripAttached,
    centreDot: matrix.m41 * toward.x + matrix.m42 * toward.y,
    centreAxis: land ? Math.abs(matrix.m41) > Math.abs(matrix.m42)
      : Math.abs(matrix.m42) > Math.abs(matrix.m41),
    openOuterEdge: land ? after?.borderLeftWidth === '0px' && after?.borderRightWidth !== '0px'
      : after?.borderTopWidth === '0px' && after?.borderBottomWidth !== '0px',
    outlineFlush: !!after && !!dieStyle
      && [after.top, after.right, after.bottom, after.left].every((inset) => inset === '0px')
      && after.borderRadius === dieStyle.borderRadius,
    outlineInsets: after ? [after.top, after.right, after.bottom, after.left] : [],
    outlineRadius: after?.borderRadius, dieRadius: dieStyle?.borderRadius,
    sourceVisible: preview ? getComputedStyle(preview).visibility === 'visible' : false,
    gripContent: after?.content, gripOpacity: +(after?.opacity || 0), gripTransform: after?.transform,
  };
}

async function pilferFlightProbe(advance) {
  const compact = (value) => String(value).replace(/\s+/g, '');
  const rounded = (value) => Math.round(value * 1000) / 1000;
  const offsetOf = (frame) => Number(frame.computedOffset ?? frame.offset);
  const column = document.querySelector('#topBoard .col[data-col="0"]');
  const ghost = document.querySelector('.pilfer-ghost');
  const blockers = [...column.querySelectorAll('.pilfer-blocker')];
  const room = document.querySelector('.pilfer-room');
  const animation = ghost?.getAnimations().find((item) => item.id === 'kb-spell-motion');
  const strain = column?.getAnimations().find((item) => item.id === 'kb-spell-motion');
  const duration = Number(animation?.effect?.getTiming().duration || 0);
  const frames = animation?.effect?.getKeyframes?.() || [];
  const vectors = frames.map((frame) => {
    const matrix = new DOMMatrixReadOnly(String(frame.transform || 'none'));
    return { x: matrix.m41, y: matrix.m42 };
  });
  const target = vectors.at(-1) || { x: 0, y: 1 };
  const distance = Math.hypot(target.x, target.y) || 1;
  const unit = { x: target.x / distance, y: target.y / distance };
  const horizontal = Math.abs(target.x) > Math.abs(target.y);
  const strainFrames = strain?.effect?.getKeyframes?.() || [];
  const strainDuration = Number(strain?.effect?.getTiming().duration || 0);
  animation?.pause(); strain?.pause();
  if (animation) animation.currentTime = 0;
  if (strain) strain.currentTime = 0;
  await new Promise(requestAnimationFrame);
  if (advance) {
    for (const item of [animation, strain]) {
      if (!item) continue;
      item.currentTime = Math.max(0, Number(item.effect?.getComputedTiming().endTime || 0) - 36);
      item.play();
    }
  }
  return {
    land: document.getElementById('kbroot').classList.contains('land'),
    declared: +(column.dataset.pilferCollisions || -1), blockers: blockers.length,
    blockerAnimations: blockers.flatMap((die) => die.getAnimations())
      .filter((item) => item.id === 'kb-spell-motion').length,
    columnAnimations: strain ? 1 : 0,
    flightDuration: duration, flightTimes: frames.map((frame) => rounded(offsetOf(frame) * duration)),
    flightAlong: vectors.map((point) => rounded(point.x * unit.x + point.y * unit.y)),
    flightAcross: vectors.map((point) => rounded(point.x * -unit.y + point.y * unit.x)),
    vertical: vectors.map((point) => rounded(point.y)), targetDistance: rounded(distance),
    horizontal: Math.abs(target.x) > 100 && Math.abs(target.y) < .5,
    flightEffectEasing: compact(animation?.effect?.getTiming().easing),
    flightFrameEasings: frames.map((frame) => compact(frame.easing)),
    strainTimes: strainFrames.map((frame) => rounded(offsetOf(frame) * strainDuration)),
    strainScales: strainFrames.map((frame) => {
      const matrix = new DOMMatrixReadOnly(String(frame.transform || 'none'));
      return rounded(horizontal ? matrix.m11 : matrix.m22);
    }),
    strainEffectEasing: compact(strain?.effect?.getTiming().easing),
    strainFrameEasings: strainFrames.map((frame) => compact(frame.easing)),
    releaseLines: document.querySelectorAll('.pilfer-release-snap').length,
    ghost: !!ghost, enemyColour: ghost?.classList.contains('p2') && !ghost.classList.contains('p1'),
    hiddenValues: [...column.querySelectorAll('.slot .die')]
      .filter((die) => getComputedStyle(die).visibility === 'hidden').map((die) => +die.dataset.v),
    roomCount: document.querySelectorAll('.pilfer-room').length,
    roomCorrect: !!room && room.matches('#botBoard .col[data-col="0"] .slot')
      && !room.firstElementChild && getComputedStyle(room).boxShadow !== 'none',
    state: [JSON.stringify(window.__kb.S.boards[1][0]),
      JSON.stringify(window.__kb.S.boards[0][0])].join('/'),
    particles: document.querySelectorAll('.particle').length,
    boardShake: document.getElementById('app').getAnimations()
      .some((item) => item.playState === 'running'),
  };
}

function pilferLandingProbe() {
  const die = document.querySelector('#botBoard .col[data-col="0"] .pilfer-soft-settle');
  const animation = die?.getAnimations().find((item) => item.id === 'kb-spell-motion');
  const frames = animation?.effect?.getKeyframes?.() || [];
  const duration = Number(animation?.effect?.getTiming().duration || 0);
  if (animation) { animation.currentTime = Math.max(0, duration - 36); animation.play(); }
  const compact = (value) => String(value).replace(/\s+/g, '');
  const offsetOf = (frame) => Number(frame.computedOffset ?? frame.offset);
  return {
    mine: JSON.stringify(window.__kb.S.boards[1][0]),
    theirs: JSON.stringify(window.__kb.S.boards[0][0]), settling: !!animation, duration,
    times: frames.map((frame) => Math.round(offsetOf(frame) * duration)),
    scales: frames.map((frame) => Math.round(new DOMMatrixReadOnly(
      String(frame.transform || 'none')).m11 * 1000) / 1000),
    effectEasing: compact(animation?.effect?.getTiming().easing),
    frameEasings: frames.map((frame) => compact(frame.easing)),
    transform: die ? getComputedStyle(die).transform : 'none',
    particles: document.querySelectorAll('.particle').length,
    flash: document.getElementById('flash').getAnimations().length,
    boardShake: document.getElementById('app').getAnimations().length,
  };
}

export async function runPilferEffectScenarios(suite) {
  const { page, out, check, newGame, waitChoose, table, tapRune, sidePage } = suite;
  out.pilferSnatch = [];

  /* Every legal enemy column gets the same PI5 waiting gesture on its exact
     top die. One-column fixtures cannot catch a second/third preview drifting
     back to a generic animation. */
  await newGame({ spell: 'pilfer' });
  check(await waitChoose(), 'game never reached choose (PI5 all targets)');
  await table([[], [], []], [[1], [2, 3], [4, 5, 6]], 5);
  await tapRune(); await page.waitForTimeout(80);
  out.pilferAllTargets = await page.evaluate(() => {
    const state = window.__kb.S;
    return [...document.querySelectorAll('#topBoard .pilferpreview')].map((die) => {
      const column = +(die.closest('.col')?.dataset.col || -1);
      const lean = die.getAnimations().find((item) => item.animationName === 'pilfer-preview-lean');
      const grip = die.getAnimations({ subtree: true })
        .find((item) => item.animationName === 'pilfer-preview-grip');
      const leanFrames = lean?.effect?.getKeyframes?.() || [];
      const gripFrames = grip?.effect?.getKeyframes?.() || [];
      const middle = leanFrames
        .find((frame) => Math.abs(Number(frame.computedOffset ?? frame.offset) - .5) < .001);
      const matrix = new DOMMatrixReadOnly(String(middle?.transform || 'none'));
      const after = getComputedStyle(die, '::after');
      const style = getComputedStyle(die);
      return {
        column,
        value: +die.dataset.v,
        exactTop: +die.dataset.v === state.boards[0][column].at(-1),
        leanDuration: Number(lean?.effect?.getTiming().duration || 0),
        leanEffectEasing: lean?.effect?.getTiming().easing,
        leanFrameEasings: leanFrames.map((frame) => frame.easing),
        towardY: matrix.m42,
        rotation: Math.atan2(matrix.m12, matrix.m11) * 180 / Math.PI,
        gripDuration: Number(grip?.effect?.getTiming().duration || 0),
        gripEffectEasing: grip?.effect?.getTiming().easing,
        gripFrameEasings: gripFrames.map((frame) => frame.easing),
        gripAttached: gripFrames.every((frame) => {
          const gripMatrix = new DOMMatrixReadOnly(String(frame.transform || 'none'));
          return Math.abs(gripMatrix.m41) < .01 && Math.abs(gripMatrix.m42) < .01;
        }),
        outlineFlush: [after.top, after.right, after.bottom, after.left]
          .every((inset) => inset === '0px') && after.borderRadius === style.borderRadius,
      };
    });
  });
  check(out.pilferAllTargets.length === 3
      && out.pilferAllTargets.every((target, column) => target.column === column
        && target.exactTop && target.leanDuration === 1600 && target.leanEffectEasing === 'linear'
        && target.leanFrameEasings.every((easing) => easing === 'ease-in-out')
        && Math.abs(target.towardY - 2) < .02 && Math.abs(target.rotation - 1.6) < .02
        && target.gripDuration === 1600 && target.gripEffectEasing === 'linear'
        && target.gripFrameEasings.every((easing) => easing === 'ease-in-out')
        && target.gripAttached && target.outlineFlush),
    'PI5 did not give every draggable target the same attached waiting gesture', out.pilferAllTargets);
  await page.evaluate(() => window.__kb.spells.disarm(true));

  for (const height of [1, 2, 3]) {
    await newGame({ spell: 'pilfer' });
    check(await waitChoose(), `game never reached choose (PI5 height ${height})`);
    const theirs = Array.from({ length: height }, (_, index) => index + 1);
    await table([[4], [], []], [theirs, [], []], 5);
    await tapRune(); await page.waitForTimeout(80);
    const grip = await page.evaluate(pilferGripProbe);
    check(grip.count === 1 && grip.value === height && grip.exactTop && grip.sourceVisible,
      `PI5 height ${height} did not clasp exactly the stolen top die`, grip);
    check(!grip.land && grip.gripAnimation && grip.leanAnimation && grip.gripAttached
      && grip.outlineFlush && grip.centreDot > 0 && grip.centreAxis && grip.openOuterEdge,
    `PI5 height ${height} grip did not face the portrait table centre`, grip);

    await page.evaluate(() => { void window.__kb.spells.cast('pilfer', 0); });
    await page.waitForTimeout(60);
    const expected = height - 1, depth = PI5_DEPTH[height];
    const tension = await page.evaluate(pilferFlightProbe, true);
    check(tension.declared === expected && tension.blockers === expected
      && tension.blockerAnimations === 0 && tension.columnAnimations === (expected ? 1 : 0),
    `PI5 height ${height} did not expose exactly ${expected} resistance beat(s)`, tension);
    check(tension.flightDuration === depth.flight && sameNumbers(tension.flightTimes, depth.times),
      `PI5 height ${height} lost its exact depth timing`, tension);
    check(sameNumbers(tension.flightAlong.slice(0, -1), depth.along)
      && Math.abs(tension.flightAlong.at(-1) - tension.targetDistance) < .02
      && tension.targetDistance > 100
      && tension.flightAcross.every((amount) => Math.abs(amount) < .02),
    `PI5 height ${height} lost its exact straight/local waypoints`, tension);
    check(tension.flightEffectEasing === 'linear'
      && tension.flightFrameEasings.every((easing) => easing === FLIGHT_EASING),
    `PI5 height ${height} did not use PI5's per-segment flight curve`, tension);
    check(sameNumbers(tension.strainTimes, depth.strainTimes)
      && sameNumbers(tension.strainScales, depth.strainScales)
      && (expected === 0 || (tension.strainEffectEasing === 'linear'
        && tension.strainFrameEasings.every((easing) => easing === STRAIN_EASING))),
    `PI5 height ${height} lost its exact repeated column strain`, tension);
    check(tension.releaseLines === 0,
      `PI5 height ${height} drew a release line across the die's path`, tension);
    check(tension.ghost && tension.enemyColour && sameNumbers(tension.hiddenValues, [height]),
      'the stolen die did not lift as one enemy-coloured copy', tension);
    check(tension.roomCount === 1 && tension.roomCorrect,
      'PI5 did not light exactly the destination room during flight', tension);
    check(tension.state === `[4]/${JSON.stringify(theirs)}`,
      'PILFER committed before the stolen die arrived', tension);
    check(tension.particles === 0 && !tension.boardShake,
      'PILFER taught a strike with particles or a board shake', tension);

    await page.waitForTimeout(90);
    const arrival = await page.evaluate(pilferLandingProbe);
    check(arrival.mine === JSON.stringify([4, height])
      && arrival.theirs === JSON.stringify(theirs.slice(0, -1)),
    'PILFER did not repaint both boards at the arrival beat', arrival);
    check(arrival.settling && arrival.duration === 576 && arrival.transform !== 'none'
      && sameNumbers(arrival.times, [0, 256, 576])
      && sameNumbers(arrival.scales, [1.1, .94, 1]) && arrival.effectEasing === 'linear'
      && arrival.frameEasings.every((easing) => easing === LANDING_EASING),
    'PI5 arrived without its measured die-only squash', arrival);
    check(arrival.particles === 0 && arrival.flash === 0 && arrival.boardShake === 0,
      'the PI5 arrival still reads as a destructive strike', arrival);
    await page.waitForTimeout(100);
    const cleaned = await page.evaluate(() => ({
      ghosts: document.querySelectorAll('.pilfer-ghost').length,
      strain: document.querySelectorAll('.pilfer-straining,.pilfer-blocker,.pilfer-soft-settle').length,
      rooms: document.querySelectorAll('.pilfer-room').length,
      grips: document.querySelectorAll('.pilferpreview').length,
      hidden: [...document.querySelectorAll('#topBoard .die,#botBoard .die')]
        .filter((die) => getComputedStyle(die).visibility === 'hidden').length,
    }));
    check(cleaned.ghosts === 0 && cleaned.strain === 0 && cleaned.rooms === 0
      && cleaned.grips === 0 && cleaned.hidden === 0,
    'PI5 left a ghost, tension/cue marker, or hidden die behind', cleaned);
    out.pilferSnatch.push({ height, grip, tension, arrival, cleaned });
  }

  await newGame({ spell: 'pilfer' });
  check(await waitChoose(), 'game never reached choose (PI5 cleanup)');
  await table([[4], [], []], [[1, 2, 3], [], []], 5);
  await page.evaluate(() => { void window.__kb.spells.cast('pilfer', 0); });
  await page.waitForTimeout(120); await page.evaluate(() => { window.__kb.S.gen++; });
  await page.waitForTimeout(100);
  out.pilferInterrupted = await page.evaluate(() => ({
    ghost: document.querySelectorAll('.pilfer-ghost').length,
    marks: document.querySelectorAll(
      '.pilfer-straining,.pilfer-blocker,.pilfer-room,.pilferpreview').length,
    sourceVisibility: getComputedStyle(
      document.querySelector('#topBoard .col[data-col="0"] .die')).visibility,
    mine: JSON.stringify(window.__kb.S.boards[1][0]),
    theirs: JSON.stringify(window.__kb.S.boards[0][0]),
  }));
  check(out.pilferInterrupted.ghost === 0 && out.pilferInterrupted.marks === 0
    && out.pilferInterrupted.sourceVisibility === 'visible',
  'a restarted PI5 remained over the replacement generation', out.pilferInterrupted);
  check(out.pilferInterrupted.mine === '[4]' && out.pilferInterrupted.theirs === '[1,2,3]',
    'an interrupted pre-arrival PILFER mutated the board', out.pilferInterrupted);

  const landscape = await sidePage({ name: 'PI5 landscape', w: 844, h: 390 });
  try {
    await newGame({ spell: 'pilfer' }, landscape.page);
    check(await waitChoose(landscape.page), 'game never reached choose (PI5 landscape)');
    await table([[4], [], []], [[1, 2, 3], [], []], 5, landscape.page);
    await landscape.page.tap('#spellBar .rune:not([hidden])');
    await landscape.page.waitForTimeout(80);
    out.pilferLandscapeGrip = await landscape.page.evaluate(pilferGripProbe);
    const lg = out.pilferLandscapeGrip;
    check(lg.land && lg.count === 1 && lg.value === 3 && lg.exactTop && lg.gripAnimation
      && lg.gripAttached && lg.outlineFlush && lg.centreDot > 0
      && lg.centreAxis && lg.openOuterEdge,
    'PI5 did not transpose its armed grip toward the landscape centre', lg);
    await landscape.page.evaluate(() => { void window.__kb.spells.cast('pilfer', 0); });
    await landscape.page.waitForTimeout(60);
    out.pilferLandscape = await landscape.page.evaluate(pilferFlightProbe, false);
    const lf = out.pilferLandscape, depth = PI5_DEPTH[3];
    check(lf.land && lf.blockers === 2 && lf.horizontal && lf.flightDuration === depth.flight
      && sameNumbers(lf.flightTimes, depth.times)
      && sameNumbers(lf.flightAlong.slice(0, -1), depth.along)
      && Math.abs(lf.flightAlong.at(-1) - lf.targetDistance) < .02
      && lf.flightAcross.every((amount) => Math.abs(amount) < .02)
      && lf.vertical.every((amount) => Math.abs(amount) < .5)
      && lf.flightEffectEasing === 'linear'
      && lf.flightFrameEasings.every((easing) => easing === FLIGHT_EASING),
    'PI5 did not transpose its two exact beats into a straight horizontal flight', lf);
    check(lf.releaseLines === 0 && lf.roomCount === 1 && lf.roomCorrect,
      'PI5 landscape drew a release line or lost its destination room', lf);
  } finally { await landscape.ctx.close(); }

  const reduced = await sidePage({
    name: 'spell effects reduced motion', w: 390, h: 844,
    opts: { reducedMotion: 'reduce' },
  });
  try {
    await newGame({ spell: 'pilfer' }, reduced.page);
    check(await waitChoose(reduced.page), 'game never reached choose (PI5 reduced)');
    await table([[4], [], []], [[1, 2, 3], [], []], 5, reduced.page);
    await reduced.page.tap('#spellBar .rune:not([hidden])'); await reduced.page.waitForTimeout(50);
    out.pilferReducedGrip = await reduced.page.evaluate(pilferGripProbe);
    const rg = out.pilferReducedGrip;
    check(rg.count === 1 && rg.value === 3 && rg.exactTop && rg.animations === 0
      && rg.outlineFlush && rg.gripContent !== 'none'
      && rg.gripOpacity >= .8 && rg.gripTransform === 'none',
    'reduced motion removed the static armed PILFER grip', rg);
    await reduced.page.evaluate(() => window.__kb.spells.cast('pilfer', 0));
    await reduced.page.waitForTimeout(30);
    out.pilferReducedAfter = await reduced.page.evaluate(() => ({
      mine: JSON.stringify(window.__kb.S.boards[1][0]),
      theirs: JSON.stringify(window.__kb.S.boards[0][0]),
      transients: document.querySelectorAll(
        '.pilferpreview,.pilfer-ghost,.pilfer-straining,'
        + '.pilfer-blocker,.pilfer-soft-settle,.pilfer-room').length,
      hidden: [...document.querySelectorAll('#topBoard .die,#botBoard .die')]
        .filter((die) => getComputedStyle(die).visibility === 'hidden').length,
    }));
    check(out.pilferReducedAfter.mine === '[4,3]' && out.pilferReducedAfter.theirs === '[1,2]'
      && out.pilferReducedAfter.transients === 0 && out.pilferReducedAfter.hidden === 0,
    'reduced PILFER left transient motion/cues after its direct result', out.pilferReducedAfter);
  } finally { await reduced.ctx.close(); }
}
