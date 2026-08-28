// Serving the ladder board: the paged leaderboard and the card a row opens.
//
// The board itself is a fixture (board-fixtures.mjs); this module owns only how
// it is SERVED — a real compound cursor, forward and backward, plus the
// deliberate mid-flight stall a loading probe needs. Nothing else in the
// harness reads the page counter or the pagination gate, so both live here.
import { RUN_A_POPULATION } from './board-fixtures.mjs';

export async function installLadderRoutes(page, { hold, nearBottomBoard, paginationRace }) {
  let ladderPageCalls = 0;
  let markPaginationStarted;
  let releasePagination;
  const paginationStarted = new Promise((resolve) => { markPaginationStarted = resolve; });
  const paginationRelease = new Promise((resolve) => { releasePagination = resolve; });
  /* the 0022 shape: points/rank/apex/avatar/peak. The two rows sit in
     DIFFERENT groups (1,072 is IVORY, 465 is BONE) so the board has to draw a
     horizon for each — the group structure is asserted below. */
  await page.route('**/rest/v1/rpc/leaderboard*', async (r) => {
    await hold(1);
    const before = r.request().url().includes('/rpc/leaderboard_before');
    const ordinary = [
      { nickname: 'NovaComet992', points: 1072, wins: 7, losses: 2, games: 9, rank: 1, pos: 1, population: 2, apex: false, avatar: 'die:3:mg', peak: 1100 },
      { nickname: 'TestGuest001', points: 465, wins: 42, losses: 61, games: 103, rank: 2, pos: 2, population: 2, apex: false, avatar: 'die:5:cy', peak: 700 },
    ];
    let board;
    if (nearBottomBoard) {
      const args = r.request().postDataJSON() ?? {};
      const limit = Number(args.limit_n ?? 50);
      if (before) {
        const boundary = Number(args.before_rank ?? 1);
        const nickname = String(args.before_nickname ?? '');
        board = nearBottomBoard.filter((row) => row.rank < boundary
          || (row.rank === boundary && row.nickname < nickname)).slice(-limit);
      } else if (args.from_pos != null) {
        /* THE SEEK. from_pos addresses a row directly, which is what a dragged
           thumb produces; the rank cursor cannot, because rank() gaps after
           ties. It REPLACES the rank cursor rather than joining it, exactly as
           the SQL branches. */
        const from = Number(args.from_pos);
        board = nearBottomBoard.filter((row) => row.pos >= from).slice(0, limit);
      } else {
        const boundary = Number(args.from_rank ?? 1);
        const nickname = typeof args.after_nickname === 'string' ? args.after_nickname : null;
        board = nearBottomBoard.filter((row) => nickname
          ? row.rank > boundary || (row.rank === boundary && row.nickname > nickname)
          : row.rank >= boundary).slice(0, limit);
      }
    } else {
      board = before ? [] : ordinary;
    }
    let headers;
    if (paginationRace && !before) {
      ladderPageCalls++;
      if (ladderPageCalls === 1) {
        /* A FULL page ON A BOARD THAT CONTINUES, because run A must have
           somewhere left to go. Two things say "there is more" and both have to
           agree with the standing stub's 199, or the client stops at this page
           and the race never starts:
             · the page fills its ask — the opening asks for the RPC's own
               ceiling of 100 (ladder-screen's OPEN_PAGE), and a page shorter
               than its ask is how the end of a board announces itself;
             · every row carries the real `population`, which the client reads
               to size the scrollbar for a signed-out reader.
           `ordinary` describes a two-player season, so its 2 must not ride along
           on a hundred-row page: the rows are restamped below rather than left
           to contradict the board they are part of. */
        board = [...ordinary, ...Array.from({ length: 98 }, (_, index) => ({
          nickname: `RunA${String(index + 3).padStart(2, '0')}`,
          points: 460 - index,
          wins: 1,
          losses: 1,
          games: 2,
          rank: index + 3,
          apex: false,
          avatar: null,
          peak: 460 - index,
        }))].map((row, index) => ({ ...row, pos: index + 1, population: RUN_A_POPULATION }));
      } else if (ladderPageCalls === 2) {
        markPaginationStarted();
        await paginationRelease;
        board = [{
          nickname: 'StaleRunA', points: 100, wins: 1, losses: 2, games: 3,
          rank: 51, apex: false, avatar: null, peak: 100,
        }];
        headers = { 'x-kb-fixture': 'stale-run-a' };
      }
    }
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      ...(headers ? { headers } : {}),
      body: JSON.stringify(board),
    });
  });
  await page.route('**/rest/v1/rpc/player_card*', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{
      streak: 4,
      since: '2026-06-01T00:00:00Z',
      points: 1072,
      wins: 7,
      losses: 2,
      games: 9,
      rank: 1,
      apex: false,
      peak: 1100,
    }]) }));
  return { paginationStarted, releasePagination: () => releasePagination() };
}
