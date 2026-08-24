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

/* how many shells stand for `left` dice — one layer per quarter, and always a
   single die while any remain, so "nearly out" reads at a glance */
const layersOf = (left: number): number =>
  (left === 0 ? 0 : Math.max(1, Math.ceil((left / BAG_SIZE) * LAYERS)));

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
    /* the die that LEAVES, and the pile's last child because the layer rules
       are nth-child. It rides at whatever the top layer was and is the only
       thing that moves on a draw, so the shells below restack underneath it
       rather than fighting an animation for the same element. */
    const take = document.createElement('i');
    take.className = 'die take';
    pile.appendChild(take);
  }
}

/* what the bag is CURRENTLY PAINTING, which is not always what state holds:
   FA4 keeps the old count on screen while its exchange plays. -1 when there is
   no bag on this screen at all. */
export function bagLeft(): number {
  const bag = $('#bagStack') as HTMLElement;
  if (bag.hidden) return -1;
  const shown = Number(bag.querySelector('.bn')!.textContent);
  return Number.isFinite(shown) ? shown : -1;
}

/* left = dice still in the bag (the die in play has already been drawn).
   `silent` repaints without the pulse or the draw — for a caller that is
   rewinding the bag to a count the player has already seen (FA4). */
export function renderBag(left: number, opts: { silent?: boolean } = {}): void {
  const bag = $('#bagStack') as HTMLElement;
  if (bag.hidden) return;
  const n = Math.max(0, left);
  const num = bag.querySelector('.bn')!;
  const was = Number(num.textContent);
  const take = bag.querySelector('.take') as HTMLElement | null;

  if (String(n) !== num.textContent) {
    num.textContent = String(n);
    bag.classList.remove('tick');
    take?.classList.remove('drawn');
    if (!opts.silent) {
      void bag.offsetWidth;                           // restart the pulse and the lift
      bag.classList.add('tick');
      /* exactly one die left the bag: a DRAW, and it comes off the top of the
         stack the player was just looking at. Any other step — a fresh game, a
         reconnect that jumps, FA4 rewinding — is a re-sync and gets the new
         picture without a die coming off anything. */
      if (n === was - 1 && take) {
        take.style.setProperty('--lay', String(Math.max(0, layersOf(was) - 1)));
        take.classList.add('drawn');
      }
    }
  }
  bag.classList.toggle('empty', n === 0);
  /* the exact supply, as the length of the gutter column (styles/game/
     variants.css). BAG_SIZE lives here, so the fraction is computed here. */
  bag.style.setProperty('--bag-left', String(n / BAG_SIZE));
  const layers = layersOf(n);
  bag.querySelectorAll('.pile .die:not(.take)')
    .forEach((d, i) => d.classList.toggle('gone', i >= layers));
}
