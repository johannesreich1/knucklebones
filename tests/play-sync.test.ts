// Owner test for the ranked in-match synchronizer (src/online/play/play-sync.ts).
// The module is driven purely through its OnlineSyncPorts plus a stubbed
// global fetch that serves PostgREST-shaped snapshots — no network, no live
// backend, no browser. Animations are never entered (every sync here is a
// full redraw), so the assertions are about authoritative projection: which
// snapshots install, which are refused, and when the drained match row may
// reopen input.
import { CLASSIC, emptyBoard, freshCharm } from '../src/core/rules.ts';
import type { MatchRow } from '../src/online/api/match-api.ts';
import { requireProjectionRecovery } from '../src/online/play/play-recovery.ts';
import {
  PLAY_SYNC_LEGACY_MATCH_COLUMNS,
  PLAY_SYNC_MATCH_COLUMNS,
  PLAY_SYNC_V2_MATCH_COLUMNS,
  createOnlineSynchronizer,
} from '../src/online/play/play-sync.ts';
import type { OnlineState } from '../src/online/play/play-types.ts';
import { S } from '../src/state.ts';
import { installFakeDom } from './support/fake-dom.ts';
import { emitReport } from './support/emit-report.mjs';

installFakeDom();

type RestReply = { body: unknown; status?: number };
let routes: Record<string, (url: URL) => RestReply> = {};
const restReads: Record<string, number> = {};
const matchSelects: string[] = [];
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const table = url.pathname.split('/').pop() ?? '';
  restReads[table] = (restReads[table] ?? 0) + 1;
  if (table === 'matches') matchSelects.push(url.searchParams.get('select') ?? '');
  const route = routes[table];
  // Fail closed: an unrouted request must never fall through to the network.
  const reply = route ? route(url) : { body: { message: `unrouted table ${table}` }, status: 500 };
  return new Response(JSON.stringify(reply.body), {
    status: reply.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

const problems: string[] = [];
const check = (condition: boolean, message: string, detail?: unknown): void => {
  if (!condition) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};

const onlineState = (overrides: Partial<OnlineState>): OnlineState => ({
  matchId: 'match-1', you: 1,
  names: { p1: 'A', p2: 'B', ratings: { p1: null, p2: null }, avatars: { p1: null, p2: null } },
  namesAreFallback: false, restoreMode: 'cpu', pendingDie: null,
  applied: 0, actionApplied: 0, actionVersion: 0,
  actionProtocol: false, rankedRunes: null, trial: false,
  gen: 90_001, channel: null, tick: null,
  lastMoveAt: 0, busySync: false, animating: false,
  recoverySync: false, recoveryActionVersion: null,
  pendingRow: null, finalizing: false, done: false, limited: false,
  ...overrides,
} as OnlineState);

const matchRow = (overrides: Partial<MatchRow> = {}): MatchRow => ({
  id: 'match-1', p1: 'p1-id', p2: 'p2-id', status: 'active', turn: 1,
  winner: null, p1_score: null, p2_score: null, next_die: 2,
  last_move_at: '2026-08-26T12:00:00.000Z', modifier: 'classic',
  ...overrides,
});
const trialRow = (overrides: Partial<MatchRow> = {}): MatchRow => matchRow({
  format: 'rune_trial', protocol_version: 2, rune_rules_version: 1,
  phase: 'playing', p1_rune: 'ward', p2_rune: 'ward', pending_aim: null,
  ...overrides,
});

let online = onlineState({});
const appliedRows: MatchRow[] = [];
let poolRenders = 0;
let opponentBeats = 0;
const sync = createOnlineSynchronizer({
  current: () => online,
  isCurrent: (candidate) => candidate === online,
  applyMatchRow: (row) => { appliedRows.push(row); },
  renderPool: () => { poolRenders++; },
  // Every sync below is a full redraw, so no replay — and therefore no beat.
  // The counter proves that rather than assuming it.
  openOpponentBeat: async () => { opponentBeats++; return true; },
});

const savedGlobals = { turn: S.turn, die: S.die, scoring: S.scoring };
S.scoring = CLASSIC;
S.boards = [emptyBoard(), emptyBoard()];
S.charm = freshCharm();
S.spellCharges = [{}, {}];

/* Board mutation and network reads are mutually exclusive: an animating match
   must not issue a single REST request. */
online.animating = true;
check(!(await sync(true)) && Object.keys(restReads).length === 0,
  'an animating match performed sync reads', restReads);
online.animating = false;

/* A coherent standard snapshot replays the full authoritative move log and
   only then releases the newer match projection to the input layer. */
routes = {
  match_moves: () => ({ body: [
    { idx: 0, who: 1, col: 0, die: 5 },
    { idx: 1, who: 0, col: 2, die: 3 },
  ] }),
  matches: () => ({ body: matchRow() }),
};
check(await sync(true), 'a coherent standard snapshot did not sync');
check(matchSelects.at(-1) === PLAY_SYNC_MATCH_COLUMNS
  && PLAY_SYNC_V2_MATCH_COLUMNS.every((column) => matchSelects.at(-1)?.includes(column)),
  'standard fallback sync did not select the complete v2 terminal contract once',
  matchSelects.at(-1));
check(JSON.stringify(S.boards[1][0]) === '[5]' && JSON.stringify(S.boards[0][2]) === '[3]'
  && online.applied === 2 && poolRenders === 1
  && appliedRows.length === 1 && appliedRows[0].id === 'match-1' && online.pendingRow === null,
  'the standard replay did not install the authoritative board and drain the projection',
  { boards: S.boards, applied: online.applied, poolRenders, appliedRows });

/* A failed move-log read is not a snapshot. Nothing may change and nothing
   may reach applyMatchRow — a partial read must never reopen input. */
routes = { match_moves: () => ({ body: { message: 'boom' }, status: 500 }) };
check(!(await sync(true)) && appliedRows.length === 1 && online.applied === 2,
  'a failed standard read still advanced state or reopened input',
  { appliedRows: appliedRows.length, applied: online.applied });

/* The Trial's two-read snapshot (action log + match row) is only authoritative
   when the log length equals the row's action version. A transaction landing
   between the two reads must be retried and, if it never converges, refused:
   the board from the wrong read pair must not install and input must not
   reopen on it. */
online = onlineState({ actionProtocol: true, trial: true, rankedRunes: ['ward', 'ward'] });
S.boards = [emptyBoard(), emptyBoard()];
const castRow = {
  idx: 0, move_idx: null, who: 1, kind: 'cast', rune_id: 'ward',
  target_col: 0, placed_col: null, die_before: 4, die_after: 4, created_at: 't0',
};
const placeRow = {
  idx: 1, move_idx: 0, who: 1, kind: 'place', rune_id: null,
  target_col: null, placed_col: 0, die_before: 4, die_after: 3, created_at: 't1',
};
restReads.match_actions = 0;
routes = {
  match_actions: () => ({ body: [castRow] }),
  matches: () => ({ body: trialRow({ turn: 0, next_die: 3, action_version: 2 }) }),
};
check(!(await sync(true))
  && restReads.match_actions === 4
  && S.boards[1][0].length === 0 && online.actionApplied === 0
  && appliedRows.length === 1 && online.pendingRow === null,
  'an incoherent two-read Trial snapshot installed a board or reopened input',
  { reads: restReads.match_actions, board: S.boards[1][0], appliedRows: appliedRows.length });

/* A coherent Trial snapshot projects the action log in idx order regardless
   of arrival order: the WARD cast precedes the placement it protects, so the
   charge, the ward mark, the placed die, and the handed-over turn all land. */
S.spellCharges = [{ ward: 1 }, { ward: 1 }];
routes = {
  match_actions: () => ({ body: [placeRow, castRow] }),
  matches: () => ({ body: trialRow({ turn: 0, next_die: 3, action_version: 2 }) }),
};
check(await sync(true), 'a coherent Trial snapshot did not sync');
check(matchSelects.at(-1) === PLAY_SYNC_MATCH_COLUMNS,
  'action fallback sync drifted from the shared terminal match projection', matchSelects.at(-1));
check(JSON.stringify(S.boards[1][0]) === '[4]' && S.charm.wards[1][0] === 1
  && S.spellCharges[1].ward === 0 && S.spellCharges[0].ward === 1
  && S.turn === 0 && S.die === 3 && S.spellCastThisTurn === null
  && online.actionApplied === 2 && online.applied === 1
  && appliedRows.length === 2 && appliedRows[1].action_version === 2,
  'the Trial projection lost the cast/place ordering or its counters',
  { board: S.boards[1][0], wards: S.charm.wards[1], charges: S.spellCharges,
    turn: S.turn, die: S.die, actionApplied: online.actionApplied, applied: online.applied });

/* A committed command response can name an action version the log reads have
   not reached yet. A coherent but version-behind snapshot may install, but it
   must not release the projection that reopens input; the confirmed version
   does. */
online = onlineState({ actionProtocol: true, trial: true, rankedRunes: ['ward', 'ward'] });
S.boards = [emptyBoard(), emptyBoard()];
S.spellCharges = [{ ward: 1 }, { ward: 1 }];
requireProjectionRecovery(online, 3);
check(!(await sync(true)) && online.actionApplied === 2
  && appliedRows.length === 2 && online.pendingRow === null,
  'a version-behind Trial snapshot reopened input during action recovery',
  { actionApplied: online.actionApplied, appliedRows: appliedRows.length });
const opponentPlace = {
  idx: 2, move_idx: 1, who: 0, kind: 'place', rune_id: null,
  target_col: null, placed_col: 1, die_before: 3, die_after: 5, created_at: 't2',
};
routes = {
  match_actions: () => ({ body: [placeRow, castRow, opponentPlace] }),
  matches: () => ({ body: trialRow({ turn: 1, next_die: 5, action_version: 3 }) }),
};
check(await sync(true) && online.actionApplied === 3
  && appliedRows.length === 3 && appliedRows[2].action_version === 3,
  'the confirmed action version did not release the projection once reached',
  { actionApplied: online.actionApplied, appliedRows: appliedRows.length });

/* A Trial settled during private selection has no actions and no die, but the
   empty terminal snapshot is complete: it must install and finish the match
   rather than wait for an opening action that will never exist. */
online = onlineState({
  actionProtocol: true,
  trial: true,
  rankedRunes: ['ward', 'ward'],
  pendingDie: 6,
  applied: 4,
});
S.boards = [[[2], [], []], [[3], [], []]];
routes = {
  match_actions: () => ({ body: [] }),
  matches: () => ({ body: trialRow({
    status: 'forfeit', winner: 'p2-id', turn: 1, next_die: null, action_version: 0,
  }) }),
};
check(await sync(true)
  && S.boards[0][0].length === 0 && S.boards[1][0].length === 0
  && online.pendingDie === null && online.applied === 0
  && appliedRows.length === 4 && appliedRows[3].status === 'forfeit',
  'an empty terminal Trial snapshot did not install its settled projection',
  { boards: S.boards, pendingDie: online.pendingDie, appliedRows: appliedRows.length });

/* Terminal projections are absorbing. A command response already recorded the
   match as done; a slower REST read that still sees the active row (even with
   a newer timestamp) must not roll the drained projection back to active. */
online = onlineState({});
S.boards = [emptyBoard(), emptyBoard()];
online.pendingRow = matchRow({
  status: 'done', winner: 'p2-id', p1_score: 12, p2_score: 30,
  last_move_at: '2026-08-26T12:00:30.000Z',
});
routes = {
  match_moves: () => ({ body: [{ idx: 0, who: 1, col: 0, die: 5 }] }),
  matches: () => ({ body: matchRow({ last_move_at: '2026-08-26T12:01:00.000Z' }) }),
};
check(await sync(true)
  && appliedRows.length === 5 && appliedRows[4].status === 'done'
  && appliedRows[4].winner === 'p2-id',
  'a stale active read outranked the terminal projection and could reopen a turn',
  appliedRows[4]);

check(opponentBeats === 0,
  'a full-redraw projection performed an opponent turn instead of installing state',
  opponentBeats);

/* ---- AN AUTO-PLAYED TURN STILL OWES THE OPPONENT THEIR BEAT ----
   The turn clock ran out, the server placed for the player, and the bot's reply
   rode along inside the same command. A TAPPED turn performs that reply through
   playBotReply (play-move.ts): the seat changes hands, their die is rolled in
   the open, the countdown runs in their colour and the think is drawn at
   random. The auto path read only the Trial's `bot_actions` field, so ordinary
   ranked set nothing, and the two fresh rows fell into the rebuild branch —
   both dice repainted in one silent frame. Reported from a device 2026-08-29:
   "when I get auto played, the opponents die if ai is placed instantly without
   a delay/timer bar etc. looks wrong. Should be the same as for normal play."

   Driven at fullRedraw=false, which is what the watchdog actually calls after a
   nudge, so this enters the replay the player sees rather than a projection. */
online = onlineState({ applied: 1, botBeatDue: true });
S.boards = [emptyBoard(), emptyBoard()];
S.turn = 1;
routes = {
  match_moves: () => ({ body: [
    { idx: 0, who: 0, col: 0, die: 3 },
    { idx: 1, who: 1, col: 1, die: 5 },   // placed FOR me by the clock
    { idx: 2, who: 0, col: 1, die: 4 },   // the bot's reply, in the same command
  ] }),
  matches: () => ({ body: matchRow({ turn: 1, next_die: 6 }) }),
};
const beatsBefore = opponentBeats;
check(await sync(false), 'the auto-played run did not sync');
check(opponentBeats === beatsBefore + 1,
  'AN AUTO-PLAYED TURN DROPPED THE OPPONENT\'S BEAT — their die lands with no '
  + 'think and no clock, unlike the identical reply a tapped turn receives',
  { opponentBeats, beatsBefore, applied: online.applied });
/* ...and the run is fully claimed, so a later read cannot animate it twice. */
check(online.applied === 3,
  'the auto-played run left rows unclaimed, so they can animate a second time',
  online.applied);
/* The flag is spent by the batch that performed it: a refused read replays the
   same rows, and nobody sits through a second think for a turn already seen. */
check(online.botBeatDue === false,
  'the bot-beat flag survived the batch that performed it', online.botBeatDue);

/* ---- A BOT'S OPENING ARRIVES ON A FULL REDRAW, AND IS STILL OWED A TURN ----
   The start RPC writes the bot's opening move before this client ever reads the
   board, so it is already in the log at entry — and entry is the one read that
   refuses to animate (initial-sync calls sync(TRUE), and the branches below are
   gated on !fullRedraw). The rows were dropped and the rebuild painted them in
   one silent frame. Reported from a device 2026-08-30: "When ai opens, at least
   In rune ritual it's instantly played."
   The flag is what buys the beat, so the flag — not the redraw mode — decides. */
online = onlineState({ applied: 0, botBeatDue: true });
S.boards = [emptyBoard(), emptyBoard()];
routes = {
  match_moves: () => ({ body: [{ idx: 0, who: 0, col: 0, die: 3 }] }),
  matches: () => ({ body: matchRow({ turn: 1, next_die: 5 }) }),
};
const openingBefore = opponentBeats;
check(await sync(true), 'the bot-opening entry did not sync');
check(opponentBeats === openingBefore + 1,
  'A BOT OPENING WAS PAINTED SILENTLY — it is already in the log at entry, and '
  + 'entry is a full redraw, so the row never reached the replay that performs it',
  { opponentBeats, openingBefore, applied: online.applied });
check(online.applied === 1,
  'the performed opening left its row unclaimed, so a later read animates it twice',
  online.applied);

/* A REJOIN IS THE SAME ROWS WITHOUT THE CLAIM. It must stay silent, or
   reconnecting into a long match would sit through every move of it. */
online = onlineState({ applied: 0, botBeatDue: false });
S.boards = [emptyBoard(), emptyBoard()];
const rejoinBefore = opponentBeats;
check(await sync(true), 'the rejoin did not sync');
check(opponentBeats === rejoinBefore,
  'a rejoin replayed the opponent\'s turn instead of projecting it', opponentBeats);

/* THE NEGATIVE CONTROL. Without a committed bot reply the same two rows are an
   ordinary catch-up and must NOT manufacture a turn that never happened. */
online = onlineState({ applied: 1, botBeatDue: false });
S.boards = [emptyBoard(), emptyBoard()];
const quiet = opponentBeats;
check(await sync(false), 'the catch-up run did not sync');
check(opponentBeats === quiet,
  'a catch-up with no committed bot reply still performed an opponent turn',
  { opponentBeats, quiet });

/* Ordinary ranked uses this same action projection whenever equipped-rune
   support was negotiated. One player may honestly have no rune: that null is
   part of the deal, not a reason to fall back to the placement-only log. */
online = onlineState({
  actionProtocol: true,
  trial: false,
  rankedRunes: [null, 'ward'],
});
S.boards = [emptyBoard(), emptyBoard()];
S.spellCharges = [{}, { ward: 1 }];
routes = {
  match_actions: () => ({ body: [castRow, placeRow] }),
  matches: () => ({ body: matchRow({
    turn: 0,
    next_die: 3,
    format: 'standard',
    protocol_version: 2,
    rune_rules_version: 1,
    phase: 'playing',
    p1_rune: 'ward',
    p2_rune: null,
    pending_aim: null,
    action_version: 2,
  }) }),
};
check(await sync(true)
  && JSON.stringify(S.boards[1][0]) === '[4]'
  && S.charm.wards[1][0] === 1
  && online.actionApplied === 2,
  'equipped ordinary ranked fell back from action replay when one seat had no rune', {
    board: S.boards[1][0],
    wards: S.charm.wards[1],
    actionApplied: online.actionApplied,
  });

/* Terminal recovery carries exact scoring components and the weekly lane. */
online = onlineState({ actionProtocol: false });
const terminalV2 = matchRow({
  status: 'done', winner: 'p1-id', p1_score: 44, p2_score: 30, next_die: null,
  p1_rating_delta: 65, p2_rating_delta: -65,
  p1_base_rating_delta: 60, p2_base_rating_delta: -60,
  p1_finish_rating_delta: 5, p2_finish_rating_delta: -5,
  scoring_version: 2, curve_version: 2, entry_kind: 'weekly',
  weekly_rotation_id: '2026-W36',
});
routes = { match_moves: () => ({ body: [] }), matches: () => ({ body: terminalV2 }) };
check(await sync(true), 'the v2 terminal fallback snapshot did not sync');
const appliedTerminal = appliedRows.at(-1);
check(appliedTerminal?.scoring_version === 2
  && appliedTerminal.curve_version === 2
  && appliedTerminal.p1_base_rating_delta === 60 && appliedTerminal.p1_finish_rating_delta === 5
  && appliedTerminal.entry_kind === 'weekly'
  && appliedTerminal.weekly_rotation_id === '2026-W36',
  'terminal fallback dropped v2 score, curve, or entry metadata', appliedTerminal);

/* Only the exact old-schema missing-column response retries legacy fields. */
online = onlineState({ actionProtocol: false });
const beforeLegacySelects = matchSelects.length;
routes = {
  match_moves: () => ({ body: [] }),
  matches: (url) => url.searchParams.get('select') === PLAY_SYNC_MATCH_COLUMNS ? {
    status: 400, body: { code: 'PGRST204',
      message: "Could not find the 'scoring_version' column of 'matches' in the schema cache" },
  }
    : ({ body: matchRow() }),
};
check(await sync(true), 'the old-schema terminal projection did not use its narrow fallback');
check(JSON.stringify(matchSelects.slice(beforeLegacySelects))
    === JSON.stringify([PLAY_SYNC_MATCH_COLUMNS, PLAY_SYNC_LEGACY_MATCH_COLUMNS]),
  'old-schema fallback did not retry exactly once with the shared legacy projection',
  matchSelects.slice(beforeLegacySelects));

Object.assign(S, savedGlobals);
emitReport({ problems, errs: [] }, problems.length);
