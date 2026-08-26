// Authoritative ranked action replay for protocol-v2 Rune Trial matches.
//
// Ordinary ranked matches keep the compact placement-only replay in match.ts.
// A Trial needs a richer log because a cast may mutate the board, the die in
// hand, persistent charm state, and the finite LIMITED supply before the turn's
// placement. This module derives all of that from the private seed, revealed
// rune assignments, and participant-readable action rows. It is pure and is
// uploaded verbatim with the Edge Function that validates actions.
import { diceStream, poolSequence } from './dice.ts';
import {
  BOUNTY,
  LIMITED,
  ME,
  applyMove,
  freshCharm,
  isFull,
  isOver,
  legalCols,
  totalOf,
  type Mode,
  type Player,
} from './rules.ts';
import { freshCharges, spellById } from './spells.ts';
import { rankedDieOk, rankedIntentOf, sameRankedAction } from './ranked-action-validation.ts';
import type {
  RankedActionIntent,
  RankedActionRow,
  RankedActionState,
  RankedRuneDeal,
} from './ranked-action-types.ts';

export type {
  RankedActionIntent,
  RankedActionKind,
  RankedActionRow,
  RankedActionState,
  RankedRuneDeal,
} from './ranked-action-types.ts';
export { projectRankedActions } from './ranked-action-projection.ts';

interface Engine {
  state: RankedActionState;
  perform(intent: RankedActionIntent, expected?: RankedActionRow): RankedActionRow | null;
}

function makeEngine(seed: string, mode: Mode, dealt: RankedRuneDeal): Engine | null {
  if (typeof seed !== 'string' || !seed.length) return null;
  if (!spellById(dealt[0]) || !spellById(dealt[1])) return null;

  const bag = mode === LIMITED ? poolSequence(seed) : null;
  const stream = bag ? null : diceStream(seed);
  let drawCount = 0;
  const draw = (): number => {
    const value = bag ? (bag[drawCount] ?? 0) : stream!();
    if (value) drawCount++;
    return value;
  };

  const firstDie = draw();
  if (!rankedDieOk(firstDie)) return null;
  const state: RankedActionState = {
    st: [[[], [], []], [[], [], []]],
    turn: ME,
    over: false,
    nextDie: firstDie,
    actionCount: 0,
    moveCount: 0,
    drawCount,
    bounty: [0, 0],
    charm: freshCharm(),
    charges: [freshCharges(dealt[0]), freshCharges(dealt[1])],
    castThisTurn: false,
    pendingAim: null,
  };

  const perform = (intent: RankedActionIntent, expected?: RankedActionRow): RankedActionRow | null => {
    if (state.over || state.nextDie === null) return null;
    const who = state.turn;
    const dieBefore = state.nextDie;
    let row: RankedActionRow;

    if (intent.kind === 'aim') {
      const spell = spellById(intent.rune_id);
      if (!spell?.commitsOnAim || spell.id !== dealt[who] || state.castThisTurn
          || state.pendingAim !== null || (state.charges[who][spell.id] ?? 0) <= 0
          || spell.target !== 'column') return null;
      const context = {
        mode,
        die: dieBefore,
        setDie() {},
        draw: () => 0,
        bagLeft: bag ? bag.length - drawCount : null,
        charm: state.charm,
      };
      let legal = false;
      for (let col = 0; col < 3; col++) legal ||= spell.legal(state.st, who, col, context);
      if (!legal) return null;
      state.charges[who][spell.id]--;
      state.castThisTurn = true;
      state.pendingAim = spell.id;
      row = {
        idx: state.actionCount, move_idx: null, who, kind: 'aim', rune_id: spell.id,
        target_col: null, placed_col: null, die_before: dieBefore, die_after: dieBefore,
      };
    } else if (intent.kind === 'cast') {
      const spell = spellById(intent.rune_id);
      const reserved = !!spell && state.pendingAim === spell.id;
      if (!spell || intent.rune_id !== dealt[who] || state.pendingAim !== (reserved ? spell.id : null)
          || (spell.commitsOnAim ? !reserved
            : state.castThisTurn || (state.charges[who][spell.id] ?? 0) <= 0)) return null;
      if (spell.target === 'self' ? intent.target_col !== -1
        : !Number.isInteger(intent.target_col) || intent.target_col < 0 || intent.target_col > 2) {
        return null;
      }

      let die = dieBefore;
      const context = {
        mode,
        die,
        setDie(value: number) { die = value; this.die = value; },
        draw,
        bagLeft: bag ? bag.length - drawCount : null,
        charm: state.charm,
      };
      if (!spell.legal(state.st, who, intent.target_col, context)) return null;
      spell.apply(state.st, who, intent.target_col, context);
      if (!rankedDieOk(die)) return null;
      if (!reserved) {
        state.charges[who][spell.id]--;
        state.castThisTurn = true;
      }
      state.pendingAim = null;
      state.over = isFull(state.st[0]) || isFull(state.st[1]);
      state.nextDie = state.over ? null : die;
      state.drawCount = drawCount;
      row = {
        idx: state.actionCount,
        move_idx: null,
        who,
        kind: 'cast',
        rune_id: spell.id,
        target_col: intent.target_col,
        placed_col: null,
        die_before: dieBefore,
        die_after: state.nextDie,
      };
    } else {
      if (state.pendingAim !== null || !Number.isInteger(intent.placed_col)
          || !legalCols(state.st[who]).includes(intent.placed_col)) return null;
      const destroyed = applyMove(
        state.st,
        who,
        intent.placed_col,
        dieBefore,
        mode,
        state.charm,
      );
      if (mode === BOUNTY) state.bounty[who] += destroyed;
      const bagLeft = bag ? bag.length - drawCount : null;
      state.over = isOver(state.st[who], bagLeft);
      const moveIndex = state.moveCount++;
      if (state.over) {
        state.nextDie = null;
      } else {
        state.turn = (1 - who) as Player;
        state.castThisTurn = false;
        const next = draw();
        if (!rankedDieOk(next)) return null;
        state.nextDie = next;
      }
      state.drawCount = drawCount;
      row = {
        idx: state.actionCount,
        move_idx: moveIndex,
        who,
        kind: 'place',
        rune_id: null,
        target_col: null,
        placed_col: intent.placed_col,
        die_before: dieBefore,
        die_after: state.nextDie,
      };
    }

    state.actionCount++;
    return expected && !sameRankedAction(row, expected) ? null : row;
  };
  return { state, perform };
}

