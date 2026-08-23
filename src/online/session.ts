// The online identity session: authentication and the player's own profile.
// This module (and supabase-js with it) is loaded ONLY via dynamic import —
// the offline game's boot path must never depend on it.
import { callFunction, supa } from './client.ts';

export interface Profile { id: string; nickname: string; rating: number; created_at?: string; avatar?: string; named_at?: string | null; }

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
  /* No session to hang the address on — a device that signed out of a real
     account never gets a silent guest (see ensureIdentity). "Keep account" is
     then simply "create account", which is what the player asked for either
     way: mint it here rather than answering their sign-up with a session
     error. Sign-in panel's Create account lands here (auth-screen.ts AUTH). */
  if (!(await currentUser())) {
    const { error, live } = await signUp(email, password);
    if (error) return error;
    return live ? null : 'Account created — confirm the link we sent, then sign in.';
  }
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

/* ---- account ---- */
export async function deleteAccount(): Promise<string | null> {
  const r = await callFunction<{ deleted?: boolean; error?: string }>('account-delete', {});
  if (r.status === 200 && r.data?.deleted) {
    await signOut();
    clearProfileCache();
    // the account is gone, so the device is a newcomer again — next tap plays
    try { localStorage.removeItem(KNOWN); } catch { /* forgetful host */ }
    return null;
  }
  return r.data?.error ?? 'delete failed';
}
