/* A RANKED TURN COMMITS AS ONE ATOMIC COMMAND — IN BOTH PROTOCOLS.
 *
 * pvp-move commits through commit_match_command and pvp-action through
 * commit_match_action, and the two live in ONE module on purpose: they are the
 * same responsibility wearing two protocols, and this repo has already been
 * bitten (2026-08-26) by behaviour added to one ranked client path and silently
 * missed by the other. Side by side, a new expectation is visibly needed twice.
 *
 * Pinned here: the refusals that must land before any replay read (a move out
 * of turn, an auto recovery younger than the shared AUTO_MS threshold), the
 * recovery commit carrying the exact last_move_at this Edge clock judged
 * stalled and the version it expected, a bot opponent's reply or cast appended
 * inside the SAME command, the terminal move's settlement snapshot riding along
 * with it, and the database re-check mapping its own conflicts back onto the
 * HTTP contract.
 */
import { rebuild, matchTotal } from '../../src/core/match.ts';
import { rebuildRankedActions } from '../../src/core/ranked-actions.ts';
import { AUTO_MS } from '../../supabase/functions/_shared/match-timing.ts';
import type { MatchRow } from '../../supabase/functions/_shared/types.ts';
import {
  EDGE_MODE, EDGE_SEED as SEED, EdgeOperationsService, actionEcho, actionTables, afterThreshold,
  beforeThreshold, buildTerminalLog, commitEcho, edgeContext, jsonBody, moveTables, standardMatch,
  trialMatch, type EdgeOperations, type RpcRoute,
} from './edge-operations.ts';

type Check = (ok: boolean, message: string, detail?: unknown) => void;

/** Drives the caller's already-materialized operations; materializing a second
    set here would import every deploy closure again into a temp root nobody
    disposes. */
