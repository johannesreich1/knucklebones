// Registry, milestone, entitlement, and canonical presentation contracts.
// Run: mise exec -- node --experimental-strip-types tests/ranked-outcome-presentation.test.ts
import { MODES } from '../src/core/modes.ts';
import { CLASSIC } from '../src/core/rules.ts';
import {
  ALL_RANKED_CAPABILITIES,
  CURVE_V2_CAPABILITY,
  EQUIPPED_RUNE_CAPABILITY,
  RANKED_OUTCOMES,
  RANKED_OUTCOME_DISPLAY_ORDER,
  RANKED_OUTCOME_DRAW_ORDER,
  RANKED_OUTCOME_UNLOCK_TIERS,
  RANKED_POOL_TIERS,
  RUNE_TRIAL_CAPABILITY,
  RUNE_TRIAL_CLAIM_CAPABILITY,
  RUNE_TRIAL_FORMAT,
  RUNE_TRIAL_OUTCOME,
  STANDARD_FORMAT,
  grandfatheredRankedOutcomeEntitlements,
  highestRankedPoolTier,
  legacyRankedOutcomeEntitlementsForPeak,
  legacyRankedOutcomeEntitlementsForTier,
  mergeRankedOutcomeEntitlements,
  orderRankedOutcomes,
  rankedOutcomeById,
  rankedOutcomeByMatch,
  rankedCompatibilityPoolTierForPeak,
  rankedOutcomeEntitlementsForPeak,
  rankedOutcomeUnlockTierForPeak,
  rankedOutcomeUnlocks,
  rankedOutcomeUnlockGroup,
  rankedOutcomesByIds,
  rankedPoolTierById,
  usesRankedActionProtocol,
} from '../src/core/ranked-outcomes.ts';
import { LADDER_CURVE_V1, LADDER_CURVE_V2 } from '../src/core/ladder.ts';
import { emitReport } from './support/emit-report.mjs';

