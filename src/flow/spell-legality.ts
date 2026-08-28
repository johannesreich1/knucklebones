// Who may cast right now, and what is legal for them: pure queries over S and
// the rune registry. Nothing here mutates, animates, or performs a cast.
// These answers are ADVISORY — the rail dims from them and an expiring aim
// picks its column from them, while flow/spells' cast() remains the one
// authority that says yes, so legality is still decided exactly once.
import { ME, SPEC, type GameState, type Player } from '../core/rules.ts';
import { spellById, type CastCtx, type SpellSpec } from '../core/spells.ts';
import { S } from '../state.ts';
import { spellCasterAllowed } from './spell-cast-transport.ts';
import { currentCastContext } from './spell-context.ts';

/* The player who may cast right now: their turn, their choice, nothing else
   in flight. The CPU drives its production turn through
   aiSpellPlacementTurn(). */
export function caster(): Player | null {
  if (S.phase !== 'choose' || S.busy) return null;
  const who = S.turn as Player;
  if (S.mode === 'cpu' && who !== ME) return null;
  if (!spellCasterAllowed(who)) return null;
  return who;
}

export function chargesOf(who: Player, id: string): number {
  return S.spellCharges[who][id] ?? 0;
}

/* The lowest column this spell would accept right now, or -1 for none. ONE
   scan answers both questions the flow asks of a column rune: the rail only
   needs to know whether ANY column is legal, while a committed aim that runs
   out of clock needs the FIRST one. */
export function firstLegalColumn(spell: SpellSpec, who: Player, context: CastCtx): number {
  for (let column = 0; column < SPEC.cols; column++) {
    if (spell.legal(S.boards as GameState, who, column, context)) return column;
  }
  return -1;
}

function legalNow(spell: SpellSpec, who: Player, context: CastCtx): boolean {
  return spell.target === 'self'
    ? spell.legal(S.boards as GameState, who, -1, context)
    : firstLegalColumn(spell, who, context) >= 0;
}

export function castable(id: string): boolean {
  const spell = spellById(id);
  const who = caster();
  if (!spell || who === null || S.spellAimCommitted || S.spellCastThisTurn === who
      || chargesOf(who, id) <= 0) return false;
  return legalNow(spell, who, currentCastContext());
}
