// Direct behavioral tests for the four big pvp Edge operations (move/action/
// join/claim), imported from their materialized deploy closures and driven
// against the recording service double in tests/support/edge-operations.ts.
// They pin what used to be regex assertions over source text: shared stall
// thresholds gate every recovery, every write goes through the atomic
// command/settlement RPCs with the observed last_move_at and log version, a
// bot's reply joins the same command, and each failure maps to its exact
// HTTP contract.
import { rebuild, matchTotal } from '../src/core/match.ts';
import { rebuildRankedActions } from '../src/core/ranked-actions.ts';
import { rankedOutcomeByMatch } from '../src/core/ranked-outcomes.ts';
import { AUTO_MS, STALL_MS } from '../supabase/functions/_shared/match-timing.ts';
import type { MatchRow } from '../supabase/functions/_shared/types.ts';
import {
  EDGE_SEED as SEED, EdgeOperationsService, actionEcho, actionTables, afterThreshold,
  beforeThreshold, buildTerminalLog, claimTables, commitEcho, edgeContext,
  materializeEdgeOperations, moveTables, seasonRoute, standardMatch, trialMatch,
  type RpcRoute,
} from './support/edge-operations.ts';

const problems: string[] = [];
const errs: string[] = [];
const check = (ok: boolean, message: string, detail?: unknown): void => {
  if (!ok) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};
const body = async (response: Response) => await response.json() as Record<string, unknown>;

const mode = rankedOutcomeByMatch('standard', 'classic').mode;
const joinInput = { allowBot: false, protocolVersion: 1 as const, capabilities: [] };

