// The ranked result's mandatory group-transition deck is planned from one
// normalized, authoritative settlement event. Presentation consumes stable
// group/outcome ids; it does not infer a crossing from cached profile state or
// duplicate the ranked outcome registry.
//
// Red-first owner for src/online/screens/group-transition-model.ts.
// Run: mise exec -- node --experimental-strip-types tests/group-transition.test.ts
import assert from 'node:assert/strict';
import { RANKED_POOL_TIERS, type RankedPoolTier } from '../src/core/ranked-outcomes.ts';
import type { LadderGroupId } from '../src/i18n/display.ts';
import { rankedProgressionFromRow } from '../src/online/api/ranked-progression-api.ts';
import { groupTransitionSlides } from '../src/online/screens/group-transition-model.ts';

type TransitionEvent = {
  eventId: string;
  matchId: string;
  beforePoints: number;
  afterPoints: number;
  beforeGroup: LadderGroupId;
  afterGroup: LadderGroupId;
  beforePoolTier: RankedPoolTier;
  afterPoolTier: RankedPoolTier;
  equippedRune: string | null;
  randomRuneMode: boolean;
  runeLiveBefore: boolean;
  runeLiveAfter: boolean;
  seenAt: string | null;
};

const base: TransitionEvent = {
  eventId: '20000000-0000-4000-8000-000000000001',
  matchId: '10000000-0000-4000-8000-000000000001',
  beforePoints: 287,
  afterPoints: 333,
  beforeGroup: 'stone',
  afterGroup: 'bone',
  beforePoolTier: 'stone',
  afterPoolTier: 'bone',
  equippedRune: null,
  randomRuneMode: false,
  runeLiveBefore: false,
  runeLiveAfter: false,
  seenAt: null,
};

const event = (overrides: Partial<TransitionEvent> = {}): TransitionEvent => ({
  ...base,
  ...overrides,
});

const group = (
  direction: 'promotion' | 'demotion',
  from: LadderGroupId,
  to: LadderGroupId,
) => ({ kind: 'group', direction, from, to });

const tier = (id: RankedPoolTier) => {
  const found = RANKED_POOL_TIERS.find((candidate) => candidate.id === id);
  assert.ok(found, `missing ranked pool tier ${id}`);
  return found;
};
const additions = (before: RankedPoolTier, after: RankedPoolTier) =>
  tier(after).outcomeIds.filter((id) => !tier(before).outcomeIds.includes(id));

/* The first BONE crossing teaches precisely the permanent additions, in the
   registry's presentation order. There is no copied mode-name list here. */
const boneAdditions = additions('stone', 'bone');
assert.deepEqual(boneAdditions, ['rowswitch', 'rowmult', 'bounty']);
assert.deepEqual(groupTransitionSlides(event()), [
  group('promotion', 'stone', 'bone'),
  ...boneAdditions.map((outcomeId) => ({ kind: 'outcome', outcomeId })),
]);

/* Crossing the same boundary again still acknowledges the visible group, but
   a permanent pool that was already BONE must not reteach its three modes. */
assert.deepEqual(groupTransitionSlides(event({
  beforePoolTier: 'bone',
  afterPoolTier: 'bone',
})), [group('promotion', 'stone', 'bone')]);
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 333,
  afterPoints: 287,
  beforeGroup: 'bone',
  afterGroup: 'stone',
  beforePoolTier: 'bone',
  afterPoolTier: 'bone',
})), [group('demotion', 'bone', 'stone')]);

/* IVORY adds the Classic-backed Rune Ritual outcome once, through the same
   stable outcome vocabulary as ordinary modes. */
const ivoryAdditions = additions('bone', 'ivory');
assert.deepEqual(ivoryAdditions, ['rune_trial']);
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 701,
  afterPoints: 761,
  beforeGroup: 'bone',
  afterGroup: 'ivory',
  beforePoolTier: 'bone',
  afterPoolTier: 'ivory',
})), [
  group('promotion', 'bone', 'ivory'),
  { kind: 'outcome', outcomeId: 'rune_trial' },
]);
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 701,
  afterPoints: 761,
  beforeGroup: 'bone',
  afterGroup: 'ivory',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
})), [group('promotion', 'bone', 'ivory')]);
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 761,
  afterPoints: 701,
  beforeGroup: 'ivory',
  afterGroup: 'bone',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
})), [group('demotion', 'ivory', 'bone')]);

/* SILVER changes whether runes CAN enter ordinary ranked matches. That league
   capability belongs to every player, including somebody who has not won a
   rune yet; the interactive profile handoff branches on the real collection. */
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 1240,
  afterPoints: 1300,
  beforeGroup: 'ivory',
  afterGroup: 'silver',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
  equippedRune: 'ward',
  runeLiveBefore: false,
  runeLiveAfter: true,
})), [
  group('promotion', 'ivory', 'silver'),
  { kind: 'rune-seat', state: 'active' },
]);
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 1274,
  afterPoints: 1211,
  beforeGroup: 'silver',
  afterGroup: 'ivory',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
  equippedRune: 'ward',
  randomRuneMode: true,
  runeLiveBefore: true,
  runeLiveAfter: false,
})), [
  group('demotion', 'silver', 'ivory'),
  { kind: 'rune-seat', state: 'resting' },
]);

/* An empty collection must never fabricate a default. The generic SILVER
   capability slide still appears, while presentation keeps Continue and skips
   the Profile tutorial until a first rune really exists. */
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 1240,
  afterPoints: 1300,
  beforeGroup: 'ivory',
  afterGroup: 'silver',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
  equippedRune: null,
  randomRuneMode: false,
  runeLiveBefore: false,
  runeLiveAfter: false,
})), [
  group('promotion', 'ivory', 'silver'),
  { kind: 'rune-seat', state: 'active' },
]);

assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 1274,
  afterPoints: 1211,
  beforeGroup: 'silver',
  afterGroup: 'ivory',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
  equippedRune: null,
  randomRuneMode: false,
  runeLiveBefore: false,
  runeLiveAfter: false,
})), [
  group('demotion', 'silver', 'ivory'),
  { kind: 'rune-seat', state: 'resting' },
]);

/* A large authoritative step that crosses SILVER gets the same capability
   slide once; it is the boundary, not an exact IVORY/SILVER pair, that owns it. */
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 1240,
  afterPoints: 2100,
  beforeGroup: 'ivory',
  afterGroup: 'gold',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
})), [
  group('promotion', 'ivory', 'gold'),
  { kind: 'rune-seat', state: 'active' },
]);

/* Crossings which neither advance the permanent pool nor change rune
   availability remain a one-slide group acknowledgement. */
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 2040,
  afterPoints: 1980,
  beforeGroup: 'gold',
  afterGroup: 'silver',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
  equippedRune: 'ward',
  runeLiveBefore: true,
  runeLiveAfter: true,
})), [group('demotion', 'gold', 'silver')]);

/* NEON is positional. An authoritative top-one-percent change is real even
   when the player's points did not move, so points may never be used as the
   sole transition detector. */
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 5000,
  afterPoints: 5000,
  beforeGroup: 'obsidian',
  afterGroup: 'neon',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
  runeLiveBefore: true,
  runeLiveAfter: true,
})), [group('promotion', 'obsidian', 'neon')]);
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 5000,
  afterPoints: 5000,
  beforeGroup: 'neon',
  afterGroup: 'obsidian',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
  runeLiveBefore: true,
  runeLiveAfter: true,
})), [group('demotion', 'neon', 'obsidian')]);
/* The positional fact also outranks point direction. Population/rank changes
   can move the 1% boundary independently of one player's own step; rejecting
   that authoritative apex transition would make NEON only approximately
   correct. */
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 5000,
  afterPoints: 4980,
  beforeGroup: 'obsidian',
  afterGroup: 'neon',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
})), [group('promotion', 'obsidian', 'neon')]);
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 5000,
  afterPoints: 5020,
  beforeGroup: 'neon',
  afterGroup: 'obsidian',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
})), [group('demotion', 'neon', 'obsidian')]);

/* Point movement inside one group does not open a mandatory deck. A durable
   event already acknowledged by seenAt is likewise not presented again. */
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 210,
  afterPoints: 270,
  beforeGroup: 'stone',
  afterGroup: 'stone',
  beforePoolTier: 'stone',
  afterPoolTier: 'stone',
})), []);
assert.deepEqual(groupTransitionSlides(event({
  seenAt: '2026-08-30T12:00:00.000Z',
})), []);

/* Malformed or internally contradictory server data fails closed. It must not
   throw over a ranked result and must not fabricate a direction or unlock. */
const invalidEvents: readonly unknown[] = [
  event({ matchId: '' }),
  event({ beforePoints: -1 }),
  event({ beforePoints: 333, afterPoints: 287 }),
  event({
    beforePoints: 320,
    afterPoints: 400,
    beforeGroup: 'bone',
    afterGroup: 'stone',
    beforePoolTier: 'bone',
    afterPoolTier: 'bone',
  }),
  event({
    beforePoints: 760,
    afterPoints: 700,
    beforeGroup: 'ivory',
    afterGroup: 'bone',
    beforePoolTier: 'ivory',
    afterPoolTier: 'bone',
  }),
  { ...event(), beforeGroup: 'diamond' },
  { ...event(), afterPoolTier: 'gold' },
];
for (const [index, candidate] of invalidEvents.entries()) {
  let slides: unknown;
  assert.doesNotThrow(() => {
    slides = groupTransitionSlides(candidate as TransitionEvent);
  }, `invalid transition ${index + 1} threw instead of failing closed`);
  assert.deepEqual(slides, [], `invalid transition ${index + 1} fabricated slides`);
}

/* The transport parser derives the exact display group from the settlement's
   points + historical apex flags. In particular, 5,000 points remain
   OBSIDIAN without the positional flag and become NEON with it. */
const apexRow = {
  id: base.eventId,
  source_match_id: base.matchId,
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
const parsedApex = rankedProgressionFromRow(apexRow);
assert.deepEqual(parsedApex, event({
  beforePoints: 5000,
  afterPoints: 5000,
  beforeGroup: 'obsidian',
  afterGroup: 'neon',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
  equippedRune: 'ward',
  runeLiveBefore: true,
  runeLiveAfter: true,
}));
assert.equal(rankedProgressionFromRow({ ...apexRow, source_match_id: null }), null);
assert.equal(rankedProgressionFromRow({
  id: base.eventId,
  source_match_id: base.matchId,
  points_before: 287,
  points_after: 333,
  apex_before: false,
  apex_after: false,
  pool_tier_before: 'diamond',
  pool_tier_after: 'bone',
  equipped_rune_before: null,
  equipped_rune_after: null,
  random_rune_mode_before: false,
  random_rune_mode_after: false,
  rune_seat_active_before: false,
  rune_seat_active_after: false,
  seen_at: null,
}), null);

console.log(JSON.stringify({
  cases: 19 + invalidEvents.length,
  boneAdditions,
  ivoryAdditions,
}, null, 2));
