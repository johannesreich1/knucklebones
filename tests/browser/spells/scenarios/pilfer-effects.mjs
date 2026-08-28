/* PI5 — The snatch, driven the way a player drives it: every legal target
   armed, three depth ladders, an interrupted cast, landscape and reduced
   motion. What the screen is asked at each beat, and the measured values the
   answers are held to, live in ./pilfer-contract.mjs. */
import {
  FLIGHT_EASING, LANDING_EASING, PI5_DEPTH, STRAIN_EASING, sameNumbers,
  readPilferFlight, readPilferGrip, readPilferLanding, readPilferResidue, readPilferTargets,
} from './pilfer-contract.mjs';

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
  out.pilferAllTargets = await readPilferTargets(page);
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
    const grip = await readPilferGrip(page);
    check(grip.count === 1 && grip.value === height && grip.exactTop && grip.sourceVisible,
      `PI5 height ${height} did not clasp exactly the stolen top die`, grip);
    check(!grip.land && grip.gripAnimation && grip.leanAnimation && grip.gripAttached
      && grip.outlineFlush && grip.centreDot > 0 && grip.centreAxis && grip.openOuterEdge,
    `PI5 height ${height} grip did not face the portrait table centre`, grip);

    await page.evaluate(() => { void window.__kb.spells.cast('pilfer', 0); });
    await page.waitForTimeout(60);
    const expected = height - 1, depth = PI5_DEPTH[height];
    const tension = await readPilferFlight(page, true);
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
    const arrival = await readPilferLanding(page);
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
    const cleaned = await readPilferResidue(page);
    check(cleaned.transients === 0 && cleaned.hidden === 0,
      'PI5 left a ghost, tension/cue marker, or hidden die behind', cleaned);
    out.pilferSnatch.push({ height, grip, tension, arrival, cleaned });
  }

  await newGame({ spell: 'pilfer' });
  check(await waitChoose(), 'game never reached choose (PI5 cleanup)');
  await table([[4], [], []], [[1, 2, 3], [], []], 5);
  await page.evaluate(() => { void window.__kb.spells.cast('pilfer', 0); });
  await page.waitForTimeout(120); await page.evaluate(() => { window.__kb.S.gen++; });
  await page.waitForTimeout(100);
  out.pilferInterrupted = await readPilferResidue(page);
  const interrupted = out.pilferInterrupted;
  /* Narrower on purpose than the post-arrival sweep above: no ghost, no
     strain/blocker/room/preview marker, and the source die still visible.
     This sweep has never counted .pilfer-soft-settle, and gaining that
     assertion here would be a strictly stronger gate — a separate decision. */
  const marks = interrupted.straining + interrupted.blockers
    + interrupted.rooms + interrupted.grips;
  check(interrupted.ghosts === 0 && marks === 0
    && interrupted.sourceVisibility === 'visible',
  'a restarted PI5 remained over the replacement generation', interrupted);
  check(interrupted.mine === '[4]' && interrupted.theirs === '[1,2,3]',
    'an interrupted pre-arrival PILFER mutated the board', interrupted);

  const landscape = await sidePage({ name: 'PI5 landscape', w: 844, h: 390 });
  try {
    await newGame({ spell: 'pilfer' }, landscape.page);
    check(await waitChoose(landscape.page), 'game never reached choose (PI5 landscape)');
    await table([[4], [], []], [[1, 2, 3], [], []], 5, landscape.page);
    await landscape.page.tap('#spellBar .rune.hand-active:not([hidden])');
    await landscape.page.waitForTimeout(80);
    out.pilferLandscapeGrip = await readPilferGrip(landscape.page);
    const lg = out.pilferLandscapeGrip;
    check(lg.land && lg.count === 1 && lg.value === 3 && lg.exactTop && lg.gripAnimation
      && lg.gripAttached && lg.outlineFlush && lg.centreDot > 0
      && lg.centreAxis && lg.openOuterEdge,
    'PI5 did not transpose its armed grip toward the landscape centre', lg);
    await landscape.page.evaluate(() => { void window.__kb.spells.cast('pilfer', 0); });
    await landscape.page.waitForTimeout(60);
    out.pilferLandscape = await readPilferFlight(landscape.page, false);
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
    await reduced.page.tap('#spellBar .rune.hand-active:not([hidden])'); await reduced.page.waitForTimeout(50);
    out.pilferReducedGrip = await readPilferGrip(reduced.page);
    const rg = out.pilferReducedGrip;
    check(rg.count === 1 && rg.value === 3 && rg.exactTop && rg.animations === 0
      && rg.outlineFlush && rg.gripContent !== 'none'
      && rg.gripOpacity >= .8 && rg.gripTransform === 'none',
    'reduced motion removed the static armed PILFER grip', rg);
    await reduced.page.evaluate(() => window.__kb.spells.cast('pilfer', 0));
    await reduced.page.waitForTimeout(30);
    out.pilferReducedAfter = await readPilferResidue(reduced.page);
    check(out.pilferReducedAfter.mine === '[4,3]' && out.pilferReducedAfter.theirs === '[1,2]'
      && out.pilferReducedAfter.transients === 0 && out.pilferReducedAfter.hidden === 0,
    'reduced PILFER left transient motion/cues after its direct result', out.pilferReducedAfter);
  } finally { await reduced.ctx.close(); }
}
