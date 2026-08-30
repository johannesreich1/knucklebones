// Press Play with the offline RANDOM draw pinned to a known answer.
//
// PRIMED AND PRESSED IN ONE TASK: the stub restores itself on first use, so
// anything that draws before Play is pressed eats the fixed seed and the mode
// goes back to chance — a previous duel's timer is exactly that thief, and a
// Playwright click's round trip is all the room it needs.
//
// Both seeds below are verified under the permanent 40/60 mode weights. A seed
// that lands on the wrong side of the Ritual split silently changes what the
// caller is measuring rather than failing.

/** Lands on an ORDINARY mode. The Ritual answers RANDOM with a private choice
    instead of a rune deal, so a deal probe seeded into it waits for a deck that
    is never dealt. */
export const SEED_AVOIDS_RITUAL = 0.375;

/** Lands ON Rune Ritual — for the probe that exists to watch it arrive. */
export const SEED_LANDS_ON_RITUAL = 0.22;

/**
 * Runs inside the page: hand it to page.evaluate, not to Node.
 * Pass a seed to pin the draw, or null to leave it to chance.
 */
export const primeRandomStart = (seed) => {
  const natural = Math.random;
  if (seed !== null) Math.random = () => { Math.random = natural; return seed; };
  window.__kb.S.timer = 0;
  const play = document.getElementById('btnPlay');
  const box = play.getBoundingClientRect();
  const at = { bubbles: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
  play.dispatchEvent(new PointerEvent('pointerdown', at));
  play.dispatchEvent(new PointerEvent('pointerup', at));
};
