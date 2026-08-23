// Thin ranked-match transport over server-authoritative Edge Functions and
// Realtime. Match lifecycle/rendering belongs to play.ts, not this API seam.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { callFunction, supa } from './client.ts';

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
}

export type JoinResult =
  | { status: 'matched'; match: MatchRow; you: 0 | 1; rejoined?: boolean;
      names: { p1: string; p2: string; ratings?: { p1: number | null; p2: number | null };
               avatars?: { p1: string | null; p2: string | null } } }
  | { status: 'queued' };

export async function join(allowBot: boolean): Promise<JoinResult | null> {
  const response = await callFunction<JoinResult>('pvp-join', { allow_bot: allowBot });
  return response.status === 200 ? response.data : null;
}

export function leaveQueue(): void {
  const client = supa();
  void client.auth.getUser().then(({ data }) => {
    if (data.user) void client.from('matchmaking_queue').delete().eq('player_id', data.user.id);
  });
}

export interface MoveResult {
  match: MatchRow;
  your_die?: number;
  bot_move?: { col: number; die: number } | null;
  error?: string;
}

export async function move(matchId: string, col: number): Promise<{ status: number; data: MoveResult | null }> {
  return callFunction<MoveResult>('pvp-move', { match_id: matchId, col });
}

export async function nudge(matchId: string): Promise<{ status: number; data: MoveResult | null }> {
  return callFunction<MoveResult>('pvp-move', { match_id: matchId, auto: true });
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
): RealtimeChannel {
  return supa().channel(`match-${matchId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'match_moves', filter: `match_id=eq.${matchId}` },
      (payload) => onMove(payload.new as { idx: number; who: number; col: number }))
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
      (payload) => onMatch(payload.new as unknown as MatchRow))
    .subscribe();
}
