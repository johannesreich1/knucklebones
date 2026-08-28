// Spell orchestration: the dealt hands, the leaf wiring, the visible spend of
// a charge, and the cast that performs a rune. Aiming, legality queries,
// rendering, pointer gestures, and visible effects are separate leaves; every
// entry path still ends in cast(), so legality is decided exactly once.
import {
  AI, ME,
  freshCharm, isFull,
  type CharmSt, type GameState, type Player,
} from '../core/rules.ts';
import {
  SPELLS,
  freshCharges,
  spellById,
  type CastCtx,
  type SpellSpec,
} from '../core/spells.ts';
import { spellCopy, t } from '../i18n/index.ts';
import { S } from '../state.ts';
import { colEl } from '../ui/dom.ts';
import { Sfx } from '../ui/audio.ts';
import { nope } from '../ui/fx.ts';
import { showHints } from '../ui/game/hints.ts';
import { clearSealPresentation } from '../ui/game/seals.ts';
import { clearSunderPresentation } from '../ui/game/sunder-presentation.ts';
import { setStatus } from '../ui/game/turn-state.ts';
import { stopTimer } from './timer.ts';
import { runSpellEffect } from './spell-effects.ts';
import { bindSpellGesture, type SpellGesturePorts } from './spell-gestures.ts';
import {
  playSpellCharge,
  renderSpellRail,
  type SpellRailPorts,
} from './spell-rail.ts';
import { createSpellAim } from './spell-aim.ts';
import { castable, caster, chargesOf } from './spell-legality.ts';
import { runAiSpellTurn, type AiSpellTurnResult } from './spell-ai.ts';
import { resolveSpellDeal, type SpellDeal } from './spell-deal.ts';
import { transportSpellCast } from './spell-cast-transport.ts';
import { currentCastContext as castContext } from './spell-context.ts';

export { aiSpellDelay } from './spell-ai.ts';
export { chargesOf } from './spell-legality.ts';
export type { SpellDeal } from './spell-deal.ts';
export { setSpellTransport, type SpellTransport } from './spell-cast-transport.ts';

export interface SpellFlowPorts {
  onChoice: () => void;
  onCastComplete: () => void;
  onGameOver: () => void;
}

let flowPorts: SpellFlowPorts = {
  onChoice: () => undefined,
  onCastComplete: () => undefined,
  onGameOver: () => undefined,
};

export function configureSpellFlow(ports: SpellFlowPorts): void {
  flowPorts = ports;
}

const requestCast = (id: string, column: number): Promise<boolean> =>
  transportSpellCast(id, column) ?? cast(id, column);

/* Bound before gesturePorts below, which reads arm/disarm at module init. */
const aim = createSpellAim({
  cast: requestCast,
  render: renderSpells,
  onChoice: () => flowPorts.onChoice(),
  spendCharge: spendChargePresentation,
});
export const {
  applyAimPresentation, arm, castArmed, castArmedByIndex, disarm,
  resolveTimedOutSpellAim,
} = aim;
const { clearAim } = aim;

/* Resolve the setup promise ONCE before the reveal so every card shown is the
   hand actually dealt. Existing RANDOM remains shared. RANDOM ×2 samples the
   second seat from the remaining roster rather than retrying until it differs:
   it is uniform, deterministic under an injected stream, and cannot hang on a
   stub that returns the same number forever. Tuple order follows Player ids. */
function drawSpellDeal(
  random: () => number = Math.random,
  candidates: readonly SpellSpec[] = SPELLS,
): SpellDeal {
  return resolveSpellDeal(S.spell, random, candidates);
}

/* Both starts install a hand over the same clean slate — no aim, no charm, no
   leftover seal or sunder presentation. Only the charges differ. */
function installHands(charges: [Record<string, number>, Record<string, number>]): void {
  S.spellCharges = charges;
  S.charm = freshCharm();
  clearSealPresentation();
  clearSunderPresentation();
  S.spellAimCommitted = null;
  S.spellCastThisTurn = null;
  disarm(true);
  renderSpells();
}

