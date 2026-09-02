// Lazy Supabase transport shared by the ranked feature. Keeping construction
// and Edge Function HTTP here prevents auth, ladder, and match APIs from each
// inventing their own session/header behavior.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from '../../config.ts';

let client: SupabaseClient | null = null;

export function supa(): SupabaseClient {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_KEY);
  return client;
}

export interface FunctionCallOptions {
  /** Refuse before fetch unless this exact account owns the captured bearer. */
  expectedAccountId?: string;
}

export interface FunctionCallResult<T> {
  status: number;
  data: T | null;
  accountMismatch?: true;
}

export interface AccountSessionBearer {
  readonly access_token: string;
  readonly user: { readonly id: string };
}

/** Bind a bearer to the same account the visible interaction retained. */
export function authorizationForAccount(
  session: AccountSessionBearer | null,
  expectedAccountId: string,
): string | null {
  return session?.user.id.toLowerCase() === expectedAccountId.toLowerCase()
    ? `Bearer ${session.access_token}` : null;
}

export async function callFunction<T>(
  fn: string,
  body: object,
  options: FunctionCallOptions = {},
): Promise<FunctionCallResult<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const request: Promise<FunctionCallResult<T>> = (async () => {
      const { data: { session } } = await supa().auth.getSession();
      const expectedAccountId = options.expectedAccountId?.toLowerCase();
      /* Guard the exact session snapshot whose bearer is sent. A separate
         current-user check leaves a cross-tab A -> B gap before getSession. */
      let authorization = `Bearer ${session?.access_token ?? ''}`;
      if (expectedAccountId) {
        const guardedAuthorization = authorizationForAccount(session, expectedAccountId);
        if (!guardedAuthorization) {
          return { status: 0, data: null, accountMismatch: true };
        }
        authorization = guardedAuthorization;
      }
      const response = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: authorization,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let data: T | null = null;
      try { data = await response.json(); } catch { /* empty body */ }
      return { status: response.status, data };
    })();
    const timeout = new Promise<FunctionCallResult<T>>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ status: 0, data: null });
      }, 15_000);
    });
    return await Promise.race([request, timeout]);
  } catch {
    // Transient network failure: callers retry or resync, never crash.
    return { status: 0, data: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
