/* SETTLEMENT THAT HAPPENS OUTSIDE A TURN, ALWAYS LOCKED TO THE REPLAYED LOG.
 *
 * Two entry points reach settle_match_checked with nobody taking a turn, and
 * both must pin the version they replayed — move count, turn, last_move_at —
 * or a settlement silently overwrites a move that arrived meanwhile:
 *
 *   pvp-claim  an opponent has gone quiet past the shared STALL_MS threshold,
 *              or the player resigns (which skips the stall proof but not the
 *              version lock). With the refusals that must precede any replay
 *              read, the lost race, and the failed seed/profile reads.
 *   pvp-join   coming back to an active match, a bot match still younger than
 *              STALL_MS that is waited on rather than forfeited, and an
 *              abandoned one settled lazily before matchmaking continues.
 */
import { rebuild, matchTotal } from '../../src/core/match.ts';
import { STALL_MS } from '../../supabase/functions/_shared/match-timing.ts';
import type { MatchRow } from '../../supabase/functions/_shared/types.ts';
import {
  EDGE_MODE, EDGE_SEED as SEED, EdgeOperationsService, afterThreshold, beforeThreshold,
  claimTables, edgeContext, jsonBody, seasonRoute, standardJoinInput, standardMatch,
  type EdgeOperations,
} from './edge-operations.ts';

type Check = (ok: boolean, message: string, detail?: unknown) => void;

/** Drives the caller's already-materialized operations; see the note on
    runTurnCommandTests for why this module does not materialize its own. */
