// A REFUSED RUNE ACTION MUST NOT FREEZE THE GAME.
//
// Reported from a device 2026-08-29: "I activated anvil in online ranked and my
// game got stuck. Had to restart the app, not even the dice got the effect
// colour when activating."
//
// Both halves of that are one chain. ANVIL is commitsOnAim, so arming it in
// ranked fires an `aim` ACTION rather than painting anything locally
// (flow/spell-aim.ts hands `commitsOnAim` to the transport and skips
// applyAimPresentation) — the die lights only when the action log projects
// back. Submitting sets S.busy = true. If the server then REFUSES the action,
// the response is not "uncertain" — that word is reserved for status 0, 5xx and
// a 200 with no match — so the recovery branch is skipped, the fallback resync
// installs a projection that never reopens the input gate, and submit returns
// false with nothing left to call refreshTurnUI.
//
// Nothing rescues it after that: the turn clock's autoPlace returns early on
// S.busy, so the one thing that could take the turn is disabled by the same
// flag. The game is frozen until the app restarts, which re-enters and projects
// fresh — which is exactly why it was placeable again afterwards.
//
// Production carried 5 × pvp-action 409 against 151 × 200 in one day, so this
// is a live path, not a theoretical one. The harness reproduces it with 422:
// its stub answers anything that is not a `place` that way, and every non-200
// that is not "uncertain" takes the same branch.

export async function runTrialRefusedActionScenarios({ visit, out, check }) {
  const seen = await visit({
    named: true,
    skipStandardProbes: true,
    door: 'match',
    /* ANVIL is the one rune here that commits on aim, which is what turns
       arming into a server action at all. */
    /* 409 is what production returns — 5 of them against 151 successes in a
       single day. A refused PLACEMENT reaches the same submit() branch a
       refused aim does, and needs no board state to arrange, so it tests the
       defect rather than the route that happened to expose it. */
    trialMatch: { myRune: 'anvil', foeRune: 'ward', refuseWith: 409 },
    probe: async (page) => {
      await page.waitForSelector('#botBoard .col.legal', { timeout: 15000 });
      const before = await page.evaluate(() => ({
        busy: window.__kb.S.busy, phase: window.__kb.S.phase,
      }));
      await page.click('#botBoard .col.legal');
      /* Long enough for the refusal, its resync, and any recovery to finish —
         this is not a race, it is a gate that never reopens. */
      await page.waitForTimeout(2500);
      return {
        before,
        after: await page.evaluate(() => ({
          busy: window.__kb.S.busy,
          phase: window.__kb.S.phase,
          armed: window.__kb.S.spellArmed,
          /* Can a column still be pressed? The player's complaint was that
             nothing responded, so ask the board, not just the flag. */
          placeable: [...document.querySelectorAll('#botBoard .col')]
            .some((col) => col.classList.contains('legal')),
        })),
      };
    },
  });
  out.trialRefusedAction = seen.probeResult;
  const r = seen.probeResult;

  check(!!r && r.before.busy === false,
    'the probe never reached a live turn, so it proves nothing', r);
  check(!!r && r.after.busy === false,
    'A REFUSED RUNE ACTION LEFT THE GAME FROZEN — S.busy stayed true, and the '
    + 'turn clock cannot clear it because autoPlace returns early on exactly '
    + 'that flag, so nothing short of restarting the app recovers', r);
  check(!!r && r.after.placeable,
    'a refused rune action left the board with no column the player can press', r);
  await runRefusedAimScenarios({ visit, out, check });
}

// A REFUSED *AIM* MUST HAND THE RUNE BACK.
//
// The other half of the same report, and the harder half to reach. Arming a
// commitsOnAim rune in ranked does not paint from a local decision — it fires an
// `aim` ACTION. flow/spell-aim arms optimistically, so a refusal has to be
// caught and undone; a discarded transport result left the player holding a rune
// the server never accepted, uncastable, with no way back short of restarting.
// Production carried 5 x pvp-action 409 against 151 x 200 that day.
//
// WHY THIS WAS PINNED AT SOURCE UNTIL NOW. ANVIL is the only commitsOnAim rune,
// and it is legal only on a column of your own you can no longer place into,
// holding a die unlike the one it would replace ("a cast that changes nothing is
// illegal"). The fixture's constant faces can never produce that: it alternates
// 5 and 2, so the player's die is always 2 and their column fills with 2s.
// Seeding the fixture's `boards` array does not help either — the client rebuilds
// its board by projecting the action LOG, so the rows are the only thing it reads.
//
// The fixture now seeds through its own place(), which keeps the log, the board,
// the turn and next_die coherent — installTrialProjection refuses any snapshot
// whose projection disagrees with match.action_version, which is what a
// hand-poked board used to trip on entry.
const ANVIL_OPENING_DIE = 2;
/* Six committed placements: the player's first column fills with 2s and the
   sixth hands them a 4, so ANVIL has a full column whose weakest die is not the
   die in hand. Seat 1 opens because projectRankedActions always starts at ME. */
