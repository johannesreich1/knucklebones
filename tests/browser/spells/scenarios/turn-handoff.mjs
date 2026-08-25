export async function runTurnHandoffScenarios(suite) {
  const { page, out, check, newGame, waitChoose, rail, turnTo } = suite;

  await newGame();
  check(await waitChoose(), 'game never reached choose (turn presentation)');

  await page.evaluate(() => {
    for (const card of document.querySelectorAll('#spellBar .rune:not([hidden])')) {
      card.dataset.handoffProbe = `seat-${card.dataset.seat}`;
    }
  });
  await turnTo(0); out.theirTurn = await rail();
  await turnTo(1); out.myTurn = await rail();
  await page.evaluate(() => { window.__kb.S.busy = true; window.__kb.spells.render(); });
  await page.waitForTimeout(80);
  out.busyMyTurn = await rail();
  check(out.theirTurn.paired && out.theirTurn.count === 2
      && out.theirTurn.active?.seat === '0' && out.theirTurn.standby?.seat === '1'
      && out.theirTurn.cards.every((card) => card.spell === 'pilfer'
        && card.probe === `seat-${card.seat}`),
    'a standard shared rune did not keep two persistent seat cards and switch the active hand',
    out.theirTurn);
  check(out.theirTurn.active.disabled && out.theirTurn.active.cards === 1
      && out.theirTurn.active.offturn && !out.theirTurn.active.unavailable
      && out.theirTurn.opponentTurn && Math.abs(out.theirTurn.active.scale - .95) <= .002
      && out.theirTurn.active.opacity >= .40 && out.theirTurn.active.opacity <= .44
      && out.theirTurn.active.filter === 'grayscale(0.6)'
      && Math.abs(out.theirTurn.standby.scale - .82) <= .002,
    'the active CPU card did not retain its viewer-relative mute while the other hand stood behind it',
    out.theirTurn);
  check(out.myTurn.paired && out.myTurn.count === 2
      && out.myTurn.active?.seat === '1' && out.myTurn.standby?.seat === '0'
      && !out.myTurn.active.disabled && out.myTurn.active.cards === 1
      && !out.myTurn.active.offturn && !out.myTurn.active.unavailable && !out.myTurn.opponentTurn
      && Math.abs(out.myTurn.active.scale - 1) <= .002
      && out.myTurn.active.opacity >= .99 && out.myTurn.active.filter === 'grayscale(0)'
      && out.myTurn.active.transform !== 'none' && Math.abs(out.myTurn.standby.scale - .82) <= .002,
    'the player card did not come forward while the other shared-rune card stood behind it', out.myTurn);
  check(out.myTurn.cards.every((card) => card.buttonMark === 'none'
      && card.ownerShadow?.content !== 'none' && card.ownerShadow?.boxShadow !== 'none'
      && card.ownerShadow?.opacity >= .99)
      && out.myTurn.bySeat['0'].ownerShadow.boxShadow !== out.myTurn.bySeat['1'].ownerShadow.boxShadow
      && ['0', '1'].every((seat) => out.myTurn.bySeat[seat].ownerShadow.boxShadow
        === out.theirTurn.bySeat[seat].ownerShadow.boxShadow),
    'the selected offset owner edge was missing, floating on the button, or changed owners at handoff',
    { theirs: out.theirTurn, mine: out.myTurn });
  check(out.theirTurn.active.wash !== 'none'
      && out.theirTurn.active.wash === out.myTurn.active.wash,
    'the active card tint flickered or changed with turn availability',
    { theirs: out.theirTurn.active, mine: out.myTurn.active });
  check(out.busyMyTurn.active?.disabled && !out.busyMyTurn.active.offturn
      && !out.busyMyTurn.active.unavailable && !out.busyMyTurn.opponentTurn
      && Math.abs(out.busyMyTurn.active.scale - 1) <= .002
      && out.busyMyTurn.active.opacity === out.myTurn.active.opacity
      && out.busyMyTurn.active.filter === out.myTurn.active.filter
      && out.busyMyTurn.active.wash === out.myTurn.active.wash
      && out.busyMyTurn.count === 2 && out.busyMyTurn.active.seat === '1',
    'a transient busy state visually changed the player-owned card',
    { mine: out.myTurn.active, busy: out.busyMyTurn });

  /* The suite's main page is an iPhone 13. Sample both persistent nodes across
     the handoff: one must move back as the other comes forward, neither may
     blink, and each coloured edge must stay attached to its owning card. */
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
      const cards = [...document.querySelectorAll('#spellBar .rune:not([hidden])')]
        .filter((card) => !!card.offsetParent).map((card) => {
          const charge = card.querySelector('.rune-charge.top');
          if (!charge) return null;
          const style = getComputedStyle(card), shadow = getComputedStyle(charge, '::after');
          const matrix = style.transform === 'none'
            ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
          const rect = card.getBoundingClientRect();
          return { seat: card.dataset.seat, probe: card.dataset.handoffProbe ?? null,
            active: card.classList.contains('hand-active'),
            standby: card.classList.contains('hand-standby'),
            scale: Math.hypot(matrix.a, matrix.b), opacity: Number(style.opacity),
            transform: style.transform, transitionProperty: style.transitionProperty,
            transitionDuration: style.transitionDuration,
            card: { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2,
              width: rect.width, height: rect.height },
            shadowOpacity: Number(shadow.opacity), shadow: shadow.boxShadow };
        }).filter(Boolean);
      return { opponentTurn: root.classList.contains('opponent-turn'), count: cards.length, cards,
        bySeat: Object.fromEntries(cards.map((card) => [card.seat, card])) };
    };
    paint(startTurn); await pause(320);
    const before = frame();
    paint(endTurn);
    const frames = [frame()], started = performance.now();
    while (performance.now() - started < 330) {
      await new Promise(requestAnimationFrame);
      frames.push(frame());
    }
    return { before, frames };
  }, [from, to]);
  const shrink = await sampleTransition(1, 0);
  const grow = await sampleTransition(0, 1);
  out.turnScaleTransition = { shrink, grow };
  const last = (sample) => sample.frames[sample.frames.length - 1];
  const path = (sample, seat) => sample.frames.map((frame) => frame.bySeat[seat].scale);
  const monotonic = (values, down) => values.every((value, index) => index === 0
    || (down ? value <= values[index - 1] + .0005 : value + .0005 >= values[index - 1]));
  const shrinkLast = last(shrink), growLast = last(grow);
  const properties = shrink.before.bySeat['1'].transitionProperty.split(',').map((value) => value.trim());
  const durations = shrink.before.bySeat['1'].transitionDuration.split(',').map((value) => value.trim());
  check(shrink.before.bySeat['1'].transform !== 'none'
      && properties.includes('transform') && properties.includes('opacity') && properties.includes('filter')
      && durations.length === 3 && durations.every((value) => value === '0.25s'),
    'the two-card turn cue properties do not share the intended 250ms transition', shrink.before);
  check(Math.abs(shrink.before.bySeat['1'].scale - 1) <= .002
      && Math.abs(shrink.before.bySeat['0'].scale - .82) <= .002
      && Math.abs(shrinkLast.bySeat['1'].scale - .82) <= .002
      && Math.abs(shrinkLast.bySeat['0'].scale - .95) <= .002
      && monotonic(path(shrink, '1'), true) && monotonic(path(shrink, '0'), false)
      && shrink.frames.some((frame) => frame.bySeat['1'].scale < .98
        && frame.bySeat['1'].scale > .84)
      && shrink.frames.every((frame) => frame.opponentTurn),
    'the player card did not recede while the CPU card came forward', shrink);
  check(Math.abs(grow.before.bySeat['0'].scale - .95) <= .002
      && Math.abs(grow.before.bySeat['1'].scale - .82) <= .002
      && Math.abs(growLast.bySeat['0'].scale - .82) <= .002
      && Math.abs(growLast.bySeat['1'].scale - 1) <= .002
      && monotonic(path(grow, '0'), true) && monotonic(path(grow, '1'), false)
      && grow.frames.some((frame) => frame.bySeat['1'].scale > .84
        && frame.bySeat['1'].scale < .98)
      && grow.frames.every((frame) => !frame.opponentTurn),
    'the CPU card did not recede while the player card came forward', grow);
  check([shrink, grow].every((sample) => sample.frames.every((frame) => frame.count === 2
      && frame.cards.every((card) => card.probe === `seat-${card.seat}`
        && card.opacity >= .40 && card.shadowOpacity >= .99 && card.shadow !== 'none')))
      && shrinkLast.bySeat['0'].active && shrinkLast.bySeat['1'].standby
      && growLast.bySeat['1'].active && growLast.bySeat['0'].standby,
    'a physical seat card blinked, changed owner edge, or failed to trade depth during handoff',
    out.turnScaleTransition);

  /* RANDOM ×2 uses the same physical handoff; only the faces differ. Pin a
     deterministic pair so the test proves each distinct card keeps both its
     owner and rune while trading active/standby depth. */
  out.randomTwoHandoff = await page.evaluate(async () => {
    const k = window.__kb;
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    k.S.spell = 'random2'; k.S.spellCharges = [{ fate: 2 }, { anvil: 1 }];
    k.S.mode = 'duo'; k.S.seat = 'pass'; k.S.bottom = 1; k.S.busy = false;
    const paint = async (turn) => {
      k.S.turn = turn; k.S.phase = 'choose';
      k.applySides(); k.setActivePlate(); k.spells.render();
      await pause(280);
      const cards = [...document.querySelectorAll('#spellBar .rune:not([hidden])')]
        .filter((card) => !!card.offsetParent).map((card) => {
          const charge = card.querySelector('.rune-charge.top');
          const shadow = charge ? getComputedStyle(charge, '::after') : null;
          return { seat: card.dataset.seat, spell: card.dataset.spell,
            probe: card.dataset.dualProbe ?? null,
            active: card.classList.contains('hand-active'),
            standby: card.classList.contains('hand-standby'),
            shadow: shadow?.boxShadow ?? 'none' };
        });
      return { count: cards.length, cards,
        active: cards.find((card) => card.active), standby: cards.find((card) => card.standby) };
    };
    k.spells.render();
    for (const card of document.querySelectorAll('#spellBar .rune:not([hidden])')) {
      card.dataset.dualProbe = `${card.dataset.seat}:${card.dataset.spell}`;
    }
    return { before: await paint(1), after: await paint(0) };
  });
  check(out.randomTwoHandoff.before.count === 2 && out.randomTwoHandoff.after.count === 2
      && out.randomTwoHandoff.before.active.seat === '1'
      && out.randomTwoHandoff.before.active.spell === 'anvil'
      && out.randomTwoHandoff.before.standby.spell === 'fate'
      && out.randomTwoHandoff.after.active.seat === '0'
      && out.randomTwoHandoff.after.active.spell === 'fate'
      && out.randomTwoHandoff.after.standby.spell === 'anvil'
      && out.randomTwoHandoff.before.cards.every((card) => card.probe === `${card.seat}:${card.spell}`
        && card.shadow !== 'none')
      && out.randomTwoHandoff.after.cards.every((card) => card.probe === `${card.seat}:${card.spell}`
        && card.shadow !== 'none'),
    'RANDOM ×2 rebuilt, relabelled, or hid a card instead of switching the two hands',
    out.randomTwoHandoff);

  /* A shared two-use rune is two cards PER seat, not one four-charge control
     and not one hand reassigned between players. */
  await newGame({ spell: 'fate' });
  check(await waitChoose(), 'game never reached choose (shared FATE hands)');
  out.sharedFateHands = await rail();
  check(out.sharedFateHands.count === 2
      && out.sharedFateHands.cards.every((card) => card.spell === 'fate'
        && card.cards === 2 && card.outlines === 0 && card.ownerShadow?.boxShadow !== 'none')
      && out.sharedFateHands.cards.reduce((sum, card) => sum + card.cards, 0) === 4,
    'shared FATE was not painted as two owner hands of two cards each', out.sharedFateHands);
}
