// The facts the profile screen asks for: this season's rating, where the player
// stands, the best streak, and the keyset of past duels.
//
// The standing is DERIVED from the board rather than restated beside it — a
// hand-kept copy of the rank and population silently disagrees with the rows
// the moment a case names its own board. Each route's `hold` share is its place
// in the arrival order the loading probes assert, so the shares are contractual.
import { historySeasonFixture, RUN_A_POPULATION } from './board-fixtures.mjs';

export async function installProfileRoutes(page, {
  hold,
  nearBottomBoard,
  historyDepth,
  standingPoints,
  standingPeak,
  historicalSilverReached,
}) {
  /* BONE by default, which is what every existing probe has always seen. A
     case that needs a different current standing or historical equipment
     unlock names its own points/peak rather than editing this. */
  const points = standingPoints ?? 465;
  const currentPeak = standingPeak ?? Math.max(700, points);
  const silverReached = historicalSilverReached ?? currentPeak >= 1260;
  await page.route('**/rest/v1/season_ratings*', async (r) => {
    await hold(.65);
    /* myLadder issues a second, owner-scoped existence read for an all-season
       SILVER peak. It is deliberately independent of the current-season row:
       a rollover may start that row below the permanent unlock threshold. */
    if (new URL(r.request().url()).searchParams.get('select') === 'peak') {
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(silverReached ? [{ peak: 1260 }] : []) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      {
        points,
        peak: currentPeak,
        wins: 42,
        losses: 61,
        draws: 0,
      },
    ]) });
  });
  await page.route('**/rest/v1/rpc/player_standing*', async (r) => {
    await hold(.7);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      /* Rank 2 of 199 is just outside floor(1%): this must agree with the
         ladder row's apex:false so both surfaces resolve BONE. */
      /* Derived from the board rather than restated beside it: a hand-kept
         copy of the rank and population silently disagrees with the rows the
         moment a case names its own board. */
      nearBottomBoard
        ? (() => {
          const me = nearBottomBoard.find((row) => row.nickname === 'TestGuest001');
          return { points: me?.points ?? points, rank: me?.rank ?? 1,
                   population: nearBottomBoard.length, percentile: 96 };
        })()
        : { points, rank: 2, population: RUN_A_POPULATION, percentile: 1 },
    ]) });
  });
  await page.route('**/rest/v1/rpc/best_streak*', async (r) => {
    await hold(.8);
    return r.fulfill({ status: 200, contentType: 'application/json', body: '4' });
  });
  /* Deliberately last during loading probes: the profile must keep its die up
     after identity and ladder facts have arrived, rather than revealing rows
     one endpoint at a time. */
  await page.route('**/rest/v1/rpc/match_history*', async (r) => {
    await hold(1);
    /* A REAL KEYSET, not a fixed page. The old stub answered three rows and
       ignored limit_n/before_t/before_id, so `3 < PAGE` marked the list
       finished on its first response and the paging branch was unreachable in
       every test — which is how match history shipped capped at thirty rows,
       silently, for as long as the paged-view refactor has been in. The first
       three rows are byte-identical to what it used to serve so the profile's
       RECENT strip and the localization probes keep asserting what they did.
       Mirrors the leaderboard stub's compound-cursor shape. */
    const season = historySeasonFixture(historyDepth);
    const args = r.request().postDataJSON() ?? {};
    const limit = Math.min(Number(args.limit_n ?? 40), 100);
    const beforeT = args.before_t ?? null;
    const beforeId = args.before_id ?? null;
    const key = (row) => `${row.finished_at}|${row.id}`;
    const page = (beforeT
      ? season.filter((row) => key(row) < `${beforeT}|${beforeId ?? ''}`)
      : season).slice(0, limit);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(page) });
  });
}