export async function runTurnCommandTests(
  check: Check, operations: EdgeOperations,
): Promise<void> {
  /* ---------------- moveMatch ---------------- */
  const open = rebuild(SEED, [], EDGE_MODE)!;

  // An already-committed command id replays its stored response, no re-reads.
  const prior = new EdgeOperationsService({}, {
    match_command_result: () => ({ data: { match: standardMatch(), your_die: 4 } }),
  });
  const replayed = await operations.moveMatch(edgeContext('player-1', prior), {
    matchId: 'match-1', col: 0, auto: false, commandId: 'cmd-1', expectedMoveCount: 0,
  });
  check(replayed.status === 200 && (await jsonBody(replayed)).your_die === 4
    && prior.reads.length === 0,
  'a committed command id did not short-circuit to its stored response',
  { status: replayed.status, reads: prior.reads.length });

  // The same command id with different arguments is a conflict, not a replay.
  const conflicted = new EdgeOperationsService({}, {
    match_command_result: () => ({ error: { code: '22023', message: 'command arguments changed' } }),
  });
  const conflict = await operations.moveMatch(edgeContext('player-1', conflicted), {
    matchId: 'match-1', col: 0, auto: false, commandId: 'cmd-1', expectedMoveCount: 0,
  });
  check(conflict.status === 409 && (await jsonBody(conflict)).error === 'command-conflict',
    'a reused command id with new arguments was not rejected as command-conflict');

  // A manual move out of turn, and an auto recovery younger than the shared
  // AUTO_MS threshold, are both refused before any replay or commit work.
  for (const [row, auto, status, error] of [
    [standardMatch({ turn: 1 }), false, 409, 'not-your-turn'],
    [standardMatch({ last_move_at: beforeThreshold(AUTO_MS) }), true, 425, 'not-stalled-yet'],
  ] as const) {
    const refusing = new EdgeOperationsService(moveTables(row, [], { is_bot: false }));
    const refusal = await operations.moveMatch(edgeContext('player-2', refusing), {
      matchId: 'match-1', col: 0, auto, commandId: 'cmd-1', expectedMoveCount: null,
    });
    check(refusal.status === status && (await jsonBody(refusal)).error === error
      && refusing.rpcCalls.length === 0 && refusing.tableReads('match_moves').length === 0,
    `the ${error} move refusal did not land before replay work`, { status: refusal.status });
  }

  // Past AUTO_MS the auto move commits atomically, handing the database clock
  // the exact last_move_at this Edge clock judged stalled.
  const stalledRow = standardMatch({ last_move_at: afterThreshold(AUTO_MS) });
  const stalled = new EdgeOperationsService(
    moveTables(stalledRow, [], { is_bot: false }),
    { commit_match_command: commitEcho(stalledRow) },
  );
  const autoMoved = await operations.moveMatch(edgeContext('player-2', stalled), {
    matchId: 'match-1', col: 0, auto: true, commandId: 'cmd-1', expectedMoveCount: null,
  });
  const autoCommit = stalled.rpcCalls.find((call) => call.name === 'commit_match_command')?.input;
  const autoMoves = autoCommit?.p_moves as Array<Record<string, unknown>>;
  check(autoMoved.status === 200 && (await jsonBody(autoMoved)).auto === true
    && autoCommit?.p_auto === true
    && autoCommit?.p_expected_last_move_at === stalledRow.last_move_at
    && autoCommit?.p_expected_move_count === 0
    && autoMoves?.length === 1 && autoMoves[0].who === 1 && autoMoves[0].die === open.nextDie
    && autoCommit?.p_next_turn === 0 && autoCommit?.p_settlement === null,
  'the stalled auto move did not commit with the observed last_move_at snapshot',
  { status: autoMoved.status, autoCommit });

  // A bot opponent answers inside the same atomic command.
  const pairedRow = standardMatch();
  const paired = new EdgeOperationsService(
    moveTables(pairedRow, [], { is_bot: true, rating: 600 }),
    { commit_match_command: commitEcho(pairedRow) },
  );
  const withBot = await operations.moveMatch(edgeContext('player-1', paired), {
    matchId: 'match-1', col: 1, auto: false, commandId: 'cmd-1', expectedMoveCount: null,
  });
  const botCommit = paired.rpcCalls.find((call) => call.name === 'commit_match_command')?.input;
  const botMoves = botCommit?.p_moves as Array<Record<string, unknown>>;
  const botReply = (await jsonBody(withBot)).bot_move as { col: number; die: number };
  check(withBot.status === 200 && botMoves?.length === 2
    && botMoves[0].who === 1 && botMoves[0].col === 1
    && botMoves[1].who === 0 && botMoves[1].idx === 1
    && botReply?.col === botMoves[1].col && botReply?.die === botMoves[1].die,
  'the bot reply was not appended inside the same atomic move command',
  { status: withBot.status, botMoves, botReply });

  // A board-filling move carries its settlement snapshot in the same command.
  const { rows, finalCol, finalWho } = buildTerminalLog(SEED, EDGE_MODE);
  const finalState = rebuild(SEED, [...rows, { idx: rows.length, who: finalWho, col: finalCol }], EDGE_MODE)!;
  const terminalRow = standardMatch({ turn: finalWho });
  const terminalService = new EdgeOperationsService(
    moveTables(terminalRow, rows.map(({ idx, who, col }) => ({ idx, who, col })), { is_bot: false }),
    { match_command_result: () => ({ data: null }), commit_match_command: commitEcho(terminalRow) },
  );
  const finisher = finalWho === 1 ? 'player-1' : 'player-2';
  const finished = await operations.moveMatch(edgeContext(finisher, terminalService), {
    matchId: 'match-1', col: finalCol, auto: false, commandId: 'cmd-1', expectedMoveCount: rows.length,
  });
  const settlementCommit = terminalService.rpcCalls
    .find((call) => call.name === 'commit_match_command')?.input;
  const settlement = settlementCommit?.p_settlement as Record<string, unknown> | null;
  const p1Score = matchTotal(finalState, 1, EDGE_MODE);
  const p2Score = matchTotal(finalState, 0, EDGE_MODE);
  const winner = p1Score > p2Score ? 'player-1' : p1Score < p2Score ? 'player-2' : null;
  check(finished.status === 200 && settlement !== null
    && settlement?.status === 'done' && settlement?.winner === winner
    && settlement?.p1_score === p1Score && settlement?.p2_score === p2Score
    && (settlement?.expected_p1 as { points: number }).points === 80
    && (settlement?.next_p1 as { points: number } | undefined) !== undefined
    && settlementCommit?.p_next_turn === null && settlementCommit?.p_next_die === null
    && terminalService.tableReads('season_ratings').filter((read) => read.kind === 'upsert').length === 2,
  'the terminal move did not carry a complete atomic settlement snapshot',
  { status: finished.status, settlement });

  // The database re-check maps its conflicts back onto the HTTP contract.
  for (const [message, status, error] of [
    ['match is not stalled yet', 425, 'not-stalled-yet'],
    ['move count changed', 409, 'race-lost'],
  ] as const) {
    const gated = new EdgeOperationsService(
      moveTables(standardMatch({ last_move_at: afterThreshold(AUTO_MS) }), [], { is_bot: false }),
      { commit_match_command: () => ({ error: { code: 'P0001', message } }) },
    );
    const refused = await operations.moveMatch(edgeContext('player-2', gated), {
      matchId: 'match-1', col: 0, auto: true, commandId: 'cmd-1', expectedMoveCount: null,
    });
    check(refused.status === status && (await jsonBody(refused)).error === error,
      `the database ${error} conflict did not map to ${status}`, { message });
  }

  /* ---------------- actionMatch ---------------- */
  const dealt = ['nudge', 'ward'] as const;
  const trialOpen = rebuildRankedActions(SEED, [], EDGE_MODE, dealt)!;
  const trialRow = (overrides: Partial<MatchRow> = {}) => trialMatch({
    turn: trialOpen.turn, next_die: trialOpen.nextDie, action_version: 0, ...overrides,
  });
  const actionLookup: RpcRoute = () => ({ data: null });

  // Same two refusals on the Trial protocol, again before replay reads.
  for (const [row, auto, status, error] of [
    [trialRow(), false, 409, 'not-your-turn'],
    [trialRow({ last_move_at: beforeThreshold(AUTO_MS) }), true, 425, 'not-stalled-yet'],
  ] as const) {
    const refusing = new EdgeOperationsService(actionTables(row), { match_action_result: actionLookup });
    const refusal = await operations.actionMatch(edgeContext('player-2', refusing), {
      matchId: 'match-1', commandId: 'cmd-1', expectedActionVersion: 0, auto,
      action: auto ? null : { kind: 'place', placed_col: 0 },
    });
    check(refusal.status === status && (await jsonBody(refusal)).error === error
      && refusing.tableReads('match_actions').length === 0,
    `the ${error} Trial refusal did not land before replay work`, { status: refusal.status });
  }

  const stalledTrialRow = trialRow({ last_move_at: afterThreshold(AUTO_MS) });
  const stalledAction = new EdgeOperationsService(actionTables(stalledTrialRow), {
    match_action_result: actionLookup, commit_match_action: actionEcho(stalledTrialRow),
  });
  const autoAction = await operations.actionMatch(edgeContext('player-2', stalledAction), {
    matchId: 'match-1', commandId: 'cmd-1', expectedActionVersion: 0, auto: true, action: null,
  });
  const actionCommit = stalledAction.rpcCalls.find((call) => call.name === 'commit_match_action')?.input;
  const committedActions = actionCommit?.p_actions as Array<Record<string, unknown>>;
  check(autoAction.status === 200 && (await jsonBody(autoAction)).auto === true
    && actionCommit?.p_auto === true
    && actionCommit?.p_expected_last_move_at === stalledTrialRow.last_move_at
    && actionCommit?.p_expected_action_version === 0
    && committedActions?.length === 1 && committedActions[0].kind === 'place'
    && committedActions[0].who === trialOpen.turn && actionCommit?.p_next_turn === 0,
  'the stalled auto Trial action did not commit with the observed last_move_at snapshot',
  { status: autoAction.status, actionCommit });

  // A bot opponent's optional cast and placement join the same action command.
  const botTrialRow = trialRow();
  const botAction = new EdgeOperationsService(actionTables(botTrialRow, true), {
    match_action_result: actionLookup, commit_match_action: actionEcho(botTrialRow),
  });
  const humanPlace = await operations.actionMatch(edgeContext('player-1', botAction), {
    matchId: 'match-1', commandId: 'cmd-1', expectedActionVersion: 0, auto: false,
    action: { kind: 'place', placed_col: 0 },
  });
  const botActionCommit = botAction.rpcCalls.find((call) => call.name === 'commit_match_action')?.input;
  const botActionRows = botActionCommit?.p_actions as Array<Record<string, unknown>>;
  const botTail = botActionRows?.slice(1) ?? [];
  check(humanPlace.status === 200 && botActionRows?.length >= 2
    && botActionRows[0].kind === 'place' && botActionRows[0].who === 1
    && botTail.length > 0 && botTail.every((row) => row.who === 0)
    && Array.isArray((await jsonBody(humanPlace)).bot_actions),
  'the bot Trial turn was not appended inside the same atomic action command',
  { status: humanPlace.status, botActionRows });

  const staleVersion = new EdgeOperationsService(actionTables(trialRow()), {
    match_action_result: actionLookup,
  });
  const raced = await operations.actionMatch(edgeContext('player-1', staleVersion), {
    matchId: 'match-1', commandId: 'cmd-1', expectedActionVersion: 1, auto: false,
    action: { kind: 'place', placed_col: 0 },
  });
  check(raced.status === 409 && (await jsonBody(raced)).error === 'race-lost',
    'a stale expected action version was not refused as race-lost');
}
