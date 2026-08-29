// A RUNE MUST GO OFF WHEN IT IS TAPPED, NOT WHEN THE SERVER AGREES.
//
// Reported from a device 2026-08-29: "activating a rune still takes some time,
// like playing with runes before. Can't we validate runes on local too and make
// the animation and play instantly, similar like game moves?"
//
// The Trial submits every cast to the authoritative action log and froze local
// state until the committed log projected back, so the whole round trip (~550ms
// in production) sat between the tap and anything happening. A placement was
// already fixed this way; casting was not.
//
// It is safe because src/core holds no randomness of its own — the supply
// arrives as CastCtx.draw — and only FATE ever reaches for it. The other five
// are pure functions of (board, seat, column, die, charm), so this client
// computes the committed row exactly. `drawsFromSupply` declares that, and
// tests/spells.test.ts casts every spell against a draw() that records being
// reached, so the declaration cannot quietly stop being true.
//
// So the split is measured here, not assumed: NUDGE lands at tap time, FATE's
// card leaves the rail at tap time while its DIE waits for the server, and
// ANVIL — whose aim is the information — shows its marks immediately.
//
// The held response is verified in every case. A probe that "passed" because
// the stub answered instantly would be measuring nothing at all.
const HOLD_MS = 1500;

/* Seat 1 opens. Six placements fill the viewer's first column with 2s and leave
   a 4 in hand, which is the only state ANVIL is legal in: a column that can no
   longer be placed into, holding a die unlike the one being offered. */
const ANVIL_BOARD = [
  { who: 1, col: 0, nextDie: 5 }, { who: 0, col: 0, nextDie: 2 },
  { who: 1, col: 0, nextDie: 5 }, { who: 0, col: 0, nextDie: 2 },
  { who: 1, col: 0, nextDie: 5 }, { who: 0, col: 0, nextDie: 4 },
];

const rune = (id) => `#spellBar button.rune[data-spell="${id}"][data-seat="1"]`;

/* Everything the probes read, in one place: charges and the die in hand come
   from S, which is what the rail and the stage paint from. */
const readState = (id) => ({
  die: window.__kb.S.die,
  charges: window.__kb.S.spellCharges[window.__kbOnline().you][id] ?? 0,
  armed: window.__kb.S.spellArmed,
});

async function castRun({ visit }, { runeId, seed = [], openingDie, arm = false, probeAfterArm }) {
  return visit({
    named: true, skipStandardProbes: true, door: 'match',
    trialMatch: {
      myRune: runeId, foeRune: 'nudge', actionDelay: HOLD_MS,
      ...(openingDie ? { openingDie } : {}), seedPlacements: seed,
    },
    probe: async (page) => {
      await page.waitForSelector(rune(runeId), { timeout: 15000 });
      await page.waitForFunction(() => window.__kb?.S?.busy === false, null, { timeout: 15000 });
      /* COUNT THE CARDS THAT ACTUALLY LEAVE THE RAIL. The charge NUMBER cannot
         see a double spend: spendChargePresentation clamps at zero, and ANVIL
         has a single use, so spending it twice reads the same as once. What the
         player sees is the card flying out — one `.rune-played` copy per spend
         (flow/spell-rail.ts playSpellCharge) — so count those instead. */
      await page.evaluate(() => {
        window.__kbCardsPlayed = 0;
        new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (node instanceof HTMLElement && node.classList.contains('rune-played')) {
                window.__kbCardsPlayed++;
              }
            }
          }
        }).observe(document.getElementById('kbroot'), { childList: true, subtree: true });
      });
      const read = () => page.evaluate(readState, runeId);
      const before = await read();
      const t0 = Date.now();
      const response = page.waitForResponse(
        (r) => r.url().includes('/functions/v1/pvp-action'), { timeout: 12000 },
      ).then(() => Date.now() - t0, () => null);

      await page.tap(rune(runeId));
      /* ARM-TIME READING, taken while the aim command is still in flight —
         this is the beat the player said was missing entirely. */
      const armed = probeAfterArm ? await page.evaluate(probeAfterArm) : null;
      if (arm) await page.tap('#botBoard .col[data-col="0"]');

      let changedAtMs = null;
      let chargeAtMs = null;
      for (let i = 0; i < 160 && (changedAtMs === null || chargeAtMs === null); i++) {
        await page.waitForTimeout(25);
        const now = await read();
        if (chargeAtMs === null && now.charges < before.charges) chargeAtMs = Date.now() - t0;
        if (changedAtMs === null && now.die !== before.die) changedAtMs = Date.now() - t0;
      }
      return {
        before, armed, chargeAtMs, changedAtMs,
        responseAtMs: await response,
        after: await read(),
        cardsPlayed: await page.evaluate(() => window.__kbCardsPlayed),
        board: await page.evaluate(() => window.__kb.S.boards[window.__kbOnline().you]),
      };
    },
  });
}

/* Runs in the page while the aim is still uncommitted. A ring or a hued die can
   be present in the DOM and invisible, so read the COMPUTED hue off the preview
   die rather than counting nodes. */
