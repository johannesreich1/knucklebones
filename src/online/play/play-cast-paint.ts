// ONE CAST BEAT, TWO DRIVERS.
//
// A ranked rune is performed twice over: once by this client the moment the
// player taps, and once by the authoritative replay of the committed action
// log. They must look identical, so they are the same code — the tap path and
// play-sync's replay both compose the two functions below, and only the
// arguments differ.
//
// The beat splits where the SERVER'S authority starts:
//
//   the charge  — the card leaves the rail. Always the player's own doing, so
//                 it can always be painted at tap time.
//   the effect  — the board and the die in hand. Determined by (state, seat,
//                 column, die) for every rune that does not draw, which is
//                 every rune but FATE. `drawsFromSupply` is what declares that
//                 (core/spell-types.ts), and tests/spells.test.ts casts each
//                 spell against a draw() that records being reached, so the
//                 declaration cannot quietly stop being true.
import type { Player } from '../../core/rules.ts';
import type { CastCtx, SpellSpec } from '../../core/spells.ts';
import { disarm, renderSpells, spendChargePresentation } from '../../flow/spells.ts';
import { runSpellEffect } from '../../flow/spell-effects.ts';
import { S } from '../../state.ts';
import { setStageDie } from '../../ui/die.ts';

export interface ChargeBeat {
  /** A committed aim already spent this charge and reserved it for the cast. */
  reserved: boolean;
  /** Was the rune armed by hand? Then the outgoing card is shown face up. */
  faceUp: boolean;
}

/** The card leaving the rail, and the one-cast-per-turn latch that follows it. */
export function paintCastCharge(who: Player, spell: SpellSpec, beat: ChargeBeat): void {
  if (beat.reserved) disarm(true);
  else spendChargePresentation(who, spell, beat.faceUp);
  S.spellCastThisTurn = who;
  renderSpells();
}

/**
 * The rune's own choreography, around exactly one apply().
 *
 * `draw` is the supply port. The replay answers it from the committed row; the
 * tap path hands in a thunk that THROWS, because it is only ever called for a
 * rune that declared it does not draw — a throw names that contract breaking,
 * where inventing a face would silently paint a die the server never rolled.
 *
 * Answers the die left in hand, which the caller owes to `pendingDie`: a
 * self-target cast changes it, and a placement tapped before the projection
 * lands reads it to paint its own optimistic die.
 */
export async function paintCastEffect(
  who: Player,
  spell: SpellSpec,
  column: number,
  dieBefore: number,
  draw: () => number,
): Promise<number> {
  let die = dieBefore;
  const context: CastCtx = {
    mode: S.scoring,
    die,
    setDie(value: number) {
      die = value;
      this.die = value;
      S.die = value;
      setStageDie(value, who);
    },
    draw,
    bagLeft: null,
    charm: S.charm,
  };
  await runSpellEffect(spell.id, who, column,
    () => spell.apply(S.boards, who, column, context));
  return die;
}
