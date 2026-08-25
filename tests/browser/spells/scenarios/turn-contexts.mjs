export async function runTurnContextScenarios(suite) {
  const { page, out, check, newGame, waitChoose, sidePage, devices, rail, turnTo } = suite;

  /* Restore the ordinary shared card before viewer/reduced-motion probes. */
  await newGame({ spell: 'pilfer' });
  check(await waitChoose(), 'game never reached choose (viewer reset)');

  /* The short landscape lane is the tightest in-play home. Check both a
     standard matching pair and RANDOM ×2 in both turn states; bounding the
     actual transformed cards catches a fan that fits only in portrait. */
  const compact = await sidePage({ name: 'two-card compact landscape', w: 568, h: 320 });
  try {
    await newGame({ spell: 'pilfer' }, compact.page);
    check(await waitChoose(compact.page), 'game never reached choose (two-card compact landscape)');
    const measureCompact = (pg) => pg.evaluate(() => {
      const root = document.getElementById('kbroot'), die = document.getElementById('dieStage').getBoundingClientRect();
      const cards = [...document.querySelectorAll('#spellBar .rune:not([hidden])')]
        .filter((card) => !!card.offsetParent).map((card) => {
          const rect = card.getBoundingClientRect(), charge = card.querySelector('.rune-charge.top');
          return { seat: card.dataset.seat, spell: card.dataset.spell,
            active: card.classList.contains('hand-active'),
            standby: card.classList.contains('hand-standby'),
            rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
            shadow: charge ? getComputedStyle(charge, '::after').boxShadow : 'none' };
        });
      return { land: root.classList.contains('land'), count: cards.length, cards,
        active: cards.find((card) => card.active), standby: cards.find((card) => card.standby),
        fits: cards.every((card) => card.rect.left >= -.5 && card.rect.top >= -.5
          && card.rect.right <= innerWidth + .5 && card.rect.bottom <= innerHeight + .5),
        clearsDie: cards.every((card) => card.rect.bottom <= die.top + .5),
        scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
          viewportWidth: innerWidth, viewportHeight: innerHeight } };
    });
    out.compactSharedCards = await measureCompact(compact.page);
    out.compactRandomTwoCards = await compact.page.evaluate(async () => {
      const k = window.__kb, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      k.S.spell = 'random2'; k.S.spellCharges = [{ fate: 2 }, { anvil: 1 }];
      k.S.mode = 'duo'; k.S.seat = 'face'; k.S.bottom = 1; k.S.busy = false;
      const read = () => {
        const die = document.getElementById('dieStage').getBoundingClientRect();
        const cards = [...document.querySelectorAll('#spellBar .rune:not([hidden])')]
          .filter((card) => !!card.offsetParent).map((card) => {
            const rect = card.getBoundingClientRect(), charge = card.querySelector('.rune-charge.top');
            return { seat: card.dataset.seat, spell: card.dataset.spell,
              active: card.classList.contains('hand-active'),
              standby: card.classList.contains('hand-standby'),
              rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
              shadow: charge ? getComputedStyle(charge, '::after').boxShadow : 'none' };
          });
        return { count: cards.length, cards, active: cards.find((card) => card.active),
          standby: cards.find((card) => card.standby),
          fits: cards.every((card) => card.rect.left >= -.5 && card.rect.top >= -.5
            && card.rect.right <= innerWidth + .5 && card.rect.bottom <= innerHeight + .5),
          clearsDie: cards.every((card) => card.rect.bottom <= die.top + .5) };
      };
      const paint = async (turn) => {
        k.S.turn = turn; k.S.phase = 'choose'; k.applySides(); k.setActivePlate(); k.spells.render();
        await pause(280); return read();
      };
      return { land: document.getElementById('kbroot').classList.contains('land'),
        mine: await paint(1), theirs: await paint(0),
        scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
          viewportWidth: innerWidth, viewportHeight: innerHeight } };
    });
    const shared = out.compactSharedCards, dual = out.compactRandomTwoCards;
    check(shared.land && shared.count === 2 && shared.active?.seat === '1'
        && shared.standby?.seat === '0' && shared.cards.every((card) => card.spell === 'pilfer'
          && card.shadow !== 'none')
        && shared.fits && shared.clearsDie
        && shared.scroll.width <= shared.scroll.viewportWidth + 1
        && shared.scroll.height <= shared.scroll.viewportHeight + 1,
      'the two matching shared-rune cards escaped or collided in compact landscape', shared);
    check(dual.land && [dual.mine, dual.theirs].every((state) => state.count === 2
        && state.fits && state.clearsDie && state.cards.every((card) => card.shadow !== 'none'))
        && dual.mine.active?.seat === '1' && dual.mine.active?.spell === 'anvil'
        && dual.theirs.active?.seat === '0' && dual.theirs.active?.spell === 'fate'
        && dual.scroll.width <= dual.scroll.viewportWidth + 1
        && dual.scroll.height <= dual.scroll.viewportHeight + 1,
      'RANDOM ×2 failed to switch both owner cards inside compact landscape', dual);
  } finally { await compact.ctx.close(); }

  /* Explicit viewers model ranked clients. A shared phone has no fixed viewer,
     whether it is passed between players or held face-to-face. */
  out.turnViewerOwnership = await page.evaluate(async () => {
    const k = window.__kb;
    const root = document.getElementById('kbroot');
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const cases = [];
    const read = (kind, seat, viewer, turn) => {
      const cards = [...document.querySelectorAll('#spellBar .rune:not([hidden])')]
        .filter((card) => !!card.offsetParent);
      const card = cards.find((item) => item.classList.contains('hand-active'));
      const standby = cards.find((item) => item.classList.contains('hand-standby'));
      const style = getComputedStyle(card);
      const matrix = style.transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
      return { kind, seat, viewer, turn, opponentTurn: root.classList.contains('opponent-turn'),
        count: cards.length, activeSeat: card?.dataset.seat, standbySeat: standby?.dataset.seat,
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
      .every((entry) => entry.count === 2 && entry.activeSeat === String(entry.turn)
        && entry.standbySeat === String(1 - entry.turn)
        && entry.opponentTurn === (entry.turn !== entry.viewer)
        && Math.abs(entry.scale - (entry.turn === entry.viewer ? 1 : .95)) <= .002),
    'an explicit viewer seat did not own the opponent-turn presentation', out.turnViewerOwnership);
  check(out.turnViewerOwnership.filter((entry) => entry.kind === 'shared-phone')
      .every((entry) => entry.count === 2 && entry.activeSeat === String(entry.turn)
        && entry.standbySeat === String(1 - entry.turn)
        && !entry.opponentTurn && Math.abs(entry.scale - 1) <= .002),
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
        const cards = [...document.querySelectorAll('#spellBar .rune:not([hidden])')]
          .filter((card) => !!card.offsetParent);
        const card = cards.find((item) => item.classList.contains('hand-active'));
        const icon = card.querySelector('.rune-charge.top .rback svg');
        const style = getComputedStyle(card);
        const matrix = style.transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
        const cr = card.getBoundingClientRect(), ir = icon.getBoundingClientRect();
        return { opponentTurn: root.classList.contains('opponent-turn'),
          count: cards.length, activeSeat: card.dataset.seat,
          standbySeat: cards.find((item) => item.classList.contains('hand-standby'))?.dataset.seat,
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
        const cards = [...document.querySelectorAll('#spellBar .rune:not([hidden])')]
          .filter((card) => !!card.offsetParent);
        cards.forEach((card) => getComputedStyle(card).transform);
        await frame();
        for (let pass = 0; pass < 3; pass++) {
          const running = cards.flatMap((card) => card.getAnimations()).filter((animation) =>
            animation.playState === 'pending' || animation.playState === 'running');
          if (!running.length) {
            await frame();
            if (!cards.flatMap((card) => card.getAnimations()).some((animation) =>
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
        && [reduced.full, reduced.immediate, reduced.opponent, reduced.fullAgain]
          .every((state) => state.count === 2 && state.standbySeat === String(1 - Number(state.activeSeat)))
        && reduced.full.activeSeat === '1' && reduced.opponent.activeSeat === '0'
        && reduced.fullAgain.activeSeat === '1'
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
