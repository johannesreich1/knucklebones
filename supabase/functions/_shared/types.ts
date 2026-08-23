/** Structural Edge/database types kept by hand until generated DB types exist. */
export type PlayerIndex = 0 | 1;

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
}

export interface MatchMoveRow {
  idx: number;
  who: PlayerIndex;
  col: number;
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
}

export interface MoveInput {
  matchId: string;
  col: number;
  auto: boolean;
}

export interface ClaimInput {
  matchId: string;
  resign: boolean;
}
