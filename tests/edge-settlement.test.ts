import { readFileSync } from 'node:fs';
import { settleMatch } from '../supabase/functions/_shared/settlement.ts';
import {
  withErrorBoundary,
  type AuthenticatedContext, type EdgeClient,
} from '../supabase/functions/_shared/http.ts';
import { ONLINE_AUTO_FORFEIT_STREAK } from '../src/config.ts';
import {
  AUTO_FORFEIT_STREAK, AUTO_MS,
} from '../supabase/functions/_shared/match-timing.ts';
import { createPvpClaimHandler } from '../supabase/functions/pvp-claim/handler.ts';
import type { LadderRow } from '../supabase/functions/_shared/types.ts';
import { ladderRow, standardMatch } from './support/edge-operations.ts';
import { SettlementService, createRecordingSettlement } from './support/edge-settlement-doubles.ts';
import {
  assertDeletionLifecycle, assertDeletionSourceContract,
} from './support/account-deletion-cases.ts';

const problems: string[] = [];
const errs: string[] = [];
const check = (ok: boolean, message: string) => { if (!ok) problems.push(message); };

/* The match every settlement below is committed for: the shared ranked row,
   pinned to turn 0 with a fixed last_move_at so the RPC inputs this suite
   compares against are stable. */
const match = standardMatch({
  turn: 0, p1_score: 0, p2_score: 0, last_move_at: '2026-08-23T10:00:00.000Z',
});
const { calculate, calculations } = createRecordingSettlement();

const service = new SettlementService();
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

const racing = new SettlementService();
racing.replies = [
  {
    error: { code: '40001', message: 'stale snapshot' },
    before: () => racing.rows.set('player-1', ladderRow(90)),
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

const broken = new SettlementService();
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

const malformed = new SettlementService();
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

assertDeletionSourceContract(check);
await assertDeletionLifecycle(check);

console.log(JSON.stringify({ problems, errs }, null, 2));