export async function runCheckedSettlementTests(
  check: Check, operations: EdgeOperations,
): Promise<void> {
  /* ---------------- claimMatch ---------------- */
  const claimMoves = [{ idx: 0, who: 1, col: 0 }];
  const claimState = rebuild(SEED, claimMoves, EDGE_MODE)!;
  const claimRow = (overrides: Partial<MatchRow> = {}) => standardMatch({
    turn: claimState.turn, next_die: claimState.nextDie,
    last_move_at: afterThreshold(STALL_MS), ...overrides,
  });

  // Own turn, bot opponent, and a stall younger than the shared STALL_MS
  // threshold all refuse before a single replay read.
  for (const [row, isBot, status, error] of [
    [claimRow({ turn: 1 }), false, 409, 'your-own-turn'],
    [claimRow(), true, 409, 'opponent-is-a-bot'],
    [claimRow({ last_move_at: beforeThreshold(STALL_MS) }), false, 425, 'not-stalled-yet'],
  ] as const) {
    const refusing = new EdgeOperationsService(claimTables(row, claimMoves, isBot));
    const refusal = await operations.claimMatch(edgeContext('player-1', refusing), {
      matchId: 'match-1', resign: false,
    });
    check(refusal.status === status && (await jsonBody(refusal)).error === error
      && refusing.tableReads('match_seeds').length === 0,
    `the ${error} claim refusal did not land before replay work`, { status: refusal.status });
  }

  const claimable = claimRow();
  const claimService = new EdgeOperationsService(claimTables(claimable, claimMoves), {
    settle_match_checked: () => ({
      data: { applied: true, match: { ...claimable, status: 'forfeit', winner: 'player-1' } },
    }),
  });
  const claimed = await operations.claimMatch(edgeContext('player-1', claimService), {
    matchId: 'match-1', resign: false,
  });
  const claimSettle = claimService.rpcCalls.find((call) => call.name === 'settle_match_checked')?.input;
  check(claimed.status === 200
    && ((await jsonBody(claimed)).match as MatchRow).status === 'forfeit'
    && claimSettle?.p_status === 'forfeit' && claimSettle?.p_winner === 'player-1'
    && claimSettle?.p_expected_move_count === claimMoves.length
    && claimSettle?.p_expected_turn === claimable.turn
    && claimSettle?.p_expected_last_move_at === claimable.last_move_at
    && claimSettle?.p_p1_score === matchTotal(claimState, 1, EDGE_MODE),
  'the stalled claim did not settle against the exact replayed log version',
  { status: claimed.status, claimSettle });

  const claimRaced = new EdgeOperationsService(claimTables(claimable, claimMoves), {
    settle_match_checked: () => ({ data: { applied: false, match: { ...claimable } } }),
  });
  const claimLost = await operations.claimMatch(edgeContext('player-1', claimRaced), {
    matchId: 'match-1', resign: false,
  });
  check(claimLost.status === 409 && (await jsonBody(claimLost)).error === 'race-lost',
    'a checked settlement that lost its race was not surfaced as race-lost');

  // Resignation skips stall proof but still locks the same log version.
  const resignable = claimRow({ last_move_at: new Date().toISOString() });
  const resignService = new EdgeOperationsService(claimTables(resignable, claimMoves), {
    settle_match_checked: () => ({
      data: { applied: true, match: { ...resignable, status: 'forfeit', winner: 'player-2' } },
    }),
  });
  const resigned = await operations.claimMatch(edgeContext('player-1', resignService), {
    matchId: 'match-1', resign: true,
  });
  const resignSettle = resignService.rpcCalls.find((call) => call.name === 'settle_match_checked')?.input;
  check(resigned.status === 200 && resignSettle?.p_winner === 'player-2'
    && resignSettle?.p_expected_move_count === claimMoves.length
    && resignSettle?.p_expected_last_move_at === resignable.last_move_at,
  'resignation did not lock its score snapshot to the replayed log version',
  { status: resigned.status, resignSettle });

  for (const [table, mapped] of [
    ['match_seeds', 'match-read-failed'], ['profiles', 'profile-read-failed'],
  ] as const) {
    const broken = new EdgeOperationsService({
      ...claimTables(claimable, claimMoves),
      [table]: () => ({ error: { message: `${table} unavailable` } }),
    });
    const failed = await operations.claimMatch(edgeContext('player-1', broken), {
      matchId: 'match-1', resign: false,
    });
    check(failed.status === 500 && (await jsonBody(failed)).error === mapped,
      `a failed claim ${table} read did not map to ${mapped}`);
  }

  /* ---------------- joinMatch ---------------- */
  // Rejoin returns the trusted names payload and an honest rejoined flag.
  const activeRow = standardMatch({ turn: 0 });
  const rejoinService = new EdgeOperationsService({
    matches: () => ({ data: activeRow }),
    match_moves: (read) => (read.head ? { count: 2 } : { data: [] }),
    profiles: () => ({
      data: [
        { id: 'player-1', nickname: 'One', rating: 91, avatar: null },
        { id: 'player-2', nickname: 'Two', rating: 87, avatar: null },
      ],
    }),
  });
  const rejoined = await operations.joinMatch(edgeContext('player-1', rejoinService), standardJoinInput);
  const rejoinBody = await jsonBody(rejoined);
  const names = rejoinBody.names as { p1: string; p2: string; ratings: { p1: number } };
  check(rejoined.status === 200 && rejoinBody.status === 'matched'
    && rejoinBody.rejoined === true && rejoinBody.you === 1
    && names.p1 === 'One' && names.p2 === 'Two' && names.ratings.p1 === 91,
  'active-match rejoin lost the honest rejoin flag or the trusted names payload', rejoinBody);

  // A stalled bot match younger than STALL_MS is rejoined, not forfeited.
  const freshBot = standardMatch({ turn: 1, last_move_at: beforeThreshold(STALL_MS) });
  const freshBotService = new EdgeOperationsService({
    matches: () => ({ data: freshBot }),
    match_moves: (read) => (read.head ? { count: 0 } : { data: [] }),
    profiles: (read) => (read.filters.some(([f, v]) => f === 'select' && v === 'is_bot')
      ? { data: { is_bot: true } }
      : { data: [] }),
  });
  const keptWaiting = await operations.joinMatch(edgeContext('player-1', freshBotService), standardJoinInput);
  check(keptWaiting.status === 200 && (await jsonBody(keptWaiting)).status === 'matched'
    && !freshBotService.rpcCalls.some((call) => call.name === 'settle_match_checked'),
  'a bot match younger than the shared stall threshold was forfeited early',
  { status: keptWaiting.status, rpcCalls: freshBotService.rpcCalls });

  // Past STALL_MS the abandoned bot match settles lazily — atomically,
  // against the replayed log version — before matchmaking continues.
  const abandoned = standardMatch({
    turn: 1, next_die: rebuild(SEED, [], EDGE_MODE)!.nextDie, last_move_at: afterThreshold(STALL_MS),
  });
  const lazyForfeit = new EdgeOperationsService({
    matches: () => ({ data: abandoned }),
    match_moves: () => ({ data: [] }),
    match_actions: () => ({ data: [] }),
    match_seeds: () => ({ data: { seed: SEED } }),
    season_ratings: seasonRoute,
    matchmaking_queue: (read) => (read.kind === 'delete' ? {} : { data: [] }),
    profiles: (read) => (read.filters.some(([f, v]) => f === 'select' && v === 'is_bot')
      ? { data: { is_bot: true } }
      : { data: { rating: 500, ranked_pool_tier: 'stone' } }),
  }, {
    settle_match_checked: () => ({
      data: { applied: true, match: { ...abandoned, status: 'forfeit', winner: 'player-2' } },
    }),
    current_season: () => ({ data: 1 }),
    players_near: () => ({ data: 4 }),
    enqueue_ranked_player_v3: () => ({ data: { status: 'queued' } }),
  });
  const requeued = await operations.joinMatch(edgeContext('player-1', lazyForfeit), standardJoinInput);
  const forfeitSettle = lazyForfeit.rpcCalls.find((call) => call.name === 'settle_match_checked')?.input;
  check(requeued.status === 200 && (await jsonBody(requeued)).status === 'queued'
    && forfeitSettle?.p_status === 'forfeit' && forfeitSettle?.p_winner === 'player-2'
    && forfeitSettle?.p_expected_move_count === 0
    && forfeitSettle?.p_expected_last_move_at === abandoned.last_move_at,
  'the abandoned bot match was not lazily settled before matchmaking continued',
  { status: requeued.status, forfeitSettle });
}
