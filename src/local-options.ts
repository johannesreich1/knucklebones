// Pure vocabulary and availability for offline setup. Mechanical modes remain
// in core/modes; Rune Trial is a format backed by Classic rules, so its setup
// promise lives beside the local controller rather than pretending to be an
// eighth scoring mode.
import { RANDOM } from './core/modes.ts';
import {
  RUNE_TRIAL_CAPABILITY,
  RUNE_TRIAL_FORMAT,
  STANDARD_FORMAT,
  pickRankedOutcome,
  rankedOutcomeRoster,
  type RankedOutcomeSpec,
  type RankedParticipantAccess,
  type RankedPoolTier,
} from './core/ranked-outcomes.ts';
import { RANDOM_DUAL_SPELL, RANDOM_SPELL, SPELLS, spellById, type SpellSpec } from './core/spells.ts';
import type { Mode as PlayMode } from './state.ts';

export const RUNE_TRIAL_PICK = -2;
export { RUNE_TRIAL_FORMAT };

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

/* WHAT OFFLINE PLAY MAY DRAW, as the ranked pool's own access record — so the
   dial's ring, the RANDOM draw and the picker's locks all read one roster
   instead of three hand-built ideas of it. The tier is an argument because this
   module stays pure; callers pass confirmedRankedPoolTier(). */
export function localPoolAccess(
  playMode: PlayMode,
  collected: readonly string[],
  tier: RankedPoolTier | null,
): RankedParticipantAccess {
  const capabilities = runeTrialAvailable(playMode, collected) ? [RUNE_TRIAL_CAPABILITY] : [];
  /* Pass-and-play is the one local mode that exposes the whole game, the same
     exception availableRuneSpecs makes for runes. An unknown tier fails closed
     to STONE: a device that has never confirmed an account has earned nothing,
     which is already how a signed-out player's rune collection reads. */
  return { tier: playMode === 'duo' ? 'ivory' : tier ?? 'stone', capabilities };
}

export function modePickAvailable(selected: number, access: RankedParticipantAccess): boolean {
  if (selected === RANDOM) return true;         // the promise itself is always offered
  const roster = rankedOutcomeRoster([access]);
  /* Discriminate on FORMAT, not the rules mode alone: Rune Trial replays under
     CLASSIC, so an id-blind match would let the Trial answer for Classic. */
  return selected === RUNE_TRIAL_PICK
    ? roster.some(({ id }) => id === RUNE_TRIAL_FORMAT)
    : roster.some((outcome) => outcome.format === STANDARD_FORMAT && outcome.mode === selected);
}

/** Ranked's exact 40/60 weights, over exactly the roster this player has earned. */
export function pickLocalOutcome(
  seed: string,
  access: RankedParticipantAccess,
): Readonly<RankedOutcomeSpec> {
  return pickRankedOutcome(seed, [access]);
}

export function isRuneTrialOutcome(outcome: Pick<RankedOutcomeSpec, 'format'> | null | undefined): boolean {
  return outcome?.format === RUNE_TRIAL_FORMAT;
}
