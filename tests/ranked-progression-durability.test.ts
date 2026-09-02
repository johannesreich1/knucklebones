// Red-first durability contract for the ranked result's owner-only settlement
// event. Transport uncertainty is not authoritative absence: a later result
// must be able to recover the still-unseen row, and an ACK failure must leave
// the same event retryable.
//
// Run: mise exec -- node --experimental-strip-types \
//   tests/ranked-progression-durability.test.ts
import assert from 'node:assert/strict';
import type { GroupTransitionEvent } from '../src/online/api/ranked-progression-api.ts';
import {
  rankedProgressionFromRow,
  shouldUseLegacyRankedProgressionFields,
} from '../src/online/api/ranked-progression-api.ts';

type TransportResult = {
  readonly data: unknown;
  readonly error: unknown | null;
};

type ProgressionLookup =
  | { readonly kind: 'event'; readonly event: GroupTransitionEvent }
  | { readonly kind: 'absent' }
  | { readonly kind: 'retryable' };

interface RankedProgressionRecoveryPorts {
  readForMatch(matchId: string): Promise<TransportResult>;
  /** RLS supplies the owner boundary; the client must not send a player id. */
  readUnseen(): Promise<TransportResult>;
  acknowledge(eventId: string): Promise<TransportResult>;
}

interface RankedProgressionRecovery {
  preload(matchId: string): Promise<ProgressionLookup>;
  recover(matchId: string, preloaded: ProgressionLookup): Promise<ProgressionLookup>;
  acknowledge(eventId: string): Promise<boolean>;
}

type RankedProgressionRecoveryFactory = (
  ports: RankedProgressionRecoveryPorts,
  options?: { readonly deadlineMs?: number },
) => RankedProgressionRecovery;

const api = await import('../src/online/api/ranked-progression-api.ts') as unknown as {
  readonly createRankedProgressionRecovery?: RankedProgressionRecoveryFactory;
};
const factory = api.createRankedProgressionRecovery;
const problems: string[] = [];
const check = (condition: boolean, message: string, detail?: unknown): void => {
  if (!condition) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};

const missingExtendedColumn = {
  code: 'PGRST204',
  message: "Could not find the 'curve_version' column of 'ranked_progression_events' in the schema cache",
};
check(shouldUseLegacyRankedProgressionFields(missingExtendedColumn, 1),
  'the genuine old-schema column miss did not enable the legacy projection');
check(!shouldUseLegacyRankedProgressionFields(missingExtendedColumn, 2),
  'a confirmed v2 curve fell back to a projection that drops v2 grants');
check(!shouldUseLegacyRankedProgressionFields({
  code: 'PGRST204',
  message: "Could not find the 'unrelated' column of 'ranked_progression_events' in the schema cache",
}, 1), 'an unrelated missing column enabled the progression fallback');
check(!shouldUseLegacyRankedProgressionFields({
  code: '42501', message: 'permission denied for curve_version',
}, 1), 'a permission failure was disguised as an old schema');

