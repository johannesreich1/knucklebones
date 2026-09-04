import assert from 'node:assert/strict';
import { progressionStatusFromRpc } from '../src/online/api/progression-status-api.ts';
import {
  PROGRESSION_STATUS_CACHE_KEY,
  RANKED_CURVE_CACHE_KEY,
  activeWeeklyChallenge,
  clearProgressionStatusSnapshot,
  confirmedLadderCurveVersion,
  confirmedRankedOutcomeEntitlements,
  readProgressionStatusSnapshot,
  readRankedCurveSnapshot,
  writeProgressionStatusSnapshot,
} from '../src/progression-status-cache.ts';

const values = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
};

const account = '11111111-2222-4333-8444-555555555555';
const other = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
/* AN UNCONFIRMED CLIENT ASSUMES THE ONLY CURVE THERE IS. This asserted 1, and
   that was right while v1 could still be the live contract: answering 2 without
   proof would have shown v2 points and unlocks to a player the server had not
   yet remapped. Production activated v2 on 2026-09-04 and the activation cannot
   be rolled back, so there is no longer a v1 to fail toward — and failing to it
   is not caution any more, it is a wrong answer. It reached a player: someone
   who never creates an account never authenticates at boot and never enters
   ranked, so nothing ever confirms the curve, and their offline mode picker
   offered Limited (a GOLD unlock under v2) while withholding Bounty (which
   STONE grants). Signed-out boot stays offline; this costs no request. */
assert.equal(confirmedLadderCurveVersion(), 2,
  'an unconfirmed client fell back to the retired v1 curve');
assert.equal(confirmedRankedOutcomeEntitlements(account), null);

const v2 = progressionStatusFromRpc({
  curve_version: 2,
  scoring_version: 2,
  admission_paused: false,
  outcomes: ['limited', 'classic', 'bounty'],
  weekly_unlocked: true,
  pending_bot_debuts: ['limited'],
  neon_medal_seasons: [2, 5],
  weekly: {
    rotation_id: '2026-W36',
    starts_at: '2026-08-31T00:00:00.000Z',
    ends_at: '2026-09-07T00:00:00.000Z',
    modifier: 'rowmult',
    completed: false,
  },
});
assert.ok(v2, 'a complete v2 progression response was rejected');
assert.equal(activeWeeklyChallenge(v2, Date.parse('2026-08-31T00:00:00.000Z'))?.modifier,
  'rowmult', 'the weekly window was not active at its inclusive start');
assert.equal(activeWeeklyChallenge(v2, Date.parse('2026-09-07T00:00:00.000Z')), null,
  'the expired weekly window remained active at its exclusive end');
assert.equal(activeWeeklyChallenge(v2, Date.parse('2026-08-30T23:59:59.999Z')), null,
  'a future weekly window was exposed before its start');
assert.deepEqual(v2?.neonMedalSeasons, [2, 5]);
for (const [starts_at, ends_at] of [
  ['2026-09-07T00:00:00.000Z', '2026-08-31T00:00:00.000Z'],
  ['2026-08-31T00:00:00.000Z', '2026-09-06T00:00:00.000Z'],
] as const) {
  assert.equal(progressionStatusFromRpc({
    curve_version: 2,
    scoring_version: 2,
    admission_paused: false,
    outcomes: ['classic'],
    weekly_unlocked: true,
    pending_bot_debuts: [],
    neon_medal_seasons: [],
    weekly: {
      rotation_id: 'bad-window', starts_at, ends_at, modifier: 'rowmult', completed: false,
    },
  }), null, 'a malformed weekly window entered the RPC contract');
}
assert.equal(progressionStatusFromRpc({
  curve_version: 2,
  scoring_version: 2,
  admission_paused: false,
  outcomes: ['classic'],
  weekly_unlocked: false,
  pending_bot_debuts: [],
  neon_medal_seasons: [],
  weekly: {
    rotation_id: 'unexpected-weekly',
    starts_at: '2026-08-31T00:00:00.000Z',
    ends_at: '2026-09-07T00:00:00.000Z',
    modifier: 'rowmult',
    completed: false,
  },
}), null, 'a weekly rotation was accepted without durable weekly access');
assert.equal(progressionStatusFromRpc({
  curve_version: 2,
  scoring_version: 1,
  admission_paused: false,
  outcomes: ['classic'],
  weekly_unlocked: false,
  pending_bot_debuts: [],
  neon_medal_seasons: [],
  weekly: null,
}), null, 'a mismatched public curve/scoring contract was accepted');
assert.equal(progressionStatusFromRpc({
  curve_version: 2,
  scoring_version: 2,
  admission_paused: false,
  outcomes: ['classic'],
  weekly_unlocked: false,
  pending_bot_debuts: [],
  weekly: null,
}), null, 'a v2 response without its durable medal field was accepted');
assert.equal(progressionStatusFromRpc({
  curve_version: 2,
  scoring_version: 2,
  admission_paused: false,
  outcomes: ['classic', 'classic'],
  weekly_unlocked: false,
  pending_bot_debuts: [],
  neon_medal_seasons: [],
  weekly: null,
}), null, 'duplicate server-confirmed outcomes were silently normalized');
assert.deepEqual(progressionStatusFromRpc({
  curve_version: 1,
  scoring_version: 1,
  admission_paused: false,
  outcomes: ['classic'],
  weekly_unlocked: false,
  pending_bot_debuts: [],
  weekly: null,
})?.neonMedalSeasons, [], 'the explicit v1 RPC fallback invented a medal');

