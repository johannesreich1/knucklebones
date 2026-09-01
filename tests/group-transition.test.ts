// The ranked result's mandatory group-transition deck is planned from one
// normalized, authoritative settlement event. Presentation consumes stable
// group/outcome ids; it does not infer a crossing from cached profile state or
// duplicate the ranked outcome registry.
//
// Red-first owner for src/online/screens/group-transition-model.ts.
// Run: mise exec -- node --experimental-strip-types tests/group-transition.test.ts
import assert from 'node:assert/strict';
import type { LadderGroupId } from '../src/i18n/display.ts';
import type { GroupTransitionEvent } from '../src/online/api/ranked-progression-api.ts';
import { groupTransitionSlides } from '../src/online/screens/group-transition-model.ts';
import { runGroupTransitionV2Cases } from './support/group-transition-v2-cases.ts';
import { runRankedProgressionEventCases } from './support/ranked-progression-event-cases.ts';

type TransitionEvent = GroupTransitionEvent;

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
  runeSeatUnlockedBefore: false,
  runeSeatUnlockedAfter: false,
  seenAt: null,
  curveVersion: 1,
  outcomeGrants: [],
  weeklyUnlockedBefore: false,
  weeklyUnlockedAfter: false,
  neonMedalGranted: false,
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

/* The first BONE crossing teaches precisely the permanent additions, in the
   order curve v1 had already shipped. */
const boneAdditions = ['rowswitch', 'rowmult', 'bounty'];
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
const ivoryAdditions = ['rune_trial'];
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

/* The first historical SILVER peak permanently unlocks the ranked rune seat.
   Settlement owns that before/after fact; presentation must not infer it from
   the current group because a demoted player keeps the capability. */
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 1240,
  afterPoints: 1300,
  beforeGroup: 'ivory',
  afterGroup: 'silver',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
  equippedRune: 'ward',
  runeSeatUnlockedBefore: false,
  runeSeatUnlockedAfter: true,
})), [
  group('promotion', 'ivory', 'silver'),
  { kind: 'rune-seat' },
]);

/* A player who already reached SILVER must not be retaught the permanent
   capability when returning there after a demotion. */
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 1211,
  afterPoints: 1274,
  beforeGroup: 'ivory',
  afterGroup: 'silver',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
  equippedRune: 'ward',
  randomRuneMode: true,
  runeSeatUnlockedBefore: true,
  runeSeatUnlockedAfter: true,
})), [group('promotion', 'ivory', 'silver')]);

/* Demotion never deactivates a historical unlock and therefore never creates
   a resting slide. Fail closed even for an old/malformed falling flag pair. */
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 1274,
  afterPoints: 1211,
  beforeGroup: 'silver',
  afterGroup: 'ivory',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
  equippedRune: 'ward',
  randomRuneMode: true,
  runeSeatUnlockedBefore: true,
  runeSeatUnlockedAfter: true,
})), [group('demotion', 'silver', 'ivory')]);
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 1274,
  afterPoints: 1211,
  beforeGroup: 'silver',
  afterGroup: 'ivory',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
  equippedRune: 'ward',
  randomRuneMode: true,
  runeSeatUnlockedBefore: true,
  runeSeatUnlockedAfter: false,
})), [group('demotion', 'silver', 'ivory')]);

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
  runeSeatUnlockedBefore: false,
  runeSeatUnlockedAfter: true,
})), [
  group('promotion', 'ivory', 'silver'),
  { kind: 'rune-seat' },
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
  runeSeatUnlockedBefore: true,
  runeSeatUnlockedAfter: true,
})), [group('demotion', 'silver', 'ivory')]);

/* A large authoritative step gets the same one-time capability slide when its
   historical unlock fact changes, without requiring an exact group pair. */
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 1240,
  afterPoints: 2100,
  beforeGroup: 'ivory',
  afterGroup: 'gold',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
  runeSeatUnlockedBefore: false,
  runeSeatUnlockedAfter: true,
})), [
  group('promotion', 'ivory', 'gold'),
  { kind: 'rune-seat' },
]);

/* Crossings which neither advance the permanent pool nor change the historical
   rune unlock remain a one-slide group acknowledgement. */
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 2040,
  afterPoints: 1980,
  beforeGroup: 'gold',
  afterGroup: 'silver',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
  equippedRune: 'ward',
  runeSeatUnlockedBefore: true,
  runeSeatUnlockedAfter: true,
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
  runeSeatUnlockedBefore: true,
  runeSeatUnlockedAfter: true,
})), [group('promotion', 'obsidian', 'neon')]);
assert.deepEqual(groupTransitionSlides(event({
  beforePoints: 5000,
  afterPoints: 5000,
  beforeGroup: 'neon',
  afterGroup: 'obsidian',
  beforePoolTier: 'ivory',
  afterPoolTier: 'ivory',
  runeSeatUnlockedBefore: true,
  runeSeatUnlockedAfter: true,
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
  matchId: null,
})), groupTransitionSlides(event()),
  'an orphaned durable event could not display after its match was deleted');
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
  { ...event(), afterPoolTier: 'diamond' },
  { ...event(), curveVersion: 3 },
  { ...event(), outcomeGrants: ['rowmult', 'rowmult'] },
];
for (const [index, candidate] of invalidEvents.entries()) {
  let slides: unknown;
  assert.doesNotThrow(() => {
    slides = groupTransitionSlides(candidate as TransitionEvent);
  }, `invalid transition ${index + 1} threw instead of failing closed`);
  assert.deepEqual(slides, [], `invalid transition ${index + 1} fabricated slides`);
}

const v2Cases = runGroupTransitionV2Cases();
const parserCases = runRankedProgressionEventCases();
console.log(JSON.stringify({
  cases: 21 + invalidEvents.length + v2Cases + parserCases,
  boneAdditions,
  ivoryAdditions,
}, null, 2));
