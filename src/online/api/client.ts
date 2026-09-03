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

/** How long any single read may take before the screen stops waiting for it.
 * The same budget Edge Function calls have always had. */
export const READ_TIMEOUT_MS = 15_000;

/* PostgREST reads carry no timeout of their own: a hung connection simply
   never settles, and the screen waiting on it waits forever with no error to
   show and no retry to offer. Give every read that a player is watching the
   same deadline the function calls have, and let it fail like any other
   refused read so the caller's existing failure path can run. */
export async function readWithin<T, Timeout>(
  run: (signal: AbortSignal) => PromiseLike<T>,
  timedOut: () => Timeout,
): Promise<T | Timeout> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  /* RACE the deadline rather than only signalling it. A signal binds the reads
     that accept one, but the session read cannot take a signal at all
     (getSession has no such parameter) and retries a lost connection on its
     own for as long as its tick allows. Cancelling what can be cancelled and
     answering anyway is what makes this budget true for every caller. */
  const deadline = new Promise<Timeout>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(timedOut());
    }, READ_TIMEOUT_MS);
  });
  const attempt = (async () => {
    try {
      return await run(controller.signal);
    } catch {
      return timedOut();
    }
  })();
  try {
    return await Promise.race([attempt, deadline]);
  } finally {
    clearTimeout(timer);
  }
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
