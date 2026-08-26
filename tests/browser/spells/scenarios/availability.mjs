export async function runAvailabilityScenarios(suite) {
  const { page, out, check, SPELLS, spellCopy, newGame, waitChoose } = suite;

  /* Every registry spell advertises real availability. The flow already asks
     each spec's legal() before arming. Pin the player-visible half of that
     contract as well: every spell is fully present when it has a legal answer,
     and every spell that can have no answer uses the same unavailable cue.
     Opponent-owned cards remain fully coloured; NUDGE is intentionally always
     legal. */
  const blockedFixtures = new Set(['fate', 'ward', 'sunder', 'pilfer', 'anvil']);
  check(SPELLS.every((spell) => spell.id === 'nudge' || blockedFixtures.has(spell.id)),
    'a new conditionally legal spell needs an unavailable-card fixture', SPELLS.map((spell) => spell.id));

  const availability = async (spell, blocked) => {
    await newGame({ spell: spell.id });
    check(await waitChoose(), `game never reached choose (${spell.id} availability)`);
    await page.evaluate(({ id, uses, blockedNow }) => {
      const k = window.__kb;
      k.S.gen += 1;
      k.S.mode = 'duo'; k.S.turn = 1; k.S.bottom = 1;
      k.S.phase = 'choose'; k.S.busy = false; k.S.die = 4; k.S.scoring = 0;
      k.S.pool = id === 'fate' && blockedNow ? [] : null;
      k.S.boards = [[[], [], []], [[], [], []]];
      k.S.charm.wards = [[0, 0, 0], [0, 0, 0]];
      k.S.charm.sunder = [false, false];
      k.S.spellCharges = [{ [id]: uses }, { [id]: uses }];
      k.S.spellArmed = null; k.S.spellAimCommitted = null;
      if (id === 'ward' && blockedNow) k.S.charm.wards[1] = [1, 1, 1];
      if (id === 'sunder' && blockedNow) k.S.charm.sunder[1] = true;
      if (id === 'pilfer' && !blockedNow) k.S.boards[0][0] = [6];
      if (id === 'anvil' && !blockedNow) k.S.boards[1][0] = [1, 2, 3];
      k.applySides(); k.renderAll(false); k.setStageDie(4, 1); k.showHints(); k.spells.render();
    }, { id: spell.id, uses: spell.uses, blockedNow: blocked });
    /* A fixed sleep can observe the filter on its final interpolation frame on
       a busy hosted browser. Wait for the settled player-visible cue instead:
       this still verifies the real transition and computed style, while making
       the assertion independent of how quickly Chromium schedules frames. */
    await page.waitForFunction(({ id, blockedNow }) => {
      const card = document.querySelector(`#spellBar .rune.hand-active[data-spell="${id}"]`);
      if (!card) return false;
      const style = getComputedStyle(card);
      const opacity = Number(style.opacity);
      return blockedNow
        ? Math.abs(opacity - .42) <= .002 && style.filter === 'grayscale(0.6)'
        : opacity >= .99 && style.filter === 'grayscale(0)';
    }, { id: spell.id, blockedNow: blocked }, { timeout: 2_000 });
    return page.evaluate((id) => {
      const k = window.__kb;
      const card = document.querySelector(`#spellBar .rune.hand-active[data-spell="${id}"]`);
      const style = getComputedStyle(card);
      const matrix = style.transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
      const before = {
        disabled: card.disabled,
        unavailable: card.classList.contains('unavailable'),
        offturn: card.classList.contains('offturn'),
        opponentTurn: document.getElementById('kbroot').classList.contains('opponent-turn'),
        scale: Math.hypot(matrix.a, matrix.b),
        opacity: Number(style.opacity),
        filter: style.filter,
        aria: card.getAttribute('aria-label'),
      };
      const armed = k.spells.arm(id);
      const aim = k.S.spellArmed;
      k.spells.disarm(true);
      return { ...before, armed, aim };
    }, spell.id);
  };

  out.spellAvailability = {};
  for (const spell of SPELLS) {
    const available = await availability(spell, false);
    out.spellAvailability[spell.id] = { available };
    check(!available.disabled && !available.unavailable && !available.offturn
        && !available.opponentTurn && Math.abs(available.scale - 1) <= .002
        && available.opacity >= .99 && available.filter === 'grayscale(0)'
        && available.armed && available.aim === spell.id,
      `${spellCopy(spell.id).name} did not look and behave activatable with a legal target`, available);
    if (!blockedFixtures.has(spell.id)) continue;
    const blocked = await availability(spell, true);
    out.spellAvailability[spell.id].blocked = blocked;
    check(blocked.disabled && blocked.unavailable && !blocked.offturn
        && !blocked.opponentTurn && Math.abs(blocked.scale - 1) <= .002
        && blocked.opacity >= .40 && blocked.opacity <= .44
        && blocked.filter === 'grayscale(0.6)' && /not available right now/i.test(blocked.aria || '')
        && !blocked.armed && blocked.aim === null,
      `${spellCopy(spell.id).name} did not use the unavailable cue when it had no legal target`, blocked);
  }
}
