// DOM geography: which element is where, given that the two players can swap
// screen halves. EVERY lookup goes through sideKey()/S.bottom — never assume
// P1 is at the bottom (pass mode swaps halves, face mode doesn't).
import { SPEC, AI, type Player } from '../core/rules';
import { S } from '../state';

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
  return who === AI && S.mode === 'duo' && S.seat === 'face' &&
         !document.documentElement.classList.contains('land');
}
