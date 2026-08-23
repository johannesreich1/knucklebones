// The rune deal: one beat of the pre-game reveal (ui/reveal.ts), in which the
// rune both seats will carry is drawn from a deck.
//
// Dealing beats spinning for a table game — the deck riffles, one card is
// drawn, and the rune arrives as an object you could pick up. The drama is in
// the SHUFFLE, not the turn: a turn is a half-second, so the deck works for
// nearly three before anything is drawn — the card-deal alternative from the
// mode-spinner study proposed this and called that out as the thing that would
// make or break it. (That study's losing cards were retired 2026-08-22; the
// mode reveal is the orbit dial, and the deck deals the RUNE instead.)
//
// THE DECK IS THE ROSTER. Every card is a real spell from core/spells, in its
// own hue, wearing its own icon in the corner like a playing card's index — so
// a rune added to the registry joins the shuffle for free, and the fan is an
// honest picture of what could come out.
//
// WHERE THE ANSWER IS is what the shuffle decides. The fan shows every rune and
// none of them is the answer until a card is DRAWN, out of the one slot the
// shuffle happened to leave it in; the turn that follows is the card being
// presented, not the moment it is decided. A card that rose out of the middle
// every time (the first build) made the whole shuffle decoration.
//
// The MOTION lives here as WAAPI, the RESTING LAYOUT lives in main.css, and
// both read the same geometry (restOf) — so a still (a design card, or a
// reduced-motion player) shows exactly the deck the animation comes to rest on.
import { SPELLS, type SpellSpec } from '../core/spells.ts';
import { spellIcon, spellHue } from './spellicons.ts';
import { Sfx, vibrate } from './audio.ts';
import { REDUCED } from './fx.ts';
import type { Beat } from './reveal-types.ts';
import { appRoot } from './embed.ts';

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const MID = (SPELLS.length - 1) / 2;

/* Where card i sits when the deck is squared up: fanned across the felt, each
   one a hair higher than the last so the stack has a thickness. ONE function,
   read by the markup below (through --x/--y/--o) and by every animation — a
   riffle that arched back to a different resting place than the CSS draws
   would settle with a visible jump. */
const restOf = (i: number) => ({ x: (i - MID) * 38, y: -i, rot: (i - MID) * 5.5 });

/* WHICH RUNE a slot is holding, as the three things that say so. ONE
   description, two renderers: deckCards builds it as markup, redeal writes it
   onto a card already on the table (the deck is re-ordered mid-shuffle, and a
   card cannot be built one way and re-dealt another). */
const faceOf = (pick: number) => {
  const s = SPELLS[pick];
  return { id: s.id, hue: spellHue(s.id), icon: spellIcon(s.id, 20) };
};

/* The deck, as markup — pure, so the design build renders the real one.
   `order` is which rune sits in which slot: a real deck is not sorted, and a
   deck that fanned out in registry order every single time would teach the
   player where their rune lives before it is drawn. Omitted (the design card,
   a still) it is the registry's own order. */
export const deckCards = (order?: readonly number[], drawn?: string): string =>
  (order ?? SPELLS.map((_, i) => i)).map((pick, i) => {
    const f = faceOf(pick), r = restOf(i);
    return `<i class="rcard${f.id === drawn ? ' drawn' : ''}" data-rune="${f.id}"`
      + ` style="--x:${r.x}%;--y:${r.y}px;--o:${r.rot}deg;color:${f.hue}">${f.icon}</i>`;
  }).join('');

/* THE DECK IS ACTUALLY RE-ORDERED, and you can watch it happen: as each card
   comes back into the fan it is carrying a different rune. Without this the
   shuffle was a set of cards waving about and landing in the order they
   started in — the hands moved and the deck did not (user report). Each card
   turns over its new rune at the moment it zips back in, so the change reads
   as that card being dealt into that slot rather than as six icons blinking. */
function redeal(el: HTMLElement, pick: number): void {
  const f = faceOf(pick);
  el.dataset.rune = f.id;
  el.style.color = f.hue;
  el.innerHTML = f.icon;
}

/** a fresh cut of the roster — Fisher-Yates, because ui/ may hold randomness */
function shuffledOrder(): number[] {
  const o = SPELLS.map((_, i) => i);
  for (let i = o.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [o[i], o[j]] = [o[j], o[i]];
  }
  return o;
}

/* The card that gets dealt — face-down unless `up`, which is the still's slot.
   Its BACK is a deck card's back, corner index and all, because it IS the card
   that was drawn: it starts life exactly on top of the slot it came out of and
   grows out of the fan from there, so the two have to be the same object to
   look at. Nothing leaks early — the whole card is transparent until the draw
   begins, and by then the fan has already shown every rune it holds. */
