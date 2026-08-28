/* WHAT A SEAT'S HAND IS DEALT, AND HOW IT SPENDS DOWN ACROSS TURNS — as
   opposed to what a cast DOES, which is effects.mjs. FATE is the only
   multi-charge hand, so it pins the whole stack story in one place; RANDOM
   (10c) and RANDOM ×2 (10d) ask the same question of the deal itself. */
export async function runHandDealScenarios(suite) {
  const { page, out, check, newGame, waitChoose } = suite;
  /* FATE is the only two-card hand, but the second card belongs to a later
     turn. One cast exposes it disabled; a direct same-turn call must not
     redraw or spend, and a full turn cycle makes it live again. */
  await newGame({ spell: 'fate' }); check(await waitChoose(), 'game never reached choose (FATE stack)');
  const fateStack = () => page.evaluate(() => {
    const rune = document.querySelector('#spellBar .rune.hand-active:not([hidden])');
    return { left: rune?.dataset.left, cards: [...rune.querySelectorAll('.rune-charge')]
      .filter((e) => !e.hidden).length, outlines: [...rune.querySelectorAll('.rune-empty')]
      .filter((e) => !e.hidden).length };
  });
  out.fateFull = await fateStack();
  out.fateFirstCast = await page.evaluate(() => window.__kb.spells.cast('fate', -1));
  await page.waitForTimeout(750);
  out.fateOne = await fateStack();
  out.fateSameTurnBlocked = await page.evaluate(async () => {
    const k = window.__kb;
    const before = { die: k.S.die, charges: JSON.stringify(k.S.spellCharges) };
    const recast = await k.spells.cast('fate', -1);
    const rune = document.querySelector('#spellBar .rune.hand-active:not([hidden])');
    return { before, recast, die: k.S.die, charges: JSON.stringify(k.S.spellCharges),
      marker: k.S.spellCastThisTurn, disabled: rune?.disabled,
      unavailable: rune?.classList.contains('unavailable') };
  });
  check(out.fateFull.left === '2' && out.fateFull.cards === 2 && out.fateFull.outlines === 0,
    'FATE was not dealt as two differently stacked cards', out.fateFull);
  check(out.fateFirstCast && out.fateOne.left === '1' && out.fateOne.cards === 1
      && out.fateOne.outlines === 0,
    'FATE did not expose exactly one later-turn card', out.fateOne);
  check(!out.fateSameTurnBlocked.recast
      && out.fateSameTurnBlocked.before.die === out.fateSameTurnBlocked.die
      && out.fateSameTurnBlocked.before.charges === out.fateSameTurnBlocked.charges
      && out.fateSameTurnBlocked.marker === 1 && out.fateSameTurnBlocked.disabled
      && out.fateSameTurnBlocked.unavailable,
    'FATE cast twice before the same placement', out.fateSameTurnBlocked);

  await page.evaluate(() => window.__kb.place(1, 0));
  await page.waitForFunction(() => window.__kb.S.turn === 0 && window.__kb.S.phase === 'choose');
  await page.evaluate(() => window.__kb.place(0, 1));
  await page.waitForFunction(() => window.__kb.S.turn === 1 && window.__kb.S.phase === 'choose');
  out.fateNextTurnReady = await page.evaluate(() => {
    const rune = document.querySelector('#spellBar .rune.hand-active:not([hidden])');
    return { marker: window.__kb.S.spellCastThisTurn, disabled: rune?.disabled,
      left: rune?.dataset.left };
  });
  out.fateSecondCast = await page.evaluate(() => window.__kb.spells.cast('fate', -1));
  await page.waitForTimeout(750);
  out.fateEmpty = await fateStack();
  check(out.fateNextTurnReady.marker === null && !out.fateNextTurnReady.disabled
      && out.fateNextTurnReady.left === '1' && out.fateSecondCast,
    'FATE did not become castable on its owner\'s next turn', out.fateNextTurnReady);
  check(out.fateEmpty.left === '0' && out.fateEmpty.cards === 0 && out.fateEmpty.outlines === 2,
    'FATE did not spend its second card on the later turn', out.fateEmpty);

  /* ---------- 10c. RANDOM keeps its original shared-rune promise ---------- */
  out.randomDeal = await page.evaluate(async () => {
    const k = window.__kb;
    const seen = new Set(); let mismatched = 0, empty = 0;
    for (let i = 0; i < 24; i++) {
      k.S.spell = 'random'; k.S.localMode = 0; k.S.mode = 'duo'; k.S.seat = 'face'; k.S.timer = 0;
      k.newGame();
      const mine = Object.keys(k.S.spellCharges[1]), theirs = Object.keys(k.S.spellCharges[0]);
      if (!mine.length) { empty++; continue; }
      if (mine[0] !== theirs[0]) mismatched++;
      seen.add(mine[0]);
    }
    return { drew: [...seen].sort(), mismatched, empty, pick: k.S.spell };
  });
  check(out.randomDeal.empty === 0, 'RANDOM dealt an EMPTY hand — it must always become a real rune', out.randomDeal);
  check(out.randomDeal.mismatched === 0,
    'RANDOM dealt the two seats DIFFERENT runes — the layer is only fair because they match', out.randomDeal);
  check(out.randomDeal.drew.length >= 2, 'RANDOM never varied over 24 games', out.randomDeal);
  check(!out.randomDeal.drew.includes('random'), 'RANDOM dealt ITSELF as a rune', out.randomDeal);
  check(out.randomDeal.pick === 'random', 'the pick must survive the draw — RANDOM stays RANDOM', out.randomDeal);

  /* ---------- 10d. RANDOM ×2 deals two guaranteed-distinct hands ----------
     The selector is another promise, never a rune. Both seat records must be
     real, different, and visible together; the active hand comes forward while
     the other remains as the opponent's readable threat. */
  out.randomDualDeal = await page.evaluate(() => {
    const k = window.__kb;
    const seen = new Set(); let matched = 0, empty = 0;
    for (let i = 0; i < 24; i++) {
      k.S.spell = 'random2'; k.S.localMode = 0; k.S.mode = 'duo'; k.S.seat = 'face'; k.S.timer = 0;
      k.newGame();
      const mine = Object.keys(k.S.spellCharges[1])[0] ?? '';
      const theirs = Object.keys(k.S.spellCharges[0])[0] ?? '';
      if (!mine || !theirs) empty++;
      if (mine === theirs) matched++;
      seen.add(`${theirs}:${mine}`);
    }
    k.spells.render();
    const cards = [...document.querySelectorAll('#spellBar .rune:not([hidden])')];
    return {
      pairs: [...seen], matched, empty, pick: k.S.spell,
      paired: document.getElementById('spellBar').classList.contains('paired'),
      visible: cards.filter((card) => !!card.offsetParent).length,
      owners: cards.map((card) => card.dataset.seat).sort(),
      active: cards.filter((card) => card.classList.contains('hand-active')).length,
      standby: cards.filter((card) => card.classList.contains('hand-standby')).length,
    };
  });
  check(out.randomDualDeal.empty === 0 && out.randomDualDeal.matched === 0,
    'RANDOM ×2 did not deal two real, different runes', out.randomDualDeal);
  check(out.randomDualDeal.pairs.length >= 2 && out.randomDualDeal.pick === 'random2',
    'RANDOM ×2 did not vary or replaced its persisted picker promise', out.randomDualDeal);
  check(out.randomDualDeal.paired && out.randomDualDeal.visible === 2
      && out.randomDualDeal.owners.join() === '0,1'
      && out.randomDualDeal.active === 1 && out.randomDualDeal.standby === 1,
    'the two distinct rune cards are not simultaneously visible and owner-mapped', out.randomDualDeal);
}
