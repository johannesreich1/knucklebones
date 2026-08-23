import {
  historyPageArgs,
  leaderboardBeforePageArgs,
  leaderboardPageArgs,
} from '../src/online/ladder-api.ts';
import { readFileSync } from 'node:fs';
import { createRunGeneration } from '../src/online/run-generation.ts';
import { createQueueCancellation } from '../src/online/queue-cancellation.ts';
import { createInitialSyncBoundary } from '../src/online/initial-sync.ts';
import { readMatchSyncSnapshot } from '../src/online/match-sync.ts';
import { randomUuid } from '../src/online/random-id.ts';
import {
  isMissingQueueLifecycleRpc,
  leaveQueueWithClient,
} from '../src/online/match-api.ts';

const problems: string[] = [];
const check = (condition: boolean, message: string, detail?: unknown) => {
  if (!condition) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};

const first = historyPageArgs(30);
check(JSON.stringify(first) === JSON.stringify({ limit_n: 30 }),
  'the first history page must not invent a cursor', first);

const cursor = { when: '2026-08-23T12:00:00.000Z', id: '00000000-0000-4000-8000-000000000042' };
const next = historyPageArgs(30, cursor);
check(next.before_t === cursor.when && next.before_id === cursor.id,
  'history pagination must send both members of the stable cursor', next);
check(Object.keys(next).sort().join(',') === 'before_id,before_t,limit_n',
  'history pagination sent an unexpected RPC argument', next);

const ladder = leaderboardPageArgs(25, 76, 'ZestyFalcon614');
check(JSON.stringify(ladder) === JSON.stringify({
  limit_n: 25,
  from_rank: 76,
  after_nickname: 'ZestyFalcon614',
}),
  'leaderboard pagination must match the SQL RPC argument names', ladder);
check(!('after_nickname' in leaderboardPageArgs(25, 76)),
  'the first leaderboard window must include its requested rank');

const ladderBefore = leaderboardBeforePageArgs(25, 76, 'ZestyFalcon614');
check(JSON.stringify(ladderBefore) === JSON.stringify({
  limit_n: 25,
  before_rank: 76,
  before_nickname: 'ZestyFalcon614',
}),
  'reverse leaderboard pagination must send both members of the stable cursor', ladderBefore);

/* A boolean cancellation flag can become "active" again when a replacement
   run starts. Generations only move forward, so neither cancel nor begin can
   let an older await inherit the replacement run. */
const runs = createRunGeneration();
const firstRun = runs.begin();
check(runs.owns(firstRun), 'a newly begun queue run does not own itself');
runs.cancel();
check(!runs.owns(firstRun), 'cancelled queue work became current again');
const secondRun = runs.begin();
const thirdRun = runs.begin();
check(secondRun > firstRun && thirdRun > secondRun,
  'queue run generations are not monotonic', { firstRun, secondRun, thirdRun });
check(!runs.owns(firstRun) && !runs.owns(secondRun) && runs.owns(thirdRun),
  'a replacement queue run did not exclusively invalidate older awaits');

const deterministicUuid = randomUuid((bytes) => {
  bytes.set(Array.from({ length: 16 }, (_, index) => index));
});
check(deterministicUuid === '00010203-0405-4607-8809-0a0b0c0d0e0f'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(deterministicUuid),
  'the iOS-14-compatible command/nonce generator is not RFC 4122 UUIDv4', deterministicUuid);

