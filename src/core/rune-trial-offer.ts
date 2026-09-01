// WHICH RUNES a dealt Rune Trial puts in front of its two seats — a stage
// after ranked-outcomes.ts has already decided that the pairing plays a Trial
// at all. Kept apart from the outcome registry because it answers a different
// question from different data: the roster comes from the spell registry, not
// from the pool tiers, and only the two callers that actually deal a Trial
// (offline setup and the pvp-join match start) need it.
//
// DETERMINISM IS PROTOCOL. Client and server derive the same offer and the
// same never-picked fallback from the same match seed; the seed suffixes and
// the shuffle below are wire format, not implementation detail.
//
// Pure and shared by construction: callers bring the seed or an explicit
// random source. No DOM, timers, storage, or ambient randomness.
import { randStream, unitDraw } from './dice.ts';
import { SPELLS, spellById } from './spells.ts';

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

/* REWARD VERSION IS MATCH PROTOCOL, not presentation. Version 1 awards the
   winner's selected rune. Version 2 awards only the rune snapshotted as CLAIM
   when the winning player's resolved selection is that rune. Keep these
   constants beside the deterministic deal so every producer and consumer can
   name the same wire values without copying magic numbers. */
export const RUNE_TRIAL_SELECTED_REWARD_V1 = 1 as const;
export const RUNE_TRIAL_CLAIM_REWARD_V2 = 2 as const;
export type RuneTrialRewardVersion =
  | typeof RUNE_TRIAL_SELECTED_REWARD_V1
  | typeof RUNE_TRIAL_CLAIM_REWARD_V2;

export type RuneTrialClaimSlot = 0 | 1 | 2;

export interface RuneTrialClaimSnapshot {
  readonly rewardVersion: typeof RUNE_TRIAL_CLAIM_REWARD_V2;
  readonly slot: RuneTrialClaimSlot;
  readonly rune: string;
}

/* Partial Fisher-Yates: each ordered three-rune sample is equally likely, so
   each unordered 3-of-N offer is equally likely too. It always terminates and
   cannot repeat a rune. */
/**
 * How long a player has to choose from the three-rune offer.
 *
 * The server stamps `selection_deadline` from this when it deals the offer, and
 * the picker counts the same number down, so the bar a player watches is the
 * one the server will actually act on. Lowered from 30s to 10s (owner call,
 * 2026-08-29): thirty seconds of dead air is a long time to hold two players
 * still, and the choice is between three cards already on screen.
 *
 * The database only bounds it — start_ranked_match_v2 refuses a deadline in the
 * past or more than two minutes out — so this is the single place it is set.
 */
export const RUNE_TRIAL_PICK_SECS = 10;

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

/** Choose one of the already dealt cards without drawing or rebuilding the
 * offer. The caller persists both the slot and rune, making presentation and
 * settlement independent of future registry order. */
export function makeRuneTrialClaim(
  random: () => number,
  offer: readonly string[],
): RuneTrialClaimSnapshot {
  const checked = checkedOffer(offer);
  const slot = Math.floor(
    unitDraw(random, 'Rune Trial CLAIM') * checked.length,
  ) as RuneTrialClaimSlot;
  return Object.freeze({
    rewardVersion: RUNE_TRIAL_CLAIM_REWARD_V2,
    slot,
    rune: checked[slot],
  });
}

/** Domain-separated from offer generation, timeout choices and the dice. A
 * CLAIM rollout therefore cannot perturb any existing deterministic stream. */
export function seededRuneTrialClaim(
  seed: string,
  offer: readonly string[],
): RuneTrialClaimSnapshot {
  if (typeof seed !== 'string' || !seed.length) {
    throw new TypeError('Rune Trial CLAIM seed must be a non-empty string.');
  }
  return makeRuneTrialClaim(randStream(seed + '#rune-trial-claim-v2'), offer);
}

/** Normalize the private wire snapshot. Legacy rows intentionally return null;
 * a version-2 row is all-or-nothing because silently hiding a malformed CLAIM
 * would let the player make a choice under rules different from settlement. */
export function readRuneTrialClaimSnapshot(
  offer: readonly string[],
  rewardVersion: unknown,
  claimSlot: unknown,
  claimRune: unknown,
): RuneTrialClaimSnapshot | null {
  const checked = checkedOffer(offer);
  if (rewardVersion === undefined || rewardVersion === null
      || rewardVersion === RUNE_TRIAL_SELECTED_REWARD_V1) return null;
  if (rewardVersion !== RUNE_TRIAL_CLAIM_REWARD_V2) {
    throw new RangeError(`Unsupported Rune Trial reward version: ${String(rewardVersion)}`);
  }
  if (!Number.isInteger(claimSlot) || (claimSlot as number) < 0
      || (claimSlot as number) >= checked.length
      || typeof claimRune !== 'string'
      || checked[claimSlot as RuneTrialClaimSlot] !== claimRune) {
    throw new RangeError('Rune Trial CLAIM snapshot does not match its offer.');
  }
  return Object.freeze({
    rewardVersion: RUNE_TRIAL_CLAIM_REWARD_V2,
    slot: claimSlot as RuneTrialClaimSlot,
    rune: claimRune,
  });
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