export function resetSpells(dealt?: string | readonly [string, string]): void {
  const ids: readonly [string, string] = S.tut ? ['', '']
    : typeof dealt === 'string' ? [dealt, dealt]
      : dealt ?? drawSpellDeal();
  installHands([freshCharges(ids[AI]), freshCharges(ids[ME])]);
}

/* Ranked play has no spell layer. */
export function clearSpells(): void {
  installHands([{}, {}]);
}

const gesturePorts: SpellGesturePorts = {
  arm,
  disarm,
  cast: requestCast,
  castable,
};

const railPorts: SpellRailPorts = {
  caster,
  castContext,
  chargesOf,
  castable,
  bindRune: (button, id) => bindSpellGesture(button, id, gesturePorts),
};

export function renderSpells(): void {
  renderSpellRail(railPorts);
}

/* The visible spend of one charge: the outgoing card copy plus the counters
   the rail renders from. Shared with the ranked replay (online/play/play-sync) so
   the charge beat cannot drift between the two drivers. */
export function spendChargePresentation(who: Player, spell: SpellSpec, faceUp = false): void {
  playSpellCharge(who, spell.id, faceUp);
  S.spellCharges[who][spell.id] = Math.max(0, chargesOf(who, spell.id) - 1);
  S.spellCastThisTurn = who;
}

/* Spend and perform for either a player gesture or the CPU. */
async function castBy(
  who: Player,
  spell: SpellSpec,
  column: number,
  context: CastCtx,
  chargeReserved = false,
  cardFaceUp = false,
): Promise<boolean> {
  if (!chargeReserved) spendChargePresentation(who, spell, cardFaceUp);
  S.busy = true;
  S.phase = 'anim';
  stopTimer();
  setStatus(() => {
    const name = spellCopy(spell.id).name;
    return S.mode === 'cpu' && who === AI
      ? t('game', 'status.aiSpell', { spell: name }) : name;
  }, who);
  renderSpells();
  const generation = S.gen;
  await runSpellEffect(spell.id, who, column,
    () => spell.apply(S.boards as GameState, who, column, context));
  if (S.gen !== generation) return true;
  renderSpells();
  if (isFull(S.boards[ME]) || isFull(S.boards[AI])) {
    flowPorts.onGameOver();
    return true;
  }
  return false;
}

export async function cast(id: string, column: number): Promise<boolean> {
  const spell = spellById(id);
  const who = caster();
  const context = castContext();
  if (!spell || who === null) {
    Sfx.tap();
    disarm();
    return false;
  }
  const chargeReserved = !!S.spellAimCommitted
    && S.spellAimCommitted.id === id && S.spellAimCommitted.who === who;
  if ((!chargeReserved && (chargesOf(who, id) <= 0 || S.spellCastThisTurn === who))
      || !spell.legal(S.boards as GameState, who, column, context)) {
    Sfx.tap();
    if (spell.target === 'column' && column >= 0) nope(colEl(S.turn as Player, column));
    disarm();
    return false;
  }
  const cardFaceUp = S.spellArmed === id && !chargeReserved;
  clearAim();
  const over = await castBy(who, spell, column, context, chargeReserved, cardFaceUp);
  if (over) return true;
  S.busy = false;
  S.phase = 'choose';
  showHints();
  flowPorts.onCastComplete();
  return true;
}

export async function aiSpellTurn(who: Player, waitForTell = true): Promise<boolean> {
  return (await runAiSpellTurn(who, { chargesOf, castContext, castBy }, waitForTell)).gameOver;
}

/* Production CPU turns coordinate a tentative cast with the normal placement
   chooser. The boolean-only hook above stays stable for browser probes. */
export function aiSpellPlacementTurn(
  who: Player,
  previewPlacement: (rootCharm?: CharmSt) => number,
  waitForTell = true,
): Promise<AiSpellTurnResult> {
  return runAiSpellTurn(
    who,
    { chargesOf, castContext, castBy, previewPlacement },
    waitForTell,
  );
}
