// One read of Supabase's persisted auth state, with absence kept distinct from
// an unreadable refresh. `getSession()` may need the network when its JWT is
// stale; failure there says nothing about whether the refresh token is still
// stored, so callers must never translate it into "signed out".
import type { Session } from '@supabase/supabase-js';
import { SUPABASE_AUTH_STORAGE_KEY } from '../../config.ts';
import { readWithin, supa } from '../api/client.ts';

export type AuthSessionRead =
  | { readonly kind: 'authenticated'; readonly session: Session }
  | { readonly kind: 'sessionless' }
  | { readonly kind: 'unavailable' };

/** The account Supabase persisted for synchronous pre-network presentation.
 * This is deliberately narrower than session restoration: malformed or
 * legacy storage simply means the entry screen keeps its shared loader. */
export function persistedAuthAccountId(): string | null {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY) ?? 'null',
    );
    if (!stored || typeof stored !== 'object') return null;
    const record = stored as Record<string, unknown>;
    const session = record.currentSession && typeof record.currentSession === 'object'
      ? record.currentSession as Record<string, unknown> : record;
    const user = session.user;
    if (!user || typeof user !== 'object') return null;
    const id = (user as Record<string, unknown>).id;
    return typeof id === 'string' ? id.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Forget a deleted user's persisted session without calling ambient
 * `signOut()`, which could sign out a replacement account that arrived while
 * the deletion request was in flight. Browser storage mutation is synchronous,
 * so the ownership check and remove cannot yield to this tab's auth flow. */
export function forgetPersistedAuthAccount(accountId: string): boolean {
  const expected = accountId.toLowerCase();
  try {
    if (persistedAuthAccountId() !== expected) return false;
    localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
    return persistedAuthAccountId() !== expected;
  } catch {
    return false;
  }
}

/* One refresh, however many reads asked for it. A screen fires four reads at
   once; if the session has gone stale they would otherwise queue four token
   requests, and the library caches a refresh FAILURE for a minute, so the
   later three would each answer from that cache without touching the network
   anyway. Share the attempt and let them all act on its one answer. */
let refreshInFlight: Promise<boolean> | null = null;

/** Ask for a new access token once. True when a session came back.
 *
 * The library refreshes on its own — a 30s ticker, a foreground listener, and
 * a lazy refresh inside getSession(). This exists for the case those cannot
 * cover: when a refresh has already failed on an expired token the library
 * DELETES the session and caches that failure, so every later read answers
 * "unavailable" without asking the server again. Until something asks
 * explicitly, the app stays signed out while still drawing a signed-in
 * player, which is what stranded the Ladder and the Profile rank on
 * 3 Sep 2026. */
export function refreshSessionOnce(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const { data, error } = await supa().auth.refreshSession();
      return !error && !!data.session;
    } catch {
      return false;
    }
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

/* THE FRONT DOOR NEEDS A DEADLINE MOST OF ALL.
   getSession() is not a storage read whenever the access token has expired: it
   goes to the token endpoint, and auth-js retries a connection it cannot reach
   with exponential backoff for as long as its 30s auto-refresh tick allows —
   longer still when the requests hang instead of failing, which is what a
   captive portal or dead mobile data actually does. Nothing above this bounded
   it, so ranked entry mounted its loading die and simply never came back
   (Johannes, 3 Sep 2026: "it loading endlessly"). An unanswered read is
   `unavailable` like any other: the door then has a connection sheet to show
   and a Retry to offer, and the player's stored session is untouched. */
/* THE DOOR'S READ, AND THE ONLY SESSION READ THAT CARRIES THE DEADLINE.
   getSession() stops being a storage read the moment the access token has
   expired: it goes to the token endpoint, and auth-js retries a connection it
   cannot reach with exponential backoff for as long as its 30s tick allows —
   longer when the requests hang instead of failing, which is what a captive
   portal or dead mobile data actually does. Nothing above it was bounded, so
   ranked entry mounted its loading die and never came back (Johannes, 3 Sep
   2026: "it loading endlessly"). Unanswered is `unavailable` like any other
   unreadable session, so the door has its connection sheet to show and its
   Retry to offer, and the stored session is left exactly where it was.

   Deliberately NOT applied to readAuthSession() itself. That one is also the
   ownership guard behind account replacement and provider restore, which
   resolve in the same turn as the writes they protect; putting a race between
   them and their caller reorders those turns, and the native Apple restore
   then finishes against a view it no longer owns and never repaints Profile.
   The deadline belongs where a player is watching a die, which is here. */
export function entryAuthSession(): Promise<AuthSessionRead> {
  return readWithin<AuthSessionRead, AuthSessionRead>(
    () => readAuthSession(),
    () => ({ kind: 'unavailable' }),
  );
}

export async function readAuthSession(): Promise<AuthSessionRead> {
  try {
    const { data, error } = await supa().auth.getSession();
    if (error) return { kind: 'unavailable' };
    return data.session
      ? { kind: 'authenticated', session: data.session }
      : { kind: 'sessionless' };
  } catch {
    return { kind: 'unavailable' };
  }
}
