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
import { searchRoot } from '../../src/core/ai.ts';
import { APEX, GROUPS } from '../../src/core/ladder.ts';
import { rebuild, matchTotal } from '../../src/core/match.ts';
import { appendRankedAction, rebuildRankedActions } from '../../src/core/ranked-actions.ts';
import { AUTO_MS } from '../../supabase/functions/_shared/match-timing.ts';
import type { MatchRow } from '../../supabase/functions/_shared/types.ts';
import {
  EDGE_MODE, EDGE_SEED as SEED, EdgeOperationsService, actionEcho, actionTables, afterThreshold,
  beforeThreshold, buildTerminalLog, commitEcho, edgeContext, jsonBody, moveTables, standardMatch,
  standingRoute, trialMatch, type EdgeOperations, type RpcRoute,
} from './edge-operations.ts';

/* NEON is a POSITION for bots too. A bot whose points outgrow OBSIDIAN keeps
   OBSIDIAN's shape until the board's rank says otherwise (boardGroup's rule,
   consumed by botShapeAt), so the same points must commit a DIFFERENT column
   depending on the standing the board reports. One draw between the two
   league slips decides it: OBSIDIAN slips on it (pick draw 0.5 of three
   columns is column 1), NEON searches on it. Live 2026-09-02: nine v1 bots at
   4,369–4,600 badged OBSIDIAN were playing NEON. */
