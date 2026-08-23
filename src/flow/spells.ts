// Spell orchestration: hands, legality, spend/undo, and turn lifecycle.
// Rendering, pointer gestures, and visible effects are separate leaves; every
// entry path still ends in cast(), so legality is decided exactly once.
import {
  AI,
  ME,
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
import { appRoot } from '../ui/embed.ts';
import { Sfx, vibrate } from '../ui/audio.ts';
import { nope } from '../ui/fx.ts';
import { renderBag } from '../ui/bag.ts';
import { setStageDie } from '../ui/die.ts';
import { renderSide } from '../ui/game/board.ts';
import { showHints } from '../ui/game/hints.ts';
import { setStatus } from '../ui/game/turn-state.ts';
import { stopTimer } from './timer.ts';
import { runSpellEffect } from './spell-effects.ts';
import { bindSpellGesture, clearSpellTargets, type SpellGesturePorts } from './spell-gestures.ts';
import { isAimedColumn, renderSpellRail, type SpellRailPorts } from './spell-rail.ts';

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
  S.spellUndo = null;
  disarm();
  renderSpells();
}

/* Ranked play has no spell layer. */
export function clearSpells(): void {
  S.spellCharges = [{}, {}];
  S.charm = freshCharm();
  S.spellUndo = null;
  disarm();
  renderSpells();
}

const gesturePorts: SpellGesturePorts = {
  arm,
  disarm,
  cast,
  castable,
  undoable,
  undoCast,
};

const railPorts: SpellRailPorts = {
  caster,
  castContext,
  chargesOf,
  undoable,
  bindRune: (button, id) => bindSpellGesture(button, id, gesturePorts),
};

export function renderSpells(): void {
  renderSpellRail(railPorts);
}

export function arm(id: string): void {
  if (S.spellArmed === id) return;
  S.spellArmed = id;
  renderSpells();
  const spell = spellById(id);
  if (spell) setStatus(spell.aim, S.turn as Player);
}

export function disarm(): void {
  if (!S.spellArmed) return;
  S.spellArmed = null;
  clearSpellTargets();
  renderSpells();
  if (S.phase === 'choose') flowPorts.onChoice();
}

/* An armed spell claims board input before placement. Wrong or empty targets
   cancel the aim and still consume the input event. */
export function castArmed(column: number | null): boolean {
  const id = S.spellArmed;
  if (!id) return false;
  const spell = spellById(id);
  const fits = column !== null && !!spell
    && (spell.target === 'self' ? column === -1 : column >= 0 && isAimedColumn(column));
  if (!fits) {
    Sfx.tap();
    disarm();
    return true;
  }
  void cast(id, column);
  return true;
}

/* Spend and perform for either a player gesture or the CPU. */
async function castBy(who: Player, spell: SpellSpec, column: number, context: CastCtx): Promise<boolean> {
  S.spellUndo = spell.target === 'self' && !spell.final ? {
    id: spell.id,
    who,
    die: S.die,
    pool: S.pool ? S.pool.slice() : null,
    charm: {
      wards: [S.charm.wards[0].slice(), S.charm.wards[1].slice()],
      sunder: [S.charm.sunder[0], S.charm.sunder[1]],
    },
  } : null;
  S.spellCharges[who][spell.id] = chargesOf(who, spell.id) - 1;
  S.busy = true;
  S.phase = 'anim';
  stopTimer();
  setStatus(S.mode === 'cpu' && who === AI ? 'AI — ' + spell.name : spell.name, who);
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
  if (!spell || who === null || chargesOf(who, id) <= 0
      || !spell.legal(S.boards as GameState, who, column, context)) {
    Sfx.tap();
    if (spell?.target === 'column' && column >= 0) nope(colEl(S.turn as Player, column));
    disarm();
    return false;
  }
  disarm();
  const over = await castBy(who, spell, column, context);
  if (over) return true;
  S.busy = false;
  S.phase = 'choose';
  showHints();
  flowPorts.onCastComplete();
  return true;
}

export function undoable(id: string): boolean {
  const undo = S.spellUndo;
  return !!undo && undo.id === id && undo.who === caster() && S.phase === 'choose' && !S.busy;
}

export function clearUndo(): void {
  S.spellUndo = null;
}

export function undoCast(): boolean {
  const undo = S.spellUndo;
  if (!undo || !undoable(undo.id)) return false;
  const spell = spellById(undo.id);
  S.spellUndo = null;
  S.die = undo.die;
  setStageDie(undo.die, undo.who);
  S.charm = {
    wards: [undo.charm.wards[0].slice(), undo.charm.wards[1].slice()],
    sunder: [undo.charm.sunder[0], undo.charm.sunder[1]],
  };
  if (undo.pool) {
    S.pool = undo.pool.slice();
    renderBag(S.pool.length);
  }
  S.spellCharges[undo.who][undo.id] = chargesOf(undo.who, undo.id) + 1;
  appRoot().querySelector('#dieStage')?.classList.remove('sundered');
  Sfx.tap();
  vibrate(12);
  renderSide(AI, true);
  renderSide(ME, true);
  renderSpells();
  showHints();
  setStatus((spell ? spell.name : 'Spell') + ' put back', undo.who);
  return true;
}

const DEMANDS: Record<string, number> = { easy: 30, medium: 16, hard: 10 };

/* The CPU casts before choosing its placement so the chooser sees the board
   and die left by the effect. */
export async function aiSpellTurn(who: Player): Promise<boolean> {
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
  return castBy(who, spell, column, context);
}

function castable(id: string): boolean {
  const who = caster();
  return who !== null && chargesOf(who, id) > 0;
}
