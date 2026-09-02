import assert from 'node:assert/strict';
import type { LadderGroupId } from '../../src/i18n/display.ts';
import type { GroupTransitionEvent } from '../../src/online/api/ranked-progression-api.ts';
import { groupTransitionSlides } from '../../src/online/screens/group-transition-model.ts';

const base: GroupTransitionEvent = {
  eventId: '20000000-0000-4000-8000-000000000002',
  matchId: '10000000-0000-4000-8000-000000000002',
  beforePoints: 350,
  afterPoints: 370,
  beforeGroup: 'stone',
  afterGroup: 'bone',
  beforePoolTier: 'stone',
  afterPoolTier: 'bone',
  equippedRune: null,
  randomRuneMode: false,
  runeSeatUnlockedBefore: false,
  runeSeatUnlockedAfter: false,
  seenAt: null,
  curveVersion: 2,
  outcomeGrants: [],
  weeklyUnlockedBefore: false,
  weeklyUnlockedAfter: false,
  neonMedalGranted: false,
};

const event = (overrides: Partial<GroupTransitionEvent> = {}): GroupTransitionEvent => ({
  ...base,
  ...overrides,
});

const group = (
  direction: 'promotion' | 'demotion',
  from: LadderGroupId,
  to: LadderGroupId,
) => ({ kind: 'group', direction, from, to });

export function runGroupTransitionV2Cases(): number {
  /* v2 never infers a grant from legacy cumulative tier fields. */
  assert.deepEqual(groupTransitionSlides(event()), [group('promotion', 'stone', 'bone')]);
  assert.deepEqual(groupTransitionSlides(event({ outcomeGrants: ['rowmult'] })), [
    group('promotion', 'stone', 'bone'),
    { kind: 'outcome', outcomeId: 'rowmult' },
  ]);

  assert.deepEqual(groupTransitionSlides(event({
    beforePoints: 6100,
    afterPoints: 6100,
    beforeGroup: 'neon',
    afterGroup: 'neon',
    beforePoolTier: 'ivory',
    afterPoolTier: 'ivory',
    neonMedalGranted: true,
  })), [{ kind: 'neon-medal' }],
  'a same-group positional NEON settlement dropped its newly granted medal');
  assert.deepEqual(groupTransitionSlides(event({
    beforePoints: 6100,
    afterPoints: 6100,
    beforeGroup: 'neon',
    afterGroup: 'neon',
    beforePoolTier: 'stone',
    afterPoolTier: 'ivory',
    outcomeGrants: ['limited', 'rowswitch', 'rune_trial', 'rowmult'],
    runeSeatUnlockedAfter: true,
    weeklyUnlockedAfter: true,
    neonMedalGranted: true,
  })), [
    { kind: 'outcome', outcomeId: 'rowmult' },
    { kind: 'outcome', outcomeId: 'rune_trial' },
    { kind: 'rune-seat' },
    { kind: 'outcome', outcomeId: 'rowswitch' },
    { kind: 'outcome', outcomeId: 'limited' },
    { kind: 'weekly-access' },
    { kind: 'neon-medal' },
  ], 'same-group positional NEON catch-up was not taught in milestone order');
  assert.deepEqual(groupTransitionSlides(event({
    beforePoints: 6100,
    afterPoints: 6100,
    beforeGroup: 'neon',
    afterGroup: 'neon',
    beforePoolTier: 'ivory',
    afterPoolTier: 'ivory',
  })), [], 'an empty same-group v2 event fabricated a transition slide');

  /* Exact ids arrive in arbitrary storage order. Teach them after the final
     group acknowledgement at ascending BONE → NEON milestones. */
  assert.deepEqual(groupTransitionSlides(event({
    afterPoints: 6100,
    afterGroup: 'neon',
    afterPoolTier: 'ivory',
    outcomeGrants: ['limited', 'rowswitch', 'rune_trial', 'rowmult'],
    runeSeatUnlockedAfter: true,
    weeklyUnlockedAfter: true,
    neonMedalGranted: true,
  })), [
    group('promotion', 'stone', 'neon'),
    { kind: 'outcome', outcomeId: 'rowmult' },
    { kind: 'outcome', outcomeId: 'rune_trial' },
    { kind: 'rune-seat' },
    { kind: 'outcome', outcomeId: 'rowswitch' },
    { kind: 'outcome', outcomeId: 'limited' },
    { kind: 'weekly-access' },
    { kind: 'neon-medal' },
  ]);
  assert.deepEqual(groupTransitionSlides(event({
    beforePoints: 6100,
    afterPoints: 6080,
    beforeGroup: 'neon',
    afterGroup: 'obsidian',
    beforePoolTier: 'ivory',
    afterPoolTier: 'ivory',
    runeSeatUnlockedBefore: true,
    runeSeatUnlockedAfter: true,
    neonMedalGranted: true,
  })), [
    group('demotion', 'neon', 'obsidian'),
    { kind: 'neon-medal' },
  ], 'an apex-before settlement dropped its medal when the game also demoted it');

  /* A positional NEON player can earn missing permanent facts from the apex-
     before snapshot even when the same settlement demotes them. */
  assert.deepEqual(groupTransitionSlides(event({
    beforePoints: 6100,
    afterPoints: 6080,
    beforeGroup: 'neon',
    afterGroup: 'obsidian',
    beforePoolTier: 'ivory',
    afterPoolTier: 'ivory',
    outcomeGrants: ['rowmult'],
    runeSeatUnlockedBefore: false,
    runeSeatUnlockedAfter: true,
    weeklyUnlockedBefore: false,
    weeklyUnlockedAfter: true,
    neonMedalGranted: true,
  })), [
    group('demotion', 'neon', 'obsidian'),
    { kind: 'outcome', outcomeId: 'rowmult' },
    { kind: 'rune-seat' },
    { kind: 'weekly-access' },
    { kind: 'neon-medal' },
  ]);

  assert.deepEqual(groupTransitionSlides(event({
    beforePoints: 6100,
    afterPoints: 6080,
    beforeGroup: 'neon',
    afterGroup: 'obsidian',
    beforePoolTier: 'ivory',
    afterPoolTier: 'ivory',
    runeSeatUnlockedBefore: true,
    runeSeatUnlockedAfter: false,
  })), [], 'a falling permanent v2 feature snapshot did not fail closed');

  /* A grant above the reached milestone is contradictory and fails closed. */
  assert.deepEqual(groupTransitionSlides(event({ outcomeGrants: ['rowswitch'] })), []);
  return 9;
}