function replayEngine(
  seed: string,
  rows: readonly RankedActionRow[],
  mode: Mode,
  dealt: RankedRuneDeal,
): Engine | null {
  const engine = makeEngine(seed, mode, dealt);
  if (!engine) return null;
  const ordered = [...rows].sort((a, b) => a.idx - b.idx);
  for (let index = 0; index < ordered.length; index++) {
    const row = ordered[index];
    if (row.idx !== index || !rankedDieOk(row.die_before)
        || (row.die_after !== null && !rankedDieOk(row.die_after))) return null;
    const intent = rankedIntentOf(row);
    if (!intent || !engine.perform(intent, row)) return null;
  }
  return engine;
}

export function rebuildRankedActions(
  seed: string,
  rows: readonly RankedActionRow[],
  mode: Mode,
  dealt: RankedRuneDeal,
): RankedActionState | null {
  return replayEngine(seed, rows, mode, dealt)?.state ?? null;
}

/** Derive one authoritative row and the complete state after it. */
export function appendRankedAction(
  seed: string,
  rows: readonly RankedActionRow[],
  mode: Mode,
  dealt: RankedRuneDeal,
  intent: RankedActionIntent,
): { row: RankedActionRow; state: RankedActionState } | null {
  const engine = replayEngine(seed, rows, mode, dealt);
  if (!engine) return null;
  const row = engine.perform(intent);
  return row ? { row, state: engine.state } : null;
}

export function rankedActionTotal(state: RankedActionState, who: Player, mode: Mode): number {
  return totalOf(state.st[who], state.bounty[who], mode, state.charm.wards[who]);
}