const APEX_POINTS = APEX.floor + 10;
const APEX_HUMAN_COL = 0;
const APEX_POPULATION = 203;
const neonSearch = (st: Parameters<typeof searchRoot>[0], die: number) => searchRoot(
  st, 0, die, APEX.bot.depth,
  { mode: EDGE_MODE, random: () => 0.5, riskWeight: APEX.bot.risk, opponentWeight: APEX.bot.oppW },
).c;
async function withBetweenSlipsDraws<T>(run: () => Promise<T>): Promise<T> {
  const ambient = Math.random;
  const between = (GROUPS[5].bot.slip + GROUPS[6].bot.slip) / 2;
  let drawn = 0;
  Math.random = () => (drawn++ === 0 ? between : 0.5);
  try { return await run(); } finally { Math.random = ambient; }
}

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

  // The apex is a position: a bot above the NEON floor plays NEON only when
  // the board ranks it there, and the reply column proves which shape moved.
  check(GROUPS[5].bot.slip > GROUPS[6].bot.slip,
    'the apex cases need NEON to slip less often than OBSIDIAN');
  const afterApexHuman = rebuild(SEED, [{ idx: 0, who: 1, col: APEX_HUMAN_COL }], EDGE_MODE)!;
  const crownedMoveCol = neonSearch(afterApexHuman.st, afterApexHuman.nextDie);
  check(crownedMoveCol !== 1, 'apex move fixture: the NEON search coincides with the slip pick');
  const apexMoveReply = async (rank: number) => {
    const row = standardMatch({ curve_version: 2, scoring_version: 2 });
    const service = new EdgeOperationsService(
      moveTables(row, [], { is_bot: true, rating: APEX_POINTS }),
      {
        commit_match_command: commitEcho(row),
        player_standing: standingRoute(APEX_POINTS, rank, APEX_POPULATION),
      },
    );
    const response = await withBetweenSlipsDraws(() => operations.moveMatch(
      edgeContext('player-1', service),
      { matchId: 'match-1', col: APEX_HUMAN_COL, auto: false, commandId: 'cmd-1', expectedMoveCount: null },
    ));
    const commit = service.rpcCalls.find((call) => call.name === 'commit_match_command')?.input;
    const moves = commit?.p_moves as Array<Record<string, unknown>> | undefined;
    const standing = service.rpcCalls.find((call) => call.name === 'player_standing');
    return { status: response.status, col: moves?.[1]?.col, askedFor: standing?.input.p };
  };
  const demotedMove = await apexMoveReply(50);
  const crownedMove = await apexMoveReply(1);
  check(demotedMove.status === 200 && crownedMove.status === 200
    && demotedMove.col === 1 && crownedMove.col === crownedMoveCol
    && demotedMove.askedFor === 'player-2' && crownedMove.askedFor === 'player-2',
  'pvp-move let a bot above the apex floor play NEON without holding the apex position',
  { demotedMove, crownedMove, crownedMoveCol });

  // A standing the board cannot answer is a failed read, never a silent demotion.
  const unreadRow = standardMatch({ curve_version: 2, scoring_version: 2 });
  const unread = new EdgeOperationsService(
    moveTables(unreadRow, [], { is_bot: true, rating: APEX_POINTS }),
    {
      commit_match_command: commitEcho(unreadRow),
      player_standing: () => ({ error: { message: 'board unavailable' } }),
    },
  );
  const unreadReply = await operations.moveMatch(edgeContext('player-1', unread), {
    matchId: 'match-1', col: APEX_HUMAN_COL, auto: false, commandId: 'cmd-1', expectedMoveCount: null,
  });
  check(unreadReply.status === 500 && (await jsonBody(unreadReply)).error === 'ladder-read-failed'
    && !unread.rpcCalls.some((call) => call.name === 'commit_match_command'),
  'a failed bot standing read did not stop the move as ladder-read-failed',
  { status: unreadReply.status });

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

  // Once ordinary ranked negotiated equipped-rune actions, pvp-move must not
  // accept even a plain placement. A bare pair still belongs to pvp-action;
  // transport is fixed by the match protocol, not by whether somebody casts.
  const actionStandardForMove = standardMatch({
    protocol_version: 2,
    rune_rules_version: 1,
  });
  const wrongStandardTransport = new EdgeOperationsService(
    moveTables(actionStandardForMove, [], { is_bot: false }),
  );
  const bypass = await operations.moveMatch(edgeContext('player-1', wrongStandardTransport), {
    matchId: 'match-1', col: 0, auto: false, commandId: '', expectedMoveCount: null,
  });
  check(bypass.status === 409 && (await jsonBody(bypass)).error === 'wrong-protocol'
    && wrongStandardTransport.tableReads('match_moves').length === 0,
  'pvp-move accepted an action-protocol standard placement', { status: bypass.status });

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

  // Ordinary ranked shares the same action command even when one public rune
  // snapshot is null. The bare seat remains a valid participant; it just has
  // no cast to make.
  const equippedDeal = [null, 'ward'] as const;
  const equippedOpen = rebuildRankedActions(SEED, [], EDGE_MODE, equippedDeal)!;
  const equippedRow = standardMatch({
    protocol_version: 2,
    rune_rules_version: 1,
    p1_rune: 'ward',
    p2_rune: null,
    turn: equippedOpen.turn,
    next_die: equippedOpen.nextDie,
  });
  const equippedAction = new EdgeOperationsService(actionTables(equippedRow), {
    match_action_result: actionLookup,
    commit_match_action: actionEcho(equippedRow),
  });
  const equippedPlacement = await operations.actionMatch(edgeContext('player-1', equippedAction), {
    matchId: 'match-1', commandId: 'cmd-equipped', expectedActionVersion: 0,
    auto: false, action: { kind: 'place', placed_col: 0 },
  });
  const equippedCommit = equippedAction.rpcCalls
    .find((call) => call.name === 'commit_match_action')?.input;
  const equippedRows = equippedCommit?.p_actions as Array<Record<string, unknown>>;
  check(equippedPlacement.status === 200
    && equippedRows?.length === 1
    && equippedRows[0].kind === 'place'
    && equippedRows[0].who === 1,
  'ordinary ranked with one empty rune seat did not commit through pvp-action', {
    status: equippedPlacement.status,
    equippedRows,
  });

  // The same apex rule on the action protocol: a bare bot seat makes exactly
  // one placement, so the committed column again names the shape that moved.
  const apexPlaced = appendRankedAction(SEED, [], EDGE_MODE, equippedDeal, {
    kind: 'place', placed_col: APEX_HUMAN_COL,
  })!;
  const crownedActionCol = neonSearch(apexPlaced.state.st, apexPlaced.state.nextDie!);
  check(crownedActionCol !== 1, 'apex action fixture: the NEON search coincides with the slip pick');
  const apexActionReply = async (rank: number) => {
    const row = standardMatch({
      protocol_version: 2, rune_rules_version: 1, p1_rune: 'ward', p2_rune: null,
      turn: equippedOpen.turn, next_die: equippedOpen.nextDie,
      curve_version: 2, scoring_version: 2,
    });
    const service = new EdgeOperationsService(
      { ...actionTables(row), profiles: () => ({ data: { id: row.p2, is_bot: true, rating: APEX_POINTS } }) },
      {
        match_action_result: actionLookup,
        commit_match_action: actionEcho(row),
        player_standing: standingRoute(APEX_POINTS, rank, APEX_POPULATION),
      },
    );
    const response = await withBetweenSlipsDraws(() => operations.actionMatch(
      edgeContext('player-1', service),
      {
        matchId: 'match-1', commandId: 'cmd-apex', expectedActionVersion: 0,
        auto: false, action: { kind: 'place', placed_col: APEX_HUMAN_COL },
      },
    ));
    const commit = service.rpcCalls.find((call) => call.name === 'commit_match_action')?.input;
    const actions = commit?.p_actions as Array<Record<string, unknown>> | undefined;
    const standing = service.rpcCalls.find((call) => call.name === 'player_standing');
    return { status: response.status, col: actions?.[1]?.placed_col, askedFor: standing?.input.p };
  };
  const demotedAction = await apexActionReply(50);
  const crownedAction = await apexActionReply(1);
  check(demotedAction.status === 200 && crownedAction.status === 200
    && demotedAction.col === 1 && crownedAction.col === crownedActionCol
    && demotedAction.askedFor === 'player-2' && crownedAction.askedFor === 'player-2',
  'pvp-action let a bot above the apex floor play NEON without holding the apex position',
  { demotedAction, crownedAction, crownedActionCol });
}