const ANVIL_BOARD = [
  { who: 1, col: 0, nextDie: 5 }, { who: 0, col: 0, nextDie: 2 },
  { who: 1, col: 0, nextDie: 5 }, { who: 0, col: 0, nextDie: 2 },
  { who: 1, col: 0, nextDie: 5 }, { who: 0, col: 0, nextDie: 4 },
];

async function runRefusedAimScenarios({ visit, out, check }) {
  const seen = await visit({
    named: true, skipStandardProbes: true, door: 'match',
    trialMatch: {
      myRune: 'anvil', foeRune: 'ward', refuseWith: 409,
      /* THE ONLY STATE IN WHICH THIS CLIENT'S OWN RECOVERY IS LOAD-BEARING.
         A refused action resyncs, and installTrialProjection disarms, restores
         the charges and hands the turn back — from the LOG, so it repairs the
         aim whether or not arm() does. MEASURED: against a coherent read this
         scenario passes with the fix reverted, which would make it a test that
         agrees with the bug. Refusing the projection (one action_version more
         than the log holds) leaves the rune with nothing but arm() to hand it
         back, which is exactly the device's "had to restart the app". */
      desyncAfterRefusal: true,
      openingDie: ANVIL_OPENING_DIE, seedPlacements: ANVIL_BOARD,
    },
    probe: async (page) => {
      const rune = '#spellBar button.rune[data-spell="anvil"][data-seat="1"]';
      await page.waitForSelector(rune, { timeout: 15000 });
      await page.waitForFunction(() => window.__kb?.S?.busy === false, null, { timeout: 15000 });
      const read = () => page.evaluate(() => ({
        armed: window.__kb.S.spellArmed,
        committed: window.__kb.S.spellAimCommitted?.id ?? null,
        busy: window.__kb.S.busy,
        charges: window.__kb.S.spellCharges[window.__kbOnline().you].anvil ?? 0,
        /* Ask the BOARD, not the flag: the complaint was that nothing responded. */
        placeable: [...document.querySelectorAll('#botBoard .col')]
          .some((col) => col.classList.contains('legal')),
      }));
      const before = await read();
      /* Tapping a column rune ARMS it; that alone fires the aim action. */
      await page.tap(rune);
      /* Long enough for the refusal, its resync and any recovery to finish.
         This is not a race: a gate that never reopens stays shut. */
      await page.waitForTimeout(2500);
      return { before, after: await read() };
    },
  });
  out.trialRefusedAim = seen.probeResult;
  const r = seen.probeResult;

  check(!!r && r.before.busy === false && r.before.charges === 1 && r.before.placeable,
    'the probe never reached a live turn holding a castable ANVIL, so it proves nothing', r);
  /* THE assertion. */
  check(!!r && r.after.armed === null && r.after.committed === null,
    'A REFUSED RUNE AIM LEFT THE RUNE ARMED — the server did not accept it, but the '
    + 'player is still holding it: unlit, uncastable, and with no projection coming '
    + 'to take it away. This is the device report, and restarting the app was the '
    + 'only way out', r);
  /* The aim spends the charge at tap time so the rings can be painted at once.
     A refusal was never spent on the SERVER, so the card has to come back. */
  check(!!r && r.after.charges === r.before.charges,
    'a refused rune aim kept the charge it never spent — the rune is gone from the '
    + 'rail for a cast that never happened', r);
  /* NOT ASSERTED, AND THE REASON MATTERS. S.busy stays true here and no column is
     pressable, with or without the fix: reopening the turn belongs to the
     projection, and this fixture deliberately refuses every projection forever so
     that arm() is the only thing left to test. A real client keeps retrying
     through the watchdog's recoverySync branch and gets its turn back with the
     rune already returned. The recoverable case — refusal, clean resync, usable
     turn — is the refused PLACEMENT above. */
}
