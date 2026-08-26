// The online identity session: authentication and the player's own profile.
// This module (and supabase-js with it) is loaded ONLY via dynamic import —
// the offline game's boot path must never depend on it.
import { callFunction, supa } from './client.ts';
import { onlineMessage } from './message-copy.ts';
import { assertCurrentGameCenter, restoreGameCenterAutomatically } from './identity.ts';
import { gameCenterState, waitForGameCenter } from '../native/game-center.ts';
import {
  clearRuneCollectionSnapshot,
  readRuneCollectionSnapshot,
} from '../rune-collection-cache.ts';
import { invalidateRuneCollectionRefreshes } from './rune-collection.ts';

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
export interface IdentityStatus {
  gameCenterLinked: boolean;
  appleLinked: boolean;
  appleRevocationReady: boolean;
}
/* An account carrying an address is NOT a guest, whatever is_anonymous says.
   Identities attached server-side (Game Center goes through the admin API) do
   not necessarily clear the flag, and a player who has attached must never be
   told again that their rating lives on this device only. */
const me = (u: { id: string; is_anonymous?: boolean; email?: string } | null | undefined): Me | null =>
  u ? { id: u.id, guest: !!u.is_anonymous && !u.email, email: u.email ?? null } : null;

function providerErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  return String((error as { code?: unknown }).code ?? '').toLowerCase();
}

export function localizedAuthError(error: unknown): string | null {
  if (!error) return null;
  switch (providerErrorCode(error)) {
    case 'invalid_credentials': return onlineMessage('errors.invalidCredentials');
    case 'email_not_confirmed': return onlineMessage('errors.emailNotConfirmed');
    case 'email_exists':
    case 'user_already_exists': return onlineMessage('errors.emailInUse');
    case 'weak_password': return onlineMessage('errors.weakPassword');
    case 'email_address_invalid': return onlineMessage('errors.invalidEmail');
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit': return onlineMessage('errors.rateLimit');
    default: return onlineMessage('errors.generic');
  }
}

/* Signing up may or may not hand back a live session: with email confirmation
   REQUIRED the account waits for the link, with it optional Supabase signs the
   player straight in. Report which happened rather than assuming — "check your
   email" shown to somebody who is already signed in is a dead end, and an
   inbox that never receives anything is a worse one. */
export async function signUp(email: string, password: string): Promise<{ error: string | null; live: boolean }> {
  const { data, error } = await supa().auth.signUp({ email, password });
  return { error: localizedAuthError(error), live: !!data?.session };
}
export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supa().auth.signInWithPassword({ email, password });
  return localizedAuthError(error);
}
const MANUAL_AUTH = 'knucklebones.online.manual-auth';
export async function signOut(): Promise<void> {
  invalidateRuneCollectionRefreshes();
  clearRuneCollectionSnapshot();
  await supa().auth.signOut();
  acceptedGameCenterRevision = null;
  try { localStorage.setItem(MANUAL_AUTH, '1'); } catch { /* forgetful host */ }
  clearProfileCache();
}
/* Once a device has held a real account, silently minting a guest on the next
   tap would be a trap: the player signed out to sign back IN. Remembering that
   fact costs one flag and turns the silent path off for exactly those devices. */
const KNOWN = 'knucklebones.online.attached';
export const hadRealAccount = (): boolean => {
  try { return !!localStorage.getItem(KNOWN); } catch { return false; }
};
function remember(u: Me | null): Me | null {
  try {
    if (u) localStorage.removeItem(MANUAL_AUTH);
    if (u && !u.guest) localStorage.setItem(KNOWN, '1');
  } catch { /* forgetful host */ }
  return u;
}

export async function currentUser(): Promise<Me | null> {
  const { data: { session } } = await supa().auth.getSession();
  const user = remember(me(session?.user));
  const runes = readRuneCollectionSnapshot();
  /* Supabase may replace a session directly during account recovery/sign-in.
     Never leave the preceding account's confirmed collection active while
     the new account's refresh is still in flight. */
  if (!user || (runes && runes.accountId !== user.id.toLowerCase())) {
    invalidateRuneCollectionRefreshes();
    clearRuneCollectionSnapshot();
  }
  return user;
}

export async function identityStatus(): Promise<IdentityStatus | null> {
  const result = await callFunction<IdentityStatus>('identity-status', {});
  return result.status === 200 && result.data ? result.data : null;
}

