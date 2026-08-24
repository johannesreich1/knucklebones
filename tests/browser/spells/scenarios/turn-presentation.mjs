export async function runTurnPresentationScenarios(suite) {
  const { page, out, check, newGame, waitChoose, sidePage, devices } = suite;

  await newGame();
  check(await waitChoose(), 'game never reached choose (turn presentation)');

  const rail = () => page.evaluate(() => {
    const card = document.querySelector('#spellBar .rune:not([hidden])');
    if (!card) return null;
    const charge = card.querySelector('.rune-charge.top');
    const back = charge?.querySelector('.rback');
    const icon = back?.querySelector('svg');
    const style = getComputedStyle(card);
    const matrix = style.transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
    const rect = card.getBoundingClientRect();
    const relative = (element) => {
      if (!element) return null;
      const inner = element.getBoundingClientRect();
      return { x: (inner.left - rect.left) / rect.width, y: (inner.top - rect.top) / rect.height,
        width: inner.width / rect.width, height: inner.height / rect.height };
    };
    return {
      seat: card.dataset.seat, disabled: card.disabled,
      offturn: card.classList.contains('offturn'), unavailable: card.classList.contains('unavailable'),
      opponentTurn: document.getElementById('kbroot').classList.contains('opponent-turn'),
      opacity: Number(style.opacity), filter: style.filter, transform: style.transform,
      scale: Math.hypot(matrix.a, matrix.b),
      card: { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2,
        width: rect.width, height: rect.height },
      charge: relative(charge), icon: relative(icon),
      cards: [...card.querySelectorAll('.rune-charge')].filter((element) => !element.hidden).length,
      pulse: charge ? getComputedStyle(charge, '::after').animationName : 'none',
      wash: back ? getComputedStyle(back, '::before').backgroundImage : 'none',
    };
  });
  const turnTo = async (turn) => {
    await page.evaluate((next) => {
      const k = window.__kb;
      k.S.mode = 'cpu'; k.S.turn = next; k.S.bottom = 1; k.S.busy = false;
      k.S.boards = [[[3], [], []], [[4], [], []]];
      k.S.phase = next === 1 ? 'choose' : 'anim'; k.S.die = 3;
      k.applySides(); k.setActivePlate(); k.spells.render();
    }, turn);
    await page.waitForTimeout(320);
  };

  await turnTo(0); out.theirTurn = await rail();
  await turnTo(1); out.myTurn = await rail();
  await page.evaluate(() => { window.__kb.S.busy = true; window.__kb.spells.render(); });
  await page.waitForTimeout(80);
  out.busyMyTurn = await rail();
  check(out.theirTurn?.seat === '0' && out.theirTurn.disabled && out.theirTurn.cards === 1
      && out.theirTurn.offturn && !out.theirTurn.unavailable && out.theirTurn.opponentTurn
      && Math.abs(out.theirTurn.scale - .95) <= .002
      && out.theirTurn.opacity >= .40 && out.theirTurn.opacity <= .44
      && out.theirTurn.filter === 'grayscale(0.6)',
    'the CPU-owned card did not retain the visible off-turn mute and scale', out.theirTurn);
  check(out.myTurn?.seat === '1' && !out.myTurn.disabled && out.myTurn.cards === 1
      && !out.myTurn.offturn && !out.myTurn.unavailable && !out.myTurn.opponentTurn
      && Math.abs(out.myTurn.scale - 1) <= .002
      && out.myTurn.opacity >= .99 && out.myTurn.filter === 'grayscale(0)'
      && out.myTurn.transform !== 'none'
      && out.myTurn.pulse === 'none',
    'the player turn did not deal its full-size castable card into the shared rail', out.myTurn);
  check(out.theirTurn?.pulse === 'none' && out.theirTurn.wash !== 'none'
      && out.theirTurn.wash === out.myTurn?.wash,
    'the card tint flickered or changed with turn availability',
    { theirs: out.theirTurn, mine: out.myTurn });
  check(out.busyMyTurn?.disabled && !out.busyMyTurn.offturn && !out.busyMyTurn.unavailable
      && !out.busyMyTurn.opponentTurn && Math.abs(out.busyMyTurn.scale - 1) <= .002
      && out.busyMyTurn.opacity === out.myTurn?.opacity
      && out.busyMyTurn.filter === out.myTurn?.filter
      && out.busyMyTurn.wash === out.myTurn?.wash,
    'a transient busy state visually changed the player-owned card',
    { mine: out.myTurn, busy: out.busyMyTurn });

  /* The suite's main page is an iPhone 13. Sampling actual paint frames catches
     a moving centre or corner icon instead of merely checking the final class. */
  const sampleTransition = (from, to) => page.evaluate(async ([startTurn, endTurn]) => {
    const k = window.__kb;
    const root = document.getElementById('kbroot');
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const paint = (turn) => {
      k.S.mode = 'cpu'; k.S.turn = turn; k.S.bottom = 1; k.S.busy = false;
      k.S.boards = [[[3], [], []], [[4], [], []]];
      k.S.phase = turn === 1 ? 'choose' : 'anim'; k.S.die = 3;
      k.applySides(); k.setActivePlate(); k.spells.render();
    };
    const frame = () => {
      const card = document.querySelector('#spellBar .rune:not([hidden])');
      const charge = card?.querySelector('.rune-charge.top');
      const icon = charge?.querySelector('.rback svg');
      if (!card || !charge || !icon) return null;
      const style = getComputedStyle(card);
      const matrix = style.transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
      const rect = card.getBoundingClientRect();
      const relative = (element) => {
        const inner = element.getBoundingClientRect();
        return { x: (inner.left - rect.left) / rect.width, y: (inner.top - rect.top) / rect.height,
          width: inner.width / rect.width, height: inner.height / rect.height };
      };
      return {
        opponentTurn: root.classList.contains('opponent-turn'),
        scale: Math.hypot(matrix.a, matrix.b), transform: style.transform,
        transitionProperty: style.transitionProperty, transitionDuration: style.transitionDuration,
        card: { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2,
          width: rect.width, height: rect.height },
        charge: relative(charge), icon: relative(icon),
      };
    };
    paint(startTurn); await pause(320);
    const before = frame();
    paint(endTurn);
    const frames = [frame()], started = performance.now();
    while (performance.now() - started < 330) {
      await new Promise(requestAnimationFrame);
      frames.push(frame());
    }
    return { before, frames: frames.filter(Boolean) };
  }, [from, to]);
  const shrink = await sampleTransition(1, 0);
  const grow = await sampleTransition(0, 1);
  out.turnScaleTransition = { shrink, grow };
  const last = (sample) => sample.frames[sample.frames.length - 1];
  const monotonic = (sample, down) => sample.frames.every((frame, index, frames) => index === 0
    || (down ? frame.scale <= frames[index - 1].scale + .0005
      : frame.scale + .0005 >= frames[index - 1].scale));
  const centreDrift = (sample) => Math.max(...sample.frames.flatMap((frame) => [
    Math.abs(frame.card.cx - sample.before.card.cx), Math.abs(frame.card.cy - sample.before.card.cy),
  ]));
  const innerDrift = (sample) => Math.max(...sample.frames.flatMap((frame) =>
    ['charge', 'icon'].flatMap((part) => ['x', 'y', 'width', 'height']
      .map((key) => Math.abs(frame[part][key] - sample.before[part][key])))));
  const shrinkLast = last(shrink), growLast = last(grow);
  const properties = shrink.before.transitionProperty.split(',').map((value) => value.trim());
  const durations = shrink.before.transitionDuration.split(',').map((value) => value.trim());
  check(shrink.before.transform !== 'none'
      && properties.includes('transform') && properties.includes('opacity') && properties.includes('filter')
      && durations.length === 3 && durations.every((value) => value === '0.25s'),
    'the turn cue properties do not share the intended 250ms transition', shrink.before);
  check(Math.abs(shrink.before.scale - 1) <= .002 && Math.abs(shrinkLast.scale - .95) <= .002
      && shrink.frames.some((frame) => frame.scale < .995 && frame.scale > .955)
      && monotonic(shrink, true) && shrink.frames.every((frame) => frame.opponentTurn),
    'the opponent hand did not animate monotonically from full size to 95%', shrink);
  check(Math.abs(grow.before.scale - .95) <= .002 && Math.abs(growLast.scale - 1) <= .002
      && grow.frames.some((frame) => frame.scale > .955 && frame.scale < .995)
      && monotonic(grow, false) && grow.frames.every((frame) => !frame.opponentTurn),
    'the player hand did not animate monotonically back to exact full size', grow);
  check(centreDrift(shrink) <= .15 && centreDrift(grow) <= .15
      && innerDrift(shrink) <= .002 && innerDrift(grow) <= .002
      && Math.abs(growLast.card.width - shrink.before.card.width) <= .05
      && Math.abs(growLast.card.height - shrink.before.card.height) <= .05,
    'the card centre or rune symbol twitched during the iPhone turn transition',
    { shrinkCentre: centreDrift(shrink), growCentre: centreDrift(grow),
      shrinkInner: innerDrift(shrink), growInner: innerDrift(grow) });

  /* Explicit viewers model ranked clients. A shared phone has no fixed viewer,
     whether it is passed between players or held face-to-face. */
  out.turnViewerOwnership = await page.evaluate(async () => {
    const k = window.__kb;
    const root = document.getElementById('kbroot');
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const cases = [];
    const read = (kind, seat, viewer, turn) => {
      const style = getComputedStyle(document.querySelector('#spellBar .rune:not([hidden])'));
      const matrix = style.transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
      return { kind, seat, viewer, turn, opponentTurn: root.classList.contains('opponent-turn'),
        scale: Math.hypot(matrix.a, matrix.b) };
    };
    for (const viewer of [0, 1]) for (const turn of [0, 1]) {
      k.S.mode = 'duo'; k.S.seat = 'pass'; k.S.turn = turn; k.S.bottom = viewer;
      k.S.phase = 'choose'; k.S.busy = false;
      k.applySides(); k.setActivePlate(viewer); k.spells.render();
      await pause(280);
      cases.push(read('fixed-viewer', 'pass', viewer, turn));
    }
    for (const seat of ['pass', 'face']) for (const turn of [0, 1]) {
      k.S.mode = 'duo'; k.S.seat = seat; k.S.turn = turn;
      k.S.bottom = seat === 'pass' ? turn : 1;
      k.S.phase = 'choose'; k.S.busy = false;
      k.applySides(); k.setActivePlate(); k.spells.render();
      await pause(280);
      cases.push(read('shared-phone', seat, null, turn));
    }
    return cases;
  });
  check(out.turnViewerOwnership.filter((entry) => entry.kind === 'fixed-viewer')
      .every((entry) => entry.opponentTurn === (entry.turn !== entry.viewer)
        && Math.abs(entry.scale - (entry.turn === entry.viewer ? 1 : .95)) <= .002),
    'an explicit viewer seat did not own the opponent-turn presentation', out.turnViewerOwnership);
  check(out.turnViewerOwnership.filter((entry) => entry.kind === 'shared-phone')
      .every((entry) => !entry.opponentTurn && Math.abs(entry.scale - 1) <= .002),
    'a local two-human turn was incorrectly presented as opponent-owned', out.turnViewerOwnership);

  const reducedTurn = await sidePage({ name: 'turn scale reduced motion',
    device: devices['iPhone 13'], opts: { reducedMotion: 'reduce' } });
  try {
    await newGame({ spell: 'pilfer' }, reducedTurn.page);
    check(await waitChoose(reducedTurn.page), 'game never reached choose (turn scale reduced)');
    out.turnScaleReduced = await reducedTurn.page.evaluate(async () => {
      const k = window.__kb;
      const root = document.getElementById('kbroot');
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const setTurn = (turn) => {
        k.S.mode = 'cpu'; k.S.turn = turn; k.S.bottom = 1; k.S.busy = false;
        k.S.phase = turn === 1 ? 'choose' : 'anim';
        k.applySides(); k.setActivePlate(); k.spells.render();
      };
      const read = () => {
        const card = document.querySelector('#spellBar .rune:not([hidden])');
        const icon = card.querySelector('.rune-charge.top .rback svg');
        const style = getComputedStyle(card);
        const matrix = style.transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
        const cr = card.getBoundingClientRect(), ir = icon.getBoundingClientRect();
        return { opponentTurn: root.classList.contains('opponent-turn'),
          scale: Math.hypot(matrix.a, matrix.b), duration: style.transitionDuration,
          cx: cr.left + cr.width / 2, cy: cr.top + cr.height / 2,
          icon: { x: (ir.left - cr.left) / cr.width, y: (ir.top - cr.top) / cr.height,
            width: ir.width / cr.width, height: ir.height / cr.height } };
      };
      /* A loaded Linux compositor can advance fewer paint frames than a JS
         timer's wall clock implies. Synchronize with the actual transition,
         while the assertion below independently pins its authored 60ms
         reduced-motion duration. Re-check because the first frame can replace
         a transition as the new turn state reaches the compositor. */
      const settle = async () => {
        const card = document.querySelector('#spellBar .rune:not([hidden])');
        getComputedStyle(card).transform;
        await frame();
        for (let pass = 0; pass < 3; pass++) {
          const running = card.getAnimations().filter((animation) =>
            animation.playState === 'pending' || animation.playState === 'running');
          if (!running.length) {
            await frame();
            if (!card.getAnimations().some((animation) =>
              animation.playState === 'pending' || animation.playState === 'running')) break;
            continue;
          }
          await Promise.allSettled(running.map((animation) => animation.finished));
          await frame();
        }
      };
      setTurn(1); await settle(); const full = read();
      setTurn(0); const immediate = read(); await settle(); const opponent = read();
      setTurn(1); await settle(); const fullAgain = read();
      return { reduced: k.reduced, rootReduced: root.classList.contains('reduce-motion'),
        full, immediate, opponent, fullAgain };
    });
    const reduced = out.turnScaleReduced;
    const iconDrift = Math.max(...['x', 'y', 'width', 'height'].map((key) =>
      Math.max(Math.abs(reduced.opponent.icon[key] - reduced.full.icon[key]),
        Math.abs(reduced.fullAgain.icon[key] - reduced.full.icon[key]))));
    check(reduced.reduced && reduced.rootReduced && reduced.immediate.opponentTurn
        && Math.abs(reduced.full.scale - 1) <= .002 && Math.abs(reduced.opponent.scale - .95) <= .002
        && Math.abs(reduced.fullAgain.scale - 1) <= .002
        && !reduced.full.opponentTurn && reduced.opponent.opponentTurn && !reduced.fullAgain.opponentTurn
        && reduced.opponent.duration.split(',').every((value) => value.trim() === '0.06s')
        && Math.abs(reduced.opponent.cx - reduced.full.cx) <= .15
        && Math.abs(reduced.opponent.cy - reduced.full.cy) <= .15 && iconDrift <= .002,
      'reduced motion did not settle the centred turn scale within its 60ms policy',
      { ...reduced, iconDrift });
  } finally { await reducedTurn.ctx.close(); }

  await turnTo(0);
  check((await rail())?.opponentTurn, 'menu cleanup fixture never entered opponent-turn');
  await page.tap('#btnLeave');
  await page.waitForSelector('#ovAsk.on');
  await page.tap('#btnAskYes');
  await page.waitForTimeout(80);
  out.opponentTurnMenuClear = await page.evaluate(() => ({
    opponentTurn: document.getElementById('kbroot').classList.contains('opponent-turn'),
    phase: window.__kb.S.phase,
    home: document.getElementById('ovStart').classList.contains('on'),
  }));
  check(!out.opponentTurnMenuClear.opponentTurn && out.opponentTurnMenuClear.phase === 'over'
      && out.opponentTurnMenuClear.home,
    'leaving a CPU turn kept the opponent-turn presentation on Home', out.opponentTurnMenuClear);
}
