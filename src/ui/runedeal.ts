// The rune deal: one beat of the pre-game reveal (ui/reveal.ts), in which the
// rune one or both seats will carry is drawn from a deck.
//
// Dealing beats spinning for a table game — and since 2026-08-26 the deal is
// the three-card monte's shuffle, played straight (study S9, design card
// 28i-shuffle-topdraw; it replaced a riffle-and-cut that read as two mirrored
// blocks, user call: "does not look like real shuffling"). The fan spreads,
// squares into one deck, is dealt ONE CARD AT A TIME off the top into three
// piles, the piles are gathered back in a random order — and the draw takes
// the TOP CARD of the assembled stack. No refan: the deck the player watched
// being assembled is the deck the answer comes off.
//
// THE DECK IS THE OFFER. Every card is a real spell from core/spells, in its
// own hue, wearing its own icon in the corner like a playing card's index — so
// a rune added to the registry joins the first shuffle for free. RANDOM ×2's
// second offer removes the first answer, leaving an honest five-card fan.
//
// WHERE THE ANSWER IS is what the shuffle decides — and here it decides it
// LEGIBLY: the spread order, the scoop direction and the gather order are
// random; everything between them is mechanical. A player who tracks the
// piles CAN call the top card before it turns (the monte read); everyone else
// feels the order is simply gone. The cards PHYSICALLY carry their runes
// through the piles — no icon ever relabels mid-shuffle, which the old riffle
// needed (redeal()) to avoid "the hands moved and the deck did not".
//
// The MOTION lives here as WAAPI, the RESTING LAYOUT lives in main.css, and
// both read the same geometry (restOf for the spread, stackOf for the deck the
// deal leaves behind) — so a still (a design card, or a reduced-motion player)
// shows exactly what the animation comes to rest on.
import { SPELLS, type SpellSpec } from '../core/spells.ts';
import { spellCopy, t } from '../i18n/index.ts';
import { spellIcon, spellHue } from './spellicons.ts';
import { Sfx, vibrate } from './audio.ts';
import { REDUCED } from './fx.ts';
import type { Beat } from './reveal-types.ts';
import { appRoot } from './embed.ts';

/* The deck's geometry and markup live in ui/runefelt.ts — one module owns
   what the deck IS, this one owns what the hands DO to it. The felt exports
   are re-exported so every existing consumer keeps its seam. */
import { restOf, stackOf, squaredOf, PILES, PILE_Y, runeFelt } from './runefelt.ts';
export { deckCards, runeCardFaces, dealtCard, runeFelt } from './runefelt.ts';

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** a fresh cut of the roster — Fisher-Yates, because ui/ may hold randomness */
function shuffledOrder(candidates: readonly number[]): number[] {
  const o = [...candidates];
  for (let i = o.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [o[i], o[j]] = [o[j], o[i]];
  }
  return o;
}

/* THE PLAN of one shuffle, decided up front so the animation, the reduced-
   motion still and the draw all read the same physics. Slots are DOM indices
   (the spread, left to right). Randomness enters exactly three times — the
   fan order (dealBeat), the scoop direction and the gather order — and the
   rest is mechanical:
   - the spread squares from either end (a dealer scoops left- or right-handed;
     without this the round-robin provably always tops a card from the same
     half of the spread — a tell the monte framing would make worse),
   - flick k takes the CURRENT TOP of the deck, round-robin across the piles,
   - the piles reassemble in gather order; the last pile's top card is the
     deck's top, and the deck's top is the answer. */
