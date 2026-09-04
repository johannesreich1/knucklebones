// THE PROFILE'S IDENTITY OFFERS, AS ONE DECK.
//
// Two cards ask the new player two different questions: what you are called
// (the one-time name claim) and where the account lives (guest, or kept). They
// are orthogonal — `named_at` and `user.guest` are independent facts — so the
// ordinary first run shows BOTH, stacked, and two boxed offers in a column is
// the profile shouting twice.
//
// They become one deck you swipe, with the count saying how many there are.
// The name comes first: what you are called comes before where you live, which
// is the order the cards were already written in.
//
// The paging, the `n / m` and the dots are ui/slide-deck.ts, shared with the
// league promotion deck. This module owns only which offers apply and which
// card is on screen.
import { formatNumber, t } from '../../i18n/index.ts';
import { $ } from '../../ui/dom.ts';
import { createSlideDeck, type SlideDeck } from '../../ui/slide-deck.ts';

/** The offers, in the order they are dealt. */
export type AccountOfferId = 'claim' | 'guest';

const CARD: Record<AccountOfferId, string> = {
  claim: '#accClaim',
  guest: '#accGuest',
};

let deck: SlideDeck | null = null;
let dealt: readonly AccountOfferId[] = [];

/* ONE SLIDE IS IN THE DOM'S LAYOUT AT A TIME, and the others are `hidden`
   rather than removed. The cards are static markup with their own ids,
   listeners and translation attributes — rebuilding them per slide would mean
   re-binding a form on every swipe, and the claim card carries an input whose
   value must survive a glance at the other offer. */
function show(active: AccountOfferId | null): void {
  for (const id of Object.keys(CARD) as AccountOfferId[]) {
    $(CARD[id]).hidden = id !== active;
  }
}

function ensureDeck(): SlideDeck {
  if (deck) return deck;
  const root = $('#accOffers');
  deck = createSlideDeck({
    surface: root,
    page: $('#accOfferPage'),
    dots: $('#accOfferDots'),
    formatNumber,
    /* SCOPED, NOT GLOBAL. The league deck takes the document's arrow keys
       because it is a mandatory dialog; this one sits in a scrolling page that
       has its own keyboard, so it only answers for arrows aimed at itself. */
    arrowKeys: root,
    /* THE SENTENCE BELONGS TO THE DECK, not to the promotion screen that
       happens to hold its key. "Slide 2 of 3" is already translated into all
       eleven locales under groupTransition; minting a second key for the same
       words would mean eleven re-translations for a string no reader can tell
       apart. Move the key if a third deck ever arrives. */
    slideLabel: (current, total) =>
      t('online', 'groupTransition.slideLabel', { current, total }),
    render: (index) => show(dealt[index] ?? null),
  });
  return deck;
}

/**
 * Deal the offers that currently apply.
 *
 * An empty list hides the deck outright — a linked member with a claimed name
 * is asked nothing. One offer collapses to a bare card: the seam drops the
 * `1 / 1` (a lie about a sequence) and the surrounding chrome goes with it, so
 * a player who only has to answer one question never learns there was a deck.
 */
export function paintAccountOffers(offers: readonly AccountOfferId[]): void {
  const root = $('#accOffers');
  dealt = offers;
  root.hidden = offers.length === 0;
  root.classList.toggle('offerdeck--single', offers.length === 1);
  if (!offers.length) {
    show(null);
    root.style.removeProperty('--offerdeck-card');
    return;
  }
  ensureDeck().setTotal(offers.length, 0);
  reserveTallestCard(root, offers);
}

/* THE COLUMN MUST NOT JUMP UNDER A THUMB. The offers are different heights, so
   paging would move everything below the deck mid-swipe. The taller one's
   height is reserved for both — measured, because the cards are translated and
   the difference is a locale's problem, not a number anyone can write here.
   Measured by showing each card in turn, which is what the deck does anyway;
   only ever on a deal, never on a swipe. The claim card can still grow past
   the reservation when a validation error appears (base.css hides an empty
   .err), which is the same growth it has always had. */
function reserveTallestCard(root: HTMLElement, offers: readonly AccountOfferId[]): void {
  if (offers.length < 2) {
    root.style.removeProperty('--offerdeck-card');
    return;
  }
  root.style.removeProperty('--offerdeck-card');
  let tallest = 0;
  for (const id of offers) {
    show(id);
    tallest = Math.max(tallest, $(CARD[id]).getBoundingClientRect().height);
  }
  show(dealt[ensureDeck().index] ?? null);
  if (tallest > 0) root.style.setProperty('--offerdeck-card', `${Math.ceil(tallest)}px`);
}

/** Which offers a painted account is owed, newest question first. */
export function accountOffers(
  named: boolean,
  guest: boolean,
): readonly AccountOfferId[] {
  const offers: AccountOfferId[] = [];
  if (!named) offers.push('claim');
  if (guest) offers.push('guest');
  return offers;
}

/**
 * The name claim is spent and leaves the deck, keeping whatever else was
 * dealt. Called the moment a claim lands, before the account refresh that will
 * re-deal from authority — so the card cannot linger for a round trip, and the
 * count collapses with it rather than saying `1 / 2` over a single card.
 */
export function retireClaimOffer(): void {
  paintAccountOffers(dealt.filter((offer) => offer !== 'claim'));
}
