// Pure vocabulary and availability for offline setup. Mechanical modes remain
// in core/modes; Rune Trial is a format backed by Classic rules, so its setup
// promise lives beside the local controller rather than pretending to be an
// eighth scoring mode.
import {
  RUNE_TRIAL_CAPABILITY,
  RUNE_TRIAL_FORMAT,
  RUNE_TRIAL_OUTCOME,
  pickRankedOutcome,
  type RankedOutcomeSpec,
} from './core/ranked-outcomes.ts';
import { RANDOM } from './core/modes.ts';
import { RANDOM_DUAL_SPELL, RANDOM_SPELL, SPELLS, spellById, type SpellSpec } from './core/spells.ts';
import type { Mode as PlayMode } from './state.ts';

export const RUNE_TRIAL_PICK = -2;
export { RUNE_TRIAL_FORMAT };

export function isLocalModePick(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= RUNE_TRIAL_PICK && Number(value) <= 6;
}

export function isLocalSpellPick(value: unknown): value is string {
  return value === '' || value === RANDOM_SPELL || value === RANDOM_DUAL_SPELL
    || (typeof value === 'string' && !!spellById(value));
}

export function availableRuneSpecs(playMode: PlayMode, collected: readonly string[]): readonly SpellSpec[] {
  if (playMode === 'duo') return SPELLS;
  const allowed = new Set(collected);
  return SPELLS.filter(({ id }) => allowed.has(id));
}

export function runePickAvailable(
  playMode: PlayMode,
  selected: string,
  collected: readonly string[],
): boolean {
  if (selected === '') return true;
  if (playMode === 'duo') return isLocalSpellPick(selected);
  const count = availableRuneSpecs(playMode, collected).length;
  if (selected === RANDOM_SPELL || selected === RANDOM_DUAL_SPELL) return count >= 2;
  return count > 0 && collected.includes(selected) && !!spellById(selected);
}

export function runeTrialAvailable(playMode: PlayMode, collected: readonly string[]): boolean {
  return playMode === 'duo' || availableRuneSpecs(playMode, collected).length >= 3;
}

export function modePickAvailable(playMode: PlayMode, selected: number, collected: readonly string[]): boolean {
  return selected !== RUNE_TRIAL_PICK || runeTrialAvailable(playMode, collected);
}

/** Ranked's exact 40/60 weights, but with Trial admitted only when local play can deal it. */
export function pickLocalOutcome(seed: string, trialEligible: boolean): Readonly<RankedOutcomeSpec> {
  return pickRankedOutcome(seed, [{
    tier: trialEligible ? 'ivory' : 'bone',
    capabilities: trialEligible ? [RUNE_TRIAL_CAPABILITY] : [],
  }]);
}

export function isRuneTrialOutcome(outcome: Pick<RankedOutcomeSpec, 'format'> | null | undefined): boolean {
  return outcome?.format === RUNE_TRIAL_FORMAT;
}

export function selectedLocalOutcome(selected: number): Readonly<RankedOutcomeSpec> | null {
  return selected === RUNE_TRIAL_PICK ? RUNE_TRIAL_OUTCOME : null;
}

export function modePromise(selected: number): boolean {
  return selected === RANDOM || selected === RUNE_TRIAL_PICK;
}
