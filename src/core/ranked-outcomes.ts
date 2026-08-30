// Ranked outcomes sit one level above mechanical game modes.
//
// Most outcomes are ordinary matches: their stable outcome id and persisted
// modifier are the same mode-registry id. Rune Trial is deliberately different
// — it is a player-facing outcome and protocol phase, but the board underneath
// still replays with CLASSIC rules. Keeping that distinction here prevents an
// eighth pseudo-mode from leaking into scoring, AI, or replay code.
//
// Pure and shared by construction: callers bring participant access and the
// match seed (or an explicit random source in tests/offline play). No DOM,
// timers, storage, or ambient randomness belongs in this module.
import { randStream, unitDraw } from './dice.ts';
import { GROUPS } from './ladder.ts';
import { MODES } from './modes.ts';
import { CLASSIC, type Mode } from './rules.ts';

export const STANDARD_FORMAT = 'standard' as const;
export const RUNE_TRIAL_FORMAT = 'rune_trial' as const;
export type RankedMatchFormat = typeof STANDARD_FORMAT | typeof RUNE_TRIAL_FORMAT;

/* Older clients understand every ordinary mode but not the private-choice and
   cast-action protocol a Trial needs. Both participants must advertise this
   capability before Rune Trial can enter their shared outcome pool. */
export const RUNE_TRIAL_CAPABILITY = 'rune_trial_v1' as const;
/* Standard matches can only carry a profile's equipped rune when BOTH clients
   understand that those matches use the ordered action log too. Keep this
   distinct from Rune Trial: the already-deployed Trial client advertises the
   older capability but routes every standard match through pvp-move. Treating
   that as equipped-rune support would let a cached client bypass every cast. */
export const EQUIPPED_RUNE_CAPABILITY = 'equipped_rune_v1' as const;
export type RankedCapability = typeof RUNE_TRIAL_CAPABILITY
  | typeof EQUIPPED_RUNE_CAPABILITY;
export const ALL_RANKED_CAPABILITIES: readonly RankedCapability[] =
  Object.freeze([RUNE_TRIAL_CAPABILITY, EQUIPPED_RUNE_CAPABILITY]);

/** Does this persisted match use the ordered aim/cast/place action protocol? */
export function usesRankedActionProtocol(match: {
  protocol_version?: unknown;
  rune_rules_version?: unknown;
}): boolean {
  return match.protocol_version === 2 && match.rune_rules_version === 1;
}

export interface RankedOutcomeSpec {
  id: string;                    // player-facing, stable outcome id
  format: RankedMatchFormat;     // persisted protocol/flow discriminator
  modifier: string;              // persisted core mode id
  mode: Mode;                    // replay/scoring rule
  requiredCapability?: RankedCapability;
}

const standardOutcomes: RankedOutcomeSpec[] = MODES.map(({ id, mode }) => ({
  id,
  format: STANDARD_FORMAT,
  modifier: id,
  mode,
}));

export const RUNE_TRIAL_OUTCOME: Readonly<RankedOutcomeSpec> = Object.freeze({
  id: RUNE_TRIAL_FORMAT,
  format: RUNE_TRIAL_FORMAT,
  modifier: 'classic',
  mode: CLASSIC,
  requiredCapability: RUNE_TRIAL_CAPABILITY,
});

export const RANKED_OUTCOMES: readonly Readonly<RankedOutcomeSpec>[] = Object.freeze([
  ...standardOutcomes.map((outcome) => Object.freeze(outcome)),
  RUNE_TRIAL_OUTCOME,
]);

export function rankedOutcomeById(id: unknown): Readonly<RankedOutcomeSpec> {
  if (typeof id !== 'string') throw new TypeError('Ranked outcome id must be a string.');
  const outcome = RANKED_OUTCOMES.find((candidate) => candidate.id === id);
  if (!outcome) throw new RangeError(`Unknown ranked outcome id: ${id}`);
  return outcome;
}

/* The authoritative read boundary must validate BOTH fields. Falling back to
   Classic for an unknown format/modifier pair would replay a different game
   from the one the players saw. */
export function rankedOutcomeByMatch(
  format: unknown,
  modifier: unknown,
): Readonly<RankedOutcomeSpec> {
  if (typeof format !== 'string' || typeof modifier !== 'string') {
    throw new TypeError('Ranked match format and modifier must be strings.');
  }
  const outcome = RANKED_OUTCOMES.find((candidate) =>
    candidate.format === format && candidate.modifier === modifier);
  if (!outcome) throw new RangeError(`Unknown ranked match rules: ${format}/${modifier}`);
  return outcome;
}

/* ---- permanent ranked variety tiers ---------------------------------- */

export type RankedPoolTier = 'stone' | 'bone' | 'ivory';

export interface RankedPoolTierSpec {
  id: RankedPoolTier;
  floor: number;
  outcomeIds: readonly string[];
}

const groupFloor = (id: RankedPoolTier): number => {
  const group = GROUPS.find((candidate) => candidate.id === id);
  if (!group) throw new Error(`Ladder group required by ranked pools is missing: ${id}`);
  return group.floor;
};

/* Order is stable and therefore part of the deterministic draw. New tiers are
   cumulative: STONE starts with three additions, BONE adds the remaining
   ordinary modes, and IVORY adds Rune Trial. Higher ladder groups keep the
   IVORY pool. */