interface ShufflePlan {
  stackSlots: number[];   // the scooped deck, bottom → top
  piles: number[][];      // each pile's slots, bottom → top
  gather: number[];       // [the base pile, then the two hopped onto it]
  finalStack: number[];   // the assembled deck, bottom → top
  topSlot: number;        // the slot whose card ends on top — the answer's
}
function planShuffle(count: number): ShufflePlan {
  const slots = [...Array(count).keys()];
  const stackSlots = Math.random() < 0.5 ? slots.reverse() : slots;
  const piles: number[][] = [[], [], []];
  for (let k = 0; k < count; k++) piles[k % 3].push(stackSlots[count - 1 - k]);
  /* the deck reassembles on a SIDE pile only: the dealt card grows over the
     felt's centre, and a stack gathered there would vanish behind the very
     card it produced. A dealer pulls the deck aside to deal off it anyway. */
  const base = Math.random() < 0.5 ? 0 : 2;
  const gather = [base, ...shuffledOrder([0, 1, 2].filter((p) => p !== base))];
  const finalStack = gather.flatMap((p) => piles[p]);
  return { stackSlots, piles, gather, finalStack, topSlot: finalStack[finalStack.length - 1] };
}

/* The shuffle, in beats: fan the deck out, square it, deal it into piles,
   gather them, draw the top. The pile cadence (FLICK) is the beat the eye
   counts, so it is strict — one card in flight at a time, the previous card
   settled before the next leaves. Measured against S9's study loop (which
   plays ~17% slower so a looping card stays readable); the totals here are
   the study's proposed app beats, with the TURN riding inside the draw:
   shuffle ≈ 2.4s, whole beat ≈ 3.33s (FLIP runs within DEAL, not after). */
const FAN = 380, SQUARE = 280, FLICK = 230, FLIGHT = 170, HOP = 290, HOP_GAP = 330,
  STACK = 730, DEAL = 560, FLIP = 520;
const EASE_SHUFFLE = 'cubic-bezier(.35,.05,.3,1)';
const EASE_LAND = 'cubic-bezier(.2,.9,.24,1)';

const cardsIn = (felt: HTMLElement) =>
  Array.from(felt.querySelectorAll<HTMLElement>('.rcard'));

const pose = (p: { x: number; y: number; rot: number }) =>
  ({ translate: `${p.x}% ${p.y}%`, rotate: `${p.rot}deg` });

/** the deck arrives on the felt, card by card */
function fanIn(felt: HTMLElement): void {
  const cards = cardsIn(felt);
  cards.forEach((el, i) => {
    const r = restOf(i, cards.length);
    el.animate([{ translate: '0% 0%', rotate: '0deg', opacity: 0 },
                { translate: `${r.x}% ${r.y}%`, rotate: `${r.rot}deg`, opacity: 1 }],
      { duration: FAN, delay: i * 26, easing: EASE_LAND, fill: 'both' });
  });
}

/* Every phase below animates TO a pose with fill:'both' and no explicit start
   frame, so each motion begins wherever the last one ended — and, unlike the
   old riffle's fill:'none' spring-back, the end pose HOLDS: there is no refan
   to return to, and draw() measures the stack-top card where it actually is. */

/** the spread squares into one held deck, bottom of the scoop first */
function squareUp(felt: HTMLElement, plan: ShufflePlan): void {
  const cards = cardsIn(felt);
  plan.stackSlots.forEach((slot, k) => {
    const el = cards[slot];
    el.style.zIndex = String(k + 1);
    el.animate([pose(squaredOf(k))],
      { duration: SQUARE, delay: k * 8, easing: EASE_SHUFFLE, fill: 'both' });
  });
}

/* THE PILE DEAL. Strictly one card at a time, always the current top of the
   deck, round-robin across the three piles — the strictness is the whole
   trick: a viewer who counts flicks knows every pile, and the ticks land one
   per flick. Each card jumps to its FINAL stacking depth mid-flight (8+ keeps
   every dealt card in front of the deck it left; the gathers then move whole
   piles without touching z at all). */
