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

export interface Profile { id: string; nickname: string; rating: number; created_at?: string; avatar?: string; named_at?: string | null; }
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
/* An account carrying an address is NOT a guest, whatever is_anonymous says.
   Identities attached server-side (Game Center goes through the admin API) do
   not necessarily clear the flag, and a player who has attached must never be
   told again that their rating lives on this device only. */
const me = (u: { id: string; is_anonymous?: boolean; email?: string } | null | undefined): Me | null =>
  u ? { id: u.id, guest: !!u.is_anonymous && !u.email, email: u.email ?? null } : null;

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
  const { data } = await supa().from('profiles').select('id, nickname, rating, created_at, avatar, named_at').eq('id', user.id).maybeSingle();
  try {
    // merged over the old entry, not replaced: rank/apex (cacheStanding) come
    // from a different RPC and must survive a profile refetch
    if (data) localStorage.setItem(PROFILE_CACHE, JSON.stringify({
      ...JSON.parse(localStorage.getItem(PROFILE_CACHE) ?? '{}'),
      nickname: data.nickname, rating: data.rating, avatar: data.avatar }));
  } catch { /* forgetful host */ }
  return data as Profile | null;
}

/* the home chip paints before any RPC answers, from this cache — when a
   standing lands anywhere (result, profile), its rank/apex are stashed beside
   the profile so the chip's group pill can carry "BONE · #13" at next boot */
export function cacheStanding(rank: number | null, apex: boolean): void {
  try {
    const c = JSON.parse(localStorage.getItem(PROFILE_CACHE) ?? 'null');
    if (c) localStorage.setItem(PROFILE_CACHE, JSON.stringify({ ...c, rank, apex }));
  } catch { /* forgetful host */ }
}

function clearProfileCache(): void {
  try { localStorage.removeItem(PROFILE_CACHE); } catch { /* forgetful host */ }
}
/* A name is claimed ONCE: the 0026 trigger stamps named_at on the first
   nickname write and refuses every later one, so this can only succeed for a
   profile whose name is still the minted placeholder. The P0001 branch is the
   backstop for a claim raced from two devices — the UI never offers a second. */
export async function claimName(nickname: string): Promise<string | null> {
  const user = await currentUser();
  if (!user) return 'not signed in';
  const { error } = await supa().from('profiles').update({ nickname }).eq('id', user.id);
  if (!error) return null;
  return error.code === '23505' ? 'That name is taken — try another.'
    : error.code === '23514' ? '3–16 letters, digits or underscores.'
    : error.code === 'P0001' ? 'Your name is already set.'
    : error.message;
}

/* ---- leaderboard ---- */
/* ---- the ladder (docs/LADDER.md) ---- */

/* Where a player stands THIS season. rank is 1-based; population is the field
   it is measured against, which is what makes the apex a position rather than
   a threshold. */
export interface Standing { points: number; rank: number; population: number; percentile: number }
export async function myStanding(): Promise<Standing | null> {
  const user = await currentUser();
  if (!user) return null;
  const { data } = await supa().rpc('player_standing', { p: user.id });
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { points: row.points, rank: Number(row.rank),
                 population: Number(row.population), percentile: Number(row.percentile) } : null;
}

/* points + peak + record for the current season. The peak is the gold notch. */
export interface Ladder { points: number; peak: number; wins: number; losses: number; draws: number }
export async function myLadder(): Promise<Ladder | null> {
  const user = await currentUser();
  if (!user) return null;
  const { data: season } = await supa().rpc('current_season');
  const { data } = await supa().from('season_ratings')
    .select('points, peak, wins, losses, draws')
    .eq('season_id', season).eq('player', user.id).maybeSingle();
  /* No row yet is not an error: a player joins the ladder the first time they
     are paired, so "nothing here" is an honest zero for someone who has not
     played a ranked match. */
  return data ?? { points: 0, peak: 0, wins: 0, losses: 0, draws: 0 };
}

