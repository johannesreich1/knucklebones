import { readFileSync } from 'node:fs';
import { settleMatch, type LadderSettlement } from '../supabase/functions/_shared/settlement.ts';
import {
  withErrorBoundary,
  type AuthenticatedContext, type EdgeClient,
} from '../supabase/functions/_shared/http.ts';
import { ONLINE_AUTO_FORFEIT_STREAK } from '../src/config.ts';
import {
  AUTO_FORFEIT_STREAK, AUTO_MS,
} from '../supabase/functions/_shared/match-timing.ts';
import { createPvpClaimHandler } from '../supabase/functions/pvp-claim/handler.ts';
import type { LadderRow, MatchRow } from '../supabase/functions/_shared/types.ts';
import { deleteAccountWithSettlement } from '../supabase/functions/_shared/account-deletion.ts';

const problems: string[] = [];
const errs: string[] = [];
const check = (ok: boolean, message: string) => { if (!ok) problems.push(message); };

const row = (points: number): LadderRow => ({
  points,
  peak: points,
  wins: 1,
  losses: 1,
  draws: 0,
});

const match: MatchRow = {
  id: 'match-1',
  p1: 'player-1',
  p2: 'player-2',
  status: 'active',
  turn: 0,
  winner: null,
  p1_score: 0,
  p2_score: 0,
  p1_rating_delta: null,
  p2_rating_delta: null,
  next_die: 4,
  last_move_at: '2026-08-23T10:00:00.000Z',
  modifier: 'classic',
  season_id: 1,
  format: 'standard',
  protocol_version: 1,
  rune_rules_version: null,
  pool_tier: 'stone',
  phase: 'playing',
  trial_offer: null,
  p1_rune: null,
  p2_rune: null,
  selection_deadline: null,
  selection_version: 0,
  action_version: 0,
  pending_aim: null,
  p1_auto_streak: 0,
  p2_auto_streak: 0,
};

interface RpcReply {
  data?: unknown;
  error?: { code?: string; message: string } | null;
  before?: () => void;
}

