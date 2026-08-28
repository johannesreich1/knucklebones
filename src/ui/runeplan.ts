// The rune plan: what one shuffle DECIDES, before a single card moves. Three
// modules split the deal by question — ui/runefelt.ts owns what the deck IS
// (geometry and markup), ui/runedeal.ts owns what the hands DO to it (the
// WAAPI beats and the draw), and this one owns the decision itself: the fresh
// cut, the scoop direction, the round-robin pile deal, the gather order, and
// therefore which fan slot ends on top of the assembled deck.
//
// It is pure data — no DOM, no timers, no animation vocabulary — so the claim
// dealBeat makes about the seat it hands the answer (how topSlot is spread
// over the fan) is measurable headlessly: pass these functions a random source
// of your own. The app passes none and gets Math.random, exactly as before.

/** a fresh cut of the roster — Fisher-Yates, because ui/ may hold randomness */
export function shuffledOrder(
  candidates: readonly number[],
  random: () => number = Math.random,
): number[] {
  const o = [...candidates];
  for (let i = o.length - 1; i > 0; i--) {
    const j = (random() * (i + 1)) | 0;
    [o[i], o[j]] = [o[j], o[i]];
  }
  return o;
}

/* THE PLAN of one shuffle, decided up front so the animation, the reduced-
   motion still and the draw all read the same physics. Slots are DOM indices
   (the spread, left to right). Randomness enters exactly three times — the
   fan order (ui/runedeal.ts's dealBeat), the scoop direction and the gather
   order — and the rest is mechanical:
   - the spread squares from either end (a dealer scoops left- or right-handed;
     without this the round-robin provably always tops a card from the same
     half of the spread — a tell the monte framing would make worse),
   - flick k takes the CURRENT TOP of the deck, round-robin across the piles,
   - the piles reassemble in gather order; the last pile's top card is the
     deck's top, and the deck's top is the answer. */
export interface ShufflePlan {
  stackSlots: number[];   // the scooped deck, bottom → top
  piles: number[][];      // each pile's slots, bottom → top
  gather: number[];       // [the base pile, then the two hopped onto it]
  finalStack: number[];   // the assembled deck, bottom → top
  topSlot: number;        // the slot whose card ends on top — the answer's
}
export function planShuffle(count: number, random: () => number = Math.random): ShufflePlan {
  const slots = [...Array(count).keys()];
  const stackSlots = random() < 0.5 ? slots.reverse() : slots;
  const piles: number[][] = [[], [], []];
  for (let k = 0; k < count; k++) piles[k % 3].push(stackSlots[count - 1 - k]);
  /* the deck reassembles on a SIDE pile only: the dealt card grows over the
     felt's centre, and a stack gathered there would vanish behind the very
     card it produced. A dealer pulls the deck aside to deal off it anyway. */
  const base = random() < 0.5 ? 0 : 2;
  const gather = [base, ...shuffledOrder([0, 1, 2].filter((p) => p !== base), random)];
  const finalStack = gather.flatMap((p) => piles[p]);
  return { stackSlots, piles, gather, finalStack, topSlot: finalStack[finalStack.length - 1] };
}
