// The dealt deck, read and judged as the player sees it (test20's owner).
//
// Since the S9 pile deal (2026-08-26) the shuffle is PHYSICAL: the runes never
// relabel — each card carries its rune through the piles — so proving the
// shuffle mattered is geometric, not textual: the fan the player was handed
// has been dealt into ONE SQUARED STACK, and the card they receive came off
// its TOP.

/* Page-side reader for the turned deal — passed to page.evaluate, so it must
   stay closure-free. Measures the assembled stack the way the player sees it:
   the visible cards' horizontal spread (a fan is ~2 card widths, a squared
   deck a few px of jitter) and the stacking order (z). */
export const readTurnedDeal = () => {
  const d = document.querySelector('.rdealt');
  const face = getComputedStyle(d.querySelector('.rface'));
  const back = getComputedStyle(d.querySelector('.rback'));
  const deck = [...document.querySelectorAll('.rcard')];
  const visible = deck.filter((e) => getComputedStyle(e).visibility === 'visible');
  const centers = visible.map((e) => { const b = e.getBoundingClientRect(); return b.x + b.width / 2; });
  const z = (e) => +getComputedStyle(e).zIndex || 0;
  const drawnEl = deck.find((e) => e.classList.contains('drawn'));
  return {
    card: d.dataset.rune,
    label: d.querySelector('.rlbl').textContent.trim(),
    // which slot of the fan the card came off the top from, and that only one left
    drawnSlot: deck.findIndex((e) => e.classList.contains('drawn')),
    drawnRune: drawnEl?.dataset.rune ?? null,
    deck: deck.map((e) => e.dataset.rune),
    stillInFan: visible.length,
    squaredSpreadPx: Math.max(...centers) - Math.min(...centers),
    cardWidthPx: deck[0].offsetWidth,
    drawnZ: drawnEl ? z(drawnEl) : -1,
    maxOtherZ: Math.max(...visible.map(z)),
    faceOpacity: +face.opacity, backOpacity: +back.opacity,
    faceBg: face.backgroundImage !== 'none',
    named: document.querySelector('#wheelName').textContent.trim(),
    settled: [...document.querySelectorAll('.wsett')].map((e) => ({
      name: e.querySelector('.wpill b').textContent.trim(),
      rule: e.querySelector('.wblurb').textContent.trim(),
    })),
    hold: getComputedStyle(document.querySelector('.dhold')).visibility,
  };
};

/** the physical re-order contract, judged across several deals */
export function checkDealPhysique(deals, check) {
  const carried = deals.map((d) => d.shuffling.deck.join(',') === d.turned.deck.join(','));
  check(carried.every(Boolean),
    'a card changed its rune mid-shuffle — the deal relabeled instead of dealing',
    deals.map((d) => ({ before: d.shuffling.deck.join(','), after: d.turned.deck.join(',') })));
  check(deals.every((d) => d.turned.squaredSpreadPx < d.turned.cardWidthPx / 2),
    'the deal did not end on a squared deck',
    deals.map((d) => ({ spread: d.turned.squaredSpreadPx, card: d.turned.cardWidthPx })));
  check(deals.every((d) => d.turned.drawnZ >= d.turned.maxOtherZ),
    'the drawn card did not come off the TOP of the assembled deck',
    deals.map((d) => ({ drawnZ: d.turned.drawnZ, maxOtherZ: d.turned.maxOtherZ })));
  return carried;
}
