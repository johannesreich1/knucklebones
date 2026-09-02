// Permanent outcome entitlements and their v1-to-v2 compatibility policy.
import {
  LADDER_CURVE_V1,
  LADDER_CURVE_V2,
  LEGACY_LADDER_GROUPS_V1,
  groupsForCurve,
  remapLadderPointsV1ToV2,
  type LadderCurveVersion,
} from './ladder.ts';
import {
  RANKED_OUTCOMES,
  RUNE_TRIAL_FORMAT,
  orderRankedOutcomes,
  rankedOutcomeById,
  type RankedOutcomeSpec,
} from './ranked-outcome-registry.ts';

/**
 * The persisted/wire compatibility bucket used by the original ranked-pool
 * rollout. This is deliberately capped at IVORY: GOLD is a v2 unlock
 * milestone, not a value accepted by profiles.ranked_pool_tier.
 */
export type RankedPoolTier = 'stone' | 'bone' | 'ivory';
export type RankedOutcomeUnlockTier = RankedPoolTier | 'gold';

export interface RankedPoolTierSpec {
  id: RankedPoolTier;
}

export interface RankedPoolTierThreshold extends RankedPoolTierSpec {
  floor: number;
}

export interface RankedOutcomeUnlockTierSpec {
  id: RankedOutcomeUnlockTier;
  floor: number;
  outcomeIds: readonly string[];
}

const groupFloor = (id: RankedOutcomeUnlockTier): number => {
  const group = groupsForCurve(LADDER_CURVE_V2).find((candidate) => candidate.id === id);
  if (!group) throw new Error(`Ladder group required by ranked unlocks is missing: ${id}`);
  return group.floor;
};

export const RANKED_POOL_TIERS: readonly Readonly<RankedPoolTierSpec>[] = Object.freeze([
  Object.freeze({ id: 'stone' }),
  Object.freeze({ id: 'bone' }),
  Object.freeze({ id: 'ivory' }),
]);

/** Curve-v2 outcome schedule. Durable per-outcome grants, not pool_tier, are
 * authoritative after activation. */
export const RANKED_OUTCOME_UNLOCK_TIERS:
readonly Readonly<RankedOutcomeUnlockTierSpec>[] = Object.freeze([
  Object.freeze({
    id: 'stone',
    floor: groupFloor('stone'),
    outcomeIds: Object.freeze(['classic', 'singlestrike', 'colshield', 'bounty']),
  }),
  Object.freeze({
    id: 'bone',
    floor: groupFloor('bone'),
    outcomeIds: Object.freeze([
      'classic', 'singlestrike', 'colshield', 'bounty', 'rowmult',
    ]),
  }),
  Object.freeze({
    id: 'ivory',
    floor: groupFloor('ivory'),
    outcomeIds: Object.freeze([
      'classic', 'singlestrike', 'colshield', 'bounty', 'rowmult', RUNE_TRIAL_FORMAT,
    ]),
  }),
  Object.freeze({
    id: 'gold',
    floor: groupFloor('gold'),
    outcomeIds: Object.freeze([
      'classic', 'singlestrike', 'colshield', 'bounty', 'rowmult', RUNE_TRIAL_FORMAT,
      'rowswitch', 'limited',
    ]),
  }),
]);

for (const tier of RANKED_OUTCOME_UNLOCK_TIERS) {
  for (const id of tier.outcomeIds) rankedOutcomeById(id);
}

export function rankedPoolTierById(id: unknown): Readonly<RankedPoolTierSpec> {
  if (typeof id !== 'string') throw new TypeError('Ranked pool tier id must be a string.');
  const tier = RANKED_POOL_TIERS.find((candidate) => candidate.id === id);
  if (!tier) throw new RangeError(`Unknown ranked pool tier id: ${id}`);
  return tier;
}

export function rankedPoolTiersForCurve(
  version: LadderCurveVersion,
): readonly Readonly<RankedPoolTierThreshold>[] {
  if (version !== LADDER_CURVE_V1 && version !== LADDER_CURVE_V2) {
    throw new RangeError(`Unknown ladder curve version: ${String(version)}`);
  }
  const groups = groupsForCurve(version);
  return Object.freeze(RANKED_POOL_TIERS.map(({ id }) => {
    const group = groups.find((candidate) => candidate.id === id);
    if (!group) throw new Error(`Compatibility pool group is missing: ${id}`);
    return Object.freeze({ id, floor: group.floor });
  }));
}

/** Resolve the legacy compatibility bucket on an explicitly named curve. */
export function rankedCompatibilityPoolTierForPeak(
  peakPoints: number,
  version: LadderCurveVersion,
): RankedPoolTier {
  if (!Number.isInteger(peakPoints) || peakPoints < 0) {
    throw new RangeError('Peak ladder points must be a non-negative integer.');
  }
  const tiers = rankedPoolTiersForCurve(version);
  const bone = tiers.find(({ id }) => id === 'bone');
  const ivory = tiers.find(({ id }) => id === 'ivory');
  if (!bone || !ivory) throw new Error('Compatibility pool groups are missing.');
  return peakPoints >= ivory.floor ? 'ivory'
    : peakPoints >= bone.floor ? 'bone' : 'stone';
}

