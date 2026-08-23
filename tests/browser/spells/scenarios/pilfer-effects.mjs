/* PI5 — The snatch. These are computed-pixel contracts for its armed grip,
   bounded 0/1/2 resistance beats, straight flight and die-only landing. */
const FLIGHT_EASING = 'cubic-bezier(0.7,0,0.2,1)';
const STRAIN_EASING = 'cubic-bezier(0.5,0,0.3,1)';
const LANDING_EASING = 'cubic-bezier(0.2,1.7,0.4,1)';
const PI5_DEPTH = {
  1: { flight: 480, release: 0, along: [0], times: [0, 480], strainTimes: [], strainScales: [] },
  2: {
    flight: 1504, release: 1024, along: [0, 10, -3, 13, 4],
    times: [0, 288, 544, 800, 1024, 1504],
    strainTimes: [0, 800, 1024, 1184, 1440, 1760],
    strainScales: [1, 1.045, 1.02, .975, 1.01, 1],
  },
  3: {
    flight: 2016, release: 1536, along: [0, 10, -3, 13, 4, 13, 4],
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
  const middle = grip?.effect?.getKeyframes?.()
    .find((frame) => Math.abs(Number(frame.computedOffset ?? frame.offset) - .5) < .001);
  const matrix = new DOMMatrixReadOnly(String(middle?.transform || 'none'));
  const toward = rect && destination ? {
    x: destination.x + destination.width / 2 - (rect.x + rect.width / 2),
    y: destination.y + destination.height / 2 - (rect.y + rect.height / 2),
  } : { x: 0, y: 0 };
  const after = preview ? getComputedStyle(preview, '::after') : null;
  const land = document.getElementById('kbroot').classList.contains('land');
  return {
    land, count: previews.length, value: +(preview?.dataset.v || 0),
    exactTop: +(preview?.dataset.v || 0) === window.__kb.S.boards[0][0].at(-1),
    gripAnimation: !!grip, leanAnimation: !!lean, animations: animations.length,
    gripVector: [matrix.m41, matrix.m42],
    centreDot: matrix.m41 * toward.x + matrix.m42 * toward.y,
    centreAxis: land ? Math.abs(matrix.m41) > Math.abs(matrix.m42)
      : Math.abs(matrix.m42) > Math.abs(matrix.m41),
    openOuterEdge: land ? after?.borderLeftWidth === '0px' && after?.borderRightWidth !== '0px'
      : after?.borderTopWidth === '0px' && after?.borderBottomWidth !== '0px',
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
  const snap = document.querySelector('.pilfer-release-snap');
  const room = document.querySelector('.pilfer-room');
  const animation = ghost?.getAnimations().find((item) => item.id === 'kb-spell-motion');
  const strain = column?.getAnimations().find((item) => item.id === 'kb-spell-motion');
  const snapAnimation = snap?.getAnimations().find((item) => item.id === 'kb-spell-motion');
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
  const snapFrames = snapAnimation?.effect?.getKeyframes?.() || [];
  const snapDuration = Number(snapAnimation?.effect?.getTiming().duration || 0);
  animation?.pause(); strain?.pause(); snapAnimation?.pause();
  if (animation) animation.currentTime = 0;
  if (strain) strain.currentTime = 0;
  if (snapAnimation) snapAnimation.currentTime = 0;
  await new Promise(requestAnimationFrame);
  const snapRect = snap?.getBoundingClientRect();
  const ghostRect = ghost?.getBoundingClientRect();
  const snapDelta = snapRect && ghostRect ? {
    x: snapRect.x + snapRect.width / 2 - (ghostRect.x + ghostRect.width / 2),
    y: snapRect.y + snapRect.height / 2 - (ghostRect.y + ghostRect.height / 2),
  } : { x: 0, y: 0 };
  if (advance) {
    for (const item of [animation, strain, snapAnimation]) {
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
    snapDelay: Number(snapAnimation?.effect?.getTiming().delay || 0), snapDuration,
    snapTimes: snapFrames.map((frame) => rounded(offsetOf(frame) * snapDuration)),
    snapScales: snapFrames.map((frame) => {
      const matrix = new DOMMatrixReadOnly(String(frame.transform || 'none'));
      return rounded(horizontal ? matrix.m22 : matrix.m11);
    }),
    snapOpacities: snapFrames.map((frame) => +frame.opacity),
    snapEffectEasing: compact(snapAnimation?.effect?.getTiming().easing),
    snapFrameEasings: snapFrames.map((frame) => compact(frame.easing)),
    snapOriented: !!snapRect && (horizontal
      ? snapRect.height > snapRect.width : snapRect.width > snapRect.height),
    snapCentreFacing: snapDelta.x * unit.x + snapDelta.y * unit.y > 0,
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
  for (const height of [1, 2, 3]) {
    await newGame({ spell: 'pilfer' });
    check(await waitChoose(), `game never reached choose (PI5 height ${height})`);
    const theirs = Array.from({ length: height }, (_, index) => index + 1);
    await table([[4], [], []], [theirs, [], []], 5);
    await tapRune(); await page.waitForTimeout(80);
    const grip = await page.evaluate(pilferGripProbe);
    check(grip.count === 1 && grip.value === height && grip.exactTop && grip.sourceVisible,
      `PI5 height ${height} did not clasp exactly the stolen top die`, grip);
    check(!grip.land && grip.gripAnimation && grip.leanAnimation && grip.centreDot > 0
      && grip.centreAxis && grip.openOuterEdge,
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
    check(tension.snapDelay === depth.release && tension.snapDuration === 608
      && sameNumbers(tension.snapTimes, [0, 160, 608])
      && sameNumbers(tension.snapScales, [.2, 1, 2.4])
      && sameNumbers(tension.snapOpacities, [0, 1, 0])
      && tension.snapEffectEasing === 'linear'
      && tension.snapFrameEasings.every((easing) => easing === 'ease-out')
      && tension.snapOriented && tension.snapCentreFacing,
    `PI5 height ${height} lost its centre-facing release snap`, tension);
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
      ghosts: document.querySelectorAll('.pilfer-ghost,.pilfer-release-snap').length,
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
    ghost: document.querySelectorAll('.pilfer-ghost,.pilfer-release-snap').length,
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
      && lg.centreDot > 0 && lg.centreAxis && lg.openOuterEdge,
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
    check(lf.snapOriented && lf.snapCentreFacing && lf.roomCount === 1 && lf.roomCorrect,
      'PI5 landscape lost its centre-facing snap or destination room', lf);
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
      && rg.gripContent !== 'none' && rg.gripOpacity >= .8 && rg.gripTransform === 'none',
    'reduced motion removed the static armed PILFER grip', rg);
    await reduced.page.evaluate(() => window.__kb.spells.cast('pilfer', 0));
    await reduced.page.waitForTimeout(30);
    out.pilferReducedAfter = await reduced.page.evaluate(() => ({
      mine: JSON.stringify(window.__kb.S.boards[1][0]),
      theirs: JSON.stringify(window.__kb.S.boards[0][0]),
      transients: document.querySelectorAll(
        '.pilferpreview,.pilfer-ghost,.pilfer-release-snap,.pilfer-straining,'
        + '.pilfer-blocker,.pilfer-soft-settle,.pilfer-room').length,
      hidden: [...document.querySelectorAll('#topBoard .die,#botBoard .die')]
        .filter((die) => getComputedStyle(die).visibility === 'hidden').length,
    }));
    check(out.pilferReducedAfter.mine === '[4,3]' && out.pilferReducedAfter.theirs === '[1,2]'
      && out.pilferReducedAfter.transients === 0 && out.pilferReducedAfter.hidden === 0,
    'reduced PILFER left transient motion/cues after its direct result', out.pilferReducedAfter);
  } finally { await reduced.ctx.close(); }
}
