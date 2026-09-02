// One read of Supabase's persisted auth state, with absence kept distinct from
// an unreadable refresh. `getSession()` may need the network when its JWT is
// stale; failure there says nothing about whether the refresh token is still
// stored, so callers must never translate it into "signed out".
import type { Session } from '@supabase/supabase-js';
import { SUPABASE_AUTH_STORAGE_KEY } from '../../config.ts';
import { supa } from '../api/client.ts';

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
