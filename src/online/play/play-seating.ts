// WHICH SIDE OF THE TABLE IS YOURS, AND WHAT COLOUR IT WEARS.
//
// Two different questions, and ranked is where they stop having the same
// answer. `data-owner` is the PROTOCOL seat: ownerOf() reads it to decide which
// board a placement lands on, the HUD chips key off it, and the spell cards
// carry the same index as data-seat. It must stay the server's number.
//
// The colour is not that question. Offline the two are safely identical — you
// are always ME (1), and in pass-and-play the two players share one screen, so
// colour SHOULD follow the player. Ranked breaks the tie: pvp-join seats the
// lower-rated participant as p1, so half of all matches hand the viewer seat 0
// — and a board coloured straight off the seat then paints the viewer in the
// opponent's colour, on a screen only the viewer is looking at.
import { S } from '../../state.ts';
import { $ } from '../../ui/dom.ts';
import { clearHuePair, paintHuePair } from '../../ui/hues.ts';
import type { Player } from '../../core/rules.ts';

/**
 * Seat the ranked board for the viewer.
 *
 * `data-owner` keeps the protocol seat on both sides. The hue pair is then
 * painted on the table so that `--p1` still means "you" — the rule the rest of
 * the app already states (the away plate, the scoreline, the active row all
 * read `--p1` as the player's own). When the viewer holds seat 1 that is
 * already true and the table is left alone; when they hold seat 0 the pair is
 * swapped on the table element, which every side, rune chip and spell card
 * inside it inherits.
 */
export function seatOnlineBoard(you: Player): void {
  $('#sideBot').dataset.owner = String(you);
  $('#sideTop').dataset.owner = String(1 - you);
  const table = $('#tableEl') as HTMLElement;
  if (you === 1) clearHuePair(table.style);
  else paintHuePair(table.style, [S.p2Hue, S.p1Hue], S.colorblind);
}

/** Hand the table's colours back to the app root's own pair. */
export function unseatOnlineBoard(): void {
  clearHuePair(($('#tableEl') as HTMLElement).style);
}
