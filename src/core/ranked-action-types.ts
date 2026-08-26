import type { CharmSt, GameState, Player } from './rules.ts';

export type RankedActionKind = 'aim' | 'cast' | 'place';

export interface RankedActionRow {
  idx: number;
  move_idx: number | null;
  who: Player;
  kind: RankedActionKind;
  rune_id: string | null;
  target_col: number | null;
  placed_col: number | null;
  die_before: number;
  die_after: number | null;
  created_at?: string;
}

export type RankedActionIntent =
  | { kind: 'aim'; rune_id: string }
  | { kind: 'cast'; rune_id: string; target_col: number }
  | { kind: 'place'; placed_col: number };

/** Tuple order follows core Player ids: [AI/p2, ME/p1]. */
export type RankedRuneDeal = readonly [string, string];

export interface RankedActionState {
  st: GameState;
  turn: Player;
  over: boolean;
  nextDie: number | null;
  actionCount: number;
  moveCount: number;
  drawCount: number;
  bounty: [number, number];
  charm: CharmSt;
  charges: [Record<string, number>, Record<string, number>];
  castThisTurn: boolean;
  pendingAim: string | null;
}
