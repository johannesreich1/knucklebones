// Auto play covers a short absence; it must never cover an indefinite one.
// These pin the two decisions _shared/auto-forfeit.ts makes for BOTH ranked
// protocols, driven against the same recording service double the other Edge
// operation tests use:
//
//   1. A self placement is not a recovery. When a player's own turn clock runs
//      out, no other player's die is being moved, so AUTO_MS must not apply and
//      the commit must carry no stall precondition — a 10s turn clock could
//      never satisfy a 12s gate, which is why the visible client used to have
//      to lie and report its timer as a finger.
//   2. Past the allowance the match ENDS. The AUTO_FORFEIT_STREAK-th
//      consecutive automatic placement settles a forfeit against the away seat
//      through the shared settlement contract instead of appending a move.
//
// The count is the rule rather than a wall clock because every automatic
// placement writes last_move_at, so any seconds-based threshold measured from
// it resets before it can be reached.
import { rebuild, matchTotal } from '../src/core/match.ts';
import { rebuildRankedActions } from '../src/core/ranked-actions.ts';
import { rankedOutcomeByMatch } from '../src/core/ranked-outcomes.ts';
import { AUTO_FORFEIT_STREAK, AUTO_MS } from '../supabase/functions/_shared/match-timing.ts';
import type { MatchRow } from '../supabase/functions/_shared/types.ts';
import {
  EDGE_SEED as SEED, EdgeOperationsService, actionEcho, actionTables, afterThreshold,
  beforeThreshold, commitEcho, edgeContext, materializeEdgeOperations, moveTables,
  standardMatch, trialMatch, type RpcRoute,
} from './support/edge-operations.ts';

const problems: string[] = [];
const errs: string[] = [];
const check = (ok: boolean, message: string, detail?: unknown): void => {
  if (!ok) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};
const body = async (response: Response) => await response.json() as Record<string, unknown>;

