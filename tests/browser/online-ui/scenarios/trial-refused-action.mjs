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
  /* NOT COVERED HERE: the refused AIM. Reaching it needs ANVIL castable, which
     needs a full own column AND a current die unlike the weakest in it, and
     seeding the action log to that state broke match entry in this fixture.
     The aim path is pinned at source in tests/online-api.test.ts instead, and
     the painted behaviour is tracked separately — said plainly rather than
     implied by a green run. */
}