let acceptedGameCenterRevision: number | null = null;
export function acknowledgeCurrentAccount(): void {
  acceptedGameCenterRevision = gameCenterState().revision;
}
export function requireGameCenterAssertion(): void {
  acceptedGameCenterRevision = null;
}

export type GameCenterSessionAction = 'continue' | 'assert' | 'retry';

/* A failed identity-status read is not proof that this Supabase account is
   unlinked. In particular, after GameKit publishes a new revision it could
   otherwise let a switched Game Center player continue under the old account.
   Keep this decision explicit so the unknown and genuinely-unlinked states
   cannot collapse back into the same optional-chain branch. */
export function gameCenterSessionAction(
  status: IdentityStatus | null,
  acceptedRevision: number | null,
  nativeRevision: number,
): GameCenterSessionAction {
  if (!status) return 'retry';
  if (!status.gameCenterLinked || acceptedRevision === nativeRevision) return 'continue';
  return 'assert';
}

/* The first rung, taken silently: whoever asks for ranked without a session
   becomes a guest and keeps playing. Returns null when the project has
   anonymous sign-ins switched off — the caller then falls back to the sign-in
   panel, which is exactly how this game behaved before guests existed. */
export async function ensureIdentity(): Promise<Me | null> {
  const here = await currentUser();
  if (here) {
    let nativeState = gameCenterState();
    if (nativeState.status === 'unavailable') nativeState = await waitForGameCenter();
    if (nativeState.status === 'unavailable') return here;
    const providers = await identityStatus();
    const action = gameCenterSessionAction(
      providers,
      acceptedGameCenterRevision,
      nativeState.revision,
    );
    if (action === 'retry') return null;
    if (action === 'continue') return here;
    const ownership = await assertCurrentGameCenter();
    if (ownership === 'match') {
      acceptedGameCenterRevision = nativeState.revision;
      return here;
    }
    return null;
  }
  let manual = false;
  try { manual = !!localStorage.getItem(MANUAL_AUTH); } catch { /* forgetful host */ }
  if (manual || hadRealAccount()) return null; // they signed out to sign back IN

  const gameCenter = await restoreGameCenterAutomatically();
  if (gameCenter === 'signed-in') return currentUser();
  if (gameCenter === 'retry') return null;

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
    return live ? null : onlineMessage('errors.accountCreatedConfirm');
  }
  const { data, error } = await supa().auth.updateUser({ email });
  if (error) return localizedAuthError(error);
  if (!data.user?.email) return onlineMessage('errors.confirmEmailThenPassword');
  const { error: pw } = await supa().auth.updateUser({ password });
  return localizedAuthError(pw);
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
  if (!user) return onlineMessage('errors.notSignedIn');
  const { error } = await supa().from('profiles').update({ nickname }).eq('id', user.id);
  if (!error) return null;
  return error.code === '23505' ? onlineMessage('errors.nameTaken')
    : error.code === '23514' ? onlineMessage('profile.nameInvalid')
    : error.code === 'P0001' ? onlineMessage('errors.nameAlreadySet')
    : onlineMessage('errors.generic');
}

/* The avatar is a die face and a hue — "die:5:cy". 36 identities, no storage
   bucket, no moderation, and no user-generated-image obligations at review.
   The string shape is the seam: a later value can be "img:<path>". */
export async function setAvatar(avatar: string): Promise<string | null> {
  const user = await currentUser();
  if (!user) return onlineMessage('errors.notSignedIn');
  const { error } = await supa().from('profiles').update({ avatar }).eq('id', user.id);
  if (error) return onlineMessage('errors.generic');
  clearProfileCache();
  return null;
}

/* ---- account ---- */
export type AppleRevocationState = 'complete' | 'pending' | 'manual-required';
export async function deleteAccount(): Promise<{
  error: string | null;
  appleRevocation: AppleRevocationState | null;
}> {
  const r = await callFunction<{
    deleted?: boolean;
    error?: string;
    appleRevocation?: AppleRevocationState;
  }>('account-delete', {});
  if (r.status === 200 && r.data?.deleted) {
    await signOut();
    clearProfileCache();
    // the account is gone, so the device is a newcomer again — next tap plays
    try { localStorage.removeItem(KNOWN); } catch { /* forgetful host */ }
    try { localStorage.removeItem(MANUAL_AUTH); } catch { /* forgetful host */ }
    return { error: null, appleRevocation: r.data.appleRevocation ?? null };
  }
  return {
    error: r.status === 401
      ? onlineMessage('errors.notSignedIn')
      : onlineMessage('errors.deleteFailed'),
    appleRevocation: null,
  };
}
