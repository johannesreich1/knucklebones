// THE LIVE TURN CHANGES HANDS — one implementation for every driver.
//
// Local play, ranked standard and the ranked Rune Trial replay all move the
// turn between seats, and the same things on screen follow from it: the rune
// rail's forward card, the active plate, and the root's opponent-turn state
// (which the paired rail transforms read). Each driver used to do its own
// subset — the Trial replay did none of it, so a bot's turn moved the board
// and the die while the two rune cards sat frozen for the whole match.
//
// The only thing that really differs is WHO IS WATCHING: offline the screen
// belongs to ME (or, two-player, to nobody), and ranked it belongs to the seat
// this device is playing. That is the parameter; everything else is shared.
// Assigning the turn HERE is the point — a driver cannot move the seat without
// painting it.
import type { Player } from '../core/rules.ts';
import { S } from '../state.ts';
import { setActivePlate } from '../ui/game/turn-state.ts';
import { renderSpells } from './spells.ts';

export function handTurnTo(who: Player, viewer?: Player | null): void {
  S.turn = who;
  renderSpells();
  setActivePlate(viewer);
}
