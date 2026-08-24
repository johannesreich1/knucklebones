// Spell orchestration: hands, legality, commitment, and turn lifecycle.
// Rendering, pointer gestures, and visible effects are separate leaves; every
// entry path still ends in cast(), so legality is decided exactly once.
import {
  AI,
  ME,
  SPEC,
  freshCharm,
  isFull,
  type CharmSt,
  type GameState,
  type Player,
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
import { renderBag } from '../ui/bag.ts';
import { setStageDie } from '../ui/die.ts';
import { showHints } from '../ui/game/hints.ts';
import { clearSealPresentation } from '../ui/game/seals.ts';
import { clearSunderPresentation } from '../ui/game/sunder-presentation.ts';
import { setStatus } from '../ui/game/turn-state.ts';
import { stopTimer } from './timer.ts';
import { runSpellEffect } from './spell-effects.ts';
import { bindSpellGesture, clearSpellTargets, type SpellGesturePorts } from './spell-gestures.ts';
import {
  isAimedColumn,
  playSpellCharge,
  renderSpellRail,
  type SpellRailPorts,
} from './spell-rail.ts';
import type { SpellInputTarget } from './spell-target.ts';
import { runAiSpellTurn, type AiSpellTurnResult } from './spell-ai.ts';
import { resolveSpellDeal, type SpellDeal } from './spell-deal.ts';

export { aiSpellDelay } from './spell-ai.ts';
export type { SpellDeal } from './spell-deal.ts';

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

/* The player who may cast right now: their turn, their choice, nothing else
   in flight. The CPU drives its production turn through
   aiSpellPlacementTurn(). */
function caster(): Player | null {
  if (S.phase !== 'choose' || S.busy) return null;
  const who = S.turn as Player;
  if (S.mode === 'cpu' && who !== ME) return null;
  return who;
}

/* One live context for every caster. Local supply intentionally uses
   Math.random; LIMITED consumes the real finite bag. */
function castContext(): CastCtx {
  return {
    mode: S.scoring,
    die: S.die,
    setDie: (value) => {
      S.die = value;
      setStageDie(value, S.turn as Player);
    },
    draw: () => {
      if (!S.pool) return 1 + ((Math.random() * 6) | 0);
      const value = S.pool.shift()!;
      renderBag(S.pool.length);
      return value;
    },
    bagLeft: S.pool ? S.pool.length : null,
    charm: S.charm,
  };
}

export function chargesOf(who: Player, id: string): number {
  return S.spellCharges[who][id] ?? 0;
}

/* Resolve the setup promise ONCE before the reveal so every card shown is the
   hand actually dealt. Existing RANDOM remains shared. RANDOM ×2 samples the
   second seat from the remaining roster rather than retrying until it differs:
   it is uniform, deterministic under an injected stream, and cannot hang on a
   stub that returns the same number forever. Tuple order follows Player ids. */
export function drawSpellDeal(random: () => number = Math.random): SpellDeal {
  return resolveSpellDeal(S.spell, random);
}

/* Kept as the singular compatibility seam for focused helpers that ask for
   the selected/shared answer. New lifecycle code passes the full deal. */
export function drawSpell(random: () => number = Math.random): string {
  return drawSpellDeal(random)[ME];
}

export function resetSpells(dealt?: string | readonly [string, string]): void {
  const ids: readonly [string, string] = S.tut ? ['', '']
    : typeof dealt === 'string' ? [dealt, dealt]
      : dealt ?? drawSpellDeal();
  S.spellCharges = [freshCharges(ids[AI]), freshCharges(ids[ME])];
  S.charm = freshCharm();
  clearSealPresentation();
  clearSunderPresentation();
  S.spellAimCommitted = null;
  disarm(true);
  renderSpells();
}

/* Ranked play has no spell layer. */
export function clearSpells(): void {
  S.spellCharges = [{}, {}];
  S.charm = freshCharm();
  clearSealPresentation();
  clearSunderPresentation();
  S.spellAimCommitted = null;
  disarm(true);
  renderSpells();
}

const gesturePorts: SpellGesturePorts = {
  arm,
  disarm,
  cast,
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

export function arm(id: string): boolean {
  if (S.spellArmed === id) return true;
  if (S.spellAimCommitted) return false;
  const who = caster();
  const spell = spellById(id);
  if (who === null || !spell || !castable(id)) return false;
  S.spellArmed = id;
  if (spell.commitsOnAim) {
    playSpellCharge(who, id);
    S.spellCharges[who][id] = chargesOf(who, id) - 1;
    S.spellAimCommitted = { id, who };
  }
  renderSpells();
  setStatus(() => spellCopy(spell.id).aim, who);
  return true;
}

function clearAimState(): void {
  S.spellArmed = null;
  S.spellAimCommitted = null;
  clearSpellTargets();
}

export function disarm(force = false): boolean {
  if ((S.spellAimCommitted || spellById(S.spellArmed)?.locksOnAim) && !force) return false;
  if (!S.spellArmed && !S.spellAimCommitted) return true;
  clearAimState();
  renderSpells();
  if (S.phase === 'choose') flowPorts.onChoice();
  return true;
}

/* An armed spell claims board input before placement. Wrong or empty targets
   consume the input event; ordinary aims cancel, while a registry-locked aim
   stays open until it receives a legal answer. */
export function castArmed(target: SpellInputTarget | null): boolean {
  const id = S.spellArmed;
  if (!id) return false;
  const spell = spellById(id);
  const who = S.turn as Player;
  const targetSide = spell?.side === 'foe' ? (1 - who) as Player : who;
  const fits = !!target && !!spell && (spell.target === 'self'
    ? target.kind === 'stage'
    : target.kind === 'column' && target.who === targetSide
      && isAimedColumn(target.who, target.column));
  if (!fits) {
    Sfx.tap();
    disarm();
    return true;
  }
  void cast(id, target.kind === 'stage' ? -1 : target.column);
  return true;
}

/* Number keys select the uniquely expected side for the armed spell. Physical
   pointer paths carry their actual side through SpellInputTarget instead. */
export function castArmedByIndex(column: number): boolean {
  const spell = spellById(S.spellArmed);
  if (!spell) return false;
  /* An armed self spell still owns the number key. A column key is the wrong
     target for it, so feed that mismatch through the normal cancellation path
     instead of falling through to ordinary placement. */
  if (spell.target !== 'column') return castArmed(null);
  const who = S.turn as Player;
  const side = (spell.side === 'foe' ? 1 - who : who) as Player;
  return castArmed({ kind: 'column', who: side, column });
}

/* The normal turn clock keeps running while a rune is aimed. An ordinary aim
   simply falls away at expiry; an information-bearing ANVIL aim has already
   committed, so expiry selects its first legal marked column instead of
   refunding it or letting the duel stall forever. A completed cast receives
   the usual fresh placement clock through onCastComplete(). */
export async function resolveTimedOutSpellAim(): Promise<boolean> {
  const id = S.spellArmed;
  if (!id) return false;
  if (!S.spellAimCommitted) {
    disarm(true);
    return false;
  }
  const spell = spellById(id);
  const who = caster();
  if (!spell || who === null || spell.target !== 'column') return false;
  const context = castContext();
  for (let column = 0; column < SPEC.cols; column++) {
    if (spell.legal(S.boards as GameState, who, column, context)) {
      return cast(id, column);
    }
  }
  return false;
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
  if (!chargeReserved) {
    playSpellCharge(who, spell.id, cardFaceUp);
    S.spellCharges[who][spell.id] = chargesOf(who, spell.id) - 1;
  }
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
  if ((!chargeReserved && chargesOf(who, id) <= 0)
      || !spell.legal(S.boards as GameState, who, column, context)) {
    Sfx.tap();
    if (spell.target === 'column' && column >= 0) nope(colEl(S.turn as Player, column));
    disarm();
    return false;
  }
  const cardFaceUp = S.spellArmed === id && !chargeReserved;
  clearAimState();
  const over = await castBy(who, spell, column, context, chargeReserved, cardFaceUp);
  if (over) return true;
  S.busy = false;
  S.phase = 'choose';
  showHints();
  flowPorts.onCastComplete();
  return true;
}

function legalNow(spell: SpellSpec, who: Player, context: CastCtx): boolean {
  if (spell.target === 'self') return spell.legal(S.boards as GameState, who, -1, context);
  for (let column = 0; column < SPEC.cols; column++) {
    if (spell.legal(S.boards as GameState, who, column, context)) return true;
  }
  return false;
}

function castable(id: string): boolean {
  const spell = spellById(id);
  const who = caster();
  if (!spell || who === null || S.spellAimCommitted || chargesOf(who, id) <= 0) return false;
  return legalNow(spell, who, castContext());
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

/*
 * The former spell take-back snapshot was removed when the full shipped
 * roster adopted one rule: aiming may cancel before commitment, but a cast
 * cannot be undone after commitment.
 */
