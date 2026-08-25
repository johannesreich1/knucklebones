export async function runRuneCardTreatmentScenarios(suite) {
  const { page, out, check, newGame, waitChoose, table, sidePage, devices, rail, turnTo } = suite;

  /* The offset edge leaves during the first half of the selected card flip,
     before the face appears. Cancelling an ordinary aim restores it. */
  await newGame({ spell: 'pilfer' });
  check(await waitChoose(), 'game never reached choose (owner-edge fade)');
  await turnTo(1);
  out.ownerShadowFade = await page.evaluate(async () => {
    const k = window.__kb;
    const card = document.querySelector('#spellBar .rune.hand-active:not([hidden])');
    const charge = card.querySelector('.rune-charge.top');
    const back = charge.querySelector('.rback'), face = charge.querySelector('.rface');
    const read = () => {
      const shadow = getComputedStyle(charge, '::after');
      return { shadow: Number(shadow.opacity), boxShadow: shadow.boxShadow,
        duration: shadow.transitionDuration, back: Number(getComputedStyle(back).opacity),
        face: Number(getComputedStyle(face).opacity), buttonMark: getComputedStyle(card, '::before').content };
    };
    const before = read(), armed = k.spells.arm('pilfer');
    const samples = [read()], started = performance.now();
    while (performance.now() - started < 240) {
      await new Promise(requestAnimationFrame); samples.push(read());
    }
    const after = read();
    k.spells.disarm(true);
    await new Promise((resolve) => setTimeout(resolve, 230));
    return { armed, before, samples, after, restored: read() };
  });
  const shadowFace = out.ownerShadowFade.samples.findIndex((sample) => sample.face >= .9);
  check(out.ownerShadowFade.armed && out.ownerShadowFade.before.shadow >= .99
      && out.ownerShadowFade.before.boxShadow !== 'none'
      && out.ownerShadowFade.before.buttonMark === 'none'
      && out.ownerShadowFade.before.duration.split(',').some((value) => value.trim() === '0.15s')
      && out.ownerShadowFade.samples.some((sample) => sample.shadow > .05 && sample.shadow < .95
        && sample.face <= .05)
      && shadowFace >= 0 && out.ownerShadowFade.samples[shadowFace].shadow <= .08
      && out.ownerShadowFade.after.shadow <= .02 && out.ownerShadowFade.after.face >= .9
      && out.ownerShadowFade.restored.shadow >= .98 && out.ownerShadowFade.restored.face <= .05,
    'the selected owner edge did not fade before the flip revealed the rune face, then restore on cancel',
    out.ownerShadowFade);

  /* Reduced motion completes the turn immediately, so its ownership edge may
     not borrow the ordinary 150ms fade. Read the armed face and pseudo in the
     same style flush that follows arm(): the face must never share a frame
     with a stale coloured edge. */
  const reducedEdge = await sidePage({ name: 'owner edge reduced motion',
    device: devices['iPhone 13'], opts: { reducedMotion: 'reduce' } });
  try {
    await newGame({ spell: 'pilfer' }, reducedEdge.page);
    check(await waitChoose(reducedEdge.page), 'game never reached choose (owner edge reduced motion)');
    await table([[4], [], []], [[6], [], []], 4, reducedEdge.page);
    out.ownerShadowReduced = await reducedEdge.page.evaluate(() => {
      const k = window.__kb;
      const root = document.getElementById('kbroot');
      const card = document.querySelector('#spellBar .rune.hand-active:not([hidden])');
      const charge = card?.querySelector('.rune-charge.top');
      const face = charge?.querySelector('.rface');
      const armed = k.spells.arm('pilfer');
      const shadow = charge ? getComputedStyle(charge, '::after') : null;
      return { armed, reduced: root.classList.contains('reduce-motion'),
        paired: document.getElementById('spellBar').classList.contains('paired'),
        activeSeat: card?.dataset.seat ?? null,
        face: face ? Number(getComputedStyle(face).opacity) : null,
        shadow: shadow ? Number(shadow.opacity) : null,
        transition: shadow?.transition ?? null,
        transitionProperty: shadow?.transitionProperty ?? null,
        transitionDuration: shadow?.transitionDuration ?? null };
    });
    const reduced = out.ownerShadowReduced;
    check(reduced.armed && reduced.reduced && reduced.paired && reduced.activeSeat === '1'
        && reduced.face >= .99 && reduced.shadow <= .01
        && reduced.transitionProperty === 'none'
        && reduced.transitionDuration.split(',').every((value) => value.trim() === '0s'),
      'reduced motion showed the armed rune face with a lingering ownership edge', reduced);
  } finally { await reducedEdge.ctx.close(); }

  /* SELF casts do not sit armed: their cloned card performs the turn while it
     leaves. The owner edge must survive onto that clone, fade before its face
     appears, and must not let its own animationend remove the flight early. */
  await newGame({ spell: 'nudge' });
  check(await waitChoose(), 'game never reached choose (turning owner-edge flight)');
  await turnTo(1);
  out.turningOwnerShadow = await page.evaluate(async () => {
    const k = window.__kb, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const readRail = () => {
      const hands = [...document.querySelectorAll('#spellBar .rune:not([hidden])')]
        .filter((card) => !!card.offsetParent).map((card) => {
          const style = getComputedStyle(card);
          const matrix = style.transform === 'none'
            ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
          const rect = card.getBoundingClientRect();
          return { seat: card.dataset.seat, spentBack: card.classList.contains('hand-spent-back'),
            liveFront: card.classList.contains('hand-live-front'), z: style.zIndex,
            opacity: Number(style.opacity), scale: Math.hypot(matrix.a, matrix.b),
            transitionProperty: style.transitionProperty,
            card: { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 },
            cards: [...card.querySelectorAll('.rune-charge')].filter((item) => !item.hidden).length,
            outlines: [...card.querySelectorAll('.rune-empty')].filter((item) => !item.hidden).length };
        });
      return { hands };
    };
    const sourceCharge = document.querySelector(
      '#spellBar .rune.hand-active:not([hidden]) .rune-charge.top');
    const sourceBox = sourceCharge?.getBoundingClientRect();
    const source = sourceBox ? { cx: sourceBox.left + sourceBox.width / 2,
      cy: sourceBox.top + sourceBox.height / 2, width: sourceBox.width, height: sourceBox.height } : null;
    const pending = k.spells.cast('nudge', -1);
    let flight = null;
    for (let frame = 0; frame < 12 && !flight; frame++) {
      await new Promise(requestAnimationFrame);
      flight = document.querySelector('#spellBar .rune-played.turning');
    }
    if (!flight) return { found: false, source, railDuring: readRail() };
    const railDuring = readRail();
    const deal = flight.getAnimations().find((animation) => animation.animationName === 'runeTurnDeal');
    if (deal) deal.currentTime = 0;
    const flightBox = flight.getBoundingClientRect();
    const first = { cx: flightBox.left + flightBox.width / 2,
      cy: flightBox.top + flightBox.height / 2, width: flightBox.width, height: flightBox.height };
    const read = () => {
      if (!flight.isConnected) return null;
      const shadow = getComputedStyle(flight, '::after');
      return { shadow: Number(shadow.opacity), boxShadow: shadow.boxShadow,
        back: Number(getComputedStyle(flight.querySelector('.rback')).opacity),
        face: Number(getComputedStyle(flight.querySelector('.rface')).opacity) };
    };
    const names = flight.getAnimations().map((animation) => animation.animationName);
    const dealDuration = Number(deal?.effect?.getTiming().duration ?? 0);
    const samples = [read()], started = performance.now();
    while (performance.now() - started < 230) {
      await new Promise(requestAnimationFrame); samples.push(read());
    }
    /* Surviving beyond the 150ms ownership fade proves its animationend did
       not remove the clone. Seeking the main animation with currentTime can
       leave Chromium's queued end event on its original timeline, so a fixed
       500ms wall-clock probe is both redundant and flaky after the seek. */
    const aliveAfterOwnerFade = flight.isConnected;
    await pending;
    const total = performance.now() - started;
    if (total < 760) await pause(760 - total);
    return { found: true, source, first, names, dealDuration,
      samples: samples.filter(Boolean), railDuring, aliveAfterOwnerFade,
      goneAfterFlight: !flight.isConnected };
  });
  const playedFace = out.turningOwnerShadow.samples?.findIndex((sample) => sample.face >= .9) ?? -1;
  const flightOriginDelta = out.turningOwnerShadow.source && out.turningOwnerShadow.first
    ? Math.max(...['cx', 'cy', 'width', 'height'].map((key) =>
      Math.abs(out.turningOwnerShadow.first[key] - out.turningOwnerShadow.source[key])))
    : Number.POSITIVE_INFINITY;
  out.turningOwnerShadow.originDelta = flightOriginDelta;
  const spentDuringCast = out.turningOwnerShadow.railDuring?.hands.find((hand) => hand.seat === '1');
  const liveDuringCast = out.turningOwnerShadow.railDuring?.hands.find((hand) => hand.seat === '0');
  const castHandGap = spentDuringCast && liveDuringCast
    ? Math.hypot(spentDuringCast.card.cx - liveDuringCast.card.cx,
      spentDuringCast.card.cy - liveDuringCast.card.cy) : 0;
  check(out.turningOwnerShadow.found
      && out.turningOwnerShadow.names.includes('runeTurnDeal')
      && out.turningOwnerShadow.samples[0].boxShadow !== 'none'
      && out.turningOwnerShadow.samples[0].shadow >= .9
      && out.turningOwnerShadow.samples.some((sample) => sample.shadow > .05 && sample.shadow < .95
        && sample.face <= .05)
      && playedFace >= 0 && out.turningOwnerShadow.samples[playedFace].shadow <= .08
      && flightOriginDelta <= 1
      && spentDuringCast?.spentBack && spentDuringCast.z === '1'
      && spentDuringCast.cards === 0 && spentDuringCast.outlines === 1
      && spentDuringCast.transitionProperty === 'none'
      && Math.abs(spentDuringCast.scale - .82) <= .02
      && liveDuringCast?.liveFront && liveDuringCast.z === '3'
      && liveDuringCast.cards === 1 && liveDuringCast.opacity >= .99
      && liveDuringCast.transitionProperty === 'none'
      && Math.abs(liveDuringCast.scale - 1) <= .02 && castHandGap >= 12
      && out.turningOwnerShadow.dealDuration >= 600
      && out.turningOwnerShadow.aliveAfterOwnerFade && out.turningOwnerShadow.goneAfterFlight,
    'a direct cast lost its flight treatment or let the spent hand cover the remaining live hand',
    out.turningOwnerShadow);

  /* The alpha-channel look is a fully opaque neutral matte. As soon as the
     active hand is exhausted it must recede behind the other live hand, even
     before the turn handoff finishes, so both physical hands stay readable. */
  await page.evaluate(() => {
    const k = window.__kb;
    k.S.spell = 'random2'; k.S.spellCharges = [{ anvil: 1 }, { fate: 2 }];
    k.S.mode = 'cpu'; k.S.turn = 0; k.S.bottom = 1; k.S.busy = false; k.S.phase = 'anim';
    k.applySides(); k.setActivePlate(); k.spells.render();
  });
  await page.waitForTimeout(320);
  out.spentMatteImmediate = await page.evaluate(() => {
    const k = window.__kb;
    k.S.spellCharges[0].anvil = 0; k.spells.render();
    const card = document.querySelector('#spellBar .rune.hand-active[data-seat="0"]');
    const empty = card.querySelector('.rune-empty:not([hidden])');
    return { cardOpacity: Number(getComputedStyle(card).opacity),
      matteOpacity: Number(getComputedStyle(empty).opacity),
      background: getComputedStyle(empty).backgroundColor };
  });
  out.spentMatteTop = await rail();
  check(out.spentMatteImmediate.cardOpacity >= .99 && out.spentMatteImmediate.matteOpacity === 1
      && out.spentMatteImmediate.background !== 'rgba(0, 0, 0, 0)'
      && out.spentMatteTop.count === 2 && out.spentMatteTop.opponentTurn
      && out.spentMatteTop.active.seat === '0' && out.spentMatteTop.active.offturn
      && out.spentMatteTop.active.spentBack && out.spentMatteTop.active.z === '1'
      && out.spentMatteTop.active.transitionProperty === 'none'
      && Math.abs(out.spentMatteTop.active.scale - .82) <= .02
      && out.spentMatteTop.active.cards === 0 && out.spentMatteTop.active.outlines === 1
      && out.spentMatteTop.active.opacity >= .99
      && out.spentMatteTop.active.matte?.opacity === 1
      && out.spentMatteTop.active.matte?.backgroundAlpha === 1
      && out.spentMatteTop.active.matte?.image !== 'none'
      && out.spentMatteTop.active.matte?.size.includes('8px 8px')
      && out.spentMatteTop.standby.seat === '1' && out.spentMatteTop.standby.cards === 2
      && out.spentMatteTop.standby.liveFront && out.spentMatteTop.standby.z === '3'
      && out.spentMatteTop.standby.transitionProperty === 'none'
      && Math.abs(out.spentMatteTop.standby.scale - 1) <= .02
      && out.spentMatteTop.standby.opacity >= .99,
    'the active spent matte did not recede behind the remaining live hand immediately',
    out.spentMatteTop);

  await page.evaluate(() => {
    const k = window.__kb;
    k.S.turn = 1; k.S.phase = 'choose'; k.S.busy = false;
    k.applySides(); k.setActivePlate(); k.spells.render();
  });
  await page.waitForTimeout(320);
  out.spentMatteBehind = await rail();
  await page.evaluate(() => {
    const k = window.__kb;
    k.S.spellCharges = [{ anvil: 0 }, { fate: 0 }]; k.S.turn = 0; k.S.phase = 'anim';
    k.applySides(); k.setActivePlate(); k.spells.render();
  });
  await page.waitForTimeout(320);
  out.bothSpentMattes = await rail();
  const topMatte = await page.locator(
    '#spellBar .rune.hand-active[data-seat="0"] .rune-empty:not([hidden])').boundingBox();
  const lowerMatte = await page.locator(
    '#spellBar .rune.hand-standby[data-seat="1"] .rune-empty:not([hidden])').last().boundingBox();
  const overlap = {
    left: Math.max(topMatte.x, lowerMatte.x), top: Math.max(topMatte.y, lowerMatte.y),
    right: Math.min(topMatte.x + topMatte.width, lowerMatte.x + lowerMatte.width),
    bottom: Math.min(topMatte.y + topMatte.height, lowerMatte.y + lowerMatte.height),
  };
  const matteClip = { x: overlap.left + 4, y: overlap.top + 4,
    width: overlap.right - overlap.left - 8, height: overlap.bottom - overlap.top - 8 };
  const matteBefore = await page.screenshot({ clip: matteClip, animations: 'disabled' });
  await page.evaluate(() => {
    const lower = document.querySelector('#spellBar .rune.hand-standby[data-seat="1"]');
    for (const matte of lower.querySelectorAll('.rune-empty:not([hidden])')) {
      matte.style.background = 'rgb(255,0,255)';
      matte.style.boxShadow = 'inset 0 0 0 999px rgb(255,0,255)';
    }
  });
  await page.waitForTimeout(40);
  const matteAfter = await page.screenshot({ clip: matteClip, animations: 'disabled' });
  out.spentMattePixelMask = matteBefore.equals(matteAfter);
  await page.evaluate(() => {
    const lower = document.querySelector('#spellBar .rune.hand-standby[data-seat="1"]');
    for (const matte of lower.querySelectorAll('.rune-empty:not([hidden])')) {
      matte.style.removeProperty('background'); matte.style.removeProperty('box-shadow');
    }
  });
  check(out.spentMatteBehind.active.seat === '1' && out.spentMatteBehind.active.cards === 2
      && out.spentMatteBehind.standby.seat === '0' && out.spentMatteBehind.standby.outlines === 1
      && out.spentMatteBehind.standby.matte?.backgroundAlpha === 1,
    'the spent matte did not remain readable behind the live hand after handoff',
    out.spentMatteBehind);
  check(out.bothSpentMattes.count === 2 && out.bothSpentMattes.active.opacity >= .99
      && out.bothSpentMattes.cards.reduce((sum, card) => sum + card.cards, 0) === 0
      && out.bothSpentMattes.cards.reduce((sum, card) => sum + card.outlines, 0) === 3
      && out.bothSpentMattes.cards.every((card) => card.matte?.opacity === 1
        && card.matte?.backgroundAlpha === 1 && card.matte?.image !== 'none')
      && out.spentMattePixelMask,
    'the both-spent overlap did not keep two opaque owner hands and all three empty cards',
    { rail: out.bothSpentMattes, pixelsEqual: out.spentMattePixelMask });
}
