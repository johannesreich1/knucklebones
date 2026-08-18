// DOM geography: which element is where, given that the two players can swap
// screen halves. EVERY lookup goes through sideKey()/S.bottom — never assume
// P1 is at the bottom (pass mode swaps halves, face mode doesn't).
import { SPEC, AI, type Player } from '../core/rules.ts';
import { S } from '../state.ts';

export const $ = (s: string) => document.querySelector(s) as HTMLElement;

export function show(sel: string): void { $(sel).classList.add('on'); }
export function hide(sel: string): void { $(sel).classList.remove('on'); }

export function sideKey(who: Player): 'bot' | 'top' { return who === S.bottom ? 'bot' : 'top'; }
export function ownerOf(sideEl: HTMLElement): Player { return +sideEl.dataset.owner! as Player; }

export function slotEl(who: Player, col: number, slot: number): HTMLElement | null {
  return document.querySelector('#' + sideKey(who) + 'Board .col[data-col="' + col + '"] .slot[data-slot="' + slot + '"]');
}
/* dice stack toward the centre line, so it depends on the half, not the player */
export function slotIdx(who: Player, i: number): number {
  return sideKey(who) === 'bot' ? i : SPEC.rows - 1 - i;
}
export function colEl(who: Player, c: number): HTMLElement | null {
  return document.querySelector('#' + sideKey(who) + 'Board .col[data-col="' + c + '"]');
}
export function chipEl(who: Player, c: number): HTMLElement {
  return document.querySelectorAll('#' + sideKey(who) + 'Cols .chip')[c] as HTMLElement;
}

/* is this player's half displayed upside-down right now? (portrait face mode) */
export function faceRotated(who: Player): boolean {
  // Ask the question the CSS asks -- <html>.face -- not the two local settings
  // it happens to be derived from offline. Online sets S.mode='duo' purely to
  // unlock input gating and never owns S.seat, so re-deriving here rotated
  // every ranked score float for anyone whose local seating was face-to-face.
  return who === AI && document.documentElement.classList.contains('face') &&
         !document.documentElement.classList.contains('land');
}
