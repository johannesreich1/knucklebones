import { waitForStableGeometry } from '../../support/stable-geometry.mjs';

export async function runEffectScenarios(suite) {
  const { page, out, check, newGame, waitChoose, table, look, tapCol, tapRune } = suite;
  /* ---------- 9. a SELF spell has ONE target, so pressing it casts it ----------
     NUDGE and FATE act on the die in hand. There is nothing to choose, so
     there is nothing to aim: a tap on the rune spends it then and there
     (user call — an aim step for a single possible target was pure friction).
     NUDGE is the deterministic one: 5 must become 6. */
  await newGame({ spell: 'nudge' }); check(await waitChoose(), 'game never reached choose (nudge)');
  await table([[2], [], []], [[5], [], []], 5);
  await tapRune(); await page.waitForFunction(() => !window.__kb.S.busy);
  out.selfTap = await look();
  check(out.selfTap.die === 6, 'a tap on a self rune must cast it — the die did not tick', out.selfTap);
  check(out.selfTap.charges === '[{"nudge":1},{"nudge":0}]', 'the tap-cast charged the wrong seat', out.selfTap);
  check(out.selfTap.armed === null && !out.selfTap.castself,
    'a self spell must never sit armed waiting for a target', out.selfTap);
  check(out.selfTap.phase === 'choose' && !out.selfTap.busy, 'the turn was not handed back (nudge)', out.selfTap);
  check(/\bspent\b/.test(out.selfTap.runeClass) && !/\bundo\b/.test(out.selfTap.runeClass),
    'a committed self cast must read spent immediately', out.selfTap.runeClass);
  await tapCol(1); await page.waitForTimeout(900);
  out.selfPlaced = await look();
  check(JSON.parse(out.selfPlaced.mine)[1][0] === 6, 'placement broken after a self cast', out.selfPlaced);
  check(out.selfPlaced.runeSeat === '0' && out.selfPlaced.cards === 1,
    "handover did not replace the spent hand with the next player's card", out.selfPlaced);

  /* the drag still aims — dropping on the die casts, dropping anywhere else
     cancels and keeps the charge */
  await newGame({ spell: 'fate' }); check(await waitChoose(), 'game never reached choose (fate)');
  await table([[2], [], []], [[5], [], []], 2);
  const drag = async (to) => {
    const rb = await page.locator('.rune[data-seat="1"]:not([hidden])').boundingBox();
    const tb = await page.locator(to).boundingBox();
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
    await page.mouse.down();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 10 });
    await page.mouse.up(); await page.waitForTimeout(900);
  };
  await drag('#botBoard .col[data-col="2"]');       // a column is not a self spell's target
  out.selfDragMiss = await look();
  check(out.selfDragMiss.charges === '[{"fate":2},{"fate":2}]',
    'dropping a self spell on a column must cancel, not spend', out.selfDragMiss);
  check(out.selfDragMiss.armed === null, 'the cancelled drag left the rune armed', out.selfDragMiss);
  await drag('#dieStage');
  out.selfDrag = await look();
  check(out.selfDrag.charges === '[{"fate":2},{"fate":1}]', 'the stage drop did not cast', out.selfDrag);
  check(out.selfDrag.die >= 1 && out.selfDrag.die <= 6, 'the redraw lost the die', out.selfDrag.die);

  /* ---------- 9a. commitment is one-way ----------
     Aim can be cancelled before a legal drop. Once a cast commits, every
     spell is final: no snapshot, rail state or hook may put its state or
     charge back. */
  await newGame({ spell: 'nudge' }); check(await waitChoose(), 'game never reached choose (commit)');
  await table([[2], [], []], [[5], [], []], 5);
  await tapRune(); await page.waitForFunction(() => !window.__kb.S.busy);
  out.committedNudge = await page.evaluate(async () => {
    const k = window.__kb;
    const before = { die: k.S.die, charges: JSON.stringify(k.S.spellCharges) };
    const recast = await k.spells.cast('nudge', -1);
    const rune = document.querySelector('.rune[data-seat="1"]:not([hidden])');
    return { before, recast, die: k.S.die, charges: JSON.stringify(k.S.spellCharges),
      hasUndo: 'undo' in k.spells || 'undoable' in k.spells || 'spellUndo' in k.S,
      runeClass: rune?.className ?? '' };
  });
  check(out.committedNudge.before.die === 6 && out.committedNudge.die === 6 && !out.committedNudge.recast,
    'NUDGE could be reversed or repeated after commitment', out.committedNudge);
  check(out.committedNudge.before.charges === '[{"nudge":1},{"nudge":0}]'
      && out.committedNudge.charges === out.committedNudge.before.charges,
    'NUDGE returned or double-spent its committed charge', out.committedNudge);
  check(!out.committedNudge.hasUndo && /\bspent\b/.test(out.committedNudge.runeClass),
    'the runtime still exposes a cast take-back', out.committedNudge);

  /* FATE IS FINAL (user call, 2026-08-22). It is the one cast that REVEALS —
     it draws the next die from the supply — and no take-back can un-see it.
     Offering the window would be "cast, peek, undo": a free read of what is
     coming, twice a game, at no charge, and in LIMITED a free read of the bag.
     So the press must NOT hand anything back: not the die, not the charge, and
     not the die the bag has already given up. */
  out.fateFinal = await page.evaluate(async () => {
    const k = window.__kb;
    k.S.spell = 'fate'; k.S.localMode = 6; k.S.mode = 'duo'; k.S.seat = 'face'; k.S.timer = 0;
    k.newGame();
    for (let i = 0; i < 80; i++) { if (k.S.phase === 'choose') break; await new Promise((r) => setTimeout(r, 100)); }
    k.S.turn = 1; k.S.bottom = 1; k.S.busy = false; k.S.phase = 'choose';
    const bagBefore = k.S.pool.length, dieBefore = k.S.die;
    await k.spells.cast('fate', -1);
    await new Promise((r) => setTimeout(r, 700));
    const bagAfter = k.S.pool.length, dieAfter = k.S.die;
    const rune = document.querySelector('.rune[data-seat="1"]:not([hidden])');
    return { bagBefore, bagAfter, dieBefore, dieAfter,
             hasUndo: 'undo' in k.spells || 'undoable' in k.spells || 'spellUndo' in k.S,
             runeClass: rune ? rune.className : '', charges: JSON.stringify(k.S.spellCharges) };
  });
  check(out.fateFinal.bagAfter === out.fateFinal.bagBefore - 1,
    'the redraw did not come out of the bag', out.fateFinal);
  check(!out.fateFinal.hasUndo,
    'FATE STILL OFFERS A TAKE-BACK — the peek at the supply is free', out.fateFinal);
  check(out.fateFinal.charges === '[{"fate":2},{"fate":1}]',
    'a final cast gave its charge back', out.fateFinal);
  /* ...and it must READ final: a rune that still says "press again" invites
     exactly the peek this forbids */
  check(/\bspent\b/.test(out.fateFinal.runeClass) || !/\bundo\b/.test(out.fateFinal.runeClass),
    'FATE still reads as takeable back', out.fateFinal.runeClass);

  /* SUNDER's warning reveals authoritative victims, so its mark is equally
     committed: a second cast attempt cannot lift or replay it. */
  out.sunderCommit = await page.evaluate(async () => {
    const k = window.__kb;
    k.S.spell = 'sunder'; k.S.localMode = 0; k.S.mode = 'duo'; k.S.seat = 'face'; k.S.timer = 0;
    k.newGame();
    for (let i = 0; i < 80; i++) { if (k.S.phase === 'choose') break; await new Promise((r) => setTimeout(r, 100)); }
    k.S.turn = 1; k.S.bottom = 1; k.S.busy = false; k.S.phase = 'choose'; k.S.die = 3;
    await k.spells.cast('sunder', -1);
    await new Promise((r) => setTimeout(r, 700));
    const marked = k.S.charm.sunder[1];
    const recast = await k.spells.cast('sunder', -1);
    return { marked, afterRecast: k.S.charm.sunder[1], recast,
             stageLit: document.getElementById('dieStage').classList.contains('sundered'),
             charges: JSON.stringify(k.S.spellCharges) };
  });
  check(out.sunderCommit.marked && out.sunderCommit.afterRecast && !out.sunderCommit.recast,
    'SUNDER was lifted or repeated after its warning committed', out.sunderCommit);
  check(out.sunderCommit.stageLit && out.sunderCommit.charges === '[{"sunder":1},{"sunder":0}]',
    'SUNDER lost its committed mark or returned its charge', out.sunderCommit);

  /* a COLUMN spell has visibly moved dice — no take-back is offered */
  await newGame({ spell: 'pilfer' }); check(await waitChoose(), 'game never reached choose (no undo)');
  await table([[2], [], []], [[6, 6], [], []]);
  await page.evaluate(() => window.__kb.spells.cast('pilfer', 0));
  await page.waitForTimeout(1200);
  out.noUndo = await page.evaluate(() => ({
    hasUndo: 'undo' in window.__kb.spells || 'undoable' in window.__kb.spells || 'spellUndo' in window.__kb.S,
    cls: document.querySelector('.rune[data-seat="1"]:not([hidden])')?.className }));
  check(!out.noUndo.hasUndo, 'a board spell offered a take-back after its dice had flown', out.noUndo);
  check(/\bspent\b/.test(out.noUndo.cls), 'a spent board rune must read as spent', out.noUndo);

  /* ---------- 9b. the board rings ONLY what the cast can land on ----------
     COLUMN SWAP could honestly ring all six (either half was a legal target).
     WARD guards your three; PILFER robs theirs, and only the ones holding
     dice. Ringing the rest told the player the board was a target when it
     was not (user report). markAim asks the registry's own legal(). */
  const rings = () => page.evaluate(() => {
    const ring = (side) => [0, 1, 2].map((c) => {
      const st = getComputedStyle(document.querySelector(`#${side} .col[data-col="${c}"]`), '::after');
      return st.display !== 'none' && st.borderStyle !== 'none' ? 1 : 0;
    });
    return { mine: ring('botBoard'), enemy: ring('topBoard') };
  });
  await newGame({ spell: 'ward' }); check(await waitChoose(), 'game never reached choose (ward rings)');
  await table([[6, 6], [2], []], [[3], [], []]);
  await tapRune(); await page.waitForTimeout(200);
  out.wardRings = await rings();
  check(String(out.wardRings.mine) === '1,1,1' && String(out.wardRings.enemy) === '0,0,0',
    'A WARD MUST OFFER YOUR COLUMNS AND ONLY YOURS', out.wardRings);
  await page.tap('#status'); await page.waitForTimeout(200);          // tap off-board: cancel

  await newGame({ spell: 'pilfer' }); check(await waitChoose(), 'game never reached choose (pilfer rings)');
  await table([[6, 6], [2], []], [[3], [], []]);                      // only enemy col 0 holds a die
  await tapRune(); await page.waitForTimeout(200);
  out.pilferRings = await rings();
  check(String(out.pilferRings.mine) === '0,0,0' && String(out.pilferRings.enemy) === '1,0,0',
    'A STEAL MUST OFFER ONLY ENEMY COLUMNS THAT HOLD A DIE', out.pilferRings);
  // and an unringed column refuses rather than casting somewhere else
  await tapCol(1); await page.waitForTimeout(400);
  out.unringed = await look();
  check(out.unringed.charges === '[{"pilfer":1},{"pilfer":1}]',
    'tapping an unoffered column spent the charge', out.unringed);

  /* ---------- 10. the shared rail and scores hold still ----------
     The rail changes owner without entering either plate. Handover must move
     neither score nor the fixed slot aligned with the right board column. */
  await newGame({ spell: 'fate' }); check(await waitChoose(), 'game never reached choose (plate)');
  out.plateHold = { ys: [], turns: [] };
  for (const turn of [1, 0, 1, 0]) {
    await page.evaluate((nextTurn) => {
      const k = window.__kb;
      k.S.turn = nextTurn; k.S.phase = 'choose'; k.S.busy = false;
      k.applySides(); k.spells.render(); k.renderAll(false);
    }, turn);
    await waitForStableGeometry(page, [
      '#sideTop', '#sideBot', '#totTop', '#totBot', '#spellBar',
    ]);
    const resting = await page.evaluate(() => ({
      y: [+document.getElementById('totTop').getBoundingClientRect().y.toFixed(1),
        +document.getElementById('totBot').getBoundingClientRect().y.toFixed(1),
        +document.getElementById('spellBar').getBoundingClientRect().y.toFixed(1)].join('/'),
      turn: getComputedStyle(document.getElementById('spellBar')).transform,
    }));
    out.plateHold.ys.push(resting.y);
    out.plateHold.turns.push(resting.turn);
  }
  out.plateHold.distinct = [...new Set(out.plateHold.ys)].length;
  check(out.plateHold.distinct === 1, 'THE SCORE MOVES WHEN THE RUNE CHANGES HANDS', out.plateHold);
  check(out.plateHold.turns[0] === 'none' && out.plateHold.turns[1] !== 'none'
      && out.plateHold.turns[2] === 'none' && out.plateHold.turns[3] !== 'none',
    'portrait face-to-face did not turn the card rail toward the active seat', out.plateHold);

  /* Score width changes may not leak into the centre rail. */
  await newGame({ spell: 'fate' }); check(await waitChoose(), 'game never reached choose (cluster)');
  out.clusterFixed = await page.evaluate(async () => {
    const k = window.__kb;
    const widths = new Set(), spots = new Set(), scores = [];
    for (const b of [[[], [], []], [[6], [], []], [[6, 6], [5], []],
                     [[6, 6, 6], [5, 5, 5], []], [[6, 6, 6], [5, 5, 5], [4, 4, 4]]]) {
      k.S.boards[0] = b; k.renderAll(false); k.spells.render();
      await new Promise((r) => setTimeout(r, 420));      // past .plate.bump
      widths.add(document.querySelector('#plateTop .pright').getBoundingClientRect().width.toFixed(3));
      const r = document.getElementById('spellBar').getBoundingClientRect();
      spots.add(r.x.toFixed(4) + ',' + r.y.toFixed(4));
      scores.push(document.getElementById('totTop').textContent);
    }
    return { widths: [...widths], spots: [...spots], scores };
  });
  check(out.clusterFixed.widths.length === 1,
    'the score cluster still grows with its contents — every child will drift', out.clusterFixed);
  check(out.clusterFixed.spots.length === 1,
    'THE CARD RAIL SHIFTS WHEN A SCORE CHANGES WIDTH', out.clusterFixed);
  // and a spell-free game reserves nothing anywhere
  await newGame({ spell: '' }); check(await waitChoose(), 'game never reached choose (plate none)');
  out.plateNone = await page.evaluate(() => {
    const rail = document.getElementById('spellBar');
    return { slots: document.querySelectorAll('.runeslot').length,
      live: rail.classList.contains('live'), display: getComputedStyle(rail).display };
  });
  check(out.plateNone.slots === 0 && !out.plateNone.live && out.plateNone.display === 'none',
    'a spell-free game reserved a rail or nameplate hole', out.plateNone);

  /* ---------- 10b. the marks hold still too ----------
     The chip CENTRES its contents, so the score and its ×k badge change width
     on every placement — a mark riding in that row jumped a dozen pixels each
     time (user report). Ward and shield sit at the chip's ends instead. */
  await newGame({ spell: 'ward' }); check(await waitChoose(), 'game never reached choose (chip)');
  await table([[6], [], []], [[1], [], []], 3);
  await page.evaluate(() => window.__kb.spells.cast('ward', 0));
  await page.waitForTimeout(700);
  out.chipHold = await page.evaluate(async () => {
    const k = window.__kb, xs = [];
    for (const col of [[6], [6, 6], [6, 6, 6]]) {          // 6 → 24 ×2 → 54 ×3
      k.S.boards[1][0] = col; k.renderAll(false);
      await new Promise((r) => setTimeout(r, 80));
      const wd = document.querySelectorAll('#botCols .chip')[0].querySelector('.wd');
      xs.push(+wd.getBoundingClientRect().x.toFixed(1));
    }
    return { xs, distinct: [...new Set(xs)].length };
  });
  check(out.chipHold.distinct === 1, 'THE WARD MARK MOVES WHEN THE SCORE GROWS', out.chipHold);

  /* BOUNTY joins the score cluster but must not disturb it or the centre rail. */
  out.btyHold = await page.evaluate(async () => {
    const k = window.__kb;
    k.S.spell = 'ward'; k.S.localMode = 5; k.S.mode = 'cpu'; k.S.seat = 'pass';
    k.newGame();
    for (let i = 0; i < 60; i++) { if (k.S.phase === 'choose') break; await new Promise((r) => setTimeout(r, 100)); }
    // let fit()/ResizeObserver finish sizing the table before measuring — a
    // layout still settling drifts on its own and would read as a tally jump
    await new Promise((r) => setTimeout(r, 700));
    const at = () => {
      const rail = document.getElementById('spellBar');
      return [+rail.getBoundingClientRect().y.toFixed(1),
              +document.getElementById('totTop').getBoundingClientRect().y.toFixed(1)].join('/');
    };
    const ys = [];
    // 0 → 2 → 11 → back to 0: if the last reading equals the first, the tally
    // is not moving anything; a drift that never returns is the layout settling
    for (const banked of [0, 2, 11, 0]) {
      k.S.bounty = [banked, 0]; k.renderAll(false); k.spells.render();
      // WAIT OUT THE BUMP. Banking changes the total, and a changed total
      // scales the number for 190ms (.plate.bump) — sampling inside that
      // window measures the celebration, not the layout, and reads as drift.
      await new Promise((r) => setTimeout(r, 420));
      ys.push(at());
    }
    return { ys, distinct: [...new Set(ys)].length, returned: ys[0] === ys[3] };
  });
  check(out.btyHold.distinct === 1, 'THE BOUNTY TALLY SHOVES THE SCORE OR CARD RAIL', out.btyHold);

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
