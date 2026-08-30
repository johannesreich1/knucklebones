/** Structural Edge/database types kept by hand until generated DB types exist. */
export type PlayerIndex = 0 | 1;

export const MATCH_COLUMNS = "id, p1, p2, status, turn, winner, p1_score, p2_score, "
  + "p1_rating_delta, p2_rating_delta, next_die, last_move_at, modifier, season_id, "
  + "format, protocol_version, rune_rules_version, pool_tier, phase, trial_offer, "
  + "p1_rune, p2_rune, selection_deadline, selection_version, action_version, pending_aim, "
  + "p1_auto_streak, p2_auto_streak";

export interface MatchRow {
  id: string;
  p1: string;
  p2: string;
  status: string;
  turn: PlayerIndex;
  winner: string | null;
  p1_score: number | null;
  p2_score: number | null;
  p1_rating_delta: number | null;
  p2_rating_delta: number | null;
  next_die: number | null;
  last_move_at: string;
  modifier: string;
  season_id: number | null;
  format: "standard" | "rune_trial";
  protocol_version: 1 | 2;
  /** Read as a number so unknown future versions can be refused at runtime. */
  rune_rules_version: number | null;
  pool_tier: "stone" | "bone" | "ivory";
  phase: "selection" | "playing";
  trial_offer: string[] | null;
  p1_rune: string | null;
  p2_rune: string | null;
  selection_deadline: string | null;
  selection_version: number;
  action_version: number;
  pending_aim: string | null;
  /** Consecutive automatic placements per seat, reset by any genuine move.
      Public on purpose: each side may see that the other is away. */
  p1_auto_streak: number;
  p2_auto_streak: number;
}

export interface MatchMoveRow {
  idx: number;
  who: PlayerIndex;
  col: number;
}

export interface MatchActionRow {
  idx: number;
  move_idx: number | null;
  who: PlayerIndex;
  kind: "aim" | "cast" | "place";
  rune_id: string | null;
  target_col: number | null;
  placed_col: number | null;
  die_before: number;
  die_after: number | null;
  created_at?: string;
}

export interface LadderRow {
  points: number;
  peak: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface ProfileSummary {
  id: string;
  nickname?: string | null;
  rating?: number | null;
  avatar?: string | null;
  is_bot?: boolean | null;
}

export interface JoinInput {
  allowBot: boolean;
  protocolVersion: 1 | 2;
  capabilities: string[];
}

export interface MoveInput {
  matchId: string;
  col: number;
  auto: boolean;
  commandId: string;
  expectedMoveCount: number | null;
}

export interface ClaimInput {
  matchId: string;
  resign: boolean;
}

export type RuneTrialSelectInput =
  | { kind: "read"; matchId: string }
  | {
    kind: "commit";
    matchId: string;
    commandId: string;
    runeId: string | null;
    auto: boolean;
  };

export type MatchActionInput =
  | { kind: "aim"; rune_id: string }
  | { kind: "cast"; rune_id: string; target_col: number }
  | { kind: "place"; placed_col: number };

export interface ActionInput {
  matchId: string;
  commandId: string;
  expectedActionVersion: number;
  auto: boolean;
  action: MatchActionInput | null;
}
