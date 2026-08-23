export async function runCastingScenarios(suite) {
  const { page, out, check, newGame, waitChoose, table, look, tapCol, tapRune, sidePage } = suite;
  /* ---------- 1. the rune is dealt to a normal offline game ---------- */
  await newGame(); check(await waitChoose(), 'game never reached choose');
  await table([[2], [3], []], [[6, 6], [5], []]);
  out.dealt = await look();
  check(out.dealt.runeShown, 'no rune in an offline game', out.dealt);
  // One rail follows the turn. Plates carry scores only; the current hand is
  // a card stack beside the die and the die says whose hand it is.
  check(out.dealt.mineHome === 'spellBar' && out.dealt.runeSeat === '1',
    'the rail does not belong to the player to move', out.dealt);
  check(out.dealt.charges === '[{"pilfer":1},{"pilfer":1}]', 'both seats hold one cast', out.dealt.charges);
  check(out.dealt.visibleRunes === 1 && out.dealt.cards === 1 && out.dealt.outlines === 0,
    'a single-use rune is not one face-down card in one slot', out.dealt);

  /* ---------- 2. tap to arm ---------- */
  await tapRune(); await page.waitForTimeout(420);
  out.armed = await look();
  check(out.armed.armed === 'pilfer', 'tapping the rune did not arm it', out.armed);
  check(out.armed.casting && !out.armed.castself, 'a column spell arms the board, not the stage', out.armed);
  check(/column/i.test(out.armed.status), 'no instruction while aiming', out.armed.status);
  out.armedCard = await page.evaluate(() => {
    const card = document.querySelector('#spellBar .rune-charge.top');
    return { face: +getComputedStyle(card.querySelector('.rface')).opacity,
      back: +getComputedStyle(card.querySelector('.rback')).opacity,
      animations: card.getAnimations().map((a) => a.animationName) };
  });
  check(out.armedCard.face > out.armedCard.back && out.armedCard.animations.includes('runeArm'),
    'arming did not turn and present the card face-up', out.armedCard);
  // aiming must not place: a tap on the board casts instead of dropping the die
  out.rings = await page.evaluate(() => {
    const c = document.querySelector('#botBoard .col');
    return { spellRing: getComputedStyle(c, '::after').borderColor,
             legalHidden: getComputedStyle(document.querySelector('#botBoard .col.legal'), '::after').display };
  });
  check(out.rings.legalHidden === 'none', 'placement hints still up while aiming', out.rings);

  /* ---------- 3. tap a column: ONE gate, one charge ---------- */
  await page.tap('#topBoard .col[data-col="0"]'); await page.waitForTimeout(50);
  out.cardFlight = await page.evaluate(() => ({
    flights: document.querySelectorAll('#spellBar .rune-played').length,
    names: [...document.querySelectorAll('#spellBar .rune-played')]
      .flatMap((e) => e.getAnimations().map((a) => a.animationName)),
  }));
  check(out.cardFlight.flights === 1 && out.cardFlight.names.includes('runeDealUp'),
    'a committed aimed card was not dealt off the rail', out.cardFlight);
  // A two-die source has one readable resistance beat before the release,
  // followed by the soft landing.
  await page.waitForTimeout(2300);
  out.cast = await look();
  check(out.cast.mine === '[[2,6],[3],[]]', 'the caster column did not receive the stolen die', out.cast);
  check(out.cast.theirs === '[[6],[5],[]]', 'the enemy column kept its top die', out.cast);
  check(out.cast.present === out.cast.visible, 'A STOLEN DIE IS INVISIBLE', out.cast);
  check(out.cast.strays === 0, 'a flying copy was left on the page', out.cast);
  check(out.cast.charges === '[{"pilfer":1},{"pilfer":0}]', 'wrong seat was charged', out.cast.charges);
  check(!out.cast.armed && !out.cast.casting, 'still aiming after the cast', out.cast);
  check(out.cast.phase === 'choose' && !out.cast.busy, 'the turn was not handed back', out.cast);
  check(out.cast.die === 4, 'the roll in hand was lost to the cast', out.cast.die);
  check(out.cast.runeClass.includes('spent'), 'a spent rune must say so', out.cast.runeClass);
  check(out.cast.cards === 0 && out.cast.outlines === 1,
    'a spent single-use rune did not leave one empty outline', out.cast);

  /* ---------- 4. spent: no second cast, and the die still places ---------- */
  out.spent = await page.evaluate(async () => {
    const k = window.__kb;
    const b = document.querySelector('.rune[data-seat="1"]:not([hidden])');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 1, clientY: 1 }));
    return { disabled: b.disabled, armed: k.S.spellArmed, again: await k.spells.cast('pilfer', 0),
             mine: JSON.stringify(k.S.boards[1]) };
  });
  check(out.spent.disabled, 'a spent rune is still a live button', out.spent);
  check(out.spent.armed === null, 'a spent rune armed anyway', out.spent);
  check(out.spent.again === false && out.spent.mine === '[[2,6],[3],[]]',
    'a second cast went through on one charge', out.spent);
  await tapCol(2); await page.waitForTimeout(900);
  out.placed = await look();
  check(out.placed.mine === '[[2,6],[3],[4]]', 'placement broken after a cast', out.placed);

  /* ---------- 5. drag and drop reaches the same gate ---------- */
  await newGame(); check(await waitChoose(), 'game never reached choose (drag)');
  await table([[1, 1], [], []], [[6], [], []]);
  const box = await page.locator('#spellBar .rune:not([hidden])').boundingBox();
  const target = await page.locator('#topBoard .col[data-col="0"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  out.dragging = await page.evaluate(() => ({
    ghost: document.querySelectorAll('.runeghost').length,
    hot: document.querySelectorAll('.col.hot').length,
    hotSide: document.querySelector('.col.hot')?.closest('.side')?.id,
  }));
  check(out.dragging.ghost === 1, 'no rune under the finger while dragging', out.dragging);
  // the steal takes from THEIR half: exactly the column it will rob lights up
  check(out.dragging.hot === 1 && out.dragging.hotSide === 'sideTop',
    'a theft must light the enemy column it will rob, and only that', out.dragging);
  await page.mouse.up(); await page.waitForTimeout(1800);
  out.dropped = await look();
  check(out.dropped.mine === '[[1,1,6],[],[]]' && out.dropped.theirs === '[[],[],[]]',
    'the drop did not steal', out.dropped);
  check(out.dropped.strays === 0, 'the dragged rune was left on the page', out.dropped);
  check(out.dropped.present === out.dropped.visible, 'a dropped-steal die is invisible', out.dropped);

  /* ---------- 6. refusals: legality is asked before anything moves ---------- */
  await newGame(); check(await waitChoose(), 'game never reached choose (refusal)');
  await table([[3], [], []], [[], [], []]);           // nothing to steal anywhere
  out.refuse = await page.evaluate(async () => {
    const k = window.__kb;
    const ok = await k.spells.cast('pilfer', 0);
    return { ok, charges: JSON.stringify(k.S.spellCharges), mine: JSON.stringify(k.S.boards[1]) };
  });
  check(out.refuse.ok === false, 'an empty-column theft was allowed', out.refuse);
  check(out.refuse.charges === '[{"pilfer":1},{"pilfer":1}]', 'a refused cast still cost a charge', out.refuse);
  // not your turn, and not your phase — the same gate placement uses. The
  // turn gate only bites in CPU mode (in duo, whoever holds the turn may
  // cast): a human cast on the machine's turn must be refused.
  out.offturn = await page.evaluate(async () => {
    const k = window.__kb;
    k.S.boards[0] = [[6], [], []];
    k.S.mode = 'cpu'; k.S.turn = 0;
    const other = await k.spells.cast('pilfer', 0);
    k.S.mode = 'duo'; k.S.turn = 1; k.S.phase = 'anim';
    const mid = await k.spells.cast('pilfer', 0);
    k.S.phase = 'choose';
    return { other, mid, charges: JSON.stringify(k.S.spellCharges) };
  });
  check(out.offturn.other === false, 'cast on the machine\'s turn', out.offturn);
  check(out.offturn.mid === false, 'cast after the die was already committed', out.offturn);

  /* ---------- 7. a cast can end the game (either grid full, not the mover's) ---------- */
  await newGame(); check(await waitChoose(), 'game never reached choose (endgame)');
  await table([[1, 2, 3], [1, 2, 3], [1, 2]], [[], [], [4, 5]]);
  await page.evaluate(() => window.__kb.spells.cast('pilfer', 2));
  await page.waitForTimeout(2600);
  out.ended = await look();
  check(out.ended.end, 'a steal that filled a grid did not end the game', out.ended);

  /* ---------- 8. NONE is really none: the table is the old table ---------- */
  await newGame({ spell: '' }); check(await waitChoose(), 'game never reached choose (none)');
  await table([[6, 6], [3], []], [[2], [5], []]);
  out.off = await look();
  check(out.off.charges === '[{},{}]', 'NONE still dealt a hand', out.off.charges);
  check(!out.off.runeShown && out.off.visibleRunes === 0, 'a rune survived the NONE pick', out.off);
  check(!out.off.casting, 'the board is still in casting with no spell picked', out.off);
  out.offCast = await page.evaluate(async () => {
    const k = window.__kb;
    return { cast: await k.spells.cast('pilfer', 0), mine: JSON.stringify(k.S.boards[1]) };
  });
  check(out.offCast.cast === false && out.offCast.mine === '[[6,6],[3],[]]',
    'a spell fired with the layer switched off', out.offCast);
  await tapCol(2); await page.waitForTimeout(900);
  check((await look()).mine === '[[6,6],[3],[4]]', 'ordinary play broken with spells off', await look());

  /* ---------- 8b. the CPU holds the same rune, and spends it ----------
     It was dealt a charge from the first build; leaving it unspent made VS CPU
     quietly one-sided. HARD takes a big steal and declines a trivial one. */
  await newGame(); check(await waitChoose(), 'game never reached choose (cpu)');
  out.cpuTakes = await page.evaluate(async () => {
    const k = window.__kb;
    k.S.mode = 'cpu'; k.S.diff = 'hard';
    k.S.boards[1] = [[6, 6], [1], []];      // the human's pair of 6s...
    k.S.boards[0] = [[2], [], []];          // ...facing the machine's single 2
    k.S.turn = 0; k.S.bottom = 1; k.S.busy = false; k.S.die = 3;
    k.applySides(); k.renderAll(false);
    const started = performance.now(), pending = k.spells.aiDelayed(0);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const beforeTell = { human: JSON.stringify(k.S.boards[1]),
      charges: JSON.stringify(k.S.spellCharges) };
    for (let i = 0; i < 80 && k.S.spellCharges[0].pilfer === 1; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const tellElapsed = Math.round(performance.now() - started);
    const over = await pending;
    return { over, cpu: JSON.stringify(k.S.boards[0]), human: JSON.stringify(k.S.boards[1]),
             charges: JSON.stringify(k.S.spellCharges), beforeTell,
             tellElapsed,
             bounds: [k.spells.aiDelay(() => 0), k.spells.aiDelay(() => .5), k.spells.aiDelay(() => 1)] };
  });
  check(out.cpuTakes.cpu === '[[2,6],[],[]]' && out.cpuTakes.human === '[[6],[1],[]]',
    'THE CPU LEFT A FREE STEAL ON THE TABLE', out.cpuTakes);
  check(out.cpuTakes.charges === '[{"pilfer":0},{"pilfer":1}]', 'the CPU charged the wrong seat', out.cpuTakes);
  check(out.cpuTakes.beforeTell.human === '[[6,6],[1],[]]'
      && out.cpuTakes.beforeTell.charges === '[{"pilfer":1},{"pilfer":1}]',
    'the computer cast before its card could be read', out.cpuTakes);
  check(out.cpuTakes.tellElapsed >= 300 && out.cpuTakes.tellElapsed < 1100
      && String(out.cpuTakes.bounds) === '320,610,900',
    'the computer spell pause is missing or outside its varied 320–900ms window', out.cpuTakes);
  // and while that turn still owns the rail, the player can see it is spent
  check(/\bspent\b/.test((await look()).runeClass),
    "a spent opponent turn did not leave an empty stack", await look());
  // a swing below what its difficulty demands is declined, charge intact
  await newGame(); check(await waitChoose(), 'game never reached choose (cpu decline)');
  out.cpuHolds = await page.evaluate(async () => {
    const k = window.__kb;
    k.S.mode = 'cpu'; k.S.diff = 'hard';
    k.S.boards[1] = [[1], [], []];          // nothing worth taking
    k.S.boards[0] = [[2], [], []];
    k.S.turn = 0; k.S.bottom = 1; k.S.busy = false; k.S.die = 3;
    k.applySides(); k.renderAll(false);
    await k.spells.ai(0);
    return { cpu: JSON.stringify(k.S.boards[0]), charges: JSON.stringify(k.S.spellCharges) };
  });
  check(out.cpuHolds.cpu === '[[2],[],[]]' && out.cpuHolds.charges === '[{"pilfer":1},{"pilfer":1}]',
    'the CPU burned its rune on nothing', out.cpuHolds);

  /* A new generation during the tell cancels the pending cast; delayed AI
     work may never land in a replacement game. */
  out.cpuTellCancelled = await page.evaluate(async () => {
    const k = window.__kb;
    k.S.mode = 'cpu'; k.S.diff = 'hard'; k.S.turn = 0; k.S.phase = 'anim';
    k.S.boards[1] = [[6, 6], [], []]; k.S.boards[0] = [[2], [], []]; k.S.die = 3;
    k.spells.render();
    const pending = k.spells.aiDelayed(0);
    await new Promise((resolve) => setTimeout(resolve, 80));
    k.S.gen += 1;
    const result = await pending;
    return { result, human: JSON.stringify(k.S.boards[1]), cpu: JSON.stringify(k.S.boards[0]),
      charges: JSON.stringify(k.S.spellCharges) };
  });
  check(!out.cpuTellCancelled.result && out.cpuTellCancelled.human === '[[6,6],[],[]]'
      && out.cpuTellCancelled.cpu === '[[2],[],[]]'
      && out.cpuTellCancelled.charges === '[{"pilfer":1},{"pilfer":1}]',
    'a computer spell survived its game generation', out.cpuTellCancelled);

  /* ---------- 8c. the rail changes owner with the turn ---------- */
  await newGame(); check(await waitChoose(), 'game never reached choose (offturn)');
  const rail = () => page.evaluate(() => {
    const b = document.querySelector('#spellBar .rune:not([hidden])');
    if (!b) return null;
    const top = b.querySelector('.rune-charge.top');
    return { cls: b.className, seat: b.dataset.seat, disabled: b.disabled,
      cards: [...b.querySelectorAll('.rune-charge')].filter((e) => !e.hidden).length,
      ring: top ? getComputedStyle(top, '::after').animationPlayState : 'none' };
  });
  const turnTo = async (who) => {
    await page.evaluate((t) => {
      const k = window.__kb;
      k.S.mode = 'cpu'; k.S.turn = t; k.S.bottom = 1; k.S.busy = false;
      k.S.boards = [[[3], [], []], [[4], [], []]];
      k.S.phase = t === 1 ? 'choose' : 'anim'; k.S.die = 3;
      k.applySides(); k.spells.render();
    }, who);
    await page.waitForTimeout(80);
  };
  await turnTo(0); out.theirTurn = await rail();
  await turnTo(1); out.myTurn = await rail();
  check(out.theirTurn?.seat === '0' && out.theirTurn.disabled && out.theirTurn.cards === 1,
    'the CPU turn did not deal its own inert card into the shared rail', out.theirTurn);
  check(out.myTurn?.seat === '1' && !out.myTurn.disabled && out.myTurn.cards === 1
    && out.myTurn.ring === 'running',
    'the player turn did not deal its castable card into the shared rail', out.myTurn);

  /* ---------- 8d. every input path respects an armed spell ----------
     Number keys are placement shortcuts, but an armed self spell owns them:
     the wrong target cancels the ordinary aim and must never place the die. */
  await newGame({ spell: 'fate' }); check(await waitChoose(), 'game never reached choose (armed key)');
  await table([[2], [], []], [[5], [], []], 4);
  check(await page.evaluate(() => window.__kb.spells.arm('fate')),
    'the self spell could not be armed for keyboard ownership');
  await page.keyboard.press('1'); await page.waitForTimeout(80);
  out.armedSelfKey = await page.evaluate(() => ({
    mine: JSON.stringify(window.__kb.S.boards[1]),
    armed: window.__kb.S.spellArmed,
    die: window.__kb.S.die,
    charges: JSON.stringify(window.__kb.S.spellCharges),
  }));
  check(out.armedSelfKey.mine === '[[2],[],[]]' && out.armedSelfKey.armed === null
      && out.armedSelfKey.die === 4 && out.armedSelfKey.charges === '[{"fate":2},{"fate":2}]',
    'a number key bypassed an armed self spell and placed the die', out.armedSelfKey);

  /* The turn clock is still authoritative while aiming. An ordinary aim
     cancels at expiry; ANVIL has already revealed and charged its markings,
     so it resolves its first legal marked column instead of stalling/refunding. */
  await newGame({ spell: 'ward' }); check(await waitChoose(), 'game never reached choose (aim timeout)');
  await table([[2], [], []], [[5], [], []], 4);
  out.ordinaryAimTimeout = await page.evaluate(async () => {
    const k = window.__kb;
    const armed = k.spells.arm('ward');
    const cast = await k.spells.timeoutAim();
    return { armed, cast, aim: k.S.spellArmed, committed: k.S.spellAimCommitted,
      charges: JSON.stringify(k.S.spellCharges) };
  });
  check(out.ordinaryAimTimeout.armed && !out.ordinaryAimTimeout.cast
      && out.ordinaryAimTimeout.aim === null && out.ordinaryAimTimeout.committed === null
      && out.ordinaryAimTimeout.charges === '[{"ward":1},{"ward":1}]',
    'an ordinary expired aim spent a charge or survived the timer', out.ordinaryAimTimeout);

  await newGame({ spell: 'anvil' }); check(await waitChoose(), 'game never reached choose (ANVIL timeout)');
  await table([[2, 3, 3], [], []], [[1], [], []], 3);
  out.committedAimTimeout = await page.evaluate(async () => {
    const k = window.__kb;
    const armed = k.spells.arm('anvil');
    const cast = await k.spells.timeoutAim();
    return { armed, cast, mine: JSON.stringify(k.S.boards[1]), aim: k.S.spellArmed,
      committed: k.S.spellAimCommitted, charges: JSON.stringify(k.S.spellCharges) };
  });
  check(out.committedAimTimeout.armed && out.committedAimTimeout.cast
      && out.committedAimTimeout.mine === '[[3,3,3],[],[]]'
      && out.committedAimTimeout.aim === null && out.committedAimTimeout.committed === null
      && out.committedAimTimeout.charges === '[{"anvil":1},{"anvil":0}]',
    'the turn clock refunded, stranded, or failed to resolve committed ANVIL', out.committedAimTimeout);

  /* Hosts without PointerEvent still use the same side-aware typed target.
     A synthetic click has useless (0,0) coordinates, so this specifically
     proves the semantic target fallback rather than the pointer path above. */
  const fallback = await sidePage({ name: 'spell click fallback', w: 390, h: 844,
    opts: { hasTouch: false, isMobile: false }, noPointer: true });
  try {
    await newGame({ spell: 'pilfer' }, fallback.page);
    check(await waitChoose(fallback.page), 'game never reached choose (click fallback)');
    await table([[2], [], []], [[6], [], []], 4, fallback.page);
    await fallback.page.locator('.rune[data-seat="1"]:not([hidden])').click();
    await fallback.page.locator('#topBoard .col[data-col="0"]').click();
    await fallback.page.waitForTimeout(1800);
    out.clickFallback = await fallback.page.evaluate(() => ({
      pointer: typeof PointerEvent,
      mine: JSON.stringify(window.__kb.S.boards[1]),
      theirs: JSON.stringify(window.__kb.S.boards[0]),
      armed: window.__kb.S.spellArmed,
      charges: JSON.stringify(window.__kb.S.spellCharges),
    }));
    check(out.clickFallback.pointer === 'undefined'
        && out.clickFallback.mine === '[[2,6],[],[]]'
        && out.clickFallback.theirs === '[[],[],[]]'
        && out.clickFallback.armed === null
        && out.clickFallback.charges === '[{"pilfer":1},{"pilfer":0}]',
      'the no-Pointer click fallback lost or cancelled the armed target', out.clickFallback);
  } finally {
    await fallback.ctx.close();
  }

}
