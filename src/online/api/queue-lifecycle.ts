// Leaving the ranked queue across a deploy skew. This is a compatibility
// DECISION, not a transport: which RPC failure means "the owner has not applied
// the migration yet", and what may stand in for the function when it does. It
// takes the client as a narrow interface so that decision can be driven without
// a live Supabase instance; match-api.ts stays a thin Edge Function seam.
import { supa } from './client.ts';

export type LeaveResult =
  | { status: 'left' }
  | { status: 'matched'; match_id: string };

interface QueueRpcError { code?: string; message?: string }
interface QueueLifecycleClient {
  rpc(name: string): Promise<{ data: unknown; error: QueueRpcError | null }>;
  auth: {
    getSession(): Promise<{
      data: { session: { user: { id: string } } | null };
      error: unknown | null;
    }>;
  };
  from(table: string): {
    delete(): {
      eq(column: string, value: string): PromiseLike<{ error: unknown | null }>;
    };
  };
}

export function isMissingQueueLifecycleRpc(error: QueueRpcError | null): boolean {
  if (!error || !['PGRST202', '42883'].includes(error.code ?? '')) return false;
  return (error.message ?? '').toLowerCase().includes('leave_ranked_queue');
}

async function legacyLeaveQueue(client: QueueLifecycleClient): Promise<LeaveResult | null> {
  const { data, error: sessionError } = await client.auth.getSession();
  const playerId = data.session?.user.id;
  if (sessionError || !playerId) return null;
  const { error } = await client.from('matchmaking_queue').delete().eq('player_id', playerId);
  return error ? null : { status: 'left' };
}

export async function leaveQueueWithClient(client: QueueLifecycleClient): Promise<LeaveResult | null> {
  let { data, error } = await client.rpc('leave_ranked_queue');
  // The web deploy can briefly precede the owner-applied migration. Only the
  // precise old-schema error falls back to the already-RLS-protected own-row
  // DELETE; authorization/outage errors are never reclassified as success.
  if (isMissingQueueLifecycleRpc(error)) return legacyLeaveQueue(client);
  if (error || data == null) ({ data, error } = await client.rpc('leave_ranked_queue'));
  if (isMissingQueueLifecycleRpc(error)) return legacyLeaveQueue(client);
  if (error || !data || typeof data !== 'object') return null;
  const result = data as Record<string, unknown>;
  if (result.status === 'left') return { status: 'left' };
  if (result.status === 'matched' && typeof result.match_id === 'string') {
    return { status: 'matched', match_id: result.match_id };
  }
  return null;
}

export async function leaveQueue(): Promise<LeaveResult | null> {
  return leaveQueueWithClient(supa() as unknown as QueueLifecycleClient);
}