export const RANKED_POOL_TIERS: readonly Readonly<RankedPoolTierSpec>[] = Object.freeze([
  Object.freeze({
    id: 'stone',
    floor: groupFloor('stone'),
    outcomeIds: Object.freeze(['classic', 'singlestrike', 'colshield', 'limited']),
  }),
  Object.freeze({
    id: 'bone',
    floor: groupFloor('bone'),
    outcomeIds: Object.freeze([
      'classic', 'singlestrike', 'colshield', 'limited',
      'rowswitch', 'rowmult', 'bounty',
    ]),
  }),
  Object.freeze({
    id: 'ivory',
    floor: groupFloor('ivory'),
    outcomeIds: Object.freeze([
      'classic', 'singlestrike', 'colshield', 'limited',
      'rowswitch', 'rowmult', 'bounty', RUNE_TRIAL_FORMAT,
    ]),
  }),
]);

/* Fail during module initialization if a tier typo ever drifts from the
   outcome registry; a silently missing wheel entry would alter every weight. */
for (const tier of RANKED_POOL_TIERS) {
  for (const id of tier.outcomeIds) rankedOutcomeById(id);
}

export function rankedPoolTierById(id: unknown): Readonly<RankedPoolTierSpec> {
  if (typeof id !== 'string') throw new TypeError('Ranked pool tier id must be a string.');
  const tier = RANKED_POOL_TIERS.find((candidate) => candidate.id === id);
  if (!tier) throw new RangeError(`Unknown ranked pool tier id: ${id}`);
  return tier;
}

/* Peak points, not current points, grant access. That makes the result
   permanent across demotion; persistence only has to retain the existing
   high-water mark or the returned tier id. */
export function rankedPoolTierForPeak(peakPoints: number): RankedPoolTier {
  if (!Number.isInteger(peakPoints) || peakPoints < 0) {
    throw new RangeError('Peak ladder points must be a non-negative integer.');
  }
  let unlocked = RANKED_POOL_TIERS[0];
  for (const tier of RANKED_POOL_TIERS) {
    if (peakPoints >= tier.floor) unlocked = tier;
  }
  return unlocked.id;
}

export function highestRankedPoolTier(
  ...tiers: readonly RankedPoolTier[]
): RankedPoolTier {
  if (!tiers.length) throw new RangeError('At least one ranked pool tier is required.');
  let highest = RANKED_POOL_TIERS[0];
  for (const id of tiers) {
    const tier = rankedPoolTierById(id);
    if (tier.floor > highest.floor) highest = tier;
  }
  return highest.id;
}

/** The permanent outcomes gained while moving between cumulative pool tiers.
 * Presentation uses this rather than copying BONE/IVORY's current contents,
 * so a future registry addition automatically becomes one teaching slide. */
export function rankedPoolUnlocks(
  before: RankedPoolTier,
  after: RankedPoolTier,
): readonly Readonly<RankedOutcomeSpec>[] {
  const from = rankedPoolTierById(before);
  const to = rankedPoolTierById(after);
  if (to.floor < from.floor) {
    throw new RangeError('Ranked pool tiers are permanent and cannot move backwards.');
  }
  const alreadyAvailable = new Set(from.outcomeIds);
  return Object.freeze(RANKED_OUTCOMES.filter(({ id }) =>
    to.outcomeIds.includes(id) && !alreadyAvailable.has(id)));
}

export interface RankedParticipantAccess {
  tier: RankedPoolTier;
  /* Unknown future strings are intentionally harmless: old code ignores a
     capability it cannot use while still negotiating the capabilities it
     knows. */
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

/* Intersect both permanent tier access and protocol capabilities. Classic is
   exactly 40%; every eligible addition shares the remaining 60%. Integer
   ratios avoid floating drift:

     STONE  -> classic 2, each of 3 additions 1  (40/20/20/20)
     BONE   -> classic 4, each of 6 additions 1  (40/10/...)
     IVORY  -> classic 14, each of 7 additions 3 (40/8.571.../...)

   If Rune Trial is filtered from an IVORY pairing by an older client, the
   same rule naturally produces the BONE 4:1 distribution.

   The draw below reads these weights directly, so matchmaking, offline RANDOM,
   and the bot bench all use this one production distribution. */
export function rankedOutcomePool(
  participants: readonly RankedParticipantAccess[],
): readonly WeightedRankedOutcome[] {
  if (!participants.length) throw new RangeError('At least one ranked participant is required.');

  const tiers = participants.map(({ tier, capabilities }) => {
    if (!Array.isArray(capabilities)
      || !capabilities.every((capability) => typeof capability === 'string')) {
      throw new TypeError('Ranked participant capabilities must be an array of strings.');
    }
    return rankedPoolTierById(tier);
  });
  const sharedIds = tiers[0].outcomeIds.filter((id) =>
    tiers.every((tier) => tier.outcomeIds.includes(id)));
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

/* The pool order above is seed-sensitive and must not double as presentation
   order. Wheels and rosters follow the canonical outcome registry (ordinary
   MODES, then Rune Trial) while reusing the pool as the sole eligibility and
   capability boundary. */
export function rankedOutcomeRoster(
  participants: readonly RankedParticipantAccess[],
): readonly Readonly<RankedOutcomeSpec>[] {
  const eligible = new Set(rankedOutcomePool(participants).map(({ outcome }) => outcome.id));
  return Object.freeze(RANKED_OUTCOMES.filter(({ id }) => eligible.has(id)));
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
