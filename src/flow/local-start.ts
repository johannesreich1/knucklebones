// Resolve the OFFLINE setup promises before the shared local game lifecycle
// starts. This is the sole owner of local RANDOM and Rune Trial presentation;
// game.ts receives only concrete scoring and rune deals.
import { CLASSIC, ME, AI, type Mode } from '../core/rules.ts';
import { randStream } from '../core/dice.ts';
import { MODES, RANDOM, modeById } from '../core/modes.ts';
import {
  makeRuneTrialOffer,
  pickRuneTrialChoice,
  RUNE_TRIAL_OUTCOME,
} from '../core/ranked-outcomes.ts';
import { RANDOM_DUAL_SPELL, RANDOM_SPELL, spellById, type SpellSpec } from '../core/spells.ts';
import { modeCopy, runeTrialCopy } from '../i18n/index.ts';
import {
  RUNE_TRIAL_PICK,
  RUNE_TRIAL_FORMAT,
  availableRuneSpecs,
  isRuneTrialOutcome,
  modePickAvailable,
  pickLocalOutcome,
  runePickAvailable,
  runeTrialAvailable,
} from '../local-options.ts';
import { collectedRuneIds } from '../rune-collection-cache.ts';
import { S, type LocalRuneTrial } from '../state.ts';
import { colorOf, nameOf } from '../ui/identity.ts';
import { hide, show } from '../ui/dom.ts';
import { reveal } from '../ui/reveal.ts';
import { awaitTrialHandoff, requestTrialRuneChoice } from '../ui/trial-select.ts';
import { resolveSpellDeal, type SpellDeal } from './spell-deal.ts';

export interface ResolvedLocalStart {
  readonly scoring: Mode;
  readonly spells: Readonly<SpellDeal>;
  readonly trial?: LocalRuneTrial;
}

function localModeCopy(id: string): { name: string; blurb: string } {
  return id === RUNE_TRIAL_FORMAT ? runeTrialCopy() : modeCopy(id);
}

async function chooseLocalTrial(
  seed: string,
  candidates: readonly SpellSpec[],
): Promise<LocalRuneTrial | null> {
  const offer = makeRuneTrialOffer(
    randStream(seed + '#local-rune-trial-offer-v1'),
    candidates.map(({ id }) => id),
  );
  const offered = offer.map((id) => spellById(id)!).filter(Boolean);
  if (offered.length !== 3) throw new Error('Local Rune Trial offer did not resolve to three runes.');
  let mine: string | null = null;
  let theirs: string | null = null;
  if (S.mode === 'cpu') {
    /* The machine commits before the player sees the cards. Its own seeded
       stream keeps the uniform choice independent of timing and card order. */
    theirs = pickRuneTrialChoice(offer, randStream(seed + '#local-rune-trial-ai-v1'));
    mine = await requestTrialRuneChoice({
      offer: offered,
      player: { name: () => nameOf(ME), hue: colorOf(ME) },
    });
  } else {
    for (const who of [ME, AI] as const) {
      const ready = await awaitTrialHandoff({
        player: { name: () => nameOf(who), hue: colorOf(who) },
      });
      if (!ready) return null;
      const choice = await requestTrialRuneChoice({
        offer: offered,
        player: { name: () => nameOf(who), hue: colorOf(who) },
      });
      if (!choice) return null;
      if (who === ME) mine = choice;
      else theirs = choice;
    }
  }
  if (!mine || !theirs) return null;
  return { offer, spells: [theirs, mine] };
}

/* The two committed hands, in the seating the reveal turns them over in. */
const trialSides = (picked: LocalRuneTrial) => [
  { spell: spellById(picked.spells[ME])!, name: () => nameOf(ME), hue: colorOf(ME) },
  { spell: spellById(picked.spells[AI])!, name: () => nameOf(AI), hue: colorOf(AI) },
] as const;

/** Resolve a local setup into one immutable duel deal; null means selection was cancelled. */
export async function resolveLocalStart(): Promise<ResolvedLocalStart | null> {
  const collected = collectedRuneIds();
  const candidates = availableRuneSpecs(S.mode, collected);
  const trialEligible = runeTrialAvailable(S.mode, collected);
  const selectedMode = modePickAvailable(S.mode, S.localMode, collected) ? S.localMode : CLASSIC;
  const seed = Math.random().toString(36).slice(2);
  const outcome = selectedMode === RANDOM ? pickLocalOutcome(seed, trialEligible)
    : selectedMode === RUNE_TRIAL_PICK ? RUNE_TRIAL_OUTCOME : null;
  const trial = isRuneTrialOutcome(outcome);
  const mode = selectedMode === RANDOM && outcome && !trial ? modeById(outcome.modifier) : null;
  const effectiveSpell = runePickAvailable(S.mode, S.spell, collected) ? S.spell : '';
  const randomRunes = !trial && (effectiveSpell === RANDOM_SPELL || effectiveSpell === RANDOM_DUAL_SPELL)
    ? resolveSpellDeal(effectiveSpell, Math.random, candidates) : null;

  if (mode || randomRunes || trial) {
    hide('#ovEnd'); hide('#ovStart'); hide('#ovPractice');
  }
  /* The Trial's choice is a BEAT of the reveal, not a screen after it: the dial
     lands on RUNE TRIAL, the cards open over it, and both hands turn over on
     the stage the mode is still sitting on. Picked outright there is no dial,
     so the same act runs as the only beat. */
  const chosen: { trial: LocalRuneTrial | null } = { trial: null };
  const trialAct = {
    resolve: async () => {
      chosen.trial = await chooseLocalTrial(seed, candidates);
      return chosen.trial ? trialSides(chosen.trial) : null;
    },
  };
  if (selectedMode === RANDOM && outcome) {
    await reveal({
      mode: trial ? RUNE_TRIAL_OUTCOME : mode,
      modeCandidates: trialEligible ? [...MODES, RUNE_TRIAL_OUTCOME] : MODES,
      modeCopy: localModeCopy,
      spell: !trial && effectiveSpell === RANDOM_SPELL && randomRunes
        ? spellById(randomRunes[ME]) : null,
      runes: !trial && effectiveSpell === RANDOM_DUAL_SPELL && randomRunes ? [
        { spell: spellById(randomRunes[ME])!, player: ME },
        { spell: spellById(randomRunes[AI])!, player: AI,
          candidates: candidates.filter((spell) => spell.id !== randomRunes[ME]) },
      ] : undefined,
      trial: trial ? trialAct : undefined,
    });
  } else if (trial) {
    await reveal({ trial: trialAct });
  } else if (randomRunes) {
    const mine = spellById(randomRunes[ME]);
    const theirs = spellById(randomRunes[AI]);
    await reveal({
      spell: effectiveSpell === RANDOM_SPELL ? mine : null,
      runes: effectiveSpell === RANDOM_DUAL_SPELL && mine && theirs ? [
        { spell: mine, player: ME },
        { spell: theirs, player: AI,
          candidates: candidates.filter((spell) => spell.id !== mine.id) },
      ] : undefined,
    });
  }

  if (trial) {
    const picked = chosen.trial;
    if (!picked) { show('#ovPractice'); return null; }
    return { scoring: CLASSIC, spells: picked.spells, trial: picked };
  }
  return {
    scoring: mode?.mode ?? selectedMode as Mode,
    spells: randomRunes ?? resolveSpellDeal(effectiveSpell, () => 0, candidates),
  };
}
