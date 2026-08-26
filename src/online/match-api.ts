// Thin ranked-match transport over server-authoritative Edge Functions and
// Realtime. Match lifecycle/rendering belongs to play.ts, not this API seam.
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  RUNE_TRIAL_CAPABILITY,
  type RankedMatchFormat,
  type RankedPoolTier,
} from '../core/ranked-outcomes.ts';
import type { RankedActionIntent, RankedActionRow } from '../core/ranked-actions.ts';
import { callFunction, supa } from './client.ts';
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
}

export interface RuneTrialState {
  offer: string[];
  phase: 'selection' | 'playing';
  deadline: string | null;
  your_choice: string | null;
  opponent_committed: boolean;
}

export type JoinResult =
  | { status: 'matched'; match: MatchRow; you: 0 | 1; rejoined?: boolean;
      names: { p1: string; p2: string; ratings?: { p1: number | null; p2: number | null };
               avatars?: { p1: string | null; p2: string | null } };
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
    capabilities: [RUNE_TRIAL_CAPABILITY],
  });
  return joinResultFromResponse(response.status, response.data);
}

export type LeaveResult =
  | { status: 'left' }
  | { status: 'matched'; match_id: string };

interface QueueRpcError { code?: string; message?: string }
interface QueueLifecycleClient {
  rpc(name: string): Promise<{ data: unknown; error: QueueRpcError | null }>;
  auth: {
    getSession(): Promise<{
      data: { session: { user: { id: string } } | null };
      error: unknown | null;
    }>;
  };
  from(table: string): {
    delete(): {
      eq(column: string, value: string): PromiseLike<{ error: unknown | null }>;
    };
  };
}

export function isMissingQueueLifecycleRpc(error: QueueRpcError | null): boolean {
  if (!error || !['PGRST202', '42883'].includes(error.code ?? '')) return false;
  return (error.message ?? '').toLowerCase().includes('leave_ranked_queue');
}

async function legacyLeaveQueue(client: QueueLifecycleClient): Promise<LeaveResult | null> {
  const { data, error: sessionError } = await client.auth.getSession();
  const playerId = data.session?.user.id;
  if (sessionError || !playerId) return null;
  const { error } = await client.from('matchmaking_queue').delete().eq('player_id', playerId);
  return error ? null : { status: 'left' };
}

export async function leaveQueueWithClient(client: QueueLifecycleClient): Promise<LeaveResult | null> {
  let { data, error } = await client.rpc('leave_ranked_queue');
  // The web deploy can briefly precede the owner-applied migration. Only the
  // precise old-schema error falls back to the already-RLS-protected own-row
  // DELETE; authorization/outage errors are never reclassified as success.
  if (isMissingQueueLifecycleRpc(error)) return legacyLeaveQueue(client);
  if (error || data == null) ({ data, error } = await client.rpc('leave_ranked_queue'));
  if (isMissingQueueLifecycleRpc(error)) return legacyLeaveQueue(client);
  if (error || !data || typeof data !== 'object') return null;
  const result = data as Record<string, unknown>;
  if (result.status === 'left') return { status: 'left' };
  if (result.status === 'matched' && typeof result.match_id === 'string') {
    return { status: 'matched', match_id: result.match_id };
  }
  return null;
}

export async function leaveQueue(): Promise<LeaveResult | null> {
  return leaveQueueWithClient(supa() as unknown as QueueLifecycleClient);
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

export async function selectRune(
  matchId: string,
  runeId: string,
  commandId: string = randomUuid(),
): Promise<{ status: number; data: { match: MatchRow; trial: RuneTrialState } | null }> {
  return callFunction('pvp-rune-select', {
    match_id: matchId,
    rune_id: runeId,
    command_id: commandId,
  });
}

export async function autoSelectRune(
  matchId: string,
): Promise<{ status: number; data: { match: MatchRow; trial: RuneTrialState } | null }> {
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

let resigned: { matchId: string; over: Promise<boolean> } | null = null;

const resignCall = async (matchId: string): Promise<boolean> => {
  const response = await callFunction<{ match?: MatchRow; error?: string }>(
    'pvp-claim', { match_id: matchId, resign: true },
  );
  return response.status === 200 || response.data?.error === 'match-over';
};

export function resign(matchId: string): void {
  resigned = { matchId, over: resignCall(matchId) };
}

export async function resignedOver(matchId: string): Promise<boolean> {
  if (resigned?.matchId !== matchId) return false;
  if (await resigned.over) return true;
  resigned = { matchId, over: resignCall(matchId) };
  return resigned.over;
}

export function readyPeer(matchId: string): { announce(): void; onPeer(cb: () => void): () => void } {
  let hit: (() => void) | null = null;
  const channel = supa()
    .channel(`ready-${matchId}`, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'ready' }, () => hit?.())
    .subscribe();
  return {
    announce() { void channel.send({ type: 'broadcast', event: 'ready', payload: {} }); },
    onPeer(callback) {
      hit = callback;
      return () => { hit = null; void supa().removeChannel(channel); };
    },
  };
}

export function watchMatch(
  matchId: string,
  onMove: (move: { idx: number; who: number; col: number }) => void,
  onMatch: (match: MatchRow) => void,
  onAction?: (action: MatchActionRow) => void,
): RealtimeChannel {
  const channel = supa().channel(`match-${matchId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'match_moves', filter: `match_id=eq.${matchId}` },
      (payload) => onMove(payload.new as { idx: number; who: number; col: number }))
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
      (payload) => onMatch(payload.new as unknown as MatchRow));
  if (onAction) channel.on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'match_actions', filter: `match_id=eq.${matchId}` },
    (payload) => onAction(payload.new as unknown as MatchActionRow));
  return channel.subscribe();
}