export const dealtCard = (spec: SpellSpec, up = false): string =>
  `<div class="rdealt${up ? ' up' : ''}" data-rune="${spec.id}" style="color:${spellHue(spec.id)}">`
  + `<i class="rback">${spellIcon(spec.id, 20)}</i>`
  + `<i class="rface">${spellIcon(spec.id, 44)}<span class="rlbl">${spec.name}</span></i></div>`;

/* The whole felt: the deck, and the card dealt off it. A turned-over still is
   necessarily a deck ONE CARD SHORT — the card in front is the one that was in
   that slot — so `up` empties the slot too, and a design card cannot picture a
   deal that never took anything. */
export const runeFelt = (spec: SpellSpec, up = false, order?: readonly number[]): string =>
  `<div class="rfelt"><div class="rdeck">${deckCards(order, up ? spec.id : undefined)}</div>`
  + `${dealtCard(spec, up)}</div>`;

/* The shuffle, in beats: fan the deck out, riffle it, cut it, deal. One riffle
   and a cut is the whole shuffle — a second riffle was measured against the
   first build and cut (user call: "one shuffle too much"), because the cut is
   already the beat that says "and again", and three seconds of card handling
   in front of a game is a held breath, not a wait. */
const FAN = 340, RIFFLE = 560, RIFFLES = 1, CUT = 440, SQUARE = 130, DEAL = 560, FLIP = 520;
/* the fan's resting opacity — .rcard's in main.css. The drawn card starts on
   it and brightens as it comes forward, so the pluck reads as one motion. */
const DECK_DIM = 0.62;
const EASE_SHUFFLE = 'cubic-bezier(.35,.05,.3,1)';
const EASE_LAND = 'cubic-bezier(.2,.9,.24,1)';

const cardsIn = (felt: HTMLElement) =>
  Array.from(felt.querySelectorAll<HTMLElement>('.rcard'));

/** the deck arrives on the felt, card by card */
function fanIn(felt: HTMLElement): void {
  cardsIn(felt).forEach((el, i) => {
    const r = restOf(i);
    el.animate([{ translate: '0% 0px', rotate: '0deg', opacity: 0 },
                { translate: `${r.x}% ${r.y}px`, rotate: `${r.rot}deg`, opacity: 1 }],
      { duration: FAN, delay: i * 26, easing: EASE_LAND, fill: 'both' });
  });
}

/* One riffle: the deck splits by alternating cards, the halves arch apart and
   zip back together holding `next`. The stagger IS the zip — every card sharing
   one delay reads as two blocks colliding, not as a shuffle. */
function riffle(felt: HTMLElement, next: readonly number[]): void {
  cardsIn(felt).forEach((el, i) => {
    const r = restOf(i), s = i % 2 ? 1 : -1;
    setTimeout(() => redeal(el, next[i]), i * 30 + RIFFLE * 0.5);
    const rest = { translate: `${r.x}% ${r.y}px`, rotate: `${r.rot}deg` };
    el.animate([rest,
      { translate: `${r.x + s * 74}% ${r.y - 26}px`, rotate: `${s * 13}deg`, offset: 0.26 },
      { translate: `${r.x + s * 60}% ${r.y + 9}px`, rotate: `${s * 6}deg`, offset: 0.58 },
      { translate: `${r.x - s * 6}% ${r.y}px`, rotate: `${r.rot - s * 2.5}deg`, offset: 0.85 },
      rest],
      { duration: RIFFLE, delay: i * 30, easing: EASE_SHUFFLE, fill: 'none' });
  });
}

/** a cut: the deck lifts aside as a block and drops back squared, holding `next` */
function cut(felt: HTMLElement, next: readonly number[]): void {
  cardsIn(felt).forEach((el, i) => {
    const r = restOf(i);
    setTimeout(() => redeal(el, next[i]), i * 22 + CUT * 0.5);
    const rest = { translate: `${r.x}% ${r.y}px`, rotate: `${r.rot}deg` };
    el.animate([rest,
      { translate: `${r.x + 80}% ${r.y - 16}px`, rotate: '11deg', offset: 0.3 },
      { translate: `${r.x + 80}% ${r.y + 18}px`, rotate: '4deg', offset: 0.62 },
      { translate: `${r.x}% ${r.y + 4}px`, rotate: `${r.rot - 3}deg`, offset: 0.88 },
      rest],
      { duration: CUT, delay: i * 22, easing: EASE_SHUFFLE, fill: 'none' });
  });
}