class FakeService {
  readonly rows = new Map<string, LadderRow>([
    ['player-1', row(80)],
    ['player-2', row(40)],
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

const service = new FakeService();
service.replies = [{
  data: {
    applied: true,
    match: { ...match, status: 'done', winner: match.p1 },
    reward: { rune_id: 'ward', newly_collected: true },
  },
}];
const completed = await settleMatch(service as unknown as EdgeClient, match, {
  status: 'done',
  winner: match.p1,
  p1Score: 24,
  p2Score: 12,
  p1Result: 1,
}, calculate);

check(completed.applied && completed.match.status === 'done',
  'successful settlement did not return the terminal RPC row');
check(completed.reward?.rune_id === 'ward' && completed.reward.newly_collected,
  'settlement parser dropped the atomic Rune Trial reward');
check(service.upserts.length === 2 && service.rpcCalls.length === 1,
  'settlement did not load both ladder rows once before committing');
check(calculations.length === 1 && calculations[0].p1 === 80
  && calculations[0].p2 === 40 && calculations[0].result === 1,
  'settlement arithmetic did not receive the exact expected snapshots');
const first = service.rpcCalls[0];
check(first.p_match_id === match.id && first.p_status === 'done'
  && first.p_winner === match.p1 && first.p_p1_score === 24 && first.p_p2_score === 12,
  'atomic RPC lost terminal match fields');
check((first.p_expected_p1 as LadderRow).points === 80
  && (first.p_next_p1 as LadderRow).points === 110
  && first.p_p1_delta === 30 && first.p_p2_delta === -20,
  'atomic RPC lost expected/next ladder snapshots or deltas');

const racing = new FakeService();
racing.replies = [
  {
    error: { code: '40001', message: 'stale snapshot' },
    before: () => racing.rows.set('player-1', row(90)),
  },
  {
    data: { applied: false, match: { ...match, status: 'forfeit', winner: match.p2 } },
  },
];
const raced = await settleMatch(racing as unknown as EdgeClient, match, {
  status: 'done', winner: null, p1Score: 12, p2Score: 12, p1Result: 0.5,
}, calculate);
check(racing.rpcCalls.length === 2 && racing.upserts.length === 4,
  'serialization conflict did not reload both snapshots exactly once');
check((racing.rpcCalls[1].p_expected_p1 as LadderRow).points === 90,
  'serialization retry reused a stale ladder snapshot');
check(!raced.applied && raced.match.status === 'forfeit',
  'same-match race did not return the already-terminal row without a second payout');

const broken = new FakeService();
broken.upsertError = { message: 'write denied' };
let rejected = false;
try {
  await settleMatch(broken as unknown as EdgeClient, match, {
    status: 'forfeit', winner: match.p2, p1Score: 0, p2Score: 0, p1Result: 0,
  }, calculate);
} catch (error) {
  rejected = String(error).includes('ladder row creation failed');
}
check(rejected && broken.rpcCalls.length === 0,
  'failed ladder initialization was guessed as zero or reached the RPC');

const malformed = new FakeService();
malformed.replies = [{ data: { applied: true }, error: null }];
rejected = false;
try {
  await settleMatch(malformed as unknown as EdgeClient, match, {
    status: 'done', winner: null, p1Score: 1, p2Score: 1, p1Result: 0.5,
  }, calculate);
} catch (error) {
  rejected = String(error).includes('invalid payload');
}
check(rejected, 'malformed atomic RPC payload was accepted as a settled match');

const terminalOperations = [
  'supabase/functions/_shared/account-deletion.ts',
];
for (const file of terminalOperations) {
  const source = readFileSync(file, 'utf8');
  check(source.includes('settleMatch('), `${file} does not route its terminal path through settleMatch()`);
  check(!/\.from\("season_ratings"\)\s*\.update|\.from\("profiles"\)\s*\.update/.test(source),
    `${file} still performs a sequential ladder/profile payout outside the atomic RPC`);
}
const deletion = readFileSync('supabase/functions/_shared/account-deletion.ts', 'utf8');
check(deletion.indexOf('settleMatch(') < deletion.indexOf('deleteUser('),
  'account deletion removes auth identity before settling active opponents');

/* An escaped settlement exception must still answer the JSON+CORS error
   contract: without the shared boundary, Deno.serve answers plain text
   without CORS and a browser sees an unreadable network failure. */
const throwingHandler = withErrorBoundary(createPvpClaimHandler({
  authenticate: async () => ({
    user: { id: 'player-1' }, authed: {}, service: () => ({}),
  } as unknown as AuthenticatedContext),
  operation: async () => { throw new Error('settlement exploded'); },
}));
const escaped = await throwingHandler(new Request('https://edge.test', {
  method: 'POST', body: JSON.stringify({ match_id: 'm9' }),
}));
check(escaped.status === 500
  && (await escaped.json()).error === 'internal'
  && escaped.headers.get('access-control-allow-origin') === '*',
  'an escaped operation exception bypassed the JSON+CORS error boundary');

/* The SQL commit gates re-check the auto stall against the database clock;
   their interval literals must agree with the shared TypeScript threshold. */
const stallInterval = `interval '${AUTO_MS / 1000} seconds'`;
for (const migration of [
  'supabase/migrations/20260825205241_rune_trial_ranked_v2.sql',
  'supabase/migrations/20260826181500_match_command_stall_check.sql',
  // Recreates BOTH commit functions, so it carries both gates forward.
  'supabase/migrations/20260827160000_auto_forfeit_streak.sql',
]) {
  check(readFileSync(migration, 'utf8').includes(stallInterval),
    `${migration} stall gate drifted from the shared AUTO_MS threshold`);
}

/* The web bundle cannot import the Edge module, so it keeps its own copy of
   the away allowance to decide when to warn. The server remains the authority;
   this is the pin that stops the warning from drifting off the turn that
   actually precedes the forfeit. */
check(ONLINE_AUTO_FORFEIT_STREAK === AUTO_FORFEIT_STREAK,
  'the web away-forfeit allowance drifted from the authoritative server one: '
    + `web ${ONLINE_AUTO_FORFEIT_STREAK}, server ${AUTO_FORFEIT_STREAK}`);
const accountDeleteOperation = readFileSync('supabase/functions/account-delete/operation.ts', 'utf8');
const stageFailureGuard = accountDeleteOperation.indexOf(
  'if (error) throw new Error("apple-revocation-stage-failed")',
);
const stagedCredentialReturn = accountDeleteOperation.indexOf(
  'return { appleLinked, credentialId: data }',
);
check(stageFailureGuard !== -1 && stageFailureGuard < stagedCredentialReturn
  && accountDeleteOperation.includes('data !== null && typeof data !== "number"'),
  'account deletion can discard an Apple revocation staging failure before deleting auth identity');
check(accountDeleteOperation.includes('undoBeforeDelete')
  && accountDeleteOperation.includes('unstage_apple_revocation'),
  'a failed auth deletion leaves the staged Apple revocation for the retry cron to execute');
const unstageMigration = readFileSync(
  'supabase/migrations/20260826181000_apple_revocation_unstage.sql', 'utf8',
);
check(unstageMigration.includes('create function public.unstage_apple_revocation(p_user uuid)')
  && /set state = 'active'/.test(unstageMigration)
  && /state = 'pending'/.test(unstageMigration)
  && unstageMigration.includes(
    'grant execute on function public.unstage_apple_revocation(uuid) to service_role',
  ),
  'the unstage RPC does not return a pending revocation credential to active for the service role');

const deleting = new FakeService();
deleting.activeMatches = [{ ...match }];
deleting.replies = [{
  data: { applied: true, match: { ...match, status: 'forfeit', winner: match.p2 } },
}];
const deletingContext = {
  user: { id: match.p1 },
  authed: {},
  service: () => deleting as unknown as EdgeClient,
} as unknown as AuthenticatedContext;
const deletedResponse = await deleteAccountWithSettlement(deletingContext, calculate);
check(deletedResponse.status === 200 && deleting.deleteCalls === 1,
  'account deletion did not remove auth identity after a successful payout');
check(deleting.events.join(',') === 'prepare-delete,settle-match,delete-user',
  'account deletion did not commit opponent payout before deleting auth identity');

const payoutFailure = new FakeService();
payoutFailure.activeMatches = [{ ...match }];
payoutFailure.replies = [{ error: { code: 'XX000', message: 'payout failed' } }];
const failedDelete = await deleteAccountWithSettlement({
  ...deletingContext,
  service: () => payoutFailure as unknown as EdgeClient,
}, calculate);
check(failedDelete.status === 500
  && (await failedDelete.json()).error === 'settlement-failed'
  && payoutFailure.deleteCalls === 0,
  'account deletion removed identity after an opponent payout failure');

const lifecycleFailure = new FakeService();
const failedLifecycle = await deleteAccountWithSettlement({
  ...deletingContext,
  service: () => lifecycleFailure as unknown as EdgeClient,
}, calculate, { beforeDelete: async () => { throw new Error('vault unavailable'); } });
check(failedLifecycle.status === 500 && lifecycleFailure.deleteCalls === 0,
  'account deletion continued after its provider-revocation state could not be prepared');

/* The missing branch: staging succeeded but deleteUser failed. The account
   lives on, so the staged revocation must be compensated before the retry
   cron can revoke a live user's Sign in with Apple grant. */
const failedAuthDelete = new FakeService();
failedAuthDelete.deleteError = { message: 'auth 502' };
const undoStates: unknown[] = [];
const compensated = await deleteAccountWithSettlement({
  ...deletingContext,
  service: () => failedAuthDelete as unknown as EdgeClient,
}, calculate, {
  beforeDelete: async () => 'staged-credential',
  undoBeforeDelete: async (state) => { undoStates.push(state); },
});
check(compensated.status === 500
  && (await compensated.json()).error === 'delete-failed'
  && failedAuthDelete.deleteCalls === 1
  && undoStates.length === 1 && undoStates[0] === 'staged-credential',
  'a failed auth deletion did not unstage the provider revocation it had staged');

const throwingUndo = new FakeService();
throwingUndo.deleteError = { message: 'auth 502' };
const undoFailure = await deleteAccountWithSettlement({
  ...deletingContext,
  service: () => throwingUndo as unknown as EdgeClient,
}, calculate, {
  beforeDelete: async () => 'staged-credential',
  undoBeforeDelete: async () => { throw new Error('unstage unavailable'); },
});
check(undoFailure.status === 500 && (await undoFailure.json()).error === 'delete-failed',
  'a failed compensation changed the delete-failed contract');

console.log(JSON.stringify({ problems, errs }, null, 2));
