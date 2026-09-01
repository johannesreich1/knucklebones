import assert from 'node:assert/strict';
import {
  rankedProgressionFromRow,
  type GroupTransitionEvent,
} from '../../src/online/api/ranked-progression-api.ts';

const eventId = '20000000-0000-4000-8000-000000000001';
const matchId = '10000000-0000-4000-8000-000000000001';
const baseEvent: GroupTransitionEvent = {
  eventId,
  matchId,
  beforePoints: 287,
  afterPoints: 333,
  beforeGroup: 'stone',
  afterGroup: 'bone',
  beforePoolTier: 'stone',
  afterPoolTier: 'bone',
  equippedRune: null,
  randomRuneMode: false,
  runeSeatUnlockedBefore: false,
  runeSeatUnlockedAfter: false,
  seenAt: null,
  curveVersion: 1,
  outcomeGrants: [],
  weeklyUnlockedBefore: false,
  weeklyUnlockedAfter: false,
  neonMedalGranted: false,
};

const event = (overrides: Partial<GroupTransitionEvent> = {}): GroupTransitionEvent => ({
  ...baseEvent,
  ...overrides,
});

export function runRankedProgressionEventCases(): number {
  /* Legacy rows default to curve v1. 5,000 points remain OBSIDIAN without
     the positional apex flag and become NEON with it. */
  const apexRow = {
    id: eventId,
    source_match_id: matchId,
    points_before: 5000,
    points_after: 5000,
    apex_before: false,
    apex_after: true,
    pool_tier_before: 'ivory',
    pool_tier_after: 'ivory',
    equipped_rune_before: 'ward',
    equipped_rune_after: 'ward',
    random_rune_mode_before: false,
    random_rune_mode_after: false,
    rune_seat_active_before: true,
    rune_seat_active_after: true,
    seen_at: null,
  };
  assert.deepEqual(rankedProgressionFromRow(apexRow), event({
    beforePoints: 5000,
    afterPoints: 5000,
    beforeGroup: 'obsidian',
    afterGroup: 'neon',
    beforePoolTier: 'ivory',
    afterPoolTier: 'ivory',
    equippedRune: 'ward',
    runeSeatUnlockedBefore: true,
    runeSeatUnlockedAfter: true,
  }));

  /* At 350 points v1 is BONE while v2 remains STONE. Exact grants are also
     normalized through the shared visible order at the parser boundary. */
  const v2Row = {
    ...apexRow,
    points_before: 350,
    points_after: 6100,
    apex_before: false,
    apex_after: true,
    pool_tier_before: 'stone',
    pool_tier_after: 'ivory',
    equipped_rune_before: null,
    equipped_rune_after: null,
    rune_seat_active_before: false,
    rune_seat_active_after: true,
    curve_version: 2,
    outcome_grants: ['limited', 'rowswitch', 'rune_trial', 'rowmult'],
    weekly_unlocked_before: false,
    weekly_unlocked_after: true,
    neon_medal_granted: true,
  };
  assert.deepEqual(rankedProgressionFromRow(v2Row), event({
    curveVersion: 2,
    beforePoints: 350,
    afterPoints: 6100,
    beforeGroup: 'stone',
    afterGroup: 'neon',
    beforePoolTier: 'stone',
    afterPoolTier: 'ivory',
    outcomeGrants: ['rowmult', 'rune_trial', 'rowswitch', 'limited'],
    runeSeatUnlockedAfter: true,
    weeklyUnlockedAfter: true,
    neonMedalGranted: true,
  }));
  assert.equal(rankedProgressionFromRow({
    ...v2Row, outcome_grants: ['rowmult', 'rowmult'],
  }), null);
  assert.equal(rankedProgressionFromRow({
    ...v2Row, weekly_unlocked_before: true, weekly_unlocked_after: false,
  }), null);
  assert.equal(rankedProgressionFromRow({ ...v2Row, curve_version: 3 }), null);
  assert.deepEqual(rankedProgressionFromRow({ ...apexRow, source_match_id: null }), event({
    matchId: null,
    beforePoints: 5000,
    afterPoints: 5000,
    beforeGroup: 'obsidian',
    afterGroup: 'neon',
    beforePoolTier: 'ivory',
    afterPoolTier: 'ivory',
    equippedRune: 'ward',
    runeSeatUnlockedBefore: true,
    runeSeatUnlockedAfter: true,
  }), 'an ON DELETE SET NULL event was rejected instead of preserving its earned transition');
  assert.equal(rankedProgressionFromRow({
    ...apexRow,
    points_before: 287,
    points_after: 333,
    apex_after: false,
    pool_tier_before: 'diamond',
    pool_tier_after: 'bone',
    equipped_rune_before: null,
    equipped_rune_after: null,
    rune_seat_active_before: false,
    rune_seat_active_after: false,
  }), null);
  return 7;
}
