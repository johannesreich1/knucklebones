import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Player } from '../../core/rules.ts';
import type { JoinResult, MatchRow } from '../api/match-api.ts';
import type { S } from '../../state.ts';

export type MatchNames = Extract<JoinResult, { status: 'matched' }>['names'];

export interface OnlineState {
  matchId: string;
  you: Player;
  names: MatchNames;
  namesAreFallback: boolean;
  restoreMode: typeof S.mode;
  pendingDie: number | null;
  applied: number;
  actionApplied: number;
  actionVersion: number;
  trial: boolean;
  trialRunes: readonly [string, string] | null;
  gen: number;
  channel: RealtimeChannel | null;
  tick: ReturnType<typeof setInterval> | null;
  lastMoveAt: number;
  busySync: boolean;
  animating: boolean;
  /** Keep input frozen until an uncertain/committed command is projected. */
  recoverySync: boolean;
  /** A confirmed action response may require a particular log version. */
  recoveryActionVersion: number | null;
  pendingRow: MatchRow | null;
  /** This turn's clock expired and the server has not taken the turn yet. It
      outlives the one-shot clock, so a visible turn cannot go silent. */
  selfAutoDue: boolean;
  /** A resignation is in flight; the Leave control must not fire a second. */
  resigning: boolean;
  /** The server answered this command with a BOT's committed reply, so the
      replay of those rows owes the player a visible opponent turn. A human
      opponent never sets it: their row arrives when they actually played, and
      a fake think would both lie and delay the player's own turn. */
  botBeatDue: boolean;
  /* A placement this client already painted at tap time, so the authoritative
     replay does not paint it a second time. Cleared as soon as it is matched,
     or when the action is refused. */
  optimisticPlace: { who: Player; col: number; die: number } | null;
  /** Automatic placements already spent by this player, from the match row. */
  autoStreak: number;
  /** The away card has been raised for this streak; the tap retires it. */
  awayWarned?: boolean;
  finalizing: boolean;
  done: boolean;
  limited: boolean;
}

export interface FinishReport {
  won: boolean;
  draw: boolean;
  forfeit: boolean;
  my: number;
  their: number;
  delta: number | null;
  opp: string;
  /** Present only when a server-name fallback must remain locale-live. */
  opponentName?: () => string;
  oppAvatar: string | null;
  oppRating: number | null;
}
