// The LIMITED bag: how many dice are still to come, shown as a stack of
// FACE-DOWN dice beside the die in play. Deliberately anonymous — the mode's
// tension is knowing how MANY are left, not which. One implementation for
// both play paths (online derives the number from the public move log,
// offline from its local bag), so the two can never drift apart.
import { POOL_PER_FACE } from '../core/dice.ts';
import { DICE_FACES } from '../config.ts';
import { $ } from './dom.ts';

export const BAG_SIZE = POOL_PER_FACE * DICE_FACES;   // 24 dice, one whole match

const LAYERS = 4;                                     // pile depth at a full bag

export function showBag(on: boolean): void {
  const bag = $('#bagStack') as HTMLElement;
  bag.hidden = !on;
  if (!on) return;
  const pile = bag.querySelector('.pile')!;
  if (!pile.childElementCount) {
    for (let i = 0; i < LAYERS; i++) {
      const d = document.createElement('i');
      d.className = 'die';                            // the shell only: no pips, no owner
      pile.appendChild(d);
    }
  }
}

/* left = dice still in the bag (the die in play has already been drawn) */
export function renderBag(left: number): void {
  const bag = $('#bagStack') as HTMLElement;
  if (bag.hidden) return;
  const n = Math.max(0, left);
  const num = bag.querySelector('.bn')!;
  if (num.textContent !== String(n)) {
    num.textContent = String(n);
    bag.classList.remove('tick');
    void bag.offsetWidth;                             // restart the pulse
    bag.classList.add('tick');
  }
  bag.classList.toggle('empty', n === 0);
  // the pile thins as the bag empties — one layer per quarter, always showing
  // a single die while any remain, so "nearly out" reads at a glance
  const layers = n === 0 ? 0 : Math.max(1, Math.ceil((n / BAG_SIZE) * LAYERS));
  bag.querySelectorAll('.pile .die').forEach((d, i) => d.classList.toggle('gone', i >= layers));
}
