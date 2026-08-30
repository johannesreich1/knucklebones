// Thin ranked-match transport over server-authoritative Edge Functions: one
// request in, its wire row out. Match lifecycle/rendering belongs to play.ts,
// not this API seam; the push side lives in match-realtime.ts.
import {
  EQUIPPED_RUNE_CAPABILITY,
  RUNE_TRIAL_CAPABILITY,
  type RankedMatchFormat,
  type RankedPoolTier,
} from '../../core/ranked-outcomes.ts';
import type { RankedActionIntent, RankedActionRow } from '../../core/ranked-actions.ts';
import { callFunction } from './client.ts';
import { randomUuid } from './random-id.ts';

export interface MatchRow {
  id: string;
  p1: string;
  p2: string;
  status: 'active' | 'done' | 'forfeit';
  turn: 0 | 1;
  winner: string | null;
  p1_score: number | null;
  p2_score: number | null;
  next_die: number | null;
  last_move_at: string;
  modifier: string;
  /* Version-1 rows predate Rune Trial. Keep these rollout fields optional at
     the web boundary and normalize their absence to a standard match in the
     flow. Once present, the server treats them as immutable match rules. */
  format?: RankedMatchFormat;
  protocol_version?: 1 | 2;
  rune_rules_version?: number | null;
  pool_tier?: RankedPoolTier;
  phase?: 'selection' | 'playing';
  trial_offer?: string[] | null;
  p1_rune?: string | null;
  p2_rune?: string | null;
  selection_deadline?: string | null;
  selection_version?: number;
  action_version?: number;
  pending_aim?: string | null;
  p1_rating_delta?: number | null;
  p2_rating_delta?: number | null;
  /* Automatic placements spent per seat. Optional at the web boundary for the
     same rollout reason as the Trial fields above: a row written before the
     column existed simply reads as an untouched allowance. */
  p1_auto_streak?: number;
  p2_auto_streak?: number;
}

export interface RuneTrialState {
  offer: string[];
  phase: 'selection' | 'playing';
  deadline: string | null;
  your_choice: string | null;
  opponent_committed: boolean;
}

export type JoinResult =
  /* `bot_actions` / `bot_move` mean A BOT MOVED INSIDE THIS REQUEST, and no
     client has ever painted those rows. The server bakes a bot's opening into
     the match before the board is ever read (pvp-join/start.ts for ordinary
     ranked, _shared/rune-trial-bot-opening.ts for a Trial), so without being
     told, the client's first read cannot tell an opener from history and paints
     it in one silent frame. Present only on the response that committed it — a
     rejoin carries neither, which is what stops a reconnect replaying a match. */
  | { status: 'matched'; match: MatchRow; you: 0 | 1; rejoined?: boolean;
      names: { p1: string; p2: string; ratings?: { p1: number | null; p2: number | null };
               avatars?: { p1: string | null; p2: string | null } };
      bot_actions?: MatchActionRow[];
      bot_move?: { col: number; die: number } | null;
      trial?: RuneTrialState | null }
  | { status: 'queued' }
  | { status: 'incompatible'; reason: 'client' | 'rune-rules' };

interface JoinErrorResult { error?: string }

export function joinResultFromResponse(
  status: number,
  data: JoinResult | JoinErrorResult | null,
): JoinResult | null {
  if (status === 200 && data && 'status' in data) return data as JoinResult;
  const error = data && 'error' in data ? data.error : undefined;
  if (status === 409 && error === 'incompatible-client') {
    return { status: 'incompatible', reason: 'client' };
  }
  if (status === 409 && error === 'unsupported-rune-rules') {
    return { status: 'incompatible', reason: 'rune-rules' };
  }
  return null;
}

export async function join(allowBot: boolean): Promise<JoinResult | null> {
  /* Unknown request fields are ignored by the legacy join endpoint, so the
     v2 client can advertise support before every participant/function has
     upgraded without ever letting a v1 peer into a Trial. */
  const response = await callFunction<JoinResult | JoinErrorResult>('pvp-join', {
    allow_bot: allowBot,
    protocol_version: 2,
    capabilities: [RUNE_TRIAL_CAPABILITY, EQUIPPED_RUNE_CAPABILITY],
  });
  return joinResultFromResponse(response.status, response.data);
}

