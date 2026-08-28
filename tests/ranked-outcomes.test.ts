// Gate for ranked variety progression and Rune Trial's deterministic deal.
// Pure only: no browser, database, clock, or ambient randomness.
// Run: mise exec -- node --experimental-strip-types tests/ranked-outcomes.test.ts
import { CLASSIC } from '../src/core/rules.ts';
import { MODES } from '../src/core/modes.ts';
import { SPELLS } from '../src/core/spells.ts';
import {
  ALL_RANKED_CAPABILITIES,
  RANKED_OUTCOMES,
  RANKED_POOL_TIERS,
  RUNE_TRIAL_CAPABILITY,
  RUNE_TRIAL_FORMAT,
  RUNE_TRIAL_OUTCOME,
  STANDARD_FORMAT,
  highestRankedPoolTier,
  pickRankedOutcome,
  pickRankedOutcomeWithRandom,
  rankedOutcomeById,
  rankedOutcomeByMatch,
  rankedOutcomePool,
  rankedOutcomeRoster,
  rankedPoolTierById,
  rankedPoolTierForPeak,
  type RankedParticipantAccess,
  type RankedPoolTier,
} from '../src/core/ranked-outcomes.ts';
import {
  RUNE_IDS,
  makeRuneTrialOffer,
  pickRuneTrialChoice,
  seededRuneTrialAutoPick,
  seededRuneTrialOffer,
} from '../src/core/rune-trial-offer.ts';
import { RUNE_TRIAL_TEST_SHARE } from '../src/core/rune-trial-test-share.ts';

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
  tier: RankedPoolTier,
  capabilities: readonly string[] = ALL_RANKED_CAPABILITIES,
): RankedParticipantAccess => ({ tier, capabilities });

const summarizedPool = (participants: readonly RankedParticipantAccess[]) =>
  rankedOutcomePool(participants).map(({ outcome, weight }) => [outcome.id, weight]);
const summarizedRoster = (participants: readonly RankedParticipantAccess[]) =>
  rankedOutcomeRoster(participants).map(({ id }) => id);

/* ---- outcome registry: Trial is a format, not a mechanical mode -------- */
eq(RANKED_OUTCOMES.filter(({ format }) => format === STANDARD_FORMAT).map(({ id }) => id),
  MODES.map(({ id }) => id), 'ordinary outcomes drifted from the mode registry');
eq(RUNE_TRIAL_OUTCOME, {
  id: 'rune_trial',
  format: 'rune_trial',
  modifier: 'classic',
  mode: CLASSIC,
  requiredCapability: 'rune_trial_v1',
}, 'Rune Trial is not Classic-backed protocol-v2 play');
check(!MODES.some(({ id }) => id === RUNE_TRIAL_FORMAT),
  'Rune Trial leaked into the mechanical mode registry');
eq(rankedOutcomeById('rune_trial'), RUNE_TRIAL_OUTCOME,
  'strict outcome lookup did not resolve Trial');
eq(rankedOutcomeByMatch('rune_trial', 'classic'), RUNE_TRIAL_OUTCOME,
  'strict wire lookup did not resolve Trial');
eq(rankedOutcomeByMatch('standard', 'limited').id, 'limited',
  'strict wire lookup did not resolve an ordinary mode');
throws(() => rankedOutcomeById('not-a-mode'), 'unknown outcome id fell back');
throws(() => rankedOutcomeById(null), 'null outcome id fell back');
throws(() => rankedOutcomeByMatch('rune_trial', 'limited'),
  'Rune Trial accepted a non-Classic modifier');
throws(() => rankedOutcomeByMatch('standard', 'rune_trial'),
  'standard format accepted the Trial outcome id as a modifier');
throws(() => rankedOutcomeByMatch('future', 'classic'), 'unknown format fell back');

/* ---- permanent tier boundaries and exact outcome sets ----------------- */
eq(RANKED_POOL_TIERS.map(({ id, floor, outcomeIds }) => [id, floor, outcomeIds]), [
  ['stone', 0, ['classic', 'singlestrike', 'colshield', 'limited']],
  ['bone', 300, [
    'classic', 'singlestrike', 'colshield', 'limited',
    'rowswitch', 'rowmult', 'bounty',
  ]],
  ['ivory', 720, [
    'classic', 'singlestrike', 'colshield', 'limited',
    'rowswitch', 'rowmult', 'bounty', 'rune_trial',
  ]],
], 'ranked pool progression drifted');
eq([0, 299, 300, 719, 720, 1259, 9999].map(rankedPoolTierForPeak),
  ['stone', 'stone', 'bone', 'bone', 'ivory', 'ivory', 'ivory'],
  'peak-point tier boundaries are wrong');
eq(highestRankedPoolTier('stone', 'ivory', 'bone'), 'ivory',
  'permanent tier merge relocked a higher pool');
eq(highestRankedPoolTier('bone', 'stone'), 'bone',
  'permanent tier merge depended on argument order');
