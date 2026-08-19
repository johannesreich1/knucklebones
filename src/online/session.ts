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

/* ---- auth ----

   Identity here is a LADDER, not a gate. Every player is the same kind of user
   to this backend — a row in auth.users, a profile, a rating — and the rungs
   differ only in how the app can prove which row is theirs:

     guest      the proof is a token in this device's storage. Survives
                relaunch, dies with the app.
     attached   an email (or, in the native build, Apple) vouches for the
                player, so the SAME row comes back after a reinstall.

   Nothing downstream knows the difference: the profile trigger fires for a
   guest exactly as for anybody else, and every RLS policy is written against
   auth.uid(). That is why guest play costs no schema. */
export interface Me { id: string; guest: boolean; email: string | null }
const me = (u: { id: string; is_anonymous?: boolean; email?: string } | null | undefined): Me | null =>
  u ? { id: u.id, guest: !!u.is_anonymous, email: u.email ?? null } : null;

/* Signing up may or may not hand back a live session: with email confirmation
   REQUIRED the account waits for the link, with it optional Supabase signs the
   player straight in. Report which happened rather than assuming — "check your
   email" shown to somebody who is already signed in is a dead end, and an
   inbox that never receives anything is a worse one. */
export async function signUp(email: string, password: string): Promise<{ error: string | null; live: boolean }> {
  const { data, error } = await supa().auth.signUp({ email, password });
  return { error: error ? error.message : null, live: !!data?.session };
}
export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supa().auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}
export async function signOut(): Promise<void> { await supa().auth.signOut(); clearProfileCache(); }
/* Once a device has held a real account, silently minting a guest on the next
   tap would be a trap: the player signed out to sign back IN. Remembering that
   fact costs one flag and turns the silent path off for exactly those devices. */
const KNOWN = 'knucklebones.online.attached';
export const hadRealAccount = (): boolean => {
  try { return !!localStorage.getItem(KNOWN); } catch { return false; }
};
function remember(u: Me | null): Me | null {
  try {
    if (u && !u.guest) localStorage.setItem(KNOWN, '1');
  } catch { /* forgetful host */ }
  return u;
}

export async function currentUser(): Promise<Me | null> {
  const { data: { session } } = await supa().auth.getSession();
  return remember(me(session?.user));
}

/* The first rung, taken silently: whoever asks for ranked without a session
   becomes a guest and keeps playing. Returns null when the project has
   anonymous sign-ins switched off — the caller then falls back to the sign-in
   panel, which is exactly how this game behaved before guests existed. */
export async function ensureIdentity(): Promise<Me | null> {
  const here = await currentUser();
  if (here) return here;
  if (hadRealAccount()) return null;          // they signed out to sign back IN
  const { data, error } = await supa().auth.signInAnonymously();
  if (error) return null;
  return me(data.user);
}

/* The second rung: hang an email on the account the player already has, so the
   rating and match history survive a reinstall. updateUser() links an identity
   to the CURRENT user — it never mints a second one — and a password can only
   be set once that address counts as verified, which is instant while email
   confirmation is optional and needs the inbox when it is not. */
export async function attachEmail(email: string, password: string): Promise<string | null> {
  const { data, error } = await supa().auth.updateUser({ email });
  if (error) return error.message;
  if (!data.user?.email) return 'Almost there — confirm the link we sent, then set your password.';
  const { error: pw } = await supa().auth.updateUser({ password });
  return pw ? pw.message : null;
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
  if (r.status === 200 && r.data?.deleted) {
    await signOut();
    clearProfileCache();
    // the account is gone, so the device is a newcomer again — next tap plays
    try { localStorage.removeItem(KNOWN); } catch { /* forgetful host */ }
    return null;
  }
  return r.data?.error ?? 'delete failed';
}