const matchApiSource = readFileSync('src/online/match-api.ts', 'utf8');
const moveTransport = matchApiSource.slice(
  matchApiSource.indexOf('async function moveCommand'),
  matchApiSource.indexOf('export async function move('),
);
check(!moveTransport.includes('status === 0')
  && (moveTransport.match(/callFunction<MoveResult>\('pvp-move'/g) ?? []).length === 1,
  'new web can automatically replay a move against the old non-idempotent Edge Function');
const playSource = readFileSync('src/online/play.ts', 'utf8');
check(playSource.includes('sync: () => sync(true)') && !playSource.includes('if (res.rejoined)'),
  'fresh matches do not sync a possible old-backend bot opening move before input');

let initialAttempts = 0;
let initialReady = 0;
let initialWaiting = 0;
const initialSync = createInitialSyncBoundary({
  sync: async () => ++initialAttempts === 2,
  owns: () => true,
  onReady: () => { initialReady++; },
  onWaiting: () => { initialWaiting++; },
});
check(await initialSync.start() && initialAttempts === 2 && initialReady === 1
  && initialWaiting === 0 && !initialSync.pending(),
  'initial match sync did not use its bounded second attempt before opening input');
check(await initialSync.retry() && initialAttempts === 2 && initialReady === 1,
  'a completed initial sync performed more network work on watchdog retry');

let failedAttempts = 0;
const failedInitial = createInitialSyncBoundary({
  sync: async () => { failedAttempts++; return false; }, owns: () => true,
  onReady: () => undefined, onWaiting: () => { initialWaiting++; },
});
check(!await failedInitial.start() && failedAttempts === 2 && failedInitial.pending(),
  'failed initial sync exceeded its bounded entry retry budget', failedAttempts);
check(!await failedInitial.retry() && failedAttempts === 3,
  'watchdog recovery did not perform exactly one paced retry', failedAttempts);

let projectionReads = 0;
const readProjection = () => readMatchSyncSnapshot({
  moves: async () => ({ data: [] as Array<{ idx: number }>, error: null }),
  match: async () => ++projectionReads === 1
    ? { data: null, error: new Error('temporary match read failure') }
    : { data: { turn: 1 }, error: null },
});
check(await readProjection() === null,
  'a sync succeeded without an authoritative match projection');
const recoveredProjection = await readProjection();
check(recoveredProjection?.match.turn === 1 && projectionReads === 2,
  'an empty move-log delta permanently skipped projection recovery',
  { recoveredProjection, projectionReads });

/* A web release may briefly run against the preceding database schema. Only
   PostgREST's exact missing-function response may use the legacy RLS DELETE;
   arbitrary permission/outage errors must remain failures. */
const missingRpc = { code: 'PGRST202', message: 'Could not find public.leave_ranked_queue in the schema cache' };
check(isMissingQueueLifecycleRpc(missingRpc)
  && !isMissingQueueLifecycleRpc({ code: '42501', message: 'leave_ranked_queue permission denied' }),
  'queue lifecycle fallback did not narrowly classify the old-schema error');
let fallbackRpcCalls = 0;
const fallbackDeletes: Array<[string, string]> = [];
const fallback = await leaveQueueWithClient({
  rpc: async () => { fallbackRpcCalls++; return { data: null, error: missingRpc }; },
  auth: { getSession: async () => ({
    data: { session: { user: { id: 'player-1' } } }, error: null,
  }) },
  from: () => ({ delete: () => ({
    eq: async (column: string, value: string) => {
      fallbackDeletes.push([column, value]);
      return { error: null };
    },
  }) }),
});
check(fallback?.status === 'left' && fallbackRpcCalls === 1
  && JSON.stringify(fallbackDeletes) === JSON.stringify([['player_id', 'player-1']]),
  'missing lifecycle RPC did not fall back to one authenticated own-row delete',
  { fallback, fallbackRpcCalls, fallbackDeletes });

let retryCalls = 0;
const retriedLeave = await leaveQueueWithClient({
  rpc: async () => ({
    data: ++retryCalls === 2 ? { status: 'left' } : null,
    error: retryCalls === 1 ? { code: '503', message: 'temporary outage' } : null,
  }),
  auth: { getSession: async () => ({ data: { session: null }, error: null }) },
  from: () => ({ delete: () => ({ eq: async () => ({ error: null }) }) }),
});
check(retriedLeave?.status === 'left' && retryCalls === 2,
  'queue leave did not perform exactly one bounded retry', { retriedLeave, retryCalls });

/* Cancellation calls are a serial boundary: the second leave represents the
   cleanup that runs after an in-flight join settles. It may not finish late
   and erase a replacement run that already enqueued. */
let releaseFirstLeave!: () => void;
const firstLeaveGate = new Promise<void>((resolve) => { releaseFirstLeave = resolve; });
let leaveCalls = 0;
const serialCancellation = createQueueCancellation({
  leaveQueue: async () => {
    leaveCalls++;
    if (leaveCalls === 1) await firstLeaveGate;
    return { status: 'left' };
  },
  resign: () => undefined,
  resignedOver: async () => true,
});
const firstCleanup = serialCancellation.cleanup();
const settledCleanup = serialCancellation.cleanup({ status: 'queued' });
await Promise.resolve();
check(leaveCalls === 1, 'cancel cleanups ran concurrently across the join race', leaveCalls);
releaseFirstLeave();
await Promise.all([firstCleanup, settledCleanup]);
check(leaveCalls === 2, 'a queued join result did not receive post-settlement cleanup', leaveCalls);

/* If matching committed before cancellation, either the lifecycle RPC or the
   join response can discover it. Both routes converge on one confirmed resign
   rather than stranding the opponent or sending duplicate forfeits. */
const resigned: string[] = [];
const confirmed: string[] = [];
const matchedCancellation = createQueueCancellation({
  leaveQueue: async () => ({ status: 'matched', match_id: 'race-match' }),
  resign: (matchId) => { resigned.push(matchId); },
  resignedOver: async (matchId) => { confirmed.push(matchId); return true; },
});
await matchedCancellation.cleanup();
await matchedCancellation.cleanup({ status: 'matched', match: { id: 'race-match' } });
check(resigned.join(',') === 'race-match' && confirmed.join(',') === 'race-match',
  'matched cancellation did not converge on one confirmed resign', { resigned, confirmed });

console.log(JSON.stringify({ problems, errs: [] }, null, 2));
process.exit(problems.length ? 1 : 0);
