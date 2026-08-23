import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Player } from '../core/rules.ts';
import type { JoinResult, MatchRow } from './match-api.ts';

export type MatchNames = Extract<JoinResult, { status: 'matched' }>['names'];

export interface OnlineState {
  matchId: string;
  you: Player;
  names: MatchNames;
  pendingDie: number | null;
  applied: number;
  gen: number;
  channel: RealtimeChannel | null;
  tick: ReturnType<typeof setInterval> | null;
  lastMoveAt: number;
  busySync: boolean;
  animating: boolean;
  pendingRow: MatchRow | null;
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
  oppAvatar: string | null;
  oppRating: number | null;
}