export interface MoveResult {
  match: MatchRow;
  your_die?: number;
  bot_move?: { col: number; die: number } | null;
  actions?: MatchActionRow[];
  action_version?: number;
  bot_actions?: MatchActionRow[];
  reward?: { rune_id: string; newly_collected: boolean } | null;
  error?: string;
}

export type MatchAction = RankedActionIntent;

/* The action table is append-only replay truth. Cast rows deliberately carry
   the die after the action when it changed (FATE/NUDGE), while placement rows
   retain the rolled die. Older placement-only matches continue to use
   match_moves and never need this shape. */
export type MatchActionRow = RankedActionRow;

async function moveCommand(body: Record<string, unknown>): Promise<{ status: number; data: MoveResult | null }> {
  // Do not automatically replay from the client: the web can deploy before
  // the Edge Function, and the preceding function ignores command_id. A lost
  // response is healed by the authoritative log sync; callers that know the
  // idempotent endpoint is deployed may explicitly replay this command id.
  return callFunction<MoveResult>('pvp-move', body);
}

/* A tap, and only a tap. A turn clock that ran out goes through `nudge`
   instead: the server counts automatic placements per seat and forfeits rather
   than playing a third in a row, so a self placement reported as a finger
   would let an away player be auto-played forever. */
export async function move(
  matchId: string,
  col: number,
  expectedMoveCount: number,
): Promise<{ status: number; data: MoveResult | null }> {
  return moveCommand({
    match_id: matchId,
    col,
    expected_move_count: expectedMoveCount,
    command_id: randomUuid(),
  });
}

export async function rankedAction(
  matchId: string,
  expectedActionVersion: number,
  action: MatchAction,
  commandId: string = randomUuid(),
): Promise<{ status: number; data: MoveResult | null }> {
  return callFunction<MoveResult>('pvp-action', {
    match_id: matchId,
    command_id: commandId,
    expected_action_version: expectedActionVersion,
    action,
  });
}

export async function nudgeRankedAction(
  matchId: string,
  expectedActionVersion: number,
): Promise<{ status: number; data: MoveResult | null }> {
  return callFunction<MoveResult>('pvp-action', {
    match_id: matchId,
    command_id: randomUuid(),
    expected_action_version: expectedActionVersion,
    auto: true,
  });
}

/* THE RESPONSE THAT COMMITS THE BOT'S OPENING. Finalizing a Trial selection is
   what flips the phase to playing, and the same Edge invocation then commits a
   bot opening seat's whole first turn — so this is where `bot_actions` arrives
   in the ordinary flow, not on the join. Carrying it to entry is what lets the
   board perform that turn instead of finding it already there. */
export type RuneTrialSelection = {
  match: MatchRow;
  trial: RuneTrialState;
  bot_actions?: MatchActionRow[];
};

export async function selectRune(
  matchId: string,
  runeId: string,
  commandId: string = randomUuid(),
): Promise<{ status: number; data: RuneTrialSelection | null }> {
  return callFunction('pvp-rune-select', {
    match_id: matchId,
    rune_id: runeId,
    command_id: commandId,
  });
}

export async function autoSelectRune(
  matchId: string,
): Promise<{ status: number; data: RuneTrialSelection | null }> {
  return callFunction('pvp-rune-select', {
    match_id: matchId,
    command_id: randomUuid(),
    auto: true,
  });
}

export async function readRuneTrialState(
  matchId: string,
): Promise<{ status: number; data: { match: MatchRow; trial: RuneTrialState } | null }> {
  return callFunction('pvp-rune-select', { match_id: matchId, read: true });
}

export async function nudge(
  matchId: string,
  expectedMoveCount: number,
): Promise<{ status: number; data: MoveResult | null }> {
  return moveCommand({
    match_id: matchId,
    auto: true,
    expected_move_count: expectedMoveCount,
    command_id: randomUuid(),
  });
}

export async function claim(matchId: string): Promise<{ status: number; data: { match: MatchRow } | null }> {
  return callFunction('pvp-claim', { match_id: matchId });
}
