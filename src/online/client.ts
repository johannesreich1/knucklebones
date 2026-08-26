// Lazy Supabase transport shared by the ranked feature. Keeping construction
// and Edge Function HTTP here prevents auth, ladder, and match APIs from each
// inventing their own session/header behavior.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from '../config.ts';

let client: SupabaseClient | null = null;

export function supa(): SupabaseClient {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_KEY);
  return client;
}

export async function callFunction<T>(fn: string, body: object): Promise<{ status: number; data: T | null }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const request = (async () => {
      const { data: { session } } = await supa().auth.getSession();
      const response = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let data: T | null = null;
      try { data = await response.json(); } catch { /* empty body */ }
      return { status: response.status, data };
    })();
    const timeout = new Promise<{ status: number; data: T | null }>((resolve) => {
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
