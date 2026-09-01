// Ranked log synchronization. Legacy standard matches project placement rows;
// every action-protocol match projects the richer aim/cast/place log and
// refuses incoherent two-read snapshots before reopening input on a wrong board.
import { BOUNTY, applyMove, emptyBoard, type Player } from '../../core/rules.ts';
import { projectRankedActions, type RankedActionRow } from '../../core/ranked-actions.ts';
import { spellById } from '../../core/spells.ts';
import { applyAimPresentation, disarm, renderSpells } from '../../flow/spells.ts';
import { paintCastCharge, paintCastEffect } from './play-cast-paint.ts';
import { handTurnTo } from '../../flow/turn.ts';
import { S } from '../../state.ts';
import { renderAll } from '../../ui/game/board.ts';
import { supa } from '../api/client.ts';
import { isMissingPostgrestColumn } from '../api/postgrest-compat.ts';
import type { MatchRow } from '../api/match-api.ts';
import { confirmedLadderCurveVersion } from '../../progression-status-cache.ts';
import { newerMatchProjection, readMatchSyncSnapshot } from './match-sync.ts';
import { animateOnlineMove } from './play-motion.ts';
import { projectionRecoveryVersionReached } from './play-recovery.ts';
import type { OnlineState } from './play-types.ts';
import {
  isEmptyTerminalTrialSnapshot,
  retryCoherentTrialSnapshot,
  type TrialSnapshot,
} from '../runes/trial-snapshot.ts';

