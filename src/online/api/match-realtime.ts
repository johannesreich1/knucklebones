// Push transport for one ranked match: the peer-ready broadcast channel and the
// postgres_changes subscription over match_moves / matches / match_actions.
// Kept apart from match-api.ts because these are the only ranked calls that
// hold a live channel and hand back a teardown, rather than asking an Edge
// Function a question and returning its answer.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supa } from './client.ts';
import type { MatchActionRow, MatchRow } from './match-api.ts';

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
