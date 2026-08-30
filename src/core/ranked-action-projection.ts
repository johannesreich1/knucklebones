import { poolSequence } from './dice.ts';
import {
  BOUNTY, LIMITED, ME, applyMove, freshCharm, isFull, isOver, legalCols,
  type Mode, type Player,
} from './rules.ts';
import { freshCharges, spellById } from './spells.ts';
import type {
  RankedActionRow, RankedActionState, RankedRuneDeal,
} from './ranked-action-types.ts';
import { rankedDieOk, rankedIntentOf } from './ranked-action-validation.ts';

/** Rebuild player-visible action state without exposing the private seed. */
export function projectRankedActions(
  rows: readonly RankedActionRow[],
  mode: Mode,
  dealt: RankedRuneDeal,
  openingDie?: number,
): RankedActionState | null {
  if (dealt.some((id) => id !== null && !spellById(id))) return null;
  const ordered = [...rows].sort((a, b) => a.idx - b.idx);
  const firstDie = ordered[0]?.die_before ?? openingDie;
  if (!rankedDieOk(firstDie)) return null;
  const limitedSize = mode === LIMITED ? poolSequence('size-only').length : null;
  const state: RankedActionState = {
    st: [[[], [], []], [[], [], []]], turn: ME, over: false, nextDie: firstDie,
    actionCount: 0, moveCount: 0, drawCount: 1, bounty: [0, 0], charm: freshCharm(),
    charges: [freshCharges(dealt[0]), freshCharges(dealt[1])],
    castThisTurn: false, pendingAim: null,
  };

  for (let index = 0; index < ordered.length; index++) {
    const row = ordered[index];
    if (row.idx !== index || row.who !== state.turn || state.over
        || state.nextDie !== row.die_before || !rankedDieOk(row.die_before)
        || (row.die_after !== null && !rankedDieOk(row.die_after))) return null;
    const who = state.turn;
    const intent = rankedIntentOf(row);
    if (!intent) return null;
    if (intent.kind === 'aim') {
      const spell = spellById(intent.rune_id);
      if (!spell?.commitsOnAim || spell.id !== dealt[who] || spell.target !== 'column'
          || state.castThisTurn || state.pendingAim !== null
          || (state.charges[who][spell.id] ?? 0) <= 0 || row.die_after !== row.die_before) return null;
      const context = {
        mode, die: row.die_before, setDie() {}, draw: () => 0,
        bagLeft: limitedSize === null ? null : limitedSize - state.drawCount,
        charm: state.charm,
      };
      let legal = false;
      for (let col = 0; col < 3; col++) legal ||= spell.legal(state.st, who, col, context);
      if (!legal) return null;
      state.charges[who][spell.id]--;
      state.castThisTurn = true;
      state.pendingAim = spell.id;
    } else if (intent.kind === 'cast') {
      const spell = spellById(intent.rune_id);
      const reserved = !!spell && state.pendingAim === spell.id;
      if (!spell || spell.id !== dealt[who]
          || (spell.commitsOnAim ? !reserved
            : state.pendingAim !== null || state.castThisTurn
              || (state.charges[who][spell.id] ?? 0) <= 0)
          || (spell.target === 'self' ? intent.target_col !== -1
            : intent.target_col < 0 || intent.target_col > 2)) return null;
      let die = row.die_before;
      let drew = false;
      const context = {
        mode, die,
        setDie(value: number) { die = value; this.die = value; },
        draw: () => {
          if (drew || !rankedDieOk(row.die_after)) return 0;
          drew = true;
          state.drawCount++;
          return row.die_after;
        },
        bagLeft: limitedSize === null ? null : limitedSize - state.drawCount,
        charm: state.charm,
      };
      if (!spell.legal(state.st, who, intent.target_col, context)) return null;
      spell.apply(state.st, who, intent.target_col, context);
      if (!reserved) {
        state.charges[who][spell.id]--;
        state.castThisTurn = true;
      }
      state.pendingAim = null;
      state.over = isFull(state.st[0]) || isFull(state.st[1]);
      const expectedAfter = state.over ? null : die;
      if (row.die_after !== expectedAfter) return null;
      state.nextDie = expectedAfter;
    } else {
      if (state.pendingAim !== null || row.move_idx !== state.moveCount
          || !legalCols(state.st[who]).includes(intent.placed_col)) return null;
      const destroyed = applyMove(
        state.st, who, intent.placed_col, row.die_before, mode, state.charm,
      );
      if (mode === BOUNTY) state.bounty[who] += destroyed;
      const bagLeft = limitedSize === null ? null : limitedSize - state.drawCount;
      state.over = isOver(state.st[who], bagLeft);
      state.moveCount++;
      if (state.over) {
        if (row.die_after !== null) return null;
        state.nextDie = null;
      } else {
        if (!rankedDieOk(row.die_after)) return null;
        state.turn = (1 - who) as Player;
        state.castThisTurn = false;
        state.nextDie = row.die_after;
        state.drawCount++;
      }
    }
    state.actionCount++;
  }
  return state;
}