export interface OnlineSyncPorts {
  current(): OnlineState | null;
  isCurrent(online: OnlineState): boolean;
  applyMatchRow(match: MatchRow): void;
  renderPool(): void;
  /** Hand the turn to the opponent and perform it: their card forward, their
      die rolled in the open, their clock running, a real think. Answers false
      once this match is no longer the one on screen. */
  openOpponentBeat(online: OnlineState, die: number | null): Promise<boolean>;
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const PLAY_SYNC_LEGACY_MATCH_COLUMNS = [
  'id', 'p1', 'p2', 'status', 'turn', 'winner', 'p1_score', 'p2_score',
  'p1_rating_delta', 'p2_rating_delta', 'next_die', 'last_move_at', 'modifier',
  'format', 'protocol_version', 'rune_rules_version', 'pool_tier', 'phase',
  'p1_rune', 'p2_rune', 'action_version', 'pending_aim',
].join(',');
export const PLAY_SYNC_V2_MATCH_COLUMNS = Object.freeze([
  'p1_base_rating_delta', 'p2_base_rating_delta',
  'p1_finish_rating_delta', 'p2_finish_rating_delta',
  'scoring_version', 'curve_version', 'entry_kind', 'weekly_rotation_id',
  'outcome_roster',
]);
export const PLAY_SYNC_MATCH_COLUMNS = [
  PLAY_SYNC_LEGACY_MATCH_COLUMNS,
  ...PLAY_SYNC_V2_MATCH_COLUMNS,
].join(',');

interface PlaySyncMatchRead {
  readonly data: MatchRow | null;
  readonly error: unknown | null;
}

async function readPlaySyncMatch(matchId: string): Promise<PlaySyncMatchRead> {
  /* Dynamic DRY select fragments cannot be inferred by supabase-js's literal
     parser. The runtime row is still validated by the synchronizer below; name
     the narrow transport shape here instead of spreading GenericStringError. */
  const read = async (columns: string): Promise<PlaySyncMatchRead> => {
    const result = await supa().from('matches')
      .select(columns).eq('id', matchId).maybeSingle();
    return result as unknown as PlaySyncMatchRead;
  };
  const result = await read(PLAY_SYNC_MATCH_COLUMNS);
  if (!result.error || confirmedLadderCurveVersion() === 2
      || !isMissingPostgrestColumn(result.error, PLAY_SYNC_V2_MATCH_COLUMNS)) return result;
  return read(PLAY_SYNC_LEGACY_MATCH_COLUMNS);
}

async function readActionSnapshot(online: OnlineState): Promise<TrialSnapshot | null> {
  return retryCoherentTrialSnapshot(async () => {
    const [actionsResult, matchResult] = await Promise.all([
      supa().from('match_actions')
        .select('idx, move_idx, who, kind, rune_id, target_col, placed_col, die_before, die_after, created_at')
        .eq('match_id', online.matchId).order('idx'),
      readPlaySyncMatch(online.matchId),
    ]);
    if (actionsResult.error || matchResult.error || !matchResult.data
        || !Array.isArray(actionsResult.data)) return null;
    return {
      rows: actionsResult.data as unknown as RankedActionRow[],
      match: matchResult.data as unknown as MatchRow,
    };
  }, (attempt) => pause(60 * attempt));
}

/* Did this client already draw this exact row at tap time? Matched on kind,
   seat, target and die rather than an index, because the index the row lands at
   is the server's answer and is not known when the paint starts. Consumed on
   the first match: a later identical action is a different tap and must play. */
function alreadyPainted(online: OnlineState, row: RankedActionRow): boolean {
  const painted = online.painted;
  if (!painted || painted.kind !== row.kind || painted.who !== row.who
      || painted.die !== row.die_before) return false;
  const target = row.kind === 'place' ? row.placed_col : row.target_col;
  if (painted.col !== target) return false;
  online.painted = null;
  return true;
}

async function animateRankedAction(
  online: OnlineState,
  row: RankedActionRow,
  ports: OnlineSyncPorts,
): Promise<void> {
  if (!ports.isCurrent(online)) return;
  S.die = row.die_before;
  online.pendingDie = row.die_before;
  if (row.kind === 'place' && row.placed_col !== null) {
    /* The projection that follows this replay owns the board absolutely, so a
       row we already drew is skipped rather than drawn a second time. */
    if (alreadyPainted(online, row)) return;
    await animateOnlineMove(row.who, row.placed_col, row.die_before,
      () => ports.isCurrent(online), S.charm);
    return;
  }
  if (row.kind === 'aim' && row.rune_id) {
    const spell = spellById(row.rune_id);
    if (!spell?.commitsOnAim) return;
    if (alreadyPainted(online, row)) return;
    applyAimPresentation(row.who, spell, S.spellArmed === spell.id);
    renderSpells();
    return;
  }
  if (row.kind !== 'cast' || !row.rune_id || row.target_col === null) return;
  const spell = spellById(row.rune_id);
  if (!spell) return;
  /* A cast this client already performed at tap time. What is still owed
     depends on the ONE flag that says whether the outcome was the server's:
     nothing for a rune that cannot draw, and the die exchange for FATE, whose
     charge beat covered the trip while the drawn face was still unknown. */
  const painted = alreadyPainted(online, row);
  if (!painted) {
    paintCastCharge(row.who, spell, {
      reserved: S.spellAimCommitted?.id === spell.id
        && S.spellAimCommitted.who === row.who,
      faceUp: S.spellArmed === spell.id,
    });
  } else if (!spell.drawsFromSupply) return;
  await paintCastEffect(row.who, spell, row.target_col, row.die_before,
    () => row.die_after ?? row.die_before);
}

function installActionProjection(
  online: OnlineState,
  rows: readonly RankedActionRow[],
  match: MatchRow,
): boolean {
  if (!online.rankedRunes) return false;
  /* A resignation/deletion can settle during private selection. There was no
     opening action (and therefore no public next die to seed replay), but the
     empty board is already the complete authoritative projection. */
  if (isEmptyTerminalTrialSnapshot({ rows, match })) {
    disarm(true);
    S.boards = [emptyBoard(), emptyBoard()];
    S.bounty = [0, 0];
    S.die = 0;
    online.pendingDie = null;
    online.actionApplied = 0;
    online.actionVersion = 0;
    online.applied = 0;
    online.lastMoveAt = Date.parse(match.last_move_at);
    renderAll(false);
    handTurnTo(match.turn, online.you);
    return true;
  }
  const projected = projectRankedActions(rows, S.scoring, online.rankedRunes,
    rows.length ? undefined : match.next_die ?? online.pendingDie ?? undefined);
  if (!projected || projected.actionCount !== match.action_version) return false;
  if (match.status === 'active'
      && (projected.over || projected.turn !== match.turn || projected.nextDie !== match.next_die
        || projected.pendingAim !== (match.pending_aim ?? null))) {
    return false;
  }
  if (match.status === 'done' && !projected.over) return false;
  disarm(true);
  S.boards = projected.st;
  S.bounty = projected.bounty;
  S.charm = projected.charm;
  S.spellCharges = projected.charges;
  S.spellCastThisTurn = projected.castThisTurn ? projected.turn : null;
  if (projected.pendingAim) {
    S.spellArmed = projected.pendingAim;
    S.spellAimCommitted = { id: projected.pendingAim, who: projected.turn };
  }
  S.die = projected.nextDie ?? 0;
  online.pendingDie = projected.nextDie;
  online.actionApplied = projected.actionCount;
  online.actionVersion = projected.actionCount;
  online.applied = projected.moveCount;
  online.lastMoveAt = Date.parse(match.last_move_at);
  renderAll(false);
  handTurnTo(projected.turn, online.you);
  return true;
}

/* One batch of the action log, played out in order. A row's seat OWNS the beat
   that follows, so the seat CHANGE — not every row — is where the turn is
   handed over, and that single paint is the rail swap the player watches.
   A bot's whole reply is committed inside the player's own command, so it
   arrives in this same batch with nothing between it and the player's own
   placement. That crossing is the one that gets the full opponent turn. */
async function replayRankedActions(
  online: OnlineState,
  fresh: readonly RankedActionRow[],
  ports: OnlineSyncPorts,
): Promise<void> {
  /* Claimed once per batch. A refused projection replays the same rows, and
     nobody sits through a second think for a turn they already watched. */
  const botReply = online.botBeatDue;
  online.botBeatDue = false;
  let seat: Player | null = null;
  for (const row of fresh) {
    if (!ports.isCurrent(online)) return;
    if (row.who !== seat) {
      seat = row.who;
      if (botReply && row.who !== online.you) {
        if (!await ports.openOpponentBeat(online, row.die_before)) return;
      } else handTurnTo(row.who, online.you);
    }
    await animateRankedAction(online, row, ports);
  }
}

async function syncActions(
  online: OnlineState,
  fullRedraw: boolean,
  ports: OnlineSyncPorts,
): Promise<boolean> {
  const snapshot = await readActionSnapshot(online);
  if (!ports.isCurrent(online) || !snapshot) return false;
  const fresh = snapshot.rows.filter(({ idx }) => idx >= online.actionApplied);
  /* A FULL REDRAW STILL OWES A BOT ITS OPENING TURN. fullRedraw exists to stop
     two things animating — reconnecting into a match already in progress, and
     recovering after a refused or uncertain action — and neither ever carries
     this flag: the join response sets it only when a bot moved inside THAT
     request, and submit() clears it before every recovery resync. So the flag,
     not the redraw mode, is what decides whether a batch is performed. Without
     this the first read dropped the opener on the floor and installActionProjection
     painted it in one silent frame (reported from a device). */
  if (fresh.length && (!fullRedraw || online.botBeatDue)) {
    online.animating = true;
    try {
      await replayRankedActions(online, fresh, ports);
    } finally { online.animating = false; }
    if (!ports.isCurrent(online)) return false;
  }
  if (!installActionProjection(online, snapshot.rows, snapshot.match)) return false;
  /* A command response can be newer than the first post-outage read. Keep the
     old input gate closed until the confirmed action version is visible. */
  if (!projectionRecoveryVersionReached(online)) return false;
  online.pendingRow = newerMatchProjection(online.pendingRow, snapshot.match);
  return true;
}

async function syncStandard(
  online: OnlineState,
  fullRedraw: boolean,
  ports: OnlineSyncPorts,
): Promise<boolean> {
  const snapshot = await readMatchSyncSnapshot<
    { idx: number; who: number; col: number; die: number }, MatchRow
  >({
    moves: async () => await supa().from('match_moves').select('idx, who, col, die')
      .eq('match_id', online.matchId).order('idx'),
    match: async () => await readPlaySyncMatch(online.matchId),
  });
  if (!ports.isCurrent(online) || !snapshot || online.animating) return false;
  const fresh = snapshot.moves.filter((row) => row.idx >= online.applied);
  /* Claimed once per batch, exactly as action replay claims it: a refused
     read replays the same rows, and nobody sits through a second think for a
     turn they already watched. */
  const botReply = online.botBeatDue;
  online.botBeatDue = false;
  /* THE BOT OPENED THIS MATCH. One row, theirs, and nothing of ours yet — the
     start RPC wrote it before this client ever read the board. It arrives on a
     full redraw (entry is one), so it needs the same exemption the action-log
     replay gate gets, and then the ordinary single-row branch below performs it. */
  const opening = botReply && fresh.length === 1 && !online.applied
    && fresh[0].who !== online.you;
  /* THE AUTO-PLAYED TURN. The clock ran out, the server placed for the player
     and the bot answered inside the same command — two fresh rows, mine then
     theirs, which the rebuild below would paint in one silent frame. A tapped
     turn performs that reply (play-move.ts -> playBotReply); so does this. */
  if (botReply && !fullRedraw && fresh.length === 2
      && fresh[0].who === online.you && fresh[1].who !== online.you) {
    online.animating = true;
    try {
      for (const [index, row] of fresh.entries()) {
        online.applied = row.idx + 1;
        if (index === 1
            && !await ports.openOpponentBeat(online, row.die)) return false;
        await animateOnlineMove(row.who as Player, row.col, row.die,
          () => ports.isCurrent(online));
      }
    } finally { online.animating = false; }
    if (!ports.isCurrent(online)) return false;
  } else if (fresh.length === 1 && (!fullRedraw || opening) && fresh[0].who !== online.you) {
    online.applied = fresh[0].idx + 1;
    online.animating = true;
    try {
      /* An OPENING is a whole turn of theirs and gets the full beat; a mid-game
         row that simply arrived is already a turn the player watched begin. */
      if (opening && !await ports.openOpponentBeat(online, fresh[0].die)) return false;
      await animateOnlineMove(fresh[0].who as Player, fresh[0].col, fresh[0].die,
        () => ports.isCurrent(online));
    } finally { online.animating = false; }
    if (!ports.isCurrent(online)) return false;
  } else if (fresh.length || fullRedraw) {
    S.boards = [emptyBoard(), emptyBoard()];
    S.bounty = [0, 0];
    for (const row of snapshot.moves) {
      const destroyed = applyMove(S.boards, row.who as Player, row.col, row.die, S.scoring);
      if (S.scoring === BOUNTY) S.bounty[row.who as Player] += destroyed;
    }
    online.applied = snapshot.moves.length;
    renderAll(false);
    ports.renderPool();
  }
  online.pendingRow = newerMatchProjection(online.pendingRow, snapshot.match);
  return true;
}

export function createOnlineSynchronizer(ports: OnlineSyncPorts) {
  return async function sync(fullRedraw: boolean): Promise<boolean> {
    const online = ports.current();
    if (!online || online.busySync || online.animating) return false;
    online.busySync = true;
    let synced = false;
    try {
      synced = online.actionProtocol
        ? await syncActions(online, fullRedraw, ports)
        : await syncStandard(online, fullRedraw, ports);
    } finally { online.busySync = false; }
    if (synced && ports.isCurrent(online) && online.pendingRow && !online.animating) {
      const match = online.pendingRow;
      online.pendingRow = null;
      ports.applyMatchRow(match);
    }
    return synced && ports.isCurrent(online);
  };
}