throws(() => rankedPoolTierForPeak(-1), 'negative peak points were accepted');
throws(() => rankedPoolTierForPeak(300.5), 'fractional peak points were accepted');
throws(() => rankedPoolTierForPeak(Number.NaN), 'NaN peak points were accepted');
throws(() => rankedPoolTierById('silver'), 'higher display group became a fourth pool tier');
throws(() => rankedPoolTierById('unknown'), 'unknown pool tier fell back');
throws(() => highestRankedPoolTier(), 'empty permanent tier merge fell back');

/* ---- exact 40/60 odds and participant intersection -------------------- */
eq(summarizedPool([access('stone')]), [
  ['classic', 2], ['singlestrike', 1], ['colshield', 1], ['limited', 1],
], 'STONE weights are not exactly 40/20/20/20');
eq(summarizedPool([access('bone')]), [
  ['classic', 4], ['singlestrike', 1], ['colshield', 1], ['limited', 1],
  ['rowswitch', 1], ['rowmult', 1], ['bounty', 1],
], 'BONE weights are not exactly 40/10/...');
eq(summarizedPool([access('ivory')]), [
  ['classic', 14], ['singlestrike', 3], ['colshield', 3], ['limited', 3],
  ['rowswitch', 3], ['rowmult', 3], ['bounty', 3], ['rune_trial', 3],
], 'IVORY weights are not exactly 40% plus seven equal additions');

/* A ranked draw retains the permanent seed-sensitive pool sequence above;
   the displayed spinner uses canonical registry order, matching offline. */
eq(summarizedRoster([access('stone')]), [
  'classic', 'colshield', 'singlestrike', 'limited',
], 'STONE spinner roster drifted from canonical mode order');
eq(summarizedRoster([access('bone')]), [
  'classic', 'rowswitch', 'rowmult', 'colshield', 'singlestrike', 'bounty', 'limited',
], 'BONE spinner roster drifted from canonical mode order');
eq(summarizedRoster([access('ivory')]), [
  'classic', 'rowswitch', 'rowmult', 'colshield', 'singlestrike', 'bounty', 'limited',
  'rune_trial',
], 'IVORY spinner roster drifted from canonical outcome order');
eq(summarizedRoster([
  access('ivory', [RUNE_TRIAL_CAPABILITY]),
  access('ivory', []),
]), summarizedRoster([access('bone')]),
  'capability filtering did not carry through to the displayed spinner roster');

for (const tier of ['stone', 'bone', 'ivory'] as const) {
  const pool = rankedOutcomePool([access(tier)]);
  const total = pool.reduce((sum, { weight }) => sum + weight, 0);
  const classic = pool.find(({ outcome }) => outcome.id === 'classic')!;
  check(classic.weight / total === 0.4, `${tier} Classic share is not exactly 40%`, pool);
  const additions = pool.filter(({ outcome }) => outcome.id !== 'classic');
  check(additions.every(({ weight }) => weight === additions[0].weight),
    `${tier} additions do not share the remaining 60%`, pool);
}

/* ---- the temporary Rune Trial test share ------------------------------- */

/* It biases the DRAW and leaves the shipped pool above untouched, so the pool
   assertions never move and tests/botbench.test.ts keeps calibrating the bots
   against the real ladder. Deleting core/rune-trial-test-share.ts puts every
   line below back on the permanent answer without an edit here.
   IVORY's draw runs the registry order, so Rune Trial is last and owns the top
   of [0, 1): its boundary IS its share. */
check(RUNE_TRIAL_TEST_SHARE === null || RUNE_TRIAL_TEST_SHARE === 0.6,
  'the temporary Rune Trial test share changed without its gate', RUNE_TRIAL_TEST_SHARE);
const ivory = [access('ivory')];
const trialBoundary = 1 - (RUNE_TRIAL_TEST_SHARE ?? 3 / 35);
eq([
  pickRankedOutcomeWithRandom(ivory, () => trialBoundary).id,
  pickRankedOutcomeWithRandom(ivory, () => trialBoundary - 1e-9).id,
  pickRankedOutcomeWithRandom(ivory, () => 0.999999999).id,
], ['rune_trial', 'bounty', 'rune_trial'],
  'the Rune Trial draw does not take exactly its share of IVORY');
eq(summarizedPool([access('bone')]).map(([id]) => id).includes(RUNE_TRIAL_FORMAT), false,
  'BONE gained a Trial to bias');

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
], ['classic', 'classic', 'singlestrike', 'colshield', 'limited', 'limited'],
  'STONE weighted boundaries drifted');
/* BONE carries no Trial, so this pin is the override-independent one: it fails
   only if the seeded draw itself drifts. IVORY's answer is a function of the
   weights, and moves with the temporary share by design. */
eq(pickRankedOutcome('ranked-pick-gate', [access('bone')]).id, 'classic',
  'seeded outcome pick drifted');
eq(pickRankedOutcome('ranked-pick-gate', [access('ivory')]).id,
  RUNE_TRIAL_TEST_SHARE === null ? 'classic' : 'rowmult',
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

console.log(JSON.stringify({ problems, errs }, null, 2));
process.exit(problems.length || errs.length ? 1 : 0);
