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
import { randStream } from './dice.ts';
import { GROUPS } from './ladder.ts';
import { MODES } from './modes.ts';
import { CLASSIC, type Mode } from './rules.ts';
import { SPELLS, spellById } from './spells.ts';

export const STANDARD_FORMAT = 'standard' as const;
export const RUNE_TRIAL_FORMAT = 'rune_trial' as const;
export type RankedMatchFormat = typeof STANDARD_FORMAT | typeof RUNE_TRIAL_FORMAT;

/* Older clients understand every ordinary mode but not the private-choice and
   cast-action protocol a Trial needs. Both participants must advertise this
   capability before Rune Trial can enter their shared outcome pool. */
export const RUNE_TRIAL_CAPABILITY = 'rune_trial_v1' as const;
export type RankedCapability = typeof RUNE_TRIAL_CAPABILITY;
export const ALL_RANKED_CAPABILITIES: readonly RankedCapability[] =
  Object.freeze([RUNE_TRIAL_CAPABILITY]);

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
   same rule naturally produces the BONE 4:1 distribution. */
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

function unitDraw(random: () => number, label: string): number {
  const draw = random();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
    throw new RangeError(`${label} random source must return a finite number in [0, 1).`);
  }
  return draw;
}

export function pickRankedOutcomeWithRandom(
  participants: readonly RankedParticipantAccess[],
  random: () => number,
): Readonly<RankedOutcomeSpec> {
  const pool = rankedOutcomePool(participants);
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
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

/* ---- Rune Trial offer and timeout choice ------------------------------ */

/* SPELLS remains the one rune roster. This derived list exists only to give
   selection helpers stable ids without duplicating the registry. */
export const RUNE_IDS: readonly string[] = Object.freeze(SPELLS.map(({ id }) => id));

function normalizedRuneCandidates(candidates: readonly string[]): string[] {
  const requested = new Set<string>();
  for (const id of candidates) {
    if (typeof id !== 'string' || !spellById(id)) throw new RangeError(`Unknown rune id: ${String(id)}`);
    if (requested.has(id)) throw new RangeError(`Duplicate rune id: ${id}`);
    requested.add(id);
  }
  if (requested.size < 3) throw new RangeError('Rune Trial needs at least three distinct runes.');
  /* Database result order must never change a seeded offer. Normalize every
     subset back to the canonical spell-registry order before shuffling. */
  return RUNE_IDS.filter((id) => requested.has(id));
}

export type RuneTrialOffer = readonly [string, string, string];

/* Partial Fisher-Yates: each ordered three-rune sample is equally likely, so
   each unordered 3-of-N offer is equally likely too. It always terminates and
   cannot repeat a rune. */
export function makeRuneTrialOffer(
  random: () => number,
  candidates: readonly string[] = RUNE_IDS,
): RuneTrialOffer {
  const pool = normalizedRuneCandidates(candidates);
  for (let index = 0; index < 3; index++) {
    const remaining = pool.length - index;
    const picked = index + Math.floor(unitDraw(random, 'Rune Trial offer') * remaining);
    [pool[index], pool[picked]] = [pool[picked], pool[index]];
  }
  return Object.freeze([pool[0], pool[1], pool[2]]) as RuneTrialOffer;
}

export function seededRuneTrialOffer(
  seed: string,
  candidates: readonly string[] = RUNE_IDS,
): RuneTrialOffer {
  if (typeof seed !== 'string' || !seed.length) {
    throw new TypeError('Rune Trial offer seed must be a non-empty string.');
  }
  return makeRuneTrialOffer(randStream(seed + '#rune-trial-offer-v1'), candidates);
}

function checkedOffer(offer: readonly string[]): RuneTrialOffer {
  if (offer.length !== 3) throw new RangeError('Rune Trial offer must contain exactly three runes.');
  normalizedRuneCandidates(offer);
  /* Preserve the presented order for choice; normalization above only
     validates known, distinct ids. */
  return offer as RuneTrialOffer;
}

export function pickRuneTrialChoice(
  offer: readonly string[],
  random: () => number,
): string {
  const checked = checkedOffer(offer);
  return checked[Math.floor(unitDraw(random, 'Rune Trial choice') * checked.length)];
}

export function seededRuneTrialAutoPick(
  seed: string,
  participantKey: string,
  offer: readonly string[],
): string {
  if (typeof seed !== 'string' || !seed.length) {
    throw new TypeError('Rune Trial auto-pick seed must be a non-empty string.');
  }
  if (typeof participantKey !== 'string' || !participantKey.length) {
    throw new TypeError('Rune Trial auto-pick participant key must be a non-empty string.');
  }
  const suffix = `#rune-trial-autopick-v1:${participantKey.length}:${participantKey}`;
  return pickRuneTrialChoice(offer, randStream(seed + suffix));
}