/* The longest run of wins this season — computed server-side over the whole
   season, so it never shrinks as old matches scroll out of any window. */
export async function bestStreak(): Promise<number> {
  const { data } = await supa().rpc('best_streak');
  return Number(data ?? 0);
}

/* One finished match as the history list shows it. The delta is what the match
   ACTUALLY paid — the only place a points number is honest, since what a match
   is worth depends on the opponent. */
export interface HistoryRow {
  id: string; when: string; opponent: string; mode: string;
  mine: number; theirs: number; delta: number; result: 'win' | 'loss' | 'draw';
}
export async function matchHistory(limit = 40, before?: string): Promise<HistoryRow[]> {
  /* One definer RPC, not a client-side join: profiles is own-row only, so a
     client cannot read an opponent's nickname and every row would read "???".
     The leaderboard is built the same way for the same reason. `before`
     (an ISO finished_at) keysets the next page of OLDER matches — the list
     lazy-loads because a season of games is not a payload (migration 0031). */
  const args: Record<string, unknown> = { limit_n: limit };
  if (before) args.before_t = before;
  const { data } = await supa().rpc('match_history', args);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    when: String(r.finished_at ?? ''),
    opponent: String(r.opponent ?? '???'),
    mode: String(r.mode ?? 'classic'),
    mine: Number(r.mine ?? 0),
    theirs: Number(r.theirs ?? 0),
    delta: Number(r.delta ?? 0),
    result: r.result as 'win' | 'loss' | 'draw',
  }));
}

/* The avatar is a die face and a hue — "die:5:cy". 36 identities, no storage
   bucket, no moderation, and no user-generated-image obligations at review.
   The string shape is the seam: a later value can be "img:<path>". */
export async function setAvatar(avatar: string): Promise<string | null> {
  const user = await currentUser();
  if (!user) return 'not signed in';
  const { error } = await supa().from('profiles').update({ avatar }).eq('id', user.id);
  if (error) return error.message;
  clearProfileCache();
  return null;
}

/* The 0022 shape: points (the ladder score, NOT the old `rating`), the row's
   1-based rank, whether the player is inside the apex — NEON is resolved
   server-side because it is a position (top 1%), not a threshold — plus the
   die they wear and their season peak, which the face-off states. */
export interface LeaderboardRow {
  nickname: string; points: number; wins: number; losses: number; games: number;
  rank: number; apex: boolean; avatar: string | null; peak: number;
}
export async function leaderboard(limit = 50, fromRank = 1): Promise<LeaderboardRow[]> {
  /* a rank WINDOW (migration 0032): the board pages around the reader
     instead of shipping the whole season — from_rank is where it opens */
  const { data } = await supa().rpc('leaderboard', { limit_n: limit, from_rank: fromRank });
  return (data as LeaderboardRow[]) ?? [];
}

/* The face-off's facts for ANY named player, keyed by NICKNAME — the board
   exposes no account ids, and profiles is own-row only, the same reason the
   leaderboard and match_history are definer functions. Since 0028 this is the
   player's WHOLE row (rank/apex mirroring leaderboard()), which is what lets
   the result screen open the same face-off the ladder does. The row fields
   are null for a player with no season row — the caller shows no door. */