function pileDeal(felt: HTMLElement, plan: ShufflePlan): void {
  const cards = cardsIn(felt);
  const count = plan.stackSlots.length;
  for (let k = 0; k < count; k++) {
    const slot = plan.stackSlots[count - 1 - k];
    const el = cards[slot];
    const p = k % 3, within = plan.piles[p].indexOf(slot);
    const from = squaredOf(count - 1 - k), to = stackOf(p, within);
    setTimeout(() => { el.style.zIndex = '20'; Sfx.tick(); }, k * FLICK);
    setTimeout(() => { el.style.zIndex = String(8 + plan.finalStack.indexOf(slot)); },
      k * FLICK + FLIGHT);
    /* the deal flicks UPWARD, bottom deck to pile row; the apex clears the
       row by a hair only — any higher and the card brushes the title */
    el.animate([
      { translate: `${(from.x + to.x) / 2}% ${to.y - 9.4}%`,
        rotate: `${to.rot + (to.x < from.x ? -7 : 7)}deg`, offset: 0.55 },
      pose(to)],
      { duration: FLIGHT + 90, delay: k * FLICK, easing: EASE_LAND, fill: 'both' });
  }
}

/** the piles come home: two hops, each pile as one block, onto the base pile */
function gatherPiles(felt: HTMLElement, plan: ShufflePlan): void {
  const cards = cardsIn(felt);
  const base = plan.gather[0];
  let height = plan.piles[base].length;
  plan.gather.slice(1).forEach((p, hop) => {
    setTimeout(() => Sfx.place(), hop * HOP_GAP + HOP * 0.7);
    plan.piles[p].forEach((slot, within) => {
      const to = stackOf(base, height + within);
      cards[slot].animate([
        { translate: `${(PILES[p] + PILES[base]) / 2}% ${PILE_Y - 7.5}%`,
          rotate: `${to.rot - 5}deg`, offset: 0.5 },
        pose(to)],
        { duration: HOP, delay: hop * HOP_GAP + within * 24, easing: EASE_SHUFFLE, fill: 'both' });
    });
    height += plan.piles[p].length;
  });
}

/* THE TURN. Not a 3D flip: `backface-visibility` needs the card's whole
   ancestry to keep a 3D rendering context, and one grouping property anywhere
   above it (this overlay carries a backdrop-filter) silently flattens it — the
   card then turns and shows its BACK, which is exactly what the first build
   did. So the card turns to edge-on, swaps which face is lit, and turns back:
   two halves of one gesture, and there is no state of the DOM in which the
   wrong face can be showing.
   It runs CONCURRENTLY with draw(): the turn is `transform` (rotateY under
   perspective) while the draw is translate/scale/rotate — separate channels
   that compose, so the card turns over as it travels and grows, and FLIP 520
   inside DEAL 560 finishes the turn just before the landing. */
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

/* THE DRAW. The card that comes forward is the TOP of the assembled deck —
   lifted off the stack the gathers just built, brought to the table and grown
   to hand size. That is the point of this shuffle: nothing has to be plucked
   out of a fan's middle, because the last motion the player watched put the
   answer on top.
   The journey is measured off the two elements rather than recomputed from
   --card, so it stays exact at any deck size, under any pose the shuffle
   left behind, in a still or a landscape phone. */
function draw(card: HTMLElement, from: HTMLElement, rot: number): void {
  const a = from.getBoundingClientRect(), b = card.getBoundingClientRect();
  // rotation is about the centre, so centres are exact; the SIZE is not — a
  // rotated box reports its inflated bounds, and offsetWidth is the real width
  const dx = (a.x + a.width / 2) - (b.x + b.width / 2);
  const dy = (a.y + a.height / 2) - (b.y + b.height / 2);
  const scale = from.offsetWidth / card.offsetWidth;
  from.classList.add('drawn');            // ...and the deck is one card short
  card.animate([
    { translate: `${dx}px ${dy}px`, scale: `${scale}`, rotate: `${rot}deg`, opacity: 1 },
    { translate: `${dx}px ${dy - 34}px`, scale: `${scale * 1.08}`, rotate: `${rot * 0.6}deg`,
      opacity: 1, offset: 0.34 },
    { translate: '0px 0px', scale: '1', rotate: '0deg', opacity: 1 }],
    { duration: DEAL, easing: EASE_LAND, fill: 'both' });
}