const mode = rankedOutcomeByMatch('standard', 'classic').mode;
const operations = await materializeEdgeOperations();
try {
  const open = rebuild(SEED, [], mode)!;

  /* ---------------- classic placements ---------------- */
  /* An own-turn self placement is not a recovery. The player's own clock ran
     out, no other player's die is being moved, so AUTO_MS never applies and
     the commit carries no stall precondition for the database to re-verify —
     otherwise a 10s turn clock could never reach a 12s gate. */
  const selfRow = standardMatch({ turn: 1, last_move_at: beforeThreshold(AUTO_MS) });
  const selfService = new EdgeOperationsService(
    moveTables(selfRow, [], { is_bot: false }),
    { commit_match_command: commitEcho(selfRow) },
  );
  const selfPlaced = await operations.moveMatch(edgeContext('player-1', selfService), {
    matchId: 'match-1', col: 0, auto: true, commandId: 'cmd-1', expectedMoveCount: null,
  });
  const selfCommit = selfService.rpcCalls.find((call) => call.name === 'commit_match_command')?.input;
  check(selfPlaced.status === 200 && selfCommit?.p_auto === true
    && selfCommit?.p_expected_last_move_at === null,
  'an own-turn auto placement was gated as if it were recovering another player',
  { status: selfPlaced.status, selfCommit });

  /* Auto play covers a short absence, never an indefinite one. The
     AUTO_FORFEIT_STREAK-th consecutive automatic placement settles a forfeit
     against the away seat instead of appending a third move. */
  const awayRow = standardMatch({
    turn: 1,
    p1_auto_streak: AUTO_FORFEIT_STREAK - 1,
    last_move_at: afterThreshold(AUTO_MS),
  });
  const awayService = new EdgeOperationsService(moveTables(awayRow, [], { is_bot: false }), {
    settle_match_checked: () => ({
      data: { applied: true, match: { ...awayRow, status: 'forfeit', winner: 'player-2' } },
    }),
  });
  const awayForfeit = await operations.moveMatch(edgeContext('player-2', awayService), {
    matchId: 'match-1', col: 0, auto: true, commandId: 'cmd-1', expectedMoveCount: null,
  });
  const awaySettle = awayService.rpcCalls.find((call) => call.name === 'settle_match_checked')?.input;
  check(awayForfeit.status === 200
    && ((await body(awayForfeit)).match as MatchRow).status === 'forfeit'
    && awaySettle?.p_status === 'forfeit' && awaySettle?.p_winner === 'player-2'
    && awaySettle?.p_expected_turn === awayRow.turn
    && awaySettle?.p_expected_last_move_at === awayRow.last_move_at
    && awaySettle?.p_expected_move_count === 0
    && awaySettle?.p_p1_score === matchTotal(open, 1, mode)
    && !awayService.rpcCalls.some((call) => call.name === 'commit_match_command'),
  'the third consecutive auto placement did not forfeit the away seat',
  { status: awayForfeit.status, awaySettle });

  // One placement short of the allowance still plays a real move.
  const coveredRow = standardMatch({
    turn: 1,
    p1_auto_streak: AUTO_FORFEIT_STREAK - 2,
    last_move_at: afterThreshold(AUTO_MS),
  });
  const coveredService = new EdgeOperationsService(
    moveTables(coveredRow, [], { is_bot: false }),
    { commit_match_command: commitEcho(coveredRow) },
  );
  const covered = await operations.moveMatch(edgeContext('player-2', coveredService), {
    matchId: 'match-1', col: 0, auto: true, commandId: 'cmd-1', expectedMoveCount: null,
  });
  check(covered.status === 200
    && coveredService.rpcCalls.some((call) => call.name === 'commit_match_command')
    && !coveredService.rpcCalls.some((call) => call.name === 'settle_match_checked'),
  'an absence still inside its auto-play allowance was forfeited early',
  { status: covered.status });


  /* ---------------- Rune Trial actions ---------------- */
  const dealt = ['nudge', 'ward'] as const;
  const trialOpen = rebuildRankedActions(SEED, [], mode, dealt)!;
  const trialRow = (overrides: Partial<MatchRow> = {}) => trialMatch({
    turn: trialOpen.turn, next_die: trialOpen.nextDie, action_version: 0, ...overrides,
  });
  const actionLookup: RpcRoute = () => ({ data: null });

  /* Both decisions come from the one shared module, so the Trial protocol
     takes them identically: no stall gate on a self placement, and a forfeit
     rather than a third automatic action. */
  const selfTrialRow = trialRow({ last_move_at: beforeThreshold(AUTO_MS) });
  const selfTrial = new EdgeOperationsService(actionTables(selfTrialRow), {
    match_action_result: actionLookup, commit_match_action: actionEcho(selfTrialRow),
  });
  const selfAction = await operations.actionMatch(edgeContext('player-1', selfTrial), {
    matchId: 'match-1', commandId: 'cmd-1', expectedActionVersion: 0, auto: true, action: null,
  });
  const selfActionCommit = selfTrial.rpcCalls
    .find((call) => call.name === 'commit_match_action')?.input;
  check(selfAction.status === 200 && selfActionCommit?.p_auto === true
    && selfActionCommit?.p_expected_last_move_at === null,
  'an own-turn auto Trial action was gated as if it were recovering another player',
  { status: selfAction.status, selfActionCommit });

  const awayTrialRow = trialRow({
    p1_auto_streak: AUTO_FORFEIT_STREAK - 1,
    last_move_at: afterThreshold(AUTO_MS),
  });
  const awayTrial = new EdgeOperationsService(actionTables(awayTrialRow), {
    match_action_result: actionLookup,
    settle_match_checked: () => ({
      data: { applied: true, match: { ...awayTrialRow, status: 'forfeit', winner: 'player-2' } },
    }),
  });
  const awayTrialForfeit = await operations.actionMatch(edgeContext('player-2', awayTrial), {
    matchId: 'match-1', commandId: 'cmd-1', expectedActionVersion: 0, auto: true, action: null,
  });
  const awayTrialSettle = awayTrial.rpcCalls
    .find((call) => call.name === 'settle_match_checked')?.input;
  check(awayTrialForfeit.status === 200
    && awayTrialSettle?.p_status === 'forfeit' && awayTrialSettle?.p_winner === 'player-2'
    && awayTrialSettle?.p_expected_turn === awayTrialRow.turn
    && awayTrialSettle?.p_expected_last_move_at === awayTrialRow.last_move_at
    && !awayTrial.rpcCalls.some((call) => call.name === 'commit_match_action'),
  'the third consecutive auto Trial action did not forfeit the away seat',
  { status: awayTrialForfeit.status, awayTrialSettle });

} catch (error) {
  errs.push(String(error));
}

console.log(JSON.stringify({ problems, errs }, null, 2));
if (problems.length || errs.length) process.exitCode = 1;
