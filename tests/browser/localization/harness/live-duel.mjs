/* A DETERMINISTIC SETTLED DUEL on the live board, held still enough to measure.
 *
 * The localized geometry contract compares resting board geometry across
 * locales, so the board it compares has to be the same board every time: a
 * fixed mode, seat, starter and rune, one die placed on each side, and the
 * opening roll cancelled so no animation is still running underneath the
 * measurement. The sentinel attributes let a caller prove afterwards that a
 * locale switch repainted the dice rather than rebuilding them.
 */
import { frame } from './layout-inspection.mjs';

export async function prepareLiveDuel(page) {
  await page.evaluate(() => {
    const game = window.__kb;
    const state = game.S;
    state.mode = 'duo';
    state.seat = 'pass';
    state.starter = 0;
    state.localMode = 0;
    state.spell = 'ward';
    state.timer = 0;
    game.newGame({ spell: 'ward' });
    state.gen++; // keep the localized opening status stable and cancel the roll
    state.boards[0][0] = [4];
    state.boards[1][1] = [5];
    game.renderAll(false);
    game.setStageDie(6);
    document.querySelector('#topBoard .die')?.setAttribute('data-locale-sentinel', 'top');
    document.querySelector('#botBoard .die')?.setAttribute('data-locale-sentinel', 'bottom');
    game.fit();
  });
  /* ResizeObserver and the 120ms orientation fallback both converge through
     fit(). Compare settled geometry, not a viewport's transitional old cell. */
  await page.waitForTimeout(160);
  await page.evaluate(() => window.__kb.fit());
  await frame(page);
  /* The contract compares resting board geometry, not an ancestor's entry or
     seating transition. Under a loaded Linux compositor, a fixed delay can
     return between animation frames; require the two boards to hold the same
     measured boxes for three consecutive paints before taking the baseline. */
  await page.evaluate(async () => {
    let previous = '';
    let stableFrames = 0;
    while (stableFrames < 3) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const signature = ['topBoard', 'botBoard'].map((id) => {
        const box = document.getElementById(id).getBoundingClientRect();
        return [box.x, box.y, box.width, box.height].map((value) => value.toFixed(3)).join(':');
      }).join('|');
      stableFrames = signature === previous ? stableFrames + 1 : 0;
      previous = signature;
    }
  });
}
