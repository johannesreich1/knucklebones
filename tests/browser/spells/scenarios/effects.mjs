import { runHandDealScenarios } from './hand-deals.mjs';
import { runRailStillnessScenarios } from './rail-stillness.mjs';

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

  /* The two families below are not effects, so they own their own modules: the
     pixel stillness of the rail and score cluster, then the composition of the
     dealt hand. All three drive the ONE page and mutate window.__kb.S
     cumulatively, so these awaits stay sequential and in this order. */
  await runRailStillnessScenarios(suite);
  await runHandDealScenarios(suite);
}
