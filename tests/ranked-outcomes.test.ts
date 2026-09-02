// Gate for ranked draw odds and Rune Trial's deterministic deal.
// Pure only: no browser, database, clock, or ambient randomness.
// Run: mise exec -- node --experimental-strip-types tests/ranked-outcomes.test.ts
import { SPELLS } from '../src/core/spells.ts';
import {
  ALL_RANKED_CAPABILITIES,
  RANKED_OUTCOME_DISPLAY_ORDER,
  RUNE_TRIAL_CAPABILITY,
  RUNE_TRIAL_FORMAT,
  grandfatheredRankedOutcomeEntitlements,
  pickRankedOutcome,
  pickRankedOutcomeWithRandom,
  rankedOutcomeUnlockTierById,
  rankedOutcomePool,
  rankedOutcomeRoster,
  type RankedParticipantAccess,
  type RankedOutcomeUnlockTier,
  type RankedPoolTier,
} from '../src/core/ranked-outcomes.ts';
import {
  RUNE_IDS,
  makeRuneTrialOffer,
  pickRuneTrialChoice,
  seededRuneTrialAutoPick,
  seededRuneTrialOffer,
} from '../src/core/rune-trial-offer.ts';
import { emitReport } from './support/emit-report.mjs';

const problems: string[] = [];
const errs: string[] = [];
const eq = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    problems.push(`${what} :: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
};
const check = (condition: boolean, what: string, detail?: unknown) => {
  if (!condition) problems.push(`${what} :: ${JSON.stringify(detail)}`);
};
const throws = (run: () => unknown, what: string) => {
  try {
    run();
    problems.push(`${what} :: did not throw`);
  } catch {
    // expected
  }
};

const access = (
  tier: RankedOutcomeUnlockTier,
  capabilities: readonly string[] = ALL_RANKED_CAPABILITIES,
  entitlementIds: readonly string[] = rankedOutcomeUnlockTierById(tier).outcomeIds,
): RankedParticipantAccess => ({
  tier: tier === 'gold' ? 'ivory' : tier,
  capabilities,
  entitlementIds,
});

const summarizedPool = (participants: readonly RankedParticipantAccess[]) =>
  rankedOutcomePool(participants).map(({ outcome, weight }) => [outcome.id, weight]);
const summarizedRoster = (participants: readonly RankedParticipantAccess[]) =>
  rankedOutcomeRoster(participants).map(({ id }) => id);

/* ---- exact 40/60 odds and participant intersection -------------------- */
eq(summarizedPool([access('stone')]), [
  ['classic', 2], ['singlestrike', 1], ['colshield', 1], ['bounty', 1],
], 'STONE weights are not exactly 40/20/20/20');
eq(summarizedPool([access('bone')]), [
  ['classic', 8], ['singlestrike', 3], ['colshield', 3],
  ['rowmult', 3], ['bounty', 3],
], 'BONE weights are not exactly 40/15/...');
eq(summarizedPool([access('ivory')]), [
  ['classic', 10], ['singlestrike', 3], ['colshield', 3],
  ['rowmult', 3], ['bounty', 3], ['rune_trial', 3],
], 'IVORY weights are not exactly 40% plus five equal additions');
eq(summarizedPool([access('gold')]), [
  ['classic', 14], ['singlestrike', 3], ['colshield', 3], ['limited', 3],
  ['rowswitch', 3], ['rowmult', 3], ['bounty', 3], ['rune_trial', 3],
], 'GOLD did not retain the seed-versioned full-pool order and weights');

/* A ranked draw retains the permanent seed-sensitive pool sequence above;
   the displayed spinner uses canonical registry order, matching offline. */
eq(summarizedRoster([access('stone')]), [
  'classic', 'singlestrike', 'colshield', 'bounty',
], 'STONE spinner roster drifted from canonical mode order');
eq(summarizedRoster([access('bone')]), [
  'classic', 'singlestrike', 'colshield', 'bounty', 'rowmult',
], 'BONE spinner roster drifted from canonical mode order');
eq(summarizedRoster([access('ivory')]), [
  'classic', 'singlestrike', 'colshield', 'bounty', 'rowmult', 'rune_trial',
], 'IVORY spinner roster drifted from canonical outcome order');
eq(summarizedRoster([access('gold')]), RANKED_OUTCOME_DISPLAY_ORDER,
  'GOLD spinner did not use the complete canonical outcome order');
eq(summarizedRoster([
  access('ivory', [RUNE_TRIAL_CAPABILITY]),
  access('ivory', []),
]), summarizedRoster([access('bone')]),
  'capability filtering did not carry through to the displayed spinner roster');

for (const tier of ['stone', 'bone', 'ivory', 'gold'] as const) {
  const pool = rankedOutcomePool([access(tier)]);
  const total = pool.reduce((sum, { weight }) => sum + weight, 0);
  const classic = pool.find(({ outcome }) => outcome.id === 'classic')!;
  check(classic.weight / total === 0.4, `${tier} Classic share is not exactly 40%`, pool);
  const additions = pool.filter(({ outcome }) => outcome.id !== 'classic');
  check(additions.every(({ weight }) => weight === additions[0].weight),
    `${tier} additions do not share the remaining 60%`, pool);
}

const grandfatheredStone = grandfatheredRankedOutcomeEntitlements(0);
eq(summarizedPool([access('stone', ALL_RANKED_CAPABILITIES, grandfatheredStone)]), [
  ['classic', 8], ['singlestrike', 3], ['colshield', 3], ['limited', 3], ['bounty', 3],
], 'durable grandfathered STONE access collapsed back to a tier shortcut');
eq(summarizedRoster([access('stone', ALL_RANKED_CAPABILITIES, grandfatheredStone)]),
  ['classic', 'singlestrike', 'colshield', 'bounty', 'limited'],
  'grandfathered STONE presentation ignored canonical relative order');
const shuffledGrandfatheredStone = [...grandfatheredStone].reverse();
eq(summarizedPool([access('stone', ALL_RANKED_CAPABILITIES, shuffledGrandfatheredStone)]),
  summarizedPool([access('stone', ALL_RANKED_CAPABILITIES, grandfatheredStone)]),
  'persisted entitlement array order changed deterministic draw order');
throws(() => summarizedPool([access('stone', ALL_RANKED_CAPABILITIES,
  ['classic', 'bounty', 'bounty'])]), 'duplicate explicit entitlements were accepted');
throws(() => summarizedPool([access('stone', ALL_RANKED_CAPABILITIES,
  ['bounty'])]), 'an explicit entitlement set without Classic was accepted');
throws(() => summarizedPool([access('stone', ALL_RANKED_CAPABILITIES,
  ['classic', 'future-mode'])]), 'an unknown explicit entitlement was accepted');

/* ---- the permanent 40/60 draw ------------------------------------------ */

/* The player-visible draw must read the permanent pool above without an
   experimental override. Checking only rankedOutcomePool() missed the live
   60% Rune Trial bias because that override was applied one layer later. */
const ivory = [access('ivory')];
eq([
  pickRankedOutcomeWithRandom(ivory, () => 0.399999999).id,
  pickRankedOutcomeWithRandom(ivory, () => 10 / 25).id,
  pickRankedOutcomeWithRandom(ivory, () => 13 / 25).id,
  pickRankedOutcomeWithRandom(ivory, () => 16 / 25).id,
  pickRankedOutcomeWithRandom(ivory, () => 19 / 25).id,
  pickRankedOutcomeWithRandom(ivory, () => 22 / 25).id,
  pickRankedOutcomeWithRandom(ivory, () => 0.999999999).id,
], [
  'classic', 'singlestrike', 'colshield', 'rowmult', 'bounty',
  'rune_trial', 'rune_trial',
], 'the IVORY draw is not Classic 40% plus five equal 3/25 additions');
eq(summarizedPool([access('bone')]).map(([id]) => id).includes(RUNE_TRIAL_FORMAT), false,
  'BONE gained a Trial to bias');

const gold = [access('gold')];
eq([
  pickRankedOutcomeWithRandom(gold, () => 0.399999999).id,
  pickRankedOutcomeWithRandom(gold, () => 14 / 35).id,
  pickRankedOutcomeWithRandom(gold, () => 17 / 35).id,
  pickRankedOutcomeWithRandom(gold, () => 20 / 35).id,
  pickRankedOutcomeWithRandom(gold, () => 23 / 35).id,
  pickRankedOutcomeWithRandom(gold, () => 26 / 35).id,
  pickRankedOutcomeWithRandom(gold, () => 29 / 35).id,
  pickRankedOutcomeWithRandom(gold, () => 32 / 35).id,
  pickRankedOutcomeWithRandom(gold, () => 0.999999999).id,
], [
  'classic', 'singlestrike', 'colshield', 'limited', 'rowswitch',
  'rowmult', 'bounty', 'rune_trial', 'rune_trial',
], 'the full-pool seed-versioned draw order changed at GOLD');

const stoneIvory = summarizedPool([access('stone'), access('ivory')]);
eq(stoneIvory, summarizedPool([access('ivory'), access('stone')]),
  'cross-tier pool depends on participant order');
eq(stoneIvory, summarizedPool([access('stone')]),
  'STONE × IVORY did not use the shared STONE pool');
eq(summarizedPool([access('bone'), access('ivory')]), summarizedPool([access('bone')]),
  'BONE × IVORY did not use the shared BONE pool');
eq(summarizedPool([
  access('ivory', [RUNE_TRIAL_CAPABILITY]),
  access('ivory', []),
]), summarizedPool([access('bone')]),
  'an older client did not remove Trial and restore BONE odds');
eq(summarizedPool([access('ivory', ['future_v9', RUNE_TRIAL_CAPABILITY])]),
  summarizedPool([access('ivory')]), 'unknown future capability changed known outcomes');
throws(() => rankedOutcomePool([]), 'empty participant intersection was accepted');
throws(() => rankedOutcomePool([
  { tier: 'silver' as RankedPoolTier, capabilities: [] },
]), 'unknown participant tier fell back');
throws(() => rankedOutcomePool([
  { tier: 'ivory', capabilities: null as unknown as string[] },
]), 'malformed participant capabilities were accepted');

/* Exact half-open weighted boundaries: a draw ON a boundary enters the next
   outcome, so every point in [0, 1) belongs to exactly one result. */
const stone = [access('stone')];
eq([
  pickRankedOutcomeWithRandom(stone, () => 0).id,
  pickRankedOutcomeWithRandom(stone, () => 0.399999999).id,
  pickRankedOutcomeWithRandom(stone, () => 0.4).id,
  pickRankedOutcomeWithRandom(stone, () => 0.6).id,
  pickRankedOutcomeWithRandom(stone, () => 0.8).id,
  pickRankedOutcomeWithRandom(stone, () => 0.999999999).id,
], ['classic', 'classic', 'singlestrike', 'colshield', 'bounty', 'bounty'],
  'STONE weighted boundaries drifted');
/* Seeded picks pin the deterministic stream as well as the permanent weights. */
eq(pickRankedOutcome('ranked-pick-gate', [access('bone')]).id, 'classic',
  'seeded outcome pick drifted');
eq(pickRankedOutcome('ranked-pick-gate', [access('ivory')]).id, 'classic',
  'seeded IVORY pick drifted from its pool weights');
throws(() => pickRankedOutcome('', stone), 'empty outcome seed was accepted');
throws(() => pickRankedOutcomeWithRandom(stone, () => 1), 'random draw 1 was accepted');
throws(() => pickRankedOutcomeWithRandom(stone, () => -0.01), 'negative random draw was accepted');

/* ---- Rune Trial offer: exactly uniform 3-of-6, stable and distinct ------ */
eq(RUNE_IDS, SPELLS.map(({ id }) => id), 'Rune selection duplicated or reordered the spell registry');
eq(new Set(RUNE_IDS).size, 6, 'the expected six-rune roster is not unique');

const combinationCounts = new Map<string, number>();
const ranges = [6, 5, 4];
for (let a = 0; a < ranges[0]; a++) {
  for (let b = 0; b < ranges[1]; b++) {
    for (let c = 0; c < ranges[2]; c++) {
      const choices = [a, b, c];
      let draw = 0;
      const offer = makeRuneTrialOffer(() => (choices[draw] + 0.5) / ranges[draw++]);
      check(offer.length === 3 && new Set(offer).size === 3,
        'offer repeated a rune', offer);
      check(offer.every((id) => RUNE_IDS.includes(id)), 'offer escaped the rune roster', offer);
      const combination = [...offer].sort().join(',');
      combinationCounts.set(combination, (combinationCounts.get(combination) ?? 0) + 1);
    }
  }
}
eq(combinationCounts.size, 20, 'the six-rune roster did not produce all 20 three-rune offers');
check([...combinationCounts.values()].every((count) => count === 6),
  '3-of-6 offers are not exactly uniform', Object.fromEntries(combinationCounts));

const offerA = seededRuneTrialOffer('trial-offer-gate');
const offerB = seededRuneTrialOffer('trial-offer-gate');
eq(offerA, offerB, 'seeded Trial offer is not deterministic');
eq(offerA, ['pilfer', 'anvil', 'fate'], 'seeded Trial offer drifted');
eq(seededRuneTrialOffer('subset-order-gate', ['anvil', 'fate', 'ward', 'nudge']),
  seededRuneTrialOffer('subset-order-gate', ['ward', 'nudge', 'anvil', 'fate']),
  'candidate input order changed the seeded Trial offer');
check(Object.isFrozen(offerA), 'a persisted Trial offer can be mutated', offerA);

eq([
  pickRuneTrialChoice(offerA, () => 0),
  pickRuneTrialChoice(offerA, () => 1 / 3),
  pickRuneTrialChoice(offerA, () => 2 / 3),
  pickRuneTrialChoice(offerA, () => 0.999999999),
], [offerA[0], offerA[1], offerA[2], offerA[2]],
  'timeout choice is not uniform across the offered runes');
eq(seededRuneTrialAutoPick('trial-match-gate', 'player-a', offerA), 'fate',
  'player-a seeded timeout choice drifted');
eq(seededRuneTrialAutoPick('trial-match-gate', 'player-b', offerA), 'pilfer',
  'player-b seeded timeout choice drifted');

throws(() => makeRuneTrialOffer(() => 0, ['fate', 'nudge']),
  'an offer with fewer than three candidates was accepted');
throws(() => makeRuneTrialOffer(() => 0, ['fate', 'nudge', 'ward', 'ward']),
  'duplicate offer candidates were accepted');
throws(() => makeRuneTrialOffer(() => 0, ['fate', 'nudge', 'unknown']),
  'unknown offer candidate was accepted');
throws(() => makeRuneTrialOffer(() => Number.NaN), 'NaN offer randomness was accepted');
throws(() => pickRuneTrialChoice(['fate', 'nudge'], () => 0),
  'a two-rune timeout offer was accepted');
throws(() => pickRuneTrialChoice(['fate', 'nudge', 'nudge'], () => 0),
  'a repeated-rune timeout offer was accepted');
throws(() => pickRuneTrialChoice(['fate', 'nudge', 'unknown'], () => 0),
  'an unknown-rune timeout offer was accepted');
throws(() => seededRuneTrialOffer(''), 'empty offer seed was accepted');
throws(() => seededRuneTrialAutoPick('', 'player-a', offerA), 'empty auto-pick seed was accepted');
throws(() => seededRuneTrialAutoPick('seed', '', offerA), 'empty participant key was accepted');

emitReport({ problems, errs }, problems.length || errs.length);
