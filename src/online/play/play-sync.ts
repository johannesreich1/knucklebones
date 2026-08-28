// Ranked log synchronization. Standard matches project placement rows; Rune
// Trial projects the richer cast/place action log and refuses incoherent
// two-read snapshots before they can reopen input on the wrong board.
import { BOUNTY, applyMove, emptyBoard, type Player } from '../../core/rules.ts';
import { projectRankedActions, type RankedActionRow } from '../../core/ranked-actions.ts';
import { spellById } from '../../core/spells.ts';
import { applyAimPresentation, disarm, renderSpells, spendChargePresentation } from '../../flow/spells.ts';
import { runSpellEffect } from '../../flow/spell-effects.ts';
import { handTurnTo } from '../../flow/turn.ts';
import { S } from '../../state.ts';
import { setStageDie } from '../../ui/die.ts';
import { renderAll } from '../../ui/game/board.ts';
import { supa } from '../api/client.ts';
import type { MatchRow } from '../api/match-api.ts';
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

async function readTrialSnapshot(online: OnlineState): Promise<TrialSnapshot | null> {
  return retryCoherentTrialSnapshot(async () => {
    const [actionsResult, matchResult] = await Promise.all([
      supa().from('match_actions')
        .select('idx, move_idx, who, kind, rune_id, target_col, placed_col, die_before, die_after, created_at')
        .eq('match_id', online.matchId).order('idx'),
      supa().from('matches')
        .select('id, p1, p2, status, turn, winner, p1_score, p2_score, p1_rating_delta, p2_rating_delta, next_die, last_move_at, modifier, format, protocol_version, rune_rules_version, pool_tier, phase, p1_rune, p2_rune, action_version, pending_aim')
        .eq('id', online.matchId).maybeSingle(),
    ]);
    if (actionsResult.error || matchResult.error || !matchResult.data
        || !Array.isArray(actionsResult.data)) return null;
    return {
      rows: actionsResult.data as unknown as RankedActionRow[],
      match: matchResult.data as unknown as MatchRow,
    };
  }, (attempt) => pause(60 * attempt));
}

/* Did this client already draw this exact row at tap time? Matched on seat,
   column and die rather than an index, because the index the row lands at is
   the server's answer and is not known when the paint starts. Consumed on the
   first match: a later identical placement is a different tap and must animate. */
function alreadyPainted(online: OnlineState, row: RankedActionRow): boolean {
  const painted = online.optimisticPlace;
  if (!painted || row.kind !== 'place') return false;
  if (painted.who !== row.who || painted.col !== row.placed_col
      || painted.die !== row.die_before) return false;
  online.optimisticPlace = null;
  return true;
}

async function animateTrialAction(
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
    applyAimPresentation(row.who, spell, S.spellArmed === spell.id);
    renderSpells();
    return;
  }
  if (row.kind !== 'cast' || !row.rune_id || row.target_col === null) return;
  const spell = spellById(row.rune_id);
  if (!spell) return;
  const reserved = S.spellAimCommitted?.id === spell.id
    && S.spellAimCommitted.who === row.who;
  if (!reserved) spendChargePresentation(row.who, spell, S.spellArmed === spell.id);
  if (reserved) disarm(true);
  S.spellCastThisTurn = row.who;
  let die = row.die_before;
  const context = {
    mode: S.scoring,
    die,
    setDie(value: number) {
      die = value;
      this.die = value;
      S.die = value;
      setStageDie(value, row.who);
    },
    draw: () => row.die_after ?? row.die_before,
    bagLeft: null,
    charm: S.charm,
  };
  renderSpells();
  await runSpellEffect(spell.id, row.who, row.target_col,
    () => spell.apply(S.boards, row.who, row.target_col!, context));
}

function installTrialProjection(
  online: OnlineState,
  rows: readonly RankedActionRow[],
  match: MatchRow,
): boolean {
  if (!online.trialRunes) return false;
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
  const projected = projectRankedActions(rows, S.scoring, online.trialRunes,
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
async function replayTrialActions(
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
    await animateTrialAction(online, row, ports);
  }
}

async function syncTrial(
  online: OnlineState,
  fullRedraw: boolean,
  ports: OnlineSyncPorts,
): Promise<boolean> {
  const snapshot = await readTrialSnapshot(online);
  if (!ports.isCurrent(online) || !snapshot) return false;
  const fresh = snapshot.rows.filter(({ idx }) => idx >= online.actionApplied);
  if (fresh.length && !fullRedraw) {
    online.animating = true;
    try {
      await replayTrialActions(online, fresh, ports);
    } finally { online.animating = false; }
    if (!ports.isCurrent(online)) return false;
  }
  if (!installTrialProjection(online, snapshot.rows, snapshot.match)) return false;
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
    match: async () => await supa().from('matches')
      .select('id, p1, p2, status, turn, winner, p1_score, p2_score, p1_rating_delta, p2_rating_delta, next_die, last_move_at, modifier')
      .eq('id', online.matchId).maybeSingle(),
  });
  if (!ports.isCurrent(online) || !snapshot || online.animating) return false;
  const fresh = snapshot.moves.filter((row) => row.idx >= online.applied);
  if (fresh.length === 1 && !fullRedraw && fresh[0].who !== online.you) {
    online.applied = fresh[0].idx + 1;
    online.animating = true;
    try {
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
      synced = online.trial
        ? await syncTrial(online, fullRedraw, ports)
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