const problems: string[] = [];
const eq = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    problems.push(`${what} :: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
};
const check = (condition: boolean, what: string) => {
  if (!condition) problems.push(what);
};
const throws = (run: () => unknown, what: string) => {
  try {
    run();
    problems.push(`${what} :: did not throw`);
  } catch {
    // expected
  }
};

eq(ALL_RANKED_CAPABILITIES, [
  RUNE_TRIAL_CAPABILITY, EQUIPPED_RUNE_CAPABILITY,
  CURVE_V2_CAPABILITY, RUNE_TRIAL_CLAIM_CAPABILITY,
], 'ranked capability registry lost a distinct Trial/CLAIM/equipment rollout gate');
eq(CURVE_V2_CAPABILITY, 'curve_v2', 'the successor curve capability wire id drifted');
eq(RUNE_TRIAL_CLAIM_CAPABILITY, 'rune_trial_claim_v2',
  'the successor CLAIM capability wire id drifted');
check(usesRankedActionProtocol({ protocol_version: 2, rune_rules_version: 1 })
  && !usesRankedActionProtocol({ protocol_version: 2, rune_rules_version: null })
  && !usesRankedActionProtocol({ protocol_version: 1, rune_rules_version: 1 }),
  'action replay was inferred from only half of its persisted protocol tuple');
eq(RANKED_OUTCOMES.filter(({ format }) => format === STANDARD_FORMAT).map(({ id }) => id),
  MODES.map(({ id }) => id), 'ordinary outcomes drifted from the mode registry');
eq(RUNE_TRIAL_OUTCOME, {
  id: 'rune_trial', format: 'rune_trial', modifier: 'classic', mode: CLASSIC,
  displayRank: 5, unlockGroup: 'ivory', requiredCapability: 'rune_trial_v1',
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

eq(RANKED_POOL_TIERS.map(({ id }) => id), ['stone', 'bone', 'ivory'],
  'the persisted compatibility pool grew beyond its database enum');
eq(RANKED_OUTCOME_UNLOCK_TIERS.map(({ id, floor, outcomeIds }) => [id, floor, outcomeIds]), [
  ['stone', 0, ['classic', 'singlestrike', 'colshield', 'bounty']],
  ['bone', 360, ['classic', 'singlestrike', 'colshield', 'bounty', 'rowmult']],
  ['ivory', 840, [
    'classic', 'singlestrike', 'colshield', 'bounty', 'rowmult', 'rune_trial',
  ]],
  ['gold', 2490, [
    'classic', 'singlestrike', 'colshield', 'bounty', 'rowmult', 'rune_trial',
    'rowswitch', 'limited',
  ]],
], 'ranked pool progression drifted');
eq([0, 359, 360, 839, 840, 2489, 2490, 9999].map(rankedOutcomeUnlockTierForPeak),
  ['stone', 'stone', 'bone', 'bone', 'ivory', 'ivory', 'gold', 'gold'],
  'v2 outcome milestone boundaries are wrong');
eq([299, 300, 719, 720].map((peak) =>
  rankedCompatibilityPoolTierForPeak(peak, LADDER_CURVE_V1)),
['stone', 'bone', 'bone', 'ivory'], 'v1 compatibility boundaries are wrong');
eq([359, 360, 839, 840].map((peak) =>
  rankedCompatibilityPoolTierForPeak(peak, LADDER_CURVE_V2)),
['stone', 'bone', 'bone', 'ivory'], 'v2 compatibility boundaries are wrong');
eq(highestRankedPoolTier('stone', 'ivory', 'bone'), 'ivory',
  'permanent compatibility tier merge relocked a higher pool');
eq(highestRankedPoolTier('bone', 'stone'), 'bone',
  'permanent tier merge depended on argument order');
throws(() => rankedOutcomeUnlockTierForPeak(-1), 'negative peak points were accepted');
throws(() => rankedOutcomeUnlockTierForPeak(360.5), 'fractional peak points were accepted');
throws(() => rankedOutcomeUnlockTierForPeak(Number.NaN), 'NaN peak points were accepted');
throws(() => rankedCompatibilityPoolTierForPeak(300, undefined as never),
  'compatibility lookup silently selected a curve');
throws(() => rankedPoolTierById('silver'), 'higher display group became a fourth pool tier');
throws(() => rankedPoolTierById('gold'), 'GOLD leaked into the persisted compatibility pool');
throws(() => rankedPoolTierById('unknown'), 'unknown pool tier fell back');
throws(() => highestRankedPoolTier(), 'empty permanent tier merge fell back');

eq(rankedOutcomeEntitlementsForPeak(0),
  ['classic', 'singlestrike', 'colshield', 'bounty'],
  'a successor STONE account did not start with Bounty');
eq(rankedOutcomeEntitlementsForPeak(1490),
  ['classic', 'singlestrike', 'colshield', 'bounty', 'rowmult', 'rune_trial'],
  'SILVER incorrectly added an ordinary outcome');
eq(rankedOutcomeEntitlementsForPeak(3890), RANKED_OUTCOME_UNLOCK_TIERS[3].outcomeIds,
  'OBSIDIAN incorrectly added an ordinary outcome');
eq(rankedOutcomeUnlocks('stone', 'bone').map(({ id }) => id), ['rowmult'],
  'BONE did not teach only Row Multiply');
eq(rankedOutcomeUnlocks('bone', 'ivory').map(({ id }) => id), ['rune_trial'],
  'IVORY did not teach only Rune Ritual');
eq(rankedOutcomeUnlocks('ivory', 'gold').map(({ id }) => id), ['rowswitch', 'limited'],
  'GOLD did not teach Row Switch before Limited');
eq(rankedOutcomeUnlocks('stone', 'gold').map(({ id, unlockGroup }) => [id, unlockGroup]), [
  ['rowmult', 'bone'], ['rune_trial', 'ivory'],
  ['rowswitch', 'gold'], ['limited', 'gold'],
], 'a catch-up outcome list lost milestone metadata needed for feature interleaving');

eq(legacyRankedOutcomeEntitlementsForPeak(0),
  ['classic', 'singlestrike', 'colshield', 'limited'],
  'the shipped STONE promise lost Limited');
eq(legacyRankedOutcomeEntitlementsForPeak(300), [
  'classic', 'singlestrike', 'colshield', 'limited',
  'rowswitch', 'rowmult', 'bounty',
], 'the shipped BONE promise lost a mechanical outcome');
eq(legacyRankedOutcomeEntitlementsForPeak(720), [
  'classic', 'singlestrike', 'colshield', 'limited',
  'rowswitch', 'rowmult', 'bounty', 'rune_trial',
], 'the shipped IVORY promise lost Rune Ritual');
eq(legacyRankedOutcomeEntitlementsForTier('stone'), [
  'classic', 'singlestrike', 'colshield', 'limited',
], 'the v1 STONE tier fallback lost its shipped Limited promise');
eq(legacyRankedOutcomeEntitlementsForTier('bone'), [
  'classic', 'singlestrike', 'colshield', 'bounty', 'rowmult', 'rowswitch', 'limited',
], 'the v1 BONE tier fallback did not canonicalize its shipped full mechanical pool');
eq(legacyRankedOutcomeEntitlementsForTier('ivory'), RANKED_OUTCOME_DISPLAY_ORDER,
  'the v1 IVORY tier fallback lost Rune Ritual or canonical order');
throws(() => legacyRankedOutcomeEntitlementsForTier('future' as never),
  'an unknown v1 tier received an entitlement set');
eq(grandfatheredRankedOutcomeEntitlements(0, 0),
  ['classic', 'singlestrike', 'colshield', 'bounty', 'limited'],
  'grandfathered STONE did not keep Limited and gain Bounty');
eq(grandfatheredRankedOutcomeEntitlements(300, 360), [
  'classic', 'singlestrike', 'colshield', 'bounty', 'rowmult', 'rowswitch', 'limited',
], 'grandfathered BONE did not retain all six mechanical additions');
eq(grandfatheredRankedOutcomeEntitlements(720, 840), RANKED_OUTCOME_DISPLAY_ORDER,
  'grandfathered IVORY did not retain the complete ordinary/Trial pool');
eq(grandfatheredRankedOutcomeEntitlements(3000, 3890), RANKED_OUTCOME_DISPLAY_ORDER,
  'an old OBSIDIAN peak was evaluated against raw target points');
throws(() => grandfatheredRankedOutcomeEntitlements(3000, 3000),
  'a raw old peak was accepted as its mapped target peak');
throws(() => legacyRankedOutcomeEntitlementsForPeak(-1),
  'a negative legacy peak received entitlements');
eq(mergeRankedOutcomeEntitlements(
  ['classic', 'limited'], ['classic', 'bounty', 'rowmult']),
  ['classic', 'bounty', 'rowmult', 'limited'],
  'explicit entitlement union did not canonicalize and deduplicate');
throws(() => mergeRankedOutcomeEntitlements(), 'an empty entitlement union was accepted');

eq(RANKED_OUTCOME_DISPLAY_ORDER, [
  'classic', 'singlestrike', 'colshield', 'bounty',
  'rowmult', 'rune_trial', 'rowswitch', 'limited',
], 'canonical outcome display order drifted');
eq(RANKED_OUTCOME_DRAW_ORDER, [
  'classic', 'singlestrike', 'colshield', 'limited',
  'rowswitch', 'rowmult', 'bounty', 'rune_trial',
], 'seed-versioned outcome draw order drifted');
eq(RANKED_OUTCOME_DISPLAY_ORDER.map(rankedOutcomeUnlockGroup), [
  'stone', 'stone', 'stone', 'stone', 'bone', 'ivory', 'gold', 'gold',
], 'successor outcome milestone metadata drifted');
eq(orderRankedOutcomes([
  rankedOutcomeById('limited'), rankedOutcomeById('classic'),
  rankedOutcomeById('rune_trial'), rankedOutcomeById('bounty'),
]).map(({ id }) => id), ['classic', 'bounty', 'rune_trial', 'limited'],
  'the shared display helper did not sort an arbitrary subset');
eq(rankedOutcomesByIds(['limited', 'classic', 'rune_trial', 'bounty']).map(({ id }) => id),
  ['classic', 'bounty', 'rune_trial', 'limited'],
  'ordered outcome lookup copied presentation order');

emitReport({ problems, errs: [] }, problems.length);