assert.equal(writeProgressionStatusSnapshot({
  accountId: account,
  curveVersion: 2,
  scoringVersion: 2,
  admissionPaused: false,
  outcomes: v2!.outcomes,
  weeklyUnlocked: v2!.weeklyUnlocked,
  pendingBotDebuts: v2!.pendingBotDebuts,
  neonMedalSeasons: v2!.neonMedalSeasons,
  weekly: v2!.weekly,
}, 123), true);
assert.equal(confirmedLadderCurveVersion(), 2);
assert.equal(readRankedCurveSnapshot()?.curveVersion, 2,
  'account status did not independently persist its server-confirmed public curve');
assert.deepEqual(confirmedRankedOutcomeEntitlements(account), ['limited', 'classic', 'bounty'],
  'the v2 cache replaced explicit grandfathered entitlements with a tier');
assert.equal(confirmedRankedOutcomeEntitlements(other), null,
  'one account consumed another account’s confirmed outcome entitlements');
assert.equal(confirmedRankedOutcomeEntitlements('not-an-account'), null);
assert.deepEqual(readProgressionStatusSnapshot()?.neonMedalSeasons, [2, 5]);

const validSnapshot = readProgressionStatusSnapshot();
values.set(PROGRESSION_STATUS_CACHE_KEY, JSON.stringify({
  ...validSnapshot,
  weekly: {
    ...validSnapshot?.weekly,
    endsAt: '2026-09-06T00:00:00.000Z',
  },
}));
assert.equal(readProgressionStatusSnapshot(), null,
  'a shortened cached weekly rotation survived strict cache parsing');
values.set(PROGRESSION_STATUS_CACHE_KEY, JSON.stringify(validSnapshot));
values.set(PROGRESSION_STATUS_CACHE_KEY, JSON.stringify({
  ...validSnapshot,
  scoringVersion: 1,
}));
assert.equal(readProgressionStatusSnapshot(), null,
  'a cached mismatched curve/scoring contract was accepted');
assert.equal(confirmedLadderCurveVersion(), 2,
  'invalid account status erased the independently confirmed public curve');

values.set(PROGRESSION_STATUS_CACHE_KEY, JSON.stringify(validSnapshot));
values.set(PROGRESSION_STATUS_CACHE_KEY, JSON.stringify({
  ...readProgressionStatusSnapshot(),
  neonMedalSeasons: [5, 2],
}));
assert.equal(readProgressionStatusSnapshot(), null,
  'an unordered durable medal list entered the eager cache');
assert.equal(confirmedLadderCurveVersion(), 2,
  'invalid account entitlements erased the independent public curve');

assert.equal(clearProgressionStatusSnapshot(), true);
assert.equal(values.has(PROGRESSION_STATUS_CACHE_KEY), false);
assert.equal(confirmedLadderCurveVersion(), 2,
  'sign-out cleared the public curve needed to classify cached mapped points');
assert.equal(confirmedRankedOutcomeEntitlements(account), null,
  'sign-out retained account-owned exact outcome entitlements');

values.set(RANKED_CURVE_CACHE_KEY, JSON.stringify({
  version: 1,
  confirmedAt: 456,
  curveVersion: 3,
}));
/* A malformed cache is not a v1 reading, it is NO reading — cachedLadderCurve-
   Version rejects the 3 above and answers null — so this lands on the same
   default as a clean device, and for the same reason: v2 is the only curve
   production has. What the check still proves is that a nonsense value is
   refused rather than believed; a cached 3 must never classify anything. */
assert.equal(confirmedLadderCurveVersion(), 2,
  'a malformed public curve was believed instead of discarded');
console.log(JSON.stringify({ problems: [] }));
