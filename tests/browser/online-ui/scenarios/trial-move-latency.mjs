// A RUNE TRIAL PLACEMENT MUST LAND AT TAP TIME, LIKE AN ORDINARY RANKED ONE.
//
// Ordinary ranked animates your own move next to the request, so the ~550ms
// round trip is never felt (production 2026-08-28: pvp-move p50 546ms, flat all
// day). The Rune Trial takes the other path — an authoritative action log — and
// froze local state until the committed log projected back. Reported on device
// 2026-08-28: the delay is there in Trial and NOT in classic.
//
// MEASURE THE BOARD, NOT THE DOM. A first attempt watched the tapped column's
// slots and "passed" with the fix disabled: the column fills with a preview
// before anything is placed, so the probe was timing a ghost. `S.boards` is the
// state renderSide paints from, so a die appearing there is a placement and
// nothing else.
const ACTION_DELAY_MS = 1500;

export async function runTrialMoveLatencyScenarios({ visit, out, check }) {
  const seen = await visit({
    named: true, skipStandardProbes: true, door: 'match',
    trialMatch: { actionDelay: ACTION_DELAY_MS },
    probe: async (page) => {
      await page.waitForSelector('#botBoard .col[data-col="1"]', { timeout: 15000 });
      const height = () => page.evaluate(() => {
        const kb = window.__kb, online = window.__kbOnline?.();
        if (!kb || !online) return null;
        return kb.S.boards[online.you].reduce((n, col) => n + col.length, 0);
      });
      const before = await height();
      const t0 = Date.now();
      const response = page.waitForResponse(
        (r) => r.url().includes('/functions/v1/pvp-action'), { timeout: 12000 },
      ).then(() => Date.now() - t0, () => null);
      await page.tap('#botBoard .col[data-col="1"]');
      let placedAtMs = null;
      for (let i = 0; i < 120 && placedAtMs === null; i++) {
        await page.waitForTimeout(25);
        if ((await height()) > before) placedAtMs = Date.now() - t0;
      }
      return { before, placedAtMs, responseAtMs: await response };
    },
  });
  out.trialMoveLatency = { ...seen.probeResult, actionDelayMs: ACTION_DELAY_MS };
  const r = seen.probeResult;

  check(!!r && r.placedAtMs !== null, 'the die never reached the board at all', out.trialMoveLatency);
  check(!!r && r.responseAtMs !== null && r.responseAtMs >= ACTION_DELAY_MS,
    'the held action was not actually held — this probe proves nothing', out.trialMoveLatency);
  /* Generous on purpose: this separates "placed while the request is in flight"
     from "placed only once it returned", and must not become a timing budget
     that fails on a loaded machine. */
  check(!!r && r.placedAtMs !== null && r.placedAtMs < ACTION_DELAY_MS,
    'A RUNE TRIAL PLACEMENT WAITS FOR THE SERVER — the die reaches the board only '
    + 'after the held action returns, so the player feels the whole round trip',
    out.trialMoveLatency);
}