export interface RuneDealOptions {
  /** The honest deck for this draw; RANDOM ×2 removes the first player's rune. */
  candidates?: readonly SpellSpec[];
  /** Locale-live title above the deck. */
  label?: () => string;
  /** Locale-live owner retained in the settled answer. */
  context?: () => string;
  contextHue?: string;
}

/** shuffle the offered roster and turn one card over — on a rune already drawn */
export function dealBeat(spec: SpellSpec, options: RuneDealOptions = {}): Beat {
  const offered = options.candidates ?? SPELLS;
  const candidateIndices = offered.map((candidate) => SPELLS.indexOf(candidate));
  const answerIndex = SPELLS.indexOf(spec);
  if (answerIndex < 0 || candidateIndices.some((index) => index < 0)
      || !candidateIndices.includes(answerIndex)) {
    throw new TypeError(`Rune deal candidates do not contain ${spec.id}`);
  }
  /* One random spread and one random shuffle plan per beat. The plan decides
     which fan slot the mechanics will carry to the top of the deck — so the
     answer is SEATED in that slot before the player is handed the fan, and the
     shuffle they watch genuinely produces the rune the draw turns over. The
     seat itself never shows: topSlot is uniform over the spread (scoop
     direction × gather order), and the rest of the fan stays a fresh cut. */
  const fanned = shuffledOrder(candidateIndices);
  const plan = planShuffle(candidateIndices.length);
  const seat = fanned.indexOf(answerIndex);
  [fanned[seat], fanned[plan.topSlot]] = [fanned[plan.topSlot], fanned[seat]];
  return {
    /* Locale-live getters let the reveal repaint copy without creating a new
       beat (which would also reshuffle the deck). */
    get label() { return options.label?.() ?? t('game', 'reveal.matchRune'); },
    cls: 'dealing',
    get name() { return spellCopy(spec.id).name; },
    get blurb() { return spellCopy(spec.id).blurb; },
    hue: spellHue(spec.id),
    icon: spellIcon(spec.id, 17),
    get context() { return options.context?.(); },
    contextHue: options.contextHue,
    stage: runeFelt(spec, false, fanned),
    repaintStage(stage) {
      const label = stage.querySelector<HTMLElement>('.rdealt .rlbl');
      if (label) label.textContent = spellCopy(spec.id).name;
    },
    async run(settle) {
      const felt = appRoot().querySelector('#wheelStage .rfelt') as HTMLElement;
      const card = felt.querySelector('.rdealt') as HTMLElement;
      const count = candidateIndices.length;
      /* reduced motion gets the same STILL a design card gets: the assembled
         stack the shuffle would have left, on the side pile the plan chose,
         its top card already taken, and the card face-up in front of it */
      if (REDUCED) {
        const cards = cardsIn(felt);
        plan.finalStack.forEach((slot, k) => {
          const el = cards[slot], p = stackOf(plan.gather[0], k);
          el.style.setProperty('--x', `${p.x}%`);
          el.style.setProperty('--y', `${p.y}%`);
          el.style.setProperty('--o', `${p.rot}deg`);
          el.style.zIndex = String(k + 1);
        });
        cards[plan.topSlot].classList.add('drawn');
        card.classList.add('up');
        settle();
        return;
      }
      fanIn(felt);
      await pause(FAN + (count - 1) * 26);
      Sfx.roll();
      squareUp(felt, plan);
      await pause(SQUARE + (count - 1) * 8);
      pileDeal(felt, plan);                       // Sfx.tick, one per flick
      await pause(count * FLICK + FLIGHT + 90);
      gatherPiles(felt, plan);                    // Sfx.place, one per hop
      await pause(STACK);
      Sfx.tick();
      /* the TURN rides the draw (user call 2026-08-26): one gesture — the card
         turns over WHILE it comes to the table and grows, finishing the turn a
         beat before it lands, instead of landing face-down and flipping as a
         second step */
      draw(card, cardsIn(felt)[plan.topSlot], stackOf(plan.gather[0], count - 1).rot);
      const turned = flip(card);
      await pause(DEAL);
      settle();
      Sfx.place();
      vibrate(18);
      await turned;
    },
  };
}
