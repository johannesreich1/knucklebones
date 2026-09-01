// One read of Supabase's persisted auth state, with absence kept distinct from
// an unreadable refresh. `getSession()` may need the network when its JWT is
// stale; failure there says nothing about whether the refresh token is still
// stored, so callers must never translate it into "signed out".
import type { Session } from '@supabase/supabase-js';
import { supa } from '../api/client.ts';

export type AuthSessionRead =
  | { readonly kind: 'authenticated'; readonly session: Session }
  | { readonly kind: 'sessionless' }
  | { readonly kind: 'unavailable' };

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
