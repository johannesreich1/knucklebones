import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Player } from '../core/rules.ts';
import type { JoinResult, MatchRow } from './match-api.ts';
import type { S } from '../state.ts';

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
