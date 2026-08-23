// Spell orchestration: hands, legality, commitment, and turn lifecycle.
// Rendering, pointer gestures, and visible effects are separate leaves; every
// entry path still ends in cast(), so legality is decided exactly once.
import {
  AI,
  ME,
  SPEC,
  freshCharm,
  isFull,
  type GameState,
  type Player,
} from '../core/rules.ts';
import {
  RANDOM_SPELL,
  SPELLS,
  freshCharges,
  machineCast,
  spellById,
  type CastCtx,
  type SpellSpec,
} from '../core/spells.ts';
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
   in flight. The CPU drives its own cast through aiSpellTurn(). */
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

/* RANDOM is drawn once before the reveal so the shown rune and dealt rune are
   the same answer. */
export function drawSpell(): string {
  if (S.spell !== RANDOM_SPELL) return S.spell;
  return SPELLS[(Math.random() * SPELLS.length) | 0].id;
}

export function resetSpells(dealt?: string): void {
  const id = S.tut ? '' : (dealt ?? drawSpell());
  S.spellCharges = [freshCharges(id), freshCharges(id)];
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
  setStatus(spell.aim, who);
  return true;
}

function clearAimState(): void {
  S.spellArmed = null;
  S.spellAimCommitted = null;
  clearSpellTargets();
}

export function disarm(force = false): boolean {
  if (S.spellAimCommitted && !force) return false;
  if (!S.spellArmed && !S.spellAimCommitted) return true;
  clearAimState();
  renderSpells();
  if (S.phase === 'choose') flowPorts.onChoice();
  return true;
}

/* An armed spell claims board input before placement. Wrong or empty targets
   cancel the aim and still consume the input event. */
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
  setStatus(S.mode === 'cpu' && who === AI ? 'AI — ' + spell.name : spell.name, who);
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

const CPU_SPELL_DELAY_MIN = 320;
const CPU_SPELL_DELAY_SPREAD = 580;
const pause = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/* A chosen computer cast gets a small tell: enough time to see its card in
   hand before it turns, never enough to read as a stall. Injecting the sample
   keeps the bounds directly testable without making production deterministic. */
export function aiSpellDelay(random: () => number = Math.random): number {
  const sample = Math.max(0, Math.min(0.999999, random()));
  return CPU_SPELL_DELAY_MIN + Math.floor(sample * (CPU_SPELL_DELAY_SPREAD + 1));
}

/* The machine never enters a player-visible aim state, so its cast reserves
   and spends in one step. */
export async function aiSpellTurn(who: Player, waitForTell = true): Promise<boolean> {
  const id = Object.keys(S.spellCharges[who]).find((key) => chargesOf(who, key) > 0);
  const spell = spellById(id);
  if (!spell) return false;
  if (S.diff === 'easy' && Math.random() < 0.5) return false;
  const context = castContext();
  const column = machineCast(
    S.boards as GameState,
    who,
    spell,
    context,
    DEMANDS[S.diff] ?? DEMANDS.medium,
  );
  if (column === null) return false;
  if (waitForTell) {
    const generation = S.gen;
    await pause(aiSpellDelay());
    if (S.gen !== generation || S.turn !== who || S.phase === 'over') return false;
  }
  return castBy(who, spell, column, context);
}

/*
 * The former spell take-back snapshot was removed when the full shipped
 * roster adopted one rule: aiming may cancel before commitment, but a cast
 * cannot be undone after commitment.
 */

const DEMANDS: Record<string, number> = { easy: 30, medium: 16, hard: 10 };
