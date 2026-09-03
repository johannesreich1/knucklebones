// A SCREEN THAT CANNOT LOAD MUST SAY SO AND OFFER THE WAY BACK.
//
// Johannes, 3 Sep 2026: "i cant read the ladder view... it loading endlessly".
// The Ladder asks for four things at once, and one of them is a bare scalar —
// the server's ranked curve version. Without it no league can be named, so the
// panel used to return early and leave the shared loading die mounted. Forever:
// no error, no retry, no timeout, and the only escape was Back or restarting
// the app. `activeRankedCurveVersion()` answers null on ANY transient error, so
// one 503 on that one read stranded the whole screen.
//
// The promise now is the one the ranked door already keeps: the same connection
// sheet, in the copy every locale already carries, with its Retry. These are
// PAINT assertions rather than DOM assertions because a sheet that exists but
// sits at opacity 0 behind the loading die is exactly the failure being fixed —
// the player has to be able to see it and hit it.
//
// The retry then has to actually re-run the read, not merely close the card,
// which is why the second half repairs the route and demands ROWS.

/* Wait for whichever answer the panel gives — a sheet or a painted board —
   rather than sleeping a fixed time. A stranded Ladder gives neither, so this
   returns its last reading and the checks below name what was missing. */
const settleLadder = (page, budgetMs = 8000) => page.evaluate(async (budget) => {
  const read = () => {
    const ask = document.getElementById('ovAsk');
    const dialog = ask?.querySelector('.askcard');
    const rect = dialog?.getBoundingClientRect();
    const hit = rect
      ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      : null;
    const loading = document.getElementById('onLoading');
    const die = loading?.getBoundingClientRect();
    return {
      sheetVisible: !!ask?.classList.contains('on'),
      sheetPainted: !!rect && rect.width > 0 && rect.height > 0
        && Number(getComputedStyle(dialog).opacity) > 0.9,
      sheetHittable: !!hit && !!ask?.contains(hit),
      title: document.getElementById('askHead')?.textContent?.trim() ?? null,
      retry: document.getElementById('btnAskYes')?.textContent?.trim() ?? null,
      stillLoading: !!loading && loading.hidden === false
        && !!die && die.width > 0 && die.height > 0,
      rows: document.querySelectorAll('#ovOnline .lb .lrow').length,
    };
  };
  /* The card flies in over ~340ms, so `visible` is true well before it can be
     hit. Wait for it to LAND — or for the board to paint — rather than for the
     class to appear, or the reading is a race the sheet usually loses. */
  const deadline = Date.now() + budget;
  let state = read();
  while (Date.now() < deadline && !(state.sheetVisible && state.sheetHittable)
    && state.rows === 0) {
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    state = read();
  }
  return state;
}, budgetMs);

/* Read the rank the way the player does: the value, and whether the inline
   wait beside it has ended. */
const readRank = (page) => page.evaluate(() => {
  const rank = document.getElementById('accRank');
  return {
    text: rank?.textContent?.trim() ?? null,
    busy: rank?.getAttribute('aria-busy') ?? null,
    waiting: !!rank?.querySelector('.ldclock, svg'),
  };
});

export async function runLadderRecoveryScenarios(suite) {
  const { visit, out, check } = suite;

  await visit({
    door: 'board',
    failCurveVersion: true,
    expectBoardFailure: true,
    skipStandardProbes: true,
    returnAfterProbe: true,
    probe: async (page, routes) => {
      const stranded = await settleLadder(page);
      out.ladderCurveFailure = stranded;
      check(stranded.sheetVisible === true && stranded.sheetPainted === true
        && stranded.sheetHittable === true,
      'a Ladder that cannot read the ranked curve left the player on its loading die '
        + 'instead of showing the connection sheet', stranded);
      check(stranded.retry === 'Try again',
        'the stranded Ladder offered no way to try again', stranded);
      check(stranded.stillLoading === false,
        'the Ladder kept its loading die mounted behind the connection sheet', stranded);

      /* The retry has to re-ask the server, not merely dismiss the card. Repair
         the route first so a board that never re-reads is visibly distinct from
         one that does. */
      routes.setCurveVersionUnavailable(false);
      await page.click('#btnAskYes');
      const recovered = await settleLadder(page);
      out.ladderCurveRecovery = recovered;
      check(recovered.rows > 0,
        'retrying the stranded Ladder did not re-read the curve and paint the board',
        recovered);
      check(recovered.sheetVisible === false,
        'the connection sheet stayed up after a successful retry', recovered);
    },
  });

  /* AN EXPIRED TOKEN IS NOT AN OUTAGE.
     Sixty minutes is all an access token ever lives (supabase/config.toml
     jwt_expiry), and a phone that has been asleep longer wakes holding a dead
     one. The library refreshes on its own, but once one of its refreshes has
     failed it deletes the session and caches that failure for a minute, and
     every read afterwards is refused for credentials without touching the
     network. That is what the player meets: a rank that never arrives, on an
     app that still looks signed in, curable only by restarting it.
     One refusal is now answered by one refresh and one retry. */
  const healed = await visit({
    door: 'chip',
    refuseStandingOnce: true,
    sessionRefresh: true,
    skipStandardProbes: true,
    returnAfterProbe: true,
    probe: async (page, routes) => {
      await page.waitForFunction(
        () => document.getElementById('accRank')?.getAttribute('aria-busy') !== 'true',
        null, { timeout: 10000 },
      ).catch(() => undefined);
      const rank = await readRank(page);
      const calls = routes.standingCalls();
      out.standingRefusalRecovery = { ...rank, standingCalls: calls };
      check(rank.busy !== 'true' && rank.waiting === false,
        'a standing refused for credentials left the rank waiting for good', rank);
      check(/^#\d+$/u.test(rank.text ?? ''),
        'the rank did not paint after refreshing the session', rank);
      check(calls === 2,
        'the refused standing was not retried exactly once after the refresh',
        { standingCalls: calls });
    },
  });
  void healed;
}
