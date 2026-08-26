// A true restart keeps the current duel's resolved identity while delegating
// every board, timer, bag, spell, and generation reset to the one lifecycle.
import { AI, ME, type Player } from '../core/rules.ts';
import { dealtOf } from '../core/spells.ts';
import { S } from '../state.ts';
import { newGame } from './game.ts';

export function restartLocal(): void {
  if (S.tut) return;
  const scoring = S.scoring;
  const spells = [dealtOf(S.spellCharges[AI]), dealtOf(S.spellCharges[ME])] as const;
  /* S.starter points at the NEXT opener. Reverse it for this restart; newGame's
     normal flip restores the queued next opener without advancing rotation. */
  S.starter = (1 - S.starter) as Player;
  newGame({ scoring, spells, trial: S.localTrial });
}
