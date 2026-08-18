// The online session: auth, profile, leaderboard, and the PvP match API.
// This module (and supabase-js with it) is loaded ONLY via dynamic import —
// the offline game's boot path must never depend on it.
import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.ts';

let client: SupabaseClient | null = null;
export function supa(): SupabaseClient {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_KEY);
  return client;
}

export interface Profile { id: string; nickname: string; rating: number; created_at?: string; }
export interface MatchRow {
  id: string; p1: string; p2: string; status: 'active' | 'done' | 'forfeit';
  turn: 0 | 1; winner: string | null; p1_score: number | null; p2_score: number | null;
  next_die: number | null; last_move_at: string;
  modifier: string;   // the wheel's pick (core/modes.ts id) — server-chosen from the seed
}

/* ---- auth ---- */
export async function signUp(email: string, password: string): Promise<string | null> {
  const { error } = await supa().auth.signUp({ email, password });
  return error ? error.message : null;
}
export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supa().auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}
export async function signOut(): Promise<void> { await supa().auth.signOut(); clearProfileCache(); }
export async function currentUser(): Promise<{ id: string } | null> {
  const { data: { session } } = await supa().auth.getSession();
  return session?.user ?? null;
}

/* ---- profile ---- */
/* the home screen's identity chip reads this cache at boot — a stale rating
   beats putting a network call in the offline game's boot path */
const PROFILE_CACHE = 'knucklebones.online.profile';

export async function myProfile(): Promise<Profile | null> {
  const user = await currentUser();
  if (!user) return null;
  const { data } = await supa().from('profiles').select('id, nickname, rating, created_at').eq('id', user.id).maybeSingle();
  try {
    if (data) localStorage.setItem(PROFILE_CACHE, JSON.stringify({ nickname: data.nickname, rating: data.rating }));
  } catch { /* forgetful host */ }
  return data as Profile | null;
}

/* lifetime W–L for the Account card, counted from the matches I took part in */
export async function myRecord(): Promise<{ wins: number; losses: number; draws: number } | null> {
  const user = await currentUser();
  if (!user) return null;
  const { data } = await supa().from('matches').select('winner, status')
    .or(`p1.eq.${user.id},p2.eq.${user.id}`).neq('status', 'active');
  if (!data) return null;
  const wins = data.filter((r) => r.winner === user.id).length;
  const draws = data.filter((r) => r.winner === null).length;
  return { wins, losses: data.length - wins - draws, draws };
}

function clearProfileCache(): void {
  try { localStorage.removeItem(PROFILE_CACHE); } catch { /* forgetful host */ }
}
export async function rename(nickname: string): Promise<string | null> {
  const user = await currentUser();
  if (!user) return 'not signed in';
  const { error } = await supa().from('profiles').update({ nickname }).eq('id', user.id);
  if (!error) return null;
  return error.code === '23505' ? 'name already taken'
    : error.code === '23514' ? '3–16 letters, digits or _'
    : error.message;
}

/* ---- leaderboard ---- */
export interface LeaderboardRow { nickname: string; rating: number; wins: number; games: number; }
export async function leaderboard(limit = 50): Promise<LeaderboardRow[]> {
  const { data } = await supa().rpc('leaderboard', { limit_n: limit });
  return (data as LeaderboardRow[]) ?? [];
}

/* ---- PvP match API (thin wrappers over the Edge Functions) ---- */
async function call<T>(fn: string, body: object): Promise<{ status: number; data: T | null }> {
  try {
    const { data: { session } } = await supa().auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify(body),
    });
    let data: T | null = null;
    try { data = await res.json(); } catch { /* empty body */ }
    return { status: res.status, data };
  } catch {
    // transient network failure: status 0 — callers retry or resync, never crash
    return { status: 0, data: null };
  }
}

export type JoinResult =
  | { status: 'matched'; match: MatchRow; you: 0 | 1; rejoined?: boolean; names: { p1: string; p2: string } }
  | { status: 'queued' };
export async function join(allowBot: boolean): Promise<JoinResult | null> {
  const r = await call<JoinResult>('pvp-join', { allow_bot: allowBot });
  return r.status === 200 ? r.data : null;
}

export interface MoveResult { match: MatchRow; your_die?: number; bot_move?: { col: number; die: number } | null; error?: string; }
export async function move(matchId: string, col: number): Promise<{ status: number; data: MoveResult | null }> {
  return call<MoveResult>('pvp-move', { match_id: matchId, col });
}
export async function claim(matchId: string): Promise<{ status: number; data: { match: MatchRow } | null }> {
  return call('pvp-claim', { match_id: matchId });
}

/* opponent moves + match updates arrive here; caller unsubscribes via the handle */
export function watchMatch(matchId: string,
  onMove: (m: { idx: number; who: number; col: number }) => void,
  onMatch: (m: MatchRow) => void): RealtimeChannel {
  return supa().channel(`match-${matchId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'match_moves', filter: `match_id=eq.${matchId}` },
      (p) => onMove(p.new as any))
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
      (p) => onMatch(p.new as any))
    .subscribe();
}

/* ---- account ---- */
export async function deleteAccount(): Promise<string | null> {
  const r = await call<{ deleted?: boolean; error?: string }>('account-delete', {});
  if (r.status === 200 && r.data?.deleted) { await signOut(); clearProfileCache(); return null; }
  return r.data?.error ?? 'delete failed';
}