if (typeof factory !== 'function') {
  problems.push(
    'ranked progression has no injectable durability seam; preload errors still collapse to null',
  );
} else {
  const matchId = '10000000-0000-4000-8000-000000000001';
  const eventId = '20000000-0000-4000-8000-000000000001';
  const row = {
    id: eventId,
    source_match_id: matchId,
    points_before: 287,
    points_after: 333,
    apex_before: false,
    apex_after: false,
    pool_tier_before: 'stone',
    pool_tier_after: 'bone',
    equipped_rune_before: null,
    equipped_rune_after: null,
    random_rune_mode_before: false,
    random_rune_mode_after: false,
    rune_seat_active_before: false,
    rune_seat_active_after: false,
    seen_at: null,
  };
  const event = rankedProgressionFromRow(row);
  assert.ok(event, 'the durability fixture is not a valid progression event');
  const orphanRow = { ...row, source_match_id: null };
  const orphan = rankedProgressionFromRow(orphanRow);
  assert.ok(orphan && orphan.matchId === null,
    'an orphaned but durable progression event was rejected');
  const unused = async (): Promise<TransportResult> => ({ data: null, error: null });

  const timedOut = factory({
    readForMatch: () => new Promise<TransportResult>(() => undefined),
    readUnseen: unused,
    acknowledge: unused,
  }, { deadlineMs: 10 });
  const timeoutStarted = Date.now();
  const timeoutLookup = await timedOut.preload(matchId);
  check(timeoutLookup.kind === 'retryable' && timeoutLookup !== null
      && Date.now() - timeoutStarted < 1_000,
  'a bounded preload timeout became authoritative absence or never released the result',
  timeoutLookup);

  const thrown = factory({
    readForMatch: async () => { throw new Error('offline'); },
    readUnseen: unused,
    acknowledge: unused,
  });
  const thrownLookup = await thrown.preload(matchId);
  check(thrownLookup.kind === 'retryable' && thrownLookup !== null,
    'a thrown transport error became authoritative absence', thrownLookup);

  const errored = factory({
    readForMatch: async () => ({ data: null, error: { code: 'PGRST000' } }),
    readUnseen: unused,
    acknowledge: unused,
  });
  const errorLookup = await errored.preload(matchId);
  check(errorLookup.kind === 'retryable' && errorLookup !== null,
    'a PostgREST error became authoritative absence', errorLookup);

  const trulyAbsent = factory({
    readForMatch: unused,
    readUnseen: unused,
    acknowledge: unused,
  });
  check((await trulyAbsent.preload(matchId)).kind === 'absent',
    'a successful zero-row response was not the sole authoritative absence');

  let matchReads = 0;
  let unseenReads = 0;
  let acknowledgementAttempts = 0;
  const durable = factory({
    readForMatch: async () => {
      matchReads++;
      return matchReads === 1
        ? { data: null, error: { message: 'temporary gateway failure' } }
        : { data: null, error: null };
    },
    readUnseen: async () => {
      unseenReads++;
      return { data: row, error: null };
    },
    acknowledge: async (submittedEventId) => {
      acknowledgementAttempts++;
      check(submittedEventId === eventId,
        'acknowledgement changed the durable event identity', submittedEventId);
      return acknowledgementAttempts === 1
        ? { data: null, error: { message: 'response lost' } }
        : { data: true, error: null };
    },
  });

  const uncertainPreload = await durable.preload(matchId);
  check(uncertainPreload.kind === 'retryable',
    'the initial result forgot that its preload was uncertain', uncertainPreload);
  const recovered = await durable.recover(matchId, uncertainPreload);
  check(recovered.kind === 'event'
      && recovered.event.eventId === eventId
      && matchReads === 2 && unseenReads === 1,
  'a later result/query did not recover the owner unseen event after retrying the match read',
  { recovered, matchReads, unseenReads });

  check(!await durable.acknowledge(eventId) && acknowledgementAttempts === 1,
    'a failed ACK was reported as durable success', acknowledgementAttempts);
  const afterFailedAck = await durable.recover(matchId, { kind: 'absent' });
  check(afterFailedAck.kind === 'event'
      && afterFailedAck.event.eventId === eventId
      && unseenReads === 2,
  'a failed ACK made the still-unseen owner event unrecoverable',
  { afterFailedAck, unseenReads });
  check(await durable.acknowledge(eventId) && acknowledgementAttempts === 2,
    'the same event ACK could not be retried after transport failure', acknowledgementAttempts);

  let orphanAcknowledged = '';
  const orphanRecovery = factory({
    readForMatch: unused,
    readUnseen: async () => ({ data: orphanRow, error: null }),
    acknowledge: async (submittedEventId) => {
      orphanAcknowledged = submittedEventId;
      return { data: true, error: null };
    },
  });
  const recoveredOrphan = await orphanRecovery.recover(matchId, { kind: 'absent' });
  check(recoveredOrphan.kind === 'event' && recoveredOrphan.event.matchId === null,
    'the oldest orphan event blocked unseen recovery', recoveredOrphan);
  check(recoveredOrphan.kind === 'event'
      && await orphanRecovery.acknowledge(recoveredOrphan.event.eventId)
      && orphanAcknowledged === eventId,
  'an orphan event could not be durably acknowledged by its own event id', orphanAcknowledged);
}

console.log(JSON.stringify({ problems }, null, 2));
if (problems.length) process.exitCode = 1;
