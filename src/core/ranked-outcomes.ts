// Public ranked-outcome facade and deterministic weighted draw. Stable
// identity/presentation lives in ranked-outcome-registry; entitlement policy
// lives in ranked-outcome-access. Existing callers keep this one import seam.
import { randStream, unitDraw } from './dice.ts';
import {
  RANKED_OUTCOMES,
  RANKED_OUTCOME_DRAW_ORDER,
  orderRankedOutcomes,
  rankedOutcomeById,
  type RankedOutcomeSpec,
} from './ranked-outcome-registry.ts';
import {
  legacyRankedOutcomeEntitlementsForTier,
  validateRankedOutcomeEntitlements,
  type RankedPoolTier,
} from './ranked-outcome-access.ts';

export * from './ranked-outcome-registry.ts';
export * from './ranked-outcome-access.ts';

export interface RankedParticipantAccess {
  tier: RankedPoolTier;
  /** Durable per-outcome state takes precedence over the rollout tier. */
  entitlementIds?: readonly string[];
  /** Unknown future capabilities remain harmless to older pool logic. */
  capabilities: readonly string[];
}

export interface WeightedRankedOutcome {
  outcome: Readonly<RankedOutcomeSpec>;
  weight: number;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/* Classic is exactly 40%; every eligible addition shares the remaining 60%.
   The explicit draw order is seed-versioned and independent from display. */
export function rankedOutcomePool(
  participants: readonly RankedParticipantAccess[],
): readonly WeightedRankedOutcome[] {
  if (!participants.length) throw new RangeError('At least one ranked participant is required.');

  const entitlementSets = participants.map(({ tier, entitlementIds, capabilities }) => {
    if (!Array.isArray(capabilities)
      || !capabilities.every((capability) => typeof capability === 'string')) {
      throw new TypeError('Ranked participant capabilities must be an array of strings.');
    }
    /* pool_tier is the three-value v1 compatibility wire. Curve-v2 callers
       always provide exact durable outcome ids; a missing projection must not
       reinterpret IVORY as a later GOLD milestone. */
    const fallback = legacyRankedOutcomeEntitlementsForTier(tier);
    return new Set(validateRankedOutcomeEntitlements(entitlementIds ?? fallback));
  });
  const sharedIds = RANKED_OUTCOME_DRAW_ORDER.filter((id) =>
    entitlementSets.every((entitlements) => entitlements.has(id)));
  const outcomes = sharedIds.map((id) => rankedOutcomeById(id)).filter((outcome) =>
    !outcome.requiredCapability
      || participants.every(({ capabilities }) => capabilities.includes(outcome.requiredCapability!)));

  const classic = outcomes.find((outcome) => outcome.id === 'classic');
  if (!classic) throw new Error('Every ranked outcome pool must contain Classic.');
  const additions = outcomes.length - 1;
  if (additions === 0) return Object.freeze([{ outcome: classic, weight: 1 }]);

  const classicRaw = 2 * additions;
  const additionRaw = 3;
  const divisor = gcd(classicRaw, additionRaw);
  return Object.freeze(outcomes.map((outcome) => Object.freeze({
    outcome,
    weight: outcome === classic ? classicRaw / divisor : additionRaw / divisor,
  })));
}

export function rankedOutcomeRoster(
  participants: readonly RankedParticipantAccess[],
): readonly Readonly<RankedOutcomeSpec>[] {
  const eligible = new Set(rankedOutcomePool(participants).map(({ outcome }) => outcome.id));
  return orderRankedOutcomes(RANKED_OUTCOMES.filter(({ id }) => eligible.has(id)));
}

export function pickRankedOutcomeWithRandom(
  participants: readonly RankedParticipantAccess[],
  random: () => number,
): Readonly<RankedOutcomeSpec> {
  const pool = rankedOutcomePool(participants);
  const total = pool.reduce((sum, { weight }) => sum + weight, 0);
  let target = unitDraw(random, 'Ranked outcome') * total;
  for (const entry of pool) {
    target -= entry.weight;
    if (target < 0) return entry.outcome;
  }
  throw new Error('Ranked outcome draw did not resolve.');
}

export function pickRankedOutcome(
  seed: string,
  participants: readonly RankedParticipantAccess[],
): Readonly<RankedOutcomeSpec> {
  if (typeof seed !== 'string' || !seed.length) {
    throw new TypeError('Ranked outcome seed must be a non-empty string.');
  }
  return pickRankedOutcomeWithRandom(participants, randStream(seed + '#ranked-outcome-v1'));
}
