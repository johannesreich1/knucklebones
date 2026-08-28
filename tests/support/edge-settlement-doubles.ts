// THE RECORDING DOUBLES THE SETTLEMENT PATH IS DRIVEN AGAINST.
//
// settleMatch() is only observable through what it asks the database for, in
// what order, and with which snapshots — so this double records every RPC
// input and every season_ratings write instead of pretending a database
// answered. Its settle_match / settle_match_checked replies are a QUEUE with a
// `before` hook, and that hook is what makes the serialization-conflict retry
// testable at all: it changes the ladder underneath the first attempt, so the
// second attempt has to prove it reloaded rather than reusing a stale
// snapshot. Account deletion reaches settlement through the same client, so
// prepare_account_deletion and auth.admin.deleteUser record onto the same
// `events` tape as the settle RPC itself — that tape is the only way to see
// that the payout committed BEFORE the auth identity was removed.
import type { LadderSettlement } from '../../supabase/functions/_shared/settlement.ts';
import type { LadderRow, MatchRow } from '../../supabase/functions/_shared/types.ts';
import { ladderRow } from './edge-operations.ts';

export interface RpcReply {
  data?: unknown;
  error?: { code?: string; message: string } | null;
  before?: () => void;
}

export class SettlementService {
  readonly rows = new Map<string, LadderRow>([
    ['player-1', ladderRow(80)],
    ['player-2', ladderRow(40)],
  ]);
  readonly rpcCalls: Array<Record<string, unknown>> = [];
  readonly upserts: Array<Record<string, unknown>> = [];
  readonly events: string[] = [];
  replies: RpcReply[] = [];
  activeMatches: MatchRow[] = [];
  activeError: { message: string } | null = null;
  upsertError: { message: string } | null = null;
  readError: { message: string } | null = null;
  deleteError: { message: string } | null = null;
  deleteCalls = 0;

  auth = {
    admin: {
      deleteUser: async (_player: string) => {
        this.events.push('delete-user');
        this.deleteCalls++;
        return { error: this.deleteError };
      },
    },
  };

  from(table: string) {
    if (table === 'matches') {
      return {
        select: (_columns: string) => {
          const query = {
            eq: (_column: string, _value: unknown) => query,
            or: async (_filter: string) => ({ data: this.activeMatches, error: this.activeError }),
          };
          return query;
        },
      };
    }
    if (table !== 'season_ratings') throw new Error(`unexpected table ${table}`);
    return {
      upsert: async (value: Record<string, unknown>) => {
        this.upserts.push(value);
        return { error: this.upsertError };
      },
      select: (_columns: string) => {
        const filters = new Map<string, unknown>();
        const query = {
          eq: (column: string, value: unknown) => {
            filters.set(column, value);
            return query;
          },
          maybeSingle: async () => ({
            data: this.readError ? null : this.rows.get(String(filters.get('player'))) ?? null,
            error: this.readError,
          }),
        };
        return query;
      },
    };
  }

  async rpc(name: string, input: Record<string, unknown>) {
    if (name === 'prepare_account_deletion') {
      this.events.push('prepare-delete');
      return { data: this.activeError ? null : this.activeMatches, error: this.activeError };
    }
    if (name !== 'settle_match' && name !== 'settle_match_checked') {
      throw new Error(`unexpected RPC ${name}`);
    }
    this.events.push('settle-match');
    this.rpcCalls.push(input);
    const reply = this.replies.shift() ?? { data: null, error: null };
    reply.before?.();
    return { data: reply.data ?? null, error: reply.error ?? null };
  }
}

/** A settlement calculator that records the exact snapshots it was handed.
    Every caller gets its OWN log: `calculations.length === 1` means "this
    settlement paid out once, from these two rows", and that only stays true
    while no other suite can append to the same array. */
export function createRecordingSettlement() {
  const calculations: Array<{ p1: number; p2: number; result: number }> = [];
  const calculate: LadderSettlement = (p1, p2, result) => {
    calculations.push({ p1: p1.points, p2: p2.points, result });
    return {
      da: 30,
      db: -20,
      a: { ...p1, points: p1.points + 30, peak: Math.max(p1.peak, p1.points + 30), wins: p1.wins + 1 },
      b: { ...p2, points: Math.max(0, p2.points - 20), losses: p2.losses + 1 },
    };
  };
  return { calculate, calculations };
}