const anvilMarks = () => {
  const previews = [...document.querySelectorAll('.spellpreview')];
  const hue = previews[0] ? getComputedStyle(previews[0]).getPropertyValue('--spell-hue').trim() : '';
  return {
    aimed: document.querySelectorAll('.col.aim').length,
    previews: previews.length,
    hue,
    busy: window.__kb.S.busy,
  };
};

export async function runTrialCastLatencyScenarios({ visit, out, check }) {
  const held = (r, label) => check(!!r && r.responseAtMs !== null && r.responseAtMs >= HOLD_MS,
    `the ${label} action was not actually held — this probe proves nothing`, r);

  /* ---- NUDGE: no draw, so the whole rune resolves at tap time ---- */
  const nudge = (await castRun({ visit }, { runeId: 'nudge' })).probeResult;
  out.trialCastNudge = nudge;
  held(nudge, 'NUDGE');
  check(!!nudge && nudge.changedAtMs !== null && nudge.changedAtMs < HOLD_MS,
    'A RUNE CAST WAITS FOR THE SERVER — NUDGE changes nothing until the held '
    + 'action returns, so the player feels the whole round trip on a rune whose '
    + 'result this client could compute exactly', nudge);
  check(!!nudge && nudge.after.die === (nudge.before.die % 6) + 1,
    'NUDGE did not leave the die the rules say it should', nudge);
  /* THE DOUBLE-SPEND GUARD. The replay must skip the row this already drew;
     if it does not, the card leaves the rail twice and the charge goes to 0. */
  check(!!nudge && nudge.after.charges === nudge.before.charges - 1
    && nudge.cardsPlayed === 1,
    'the authoritative replay spent the charge a SECOND time — the optimistic '
    + 'cast was drawn and then drawn again', nudge);

  /* ---- FATE: the one rune whose face is the server's ---- */
  const fate = (await castRun({ visit }, { runeId: 'fate' })).probeResult;
  out.trialCastFate = fate;
  held(fate, 'FATE');
  check(!!fate && fate.chargeAtMs !== null && fate.chargeAtMs < HOLD_MS,
    'FATE gives the player nothing at tap time — its card should leave the rail '
    + 'immediately even though the drawn face cannot be known yet', fate);
  check(!!fate && fate.changedAtMs !== null && fate.changedAtMs >= HOLD_MS,
    'FATE PAINTED A DIE THE SERVER NEVER ROLLED — the redraw resolved locally, '
    + 'which it cannot do: the supply is not this client\'s to read', fate);
  check(!!fate && fate.after.charges === fate.before.charges - 1
    && fate.cardsPlayed === 1,
    'FATE spent its charge twice — the replay redrew the card the tap already '
    + 'played', fate);

  /* ---- ANVIL: commits on aim, and the aim IS the information ---- */
  const anvil = (await castRun({ visit }, {
    runeId: 'anvil', seed: ANVIL_BOARD, openingDie: 2, arm: true, probeAfterArm: anvilMarks,
  })).probeResult;
  out.trialCastAnvil = anvil;
  held(anvil, 'ANVIL');
  check(!!anvil?.armed && anvil.armed.busy === true,
    'the ANVIL reading was not taken while its aim was in flight, so it says '
    + 'nothing about what the player sees during the trip', anvil);
  check(!!anvil?.armed && anvil.armed.aimed > 0,
    'ARMING ANVIL IN RANKED RINGS NO COLUMN — the aim commits on the server and '
    + 'caster() answers null while that command is in flight, so markAim '
    + 'CLEARED the rings instead of drawing them', anvil);
  check(!!anvil?.armed && anvil.armed.previews > 0 && anvil.armed.hue !== '',
    'ARMING ANVIL LIGHTS NO DIE — "not even the dice got the effect color when '
    + 'activating", as reported', anvil);
  /* ...and the cast that follows still lands, with one charge gone, not two. */
  /* ANVIL commits on aim, so the aim plays the card and the cast only claims
     what the aim reserved: one flight for the pair.
     SAID PLAINLY — this does not currently pin the ordering that produces it.
     play-trial-actions reads `reserved` BEFORE the disarm that clears
     S.spellAimCommitted, and reading it after was measured to change nothing:
     ANVIL is the only commitsOnAim rune, it has a single use, and by cast time
     that charge is already gone — so the second spend finds no card to fly and
     clamps at zero. The ordering is kept because it is what the decision
     actually depends on, and it becomes load-bearing the day a commitsOnAim
     rune carries two. FATE, which does carry two, is where the replay's skip is
     genuinely pinned above. */
  check(!!anvil && anvil.cardsPlayed === 1,
    'the ANVIL aim and its cast played two cards for one rune', anvil);
  /* ANVIL reforges the ONE die its aim marked — the preview die above — not
     the column. [2,2,2] holding a 4 becomes [4,2,2]. */
  check(!!anvil && JSON.stringify(anvil.board[0]) === '[4,2,2]',
    'the ANVIL cast did not reforge the die its aim had marked', anvil);
}
