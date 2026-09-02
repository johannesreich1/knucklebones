// Stable ranked-outcome identities, protocol capabilities, and the one
// player-facing teaching order. Weighted selection lives in ranked-outcomes;
// this module only names and orders outcomes, so a visual reorder cannot
// perturb a seeded draw.
import { MODES } from './modes.ts';
import { CLASSIC, type Mode } from './rules.ts';

export const STANDARD_FORMAT = 'standard' as const;
export const RUNE_TRIAL_FORMAT = 'rune_trial' as const;
export type RankedMatchFormat = typeof STANDARD_FORMAT | typeof RUNE_TRIAL_FORMAT;

export const RUNE_TRIAL_CAPABILITY = 'rune_trial_v1' as const;
export const EQUIPPED_RUNE_CAPABILITY = 'equipped_rune_v1' as const;
export const CURVE_V2_CAPABILITY = 'curve_v2' as const;
export const RUNE_TRIAL_CLAIM_CAPABILITY = 'rune_trial_claim_v2' as const;
export type RankedCapability = typeof RUNE_TRIAL_CAPABILITY
  | typeof EQUIPPED_RUNE_CAPABILITY
  | typeof CURVE_V2_CAPABILITY
  | typeof RUNE_TRIAL_CLAIM_CAPABILITY;
export const ALL_RANKED_CAPABILITIES: readonly RankedCapability[] = Object.freeze([
  RUNE_TRIAL_CAPABILITY,
  EQUIPPED_RUNE_CAPABILITY,
  CURVE_V2_CAPABILITY,
  RUNE_TRIAL_CLAIM_CAPABILITY,
]);

export function usesRankedActionProtocol(match: {
  protocol_version?: unknown;
  rune_rules_version?: unknown;
}): boolean {
  return match.protocol_version === 2 && match.rune_rules_version === 1;
}

export type RankedOutcomeUnlockGroup = 'stone' | 'bone' | 'ivory' | 'gold';

export interface RankedOutcomeSpec {
  id: string;
  format: RankedMatchFormat;
  modifier: string;
  mode: Mode;
  displayRank: number;
  unlockGroup: RankedOutcomeUnlockGroup;
  requiredCapability?: RankedCapability;
}

export const RANKED_OUTCOME_DISPLAY_ORDER: readonly string[] = Object.freeze([
  'classic', 'singlestrike', 'colshield', 'bounty', 'rowmult',
  RUNE_TRIAL_FORMAT, 'rowswitch', 'limited',
]);

const DISPLAY_RANK = new Map(RANKED_OUTCOME_DISPLAY_ORDER.map((id, rank) => [id, rank]));
const OUTCOME_UNLOCK_GROUP = new Map<string, RankedOutcomeUnlockGroup>([
  ['classic', 'stone'],
  ['singlestrike', 'stone'],
  ['colshield', 'stone'],
  ['bounty', 'stone'],
  ['rowmult', 'bone'],
  [RUNE_TRIAL_FORMAT, 'ivory'],
  ['rowswitch', 'gold'],
  ['limited', 'gold'],
]);

function displayRank(id: string): number {
  const rank = DISPLAY_RANK.get(id);
  if (rank === undefined) throw new RangeError(`Unknown ranked outcome id: ${id}`);
  return rank;
}

export function rankedOutcomeUnlockGroup(id: string): RankedOutcomeUnlockGroup {
  const group = OUTCOME_UNLOCK_GROUP.get(id);
  if (!group) throw new RangeError(`Unknown ranked outcome id: ${id}`);
  return group;
}

export function compareRankedOutcomeDisplayOrder(
  a: string | { id: string },
  b: string | { id: string },
): number {
  const aId = typeof a === 'string' ? a : a.id;
  const bId = typeof b === 'string' ? b : b.id;
  return displayRank(aId) - displayRank(bId);
}

export function orderRankedOutcomes<T extends string | { id: string }>(
  outcomes: readonly T[],
): readonly T[] {
  return Object.freeze([...outcomes].sort(compareRankedOutcomeDisplayOrder));
}

export const sortRankedOutcomesForDisplay = orderRankedOutcomes;

const standardOutcomes: RankedOutcomeSpec[] = MODES.map(({ id, mode }) => ({
  id,
  format: STANDARD_FORMAT,
  modifier: id,
  mode,
  displayRank: displayRank(id),
  unlockGroup: rankedOutcomeUnlockGroup(id),
}));

export const RUNE_TRIAL_OUTCOME: Readonly<RankedOutcomeSpec> = Object.freeze({
  id: RUNE_TRIAL_FORMAT,
  format: RUNE_TRIAL_FORMAT,
  modifier: 'classic',
  mode: CLASSIC,
  displayRank: displayRank(RUNE_TRIAL_FORMAT),
  unlockGroup: rankedOutcomeUnlockGroup(RUNE_TRIAL_FORMAT),
  requiredCapability: RUNE_TRIAL_CAPABILITY,
});

export const RANKED_OUTCOMES: readonly Readonly<RankedOutcomeSpec>[] = Object.freeze([
  ...standardOutcomes.map((outcome) => Object.freeze(outcome)),
  RUNE_TRIAL_OUTCOME,
]);

if (new Set(RANKED_OUTCOME_DISPLAY_ORDER).size !== RANKED_OUTCOME_DISPLAY_ORDER.length
  || RANKED_OUTCOME_DISPLAY_ORDER.length !== RANKED_OUTCOMES.length
  || !RANKED_OUTCOMES.every(({ id }) => DISPLAY_RANK.has(id))) {
  throw new Error('Ranked outcome display order must contain every outcome exactly once.');
}

export function rankedOutcomeById(id: unknown): Readonly<RankedOutcomeSpec> {
  if (typeof id !== 'string') throw new TypeError('Ranked outcome id must be a string.');
  const outcome = RANKED_OUTCOMES.find((candidate) => candidate.id === id);
  if (!outcome) throw new RangeError(`Unknown ranked outcome id: ${id}`);
  return outcome;
}

export function rankedOutcomesByIds(
  ids: readonly string[],
): readonly Readonly<RankedOutcomeSpec>[] {
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length) {
    throw new RangeError('Ranked outcome ids must be a unique array.');
  }
  return orderRankedOutcomes(ids.map(rankedOutcomeById));
}

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

export const RANKED_OUTCOME_DRAW_ORDER: readonly string[] = Object.freeze([
  'classic', 'singlestrike', 'colshield', 'limited',
  'rowswitch', 'rowmult', 'bounty', RUNE_TRIAL_FORMAT,
]);

if (new Set(RANKED_OUTCOME_DRAW_ORDER).size !== RANKED_OUTCOME_DRAW_ORDER.length
  || RANKED_OUTCOME_DRAW_ORDER.length !== RANKED_OUTCOMES.length
  || !RANKED_OUTCOMES.every(({ id }) => RANKED_OUTCOME_DRAW_ORDER.includes(id))) {
  throw new Error('Ranked outcome draw order must contain every outcome exactly once.');
}