const operations = await materializeEdgeOperations();
try {
  // A failed match read is an infrastructure error, never a game answer.
  for (const [label, run] of [
    ['moveMatch', (s: EdgeOperationsService) => operations.moveMatch(edgeContext('player-1', s),
      { matchId: 'match-1', col: 0, auto: false, commandId: 'cmd-1', expectedMoveCount: null })],
    ['claimMatch', (s: EdgeOperationsService) => operations.claimMatch(edgeContext('player-1', s),
      { matchId: 'match-1', resign: false })],
    ['joinMatch', (s: EdgeOperationsService) => operations.joinMatch(edgeContext('player-1', s), joinInput)],
  ] as const) {
    const unreadable = new EdgeOperationsService({ matches: () => ({ error: { message: 'db down' } }) });
    const unread = await run(unreadable);
    check(unread.status === 500 && (await body(unread)).error === 'match-read-failed',
      `${label} did not map a failed match read to match-read-failed`);
  }

  /* ---------------- moveMatch ---------------- */
  const open = rebuild(SEED, [], mode)!;

  // An already-committed command id replays its stored response, no re-reads.
  const prior = new EdgeOperationsService({}, {
    match_command_result: () => ({ data: { match: standardMatch(), your_die: 4 } }),
  });
  const replayed = await operations.moveMatch(edgeContext('player-1', prior), {
    matchId: 'match-1', col: 0, auto: false, commandId: 'cmd-1', expectedMoveCount: 0,
  });
  check(replayed.status === 200 && (await body(replayed)).your_die === 4
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
  check(conflict.status === 409 && (await body(conflict)).error === 'command-conflict',
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
    check(refusal.status === status && (await body(refusal)).error === error
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
  check(autoMoved.status === 200 && (await body(autoMoved)).auto === true
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
  const botReply = (await body(withBot)).bot_move as { col: number; die: number };
  check(withBot.status === 200 && botMoves?.length === 2
    && botMoves[0].who === 1 && botMoves[0].col === 1
    && botMoves[1].who === 0 && botMoves[1].idx === 1
    && botReply?.col === botMoves[1].col && botReply?.die === botMoves[1].die,
  'the bot reply was not appended inside the same atomic move command',
  { status: withBot.status, botMoves, botReply });

  // A board-filling move carries its settlement snapshot in the same command.
  const { rows, finalCol, finalWho } = buildTerminalLog(SEED, mode);
  const finalState = rebuild(SEED, [...rows, { idx: rows.length, who: finalWho, col: finalCol }], mode)!;
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
  const p1Score = matchTotal(finalState, 1, mode);
  const p2Score = matchTotal(finalState, 0, mode);
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
    check(refused.status === status && (await body(refused)).error === error,
      `the database ${error} conflict did not map to ${status}`, { message });
  }

  /* ---------------- actionMatch ---------------- */
  const dealt = ['nudge', 'ward'] as const;
  const trialOpen = rebuildRankedActions(SEED, [], mode, dealt)!;
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
    check(refusal.status === status && (await body(refusal)).error === error
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
  check(autoAction.status === 200 && (await body(autoAction)).auto === true
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
    && Array.isArray((await body(humanPlace)).bot_actions),
  'the bot Trial turn was not appended inside the same atomic action command',
  { status: humanPlace.status, botActionRows });

  const staleVersion = new EdgeOperationsService(actionTables(trialRow()), {
    match_action_result: actionLookup,
  });
  const raced = await operations.actionMatch(edgeContext('player-1', staleVersion), {
    matchId: 'match-1', commandId: 'cmd-1', expectedActionVersion: 1, auto: false,
    action: { kind: 'place', placed_col: 0 },
  });
  check(raced.status === 409 && (await body(raced)).error === 'race-lost',
    'a stale expected action version was not refused as race-lost');

  /* ---------------- claimMatch ---------------- */
  const claimMoves = [{ idx: 0, who: 1, col: 0 }];
  const claimState = rebuild(SEED, claimMoves, mode)!;
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
    check(refusal.status === status && (await body(refusal)).error === error
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
    && ((await body(claimed)).match as MatchRow).status === 'forfeit'
    && claimSettle?.p_status === 'forfeit' && claimSettle?.p_winner === 'player-1'
    && claimSettle?.p_expected_move_count === claimMoves.length
    && claimSettle?.p_expected_turn === claimable.turn
    && claimSettle?.p_expected_last_move_at === claimable.last_move_at
    && claimSettle?.p_p1_score === matchTotal(claimState, 1, mode),
  'the stalled claim did not settle against the exact replayed log version',
  { status: claimed.status, claimSettle });

  const claimRaced = new EdgeOperationsService(claimTables(claimable, claimMoves), {
    settle_match_checked: () => ({ data: { applied: false, match: { ...claimable } } }),
  });
  const claimLost = await operations.claimMatch(edgeContext('player-1', claimRaced), {
    matchId: 'match-1', resign: false,
  });
  check(claimLost.status === 409 && (await body(claimLost)).error === 'race-lost',
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
    check(failed.status === 500 && (await body(failed)).error === mapped,
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
  const rejoined = await operations.joinMatch(edgeContext('player-1', rejoinService), joinInput);
  const rejoinBody = await body(rejoined);
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
  const keptWaiting = await operations.joinMatch(edgeContext('player-1', freshBotService), joinInput);
  check(keptWaiting.status === 200 && (await body(keptWaiting)).status === 'matched'
    && freshBotService.rpcCalls.length === 0,
  'a bot match younger than the shared stall threshold was forfeited early',
  { status: keptWaiting.status, rpcCalls: freshBotService.rpcCalls });

  // Past STALL_MS the abandoned bot match settles lazily — atomically,
  // against the replayed log version — before matchmaking continues.
  const abandoned = standardMatch({
    turn: 1, next_die: rebuild(SEED, [], mode)!.nextDie, last_move_at: afterThreshold(STALL_MS),
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
    enqueue_ranked_player_v2: () => ({ data: { status: 'queued' } }),
  });
  const requeued = await operations.joinMatch(edgeContext('player-1', lazyForfeit), joinInput);
  const forfeitSettle = lazyForfeit.rpcCalls.find((call) => call.name === 'settle_match_checked')?.input;
  check(requeued.status === 200 && (await body(requeued)).status === 'queued'
    && forfeitSettle?.p_status === 'forfeit' && forfeitSettle?.p_winner === 'player-2'
    && forfeitSettle?.p_expected_move_count === 0
    && forfeitSettle?.p_expected_last_move_at === abandoned.last_move_at,
  'the abandoned bot match was not lazily settled before matchmaking continued',
  { status: requeued.status, forfeitSettle });
} catch (error) {
  errs.push(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  operations.dispose();
}

console.log(JSON.stringify({ problems, errs }, null, 2));
process.exit(problems.length || errs.length ? 1 : 0);
