// The rune felt: the deck's GEOMETRY and MARKUP, shared by the shuffle
// (ui/runedeal.ts drives these poses with WAAPI), the stills the design build
// renders, and the reduced-motion player. One module owns what the deck IS —
// where a card sits fanned, squared, piled or stacked, and how a card, its
// faces and the whole felt are drawn — so the animation, the CSS rest and
// every still read the same table. The shuffle itself (the plan, the beats,
// the draw) lives in ui/runedeal.ts.
import { SPELLS, type SpellSpec } from '../core/spells.ts';
import { spellCopy } from '../i18n/index.ts';
import { spellIcon, spellHue } from './spellicons.ts';

/* Where card i sits when the deck is fanned out: spread across the felt, each
   one a hair higher than the last so the stack has a thickness. ONE function,
   read by the markup below (through --x/--y/--o) and by the fan-in — geometry
   that disagreed with the CSS rest would settle with a visible jump. */
export const restOf = (i: number, count: number) => {
  const middle = (count - 1) / 2;
  return { x: (i - middle) * 38, y: -i, rot: (i - middle) * 5.5 };
};

/* The TABLE geometry of the shuffle: the pile row rides high on the felt —
   it is the DISPLAY space, where the dealt cards land and where the assembled
   deck waits for the draw — and the DEALING deck squares up at the bottom,
   fully below that row, so the source is never overlaid by the cards it deals
   (user call 2026-08-26: the deck used to sit on the fan line with the centre
   pile growing straight through it). stackOf(p, k) is stack position k on
   pile anchor p (0 = bottom). The jitter is deterministic and small — enough
   that a stack reads as cards rather than as one thick card, without a second
   source of randomness.
   EVERY y here is a PERCENTAGE OF THE CARD'S OWN HEIGHT (translate y%), never
   px: --card runs 58..96px and reaches its 58px floor on a short landscape phone, and
   a fixed-px row offset that cleared the title at 76px escaped the stage at
   40px (test20's 320px lanes caught it). Percentages keep the table identical
   at every size. */
export const PILES = [-122, 0, 122] as const;    // % of the card's own width
/* -9 with a 0.75 step keeps the ASSEMBLED stack's top card (k=5, rotated ±4°)
   inside the stage box on the 320px lanes — higher rows read nicer at 430px
   but test20's short-landscape check is the boundary that matters */
export const PILE_Y = -9;                        // the pile row, % above the fan line
/* 102 leaves a visible body gap after rotation between the remaining source
   stock and every pile card. At 92 their axis-aligned bodies still crossed by
   several pixels even though the unrotated card boxes only just cleared. */
export const DECK_Y = 102;                       // the dealing deck, at the felt's bottom
export const stackOf = (p: number, k: number) => ({
  x: PILES[p] + ((k % 3) - 1) * 1.4,
  y: PILE_Y - k * 0.75,
  rot: ((k * 7) % 9) - 4,
});
/* the deck squared IN HAND (between the scoop and the pile deal), at the
   bottom, fully below the pile row it deals up into, including rotated card
   corners rather than only the unrotated boxes */
export const squaredOf = (k: number) => ({
  x: ((k % 3) - 1) * 1.4,
  y: DECK_Y - k * 1.1,
  rot: ((k * 5) % 7) - 3,
});

/* WHICH RUNE a slot is holding, as the three things that say so. */
const faceOf = (pick: number) => {
  const s = SPELLS[pick];
  return { id: s.id, hue: spellHue(s.id), icon: spellIcon(s.id, 20) };
};

/* The deck, as markup — pure, so the design build renders the real one.
   `order` is which rune sits in which slot: a real deck is not sorted, and a
   deck that fanned out in registry order every single time would teach the
   player where their rune lives before it is drawn. Omitted (the design card,
   a still) it is the registry's own order.
   A deck with a card DRAWN is not a fan at all: it is the assembled stack the
   deal left behind — squared on a side pile, one card short off the top,
   clear of the dealt card — because that is what the animation comes to rest
   on. DOM order is stack order there, so the still needs no z-index. */
const deckCards = (order?: readonly number[], drawn?: string): string =>
  (order ?? SPELLS.map((_, i) => i)).map((pick, i, picks) => {
    const f = faceOf(pick), r = drawn ? stackOf(2, i) : restOf(i, picks.length);
    return `<i class="rcard${f.id === drawn ? ' drawn' : ''}" data-rune="${f.id}"`
      + ` style="--x:${r.x}%;--y:${r.y}%;--o:${r.rot}deg;color:${f.hue}">${f.icon}</i>`;
  }).join('');

/* One card anatomy for the reveal, the in-game charge stack and its drag
   ghost. Containers choose scale and state; the back, face and optional name
   never get redrawn as three subtly different objects. */
export function runeCardFaces(
  spec: SpellSpec,
  backSize = 20,
  faceSize = 44,
  labelled = true,
): string {
  return `<i class="rback">${spellIcon(spec.id, backSize)}</i>`
    + `<i class="rface">${spellIcon(spec.id, faceSize)}`
    + `${labelled ? `<span class="rlbl">${spellCopy(spec.id).name}</span>` : ''}</i>`;
}

/* The card that gets dealt — face-down unless `up`, which is the still's slot.
   Its BACK is a deck card's back, corner index and all, because it IS the card
   that was drawn: it starts life exactly on top of the stack it came off and
   grows out of the deck from there, so the two have to be the same object to
   look at. Nothing leaks early — the whole card is transparent until the draw
   begins, and by then the spread has already shown every rune it holds. */
const dealtCard = (spec: SpellSpec, up = false): string =>
  `<div class="rdealt${up ? ' up' : ''}" data-rune="${spec.id}" style="color:${spellHue(spec.id)}">`
  + `${runeCardFaces(spec)}</div>`;

/* The whole felt: the deck, and the card dealt off it. A turned-over still is
   necessarily a deck ONE CARD SHORT — and with a top draw, the missing card is
   the TOP one — so `up` stacks the deck with the answer's slot last and empties
   it, and a design card cannot picture a deal that never took anything. */
export const runeFelt = (spec: SpellSpec, up = false, order?: readonly number[]): string => {
  const registry = SPELLS.map((_, i) => i);
  const still = order ?? (up
    ? [...registry.filter((i) => SPELLS[i].id !== spec.id), SPELLS.indexOf(spec)]
    : registry);
  return `<div class="rfelt"><div class="rdeck">${deckCards(still, up ? spec.id : undefined)}</div>`
    + `${dealtCard(spec, up)}</div>`;
};