export function highestRankedPoolTier(
  ...tiers: readonly RankedPoolTier[]
): RankedPoolTier {
  if (!tiers.length) throw new RangeError('At least one ranked pool tier is required.');
  let highest = RANKED_POOL_TIERS[0];
  for (const id of tiers) {
    const tier = rankedPoolTierById(id);
    if (RANKED_POOL_TIERS.indexOf(tier) > RANKED_POOL_TIERS.indexOf(highest)) highest = tier;
  }
  return highest.id;
}

export function rankedOutcomeUnlockTierById(
  id: unknown,
): Readonly<RankedOutcomeUnlockTierSpec> {
  if (typeof id !== 'string') throw new TypeError('Ranked outcome unlock tier id must be a string.');
  const tier = RANKED_OUTCOME_UNLOCK_TIERS.find((candidate) => candidate.id === id);
  if (!tier) throw new RangeError(`Unknown ranked outcome unlock tier id: ${id}`);
  return tier;
}

export function rankedOutcomeUnlockTierForPeak(
  peakPoints: number,
): RankedOutcomeUnlockTier {
  if (!Number.isInteger(peakPoints) || peakPoints < 0) {
    throw new RangeError('Peak ladder points must be a non-negative integer.');
  }
  let unlocked = RANKED_OUTCOME_UNLOCK_TIERS[0];
  for (const tier of RANKED_OUTCOME_UNLOCK_TIERS) {
    if (peakPoints >= tier.floor) unlocked = tier;
  }
  return unlocked.id;
}

export function rankedOutcomeEntitlementsForPeak(peakPoints: number): readonly string[] {
  return rankedOutcomeUnlockTierById(rankedOutcomeUnlockTierForPeak(peakPoints)).outcomeIds;
}

export function validateRankedOutcomeEntitlements(ids: unknown): readonly string[] {
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
    throw new TypeError('Ranked outcome entitlements must be an array of strings.');
  }
  if (new Set(ids).size !== ids.length) {
    throw new RangeError('Ranked outcome entitlements must not contain duplicates.');
  }
  for (const id of ids) rankedOutcomeById(id);
  if (!ids.includes('classic')) {
    throw new RangeError('Ranked outcome entitlements must include Classic.');
  }
  return ids;
}

export function mergeRankedOutcomeEntitlements(
  ...sets: readonly (readonly string[])[]
): readonly string[] {
  if (!sets.length) throw new RangeError('At least one entitlement set is required.');
  const merged = new Set<string>();
  for (const ids of sets) {
    for (const id of validateRankedOutcomeEntitlements(ids)) merged.add(id);
  }
  return orderRankedOutcomes([...merged]);
}

export function legacyRankedOutcomeEntitlementsForPeak(oldPeakPoints: number): readonly string[] {
  if (!Number.isInteger(oldPeakPoints) || oldPeakPoints < 0) {
    throw new RangeError('Peak ladder points must be a non-negative integer.');
  }
  const boneFloor = LEGACY_LADDER_GROUPS_V1[1].floor;
  const ivoryFloor = LEGACY_LADDER_GROUPS_V1[2].floor;
  if (oldPeakPoints >= ivoryFloor) {
    return Object.freeze([
      'classic', 'singlestrike', 'colshield', 'limited',
      'rowswitch', 'rowmult', 'bounty', RUNE_TRIAL_FORMAT,
    ]);
  }
  if (oldPeakPoints >= boneFloor) {
    return Object.freeze([
      'classic', 'singlestrike', 'colshield', 'limited',
      'rowswitch', 'rowmult', 'bounty',
    ]);
  }
  return Object.freeze(['classic', 'singlestrike', 'colshield', 'limited']);
}

export function legacyRankedOutcomeEntitlementsForTier(
  tier: RankedPoolTier,
): readonly string[] {
  if (!RANKED_POOL_TIERS.some((candidate) => candidate.id === tier)) {
    throw new RangeError(`Unknown ranked pool tier id: ${tier}`);
  }
  const group = LEGACY_LADDER_GROUPS_V1.find(({ id }) => id === tier);
  if (!group) throw new Error(`Legacy ladder group required by ranked pools is missing: ${tier}`);
  return orderRankedOutcomes(legacyRankedOutcomeEntitlementsForPeak(group.floor));
}

export function grandfatheredRankedOutcomeEntitlements(
  oldPeakPoints: number,
  mappedPeakPoints: number = remapLadderPointsV1ToV2(oldPeakPoints),
): readonly string[] {
  if (mappedPeakPoints !== remapLadderPointsV1ToV2(oldPeakPoints)) {
    throw new RangeError('Mapped peak points do not match the v1 → v2 curve conversion.');
  }
  return mergeRankedOutcomeEntitlements(
    legacyRankedOutcomeEntitlementsForPeak(oldPeakPoints),
    rankedOutcomeEntitlementsForPeak(mappedPeakPoints),
  );
}

export function rankedOutcomeUnlocks(
  before: RankedOutcomeUnlockTier,
  after: RankedOutcomeUnlockTier,
): readonly Readonly<RankedOutcomeSpec>[] {
  const from = rankedOutcomeUnlockTierById(before);
  const to = rankedOutcomeUnlockTierById(after);
  if (to.floor < from.floor) {
    throw new RangeError('Ranked outcome unlocks are permanent and cannot move backwards.');
  }
  const alreadyAvailable = new Set(from.outcomeIds);
  return orderRankedOutcomes(RANKED_OUTCOMES.filter(({ id }) =>
    to.outcomeIds.includes(id) && !alreadyAvailable.has(id)));
}