export interface PlayerCard {
  streak: number; since: string | null;
  points: number | null; wins: number | null; losses: number | null;
  games: number | null; rank: number | null; apex: boolean; peak: number | null;
}
export async function playerCard(nick: string): Promise<PlayerCard | null> {
  const { data } = await supa().rpc('player_card', { nick });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const num = (v: unknown): number | null => v == null ? null : Number(v);
  return { streak: Number(row.streak ?? 0), since: row.since ?? null,
           points: num(row.points), wins: num(row.wins), losses: num(row.losses),
           games: num(row.games), rank: num(row.rank), apex: !!row.apex,
           peak: num(row.peak) };
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
  | { status: 'matched'; match: MatchRow; you: 0 | 1; rejoined?: boolean;
      /* avatars is optional only for the deploy gap: a client shipped with
         this field may still hear from a pvp-join that predates it */
      names: { p1: string; p2: string; ratings?: { p1: number | null; p2: number | null };
               avatars?: { p1: string | null; p2: string | null } } }
  | { status: 'queued' };
export async function join(allowBot: boolean): Promise<JoinResult | null> {
  const r = await call<JoinResult>('pvp-join', { allow_bot: allowBot });
  return r.status === 200 ? r.data : null;
}

/* Truly leave the queue: delete my own row (RLS delete-own, migration 0030).
   Without this, Cancel only stopped the POLLING while the server row sat
   claimable for up to two minutes — a player who walked away could still be
   pulled into a match they would never see. Fire-and-forget by design: the
   worst a lost request costs is the old behaviour. */
export function leaveQueue(): void {
  const c = supa();
  void c.auth.getUser().then(({ data }) => {
    if (data.user) void c.from('matchmaking_queue').delete().eq('player_id', data.user.id);
  });
}

export interface MoveResult { match: MatchRow; your_die?: number; bot_move?: { col: number; die: number } | null; error?: string; }
export async function move(matchId: string, col: number): Promise<{ status: number; data: MoveResult | null }> {
  return call<MoveResult>('pvp-move', { match_id: matchId, col });
}
/* Ask the server to place for an opponent who has stopped answering. It checks
   the stall against its OWN clock and refuses (425) until it is real, so this
   is safe to call optimistically and safe to retry. */
export async function nudge(matchId: string): Promise<{ status: number; data: MoveResult | null }> {
  return call<MoveResult>('pvp-move', { match_id: matchId, auto: true });
}
export async function claim(matchId: string): Promise<{ status: number; data: { match: MatchRow } | null }> {
  return call('pvp-claim', { match_id: matchId });
}

/* Resigning: the same forfeit finisher as claim, aimed the other way — the
   CALLER gives the match away, no stall to prove. Fired from the quit path
   and never awaited there (the player is already on their way home), so the
   outcome is remembered: matchmaking must not race it, or pvp-join would
   hand back the very match the player just walked out of. */
let resigned: { matchId: string; over: Promise<boolean> } | null = null;
const resignCall = async (matchId: string): Promise<boolean> => {
  const r = await call<{ match?: MatchRow; error?: string }>('pvp-claim', { match_id: matchId, resign: true });
  /* 200 = resigned (or somebody else finished it first — the function answers
     with the settled row either way); "match-over" = already finished. Any
     other answer means the match may still be live. */
  return r.status === 200 || r.data?.error === 'match-over';
};
export function resign(matchId: string): void {
  resigned = { matchId, over: resignCall(matchId) };
}
/* true = this match was resigned and is CONFIRMED over — never re-enter it.
   A quit-time call that failed (a radio blip) gets one retry here; if the
   match still won't die, the caller falls back to rejoining it. */
export async function resignedOver(matchId: string): Promise<boolean> {
  if (resigned?.matchId !== matchId) return false;
  if (await resigned.over) return true;
  resigned = { matchId, over: resignCall(matchId) };
  return resigned.over;
}

/* Readiness on the mode dial: a BROADCAST, not a table. Nothing here is worth
   persisting — it only ever shortens a five-second countdown, so a message that
   never lands costs those seconds and nothing else. */
export function readyPeer(matchId: string): { announce(): void; onPeer(cb: () => void): () => void } {
  let hit: (() => void) | null = null;
  const ch = supa()
    .channel(`ready-${matchId}`, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'ready' }, () => hit?.())
    .subscribe();
  return {
    announce() { void ch.send({ type: 'broadcast', event: 'ready', payload: {} }); },
    onPeer(cb) { hit = cb; return () => { hit = null; void supa().removeChannel(ch); }; },
  };
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