/* THE TURN. Not a 3D flip: `backface-visibility` needs the card's whole
   ancestry to keep a 3D rendering context, and one grouping property anywhere
   above it (this overlay carries a backdrop-filter) silently flattens it — the
   card then turns and shows its BACK, which is exactly what the first build
   did. So the card turns to edge-on, swaps which face is lit, and turns back:
   two halves of one gesture, and there is no state of the DOM in which the
   wrong face can be showing. */
function flip(card: HTMLElement): Promise<void> {
  const half = { duration: FLIP / 2, easing: 'linear' as const, fill: 'both' as const };
  return card.animate([{ transform: 'perspective(900px) rotateY(0deg)' },
                       { transform: 'perspective(900px) rotateY(90deg)' }],
    { ...half, easing: 'ease-in' }).finished.then(() => {
      card.classList.add('up');
      return card.animate([{ transform: 'perspective(900px) rotateY(-90deg)' },
                           { transform: 'perspective(900px) rotateY(0deg)' }],
        { ...half, easing: 'ease-out' }).finished.then(() => { card.style.transform = ''; });
    });
}

/* THE DRAW. The card that comes forward is the one that was sitting in that
   slot of the fan — plucked upward out of the deck, brought to the table and
   grown to hand size. A card that always appeared out of the middle was the
   first build, and it made the shuffle decorative: nothing that happened to
   the deck could have decided anything.
   The journey is measured off the two elements rather than recomputed from
   --card, so it stays exact at any deck size, under any rotation the shuffle
   left behind, in a still or a landscape phone. */
function draw(card: HTMLElement, from: HTMLElement, rot: number): void {
  const a = from.getBoundingClientRect(), b = card.getBoundingClientRect();
  // rotation is about the centre, so centres are exact; the SIZE is not — a
  // rotated box reports its inflated bounds, and offsetWidth is the real width
  const dx = (a.x + a.width / 2) - (b.x + b.width / 2);
  const dy = (a.y + a.height / 2) - (b.y + b.height / 2);
  const scale = from.offsetWidth / card.offsetWidth;
  from.classList.add('drawn');            // ...and the fan is one card short
  card.animate([
    { translate: `${dx}px ${dy}px`, scale: `${scale}`, rotate: `${rot}deg`, opacity: DECK_DIM },
    { translate: `${dx}px ${dy - 34}px`, scale: `${scale * 1.08}`, rotate: `${rot * 0.6}deg`,
      opacity: 1, offset: 0.34 },
    { translate: '0px 0px', scale: '1', rotate: '0deg', opacity: 1 }],
    { duration: DEAL, easing: EASE_LAND, fill: 'both' });
}

/** shuffle the roster and turn one card over — on a rune already drawn */
export function dealBeat(spec: SpellSpec): Beat {
  /* One order per beat of the shuffle: the deck the player is handed, the deck
     after the riffle, and the deck after the cut. The LAST one is the deck the
     draw reaches into — so where the answer ends up is decided by the shuffle
     the player just watched, not before it. */
  const [fanned, riffled, settled] = [shuffledOrder(), shuffledOrder(), shuffledOrder()];
  /* WHICH SLOT of the fan the answer ends up in, once the deck has stopped
     moving — so the draw reaches into a place the shuffle chose. */
  const slot = settled.indexOf(SPELLS.findIndex((s) => s.id === spec.id));
  return {
    label: 'YOUR RUNE',
    cls: 'dealing',
    name: spec.name,
    blurb: spec.blurb,
    hue: spellHue(spec.id),
    icon: spellIcon(spec.id, 17),
    stage: runeFelt(spec, false, fanned),
    async run(settle) {
      const felt = appRoot().querySelector('#wheelStage .rfelt') as HTMLElement;
      const card = felt.querySelector('.rdealt') as HTMLElement;
      /* reduced motion gets the same STILL a design card gets: the deck as the
         shuffle would have left it, its slot already empty, and the card
         face-up in front of it */
      if (REDUCED) {
        cardsIn(felt).forEach((el, i) => redeal(el, settled[i]));
        cardsIn(felt)[slot]?.classList.add('drawn');
        card.classList.add('up');
        settle();
        return;
      }
      fanIn(felt);
      await pause(FAN + (SPELLS.length - 1) * 26);
      for (let k = 0; k < RIFFLES; k++) {
        Sfx.riffle();
        riffle(felt, riffled);
        await pause(RIFFLE + (SPELLS.length - 1) * 30);
      }
      Sfx.roll();
      cut(felt, settled);
      await pause(CUT + (SPELLS.length - 1) * 22 + SQUARE);
      Sfx.tick();
      draw(card, cardsIn(felt)[slot], restOf(slot).rot);
      await pause(DEAL);
      settle();
      Sfx.place();
      vibrate(18);
      await flip(card);
    },
  };
}
