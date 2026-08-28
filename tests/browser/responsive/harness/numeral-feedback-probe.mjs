/* NUMBERED-DIE SCORE FEEDBACK, MEASURED AS PAINTED INK.
 *
 * The +N / -N label a placement paints has three distinct floatPts branches,
 * and two of them cannot be reached by tapping a column: the far
 * face-to-face seat, and a destroyed victim. Both probes below seat that
 * state on the live page, catch the label, and measure its ink against the
 * die it belongs to. They return data; the scenario keeps its check()
 * sentences, the same contract reduced-motion-support.mjs uses.
 *
 * This lives beside the reduced-motion scenario rather than inside it because
 * the contract is not a reduced-motion one. Reduced motion is only what makes
 * it measurable: with no flying ghost the geometry stands still.
 *
 * The two probes are deliberately NOT one parameterized probe. They differ in
 * WHEN the label can be observed at all - the far seat's survives its
 * placement resolving, while the minus belongs to a die being destroyed and
 * has to be caught mid-flight - so each keeps its own body, including its own
 * in-page inkRect, which a page.evaluate body cannot import from here.
 */

/* The far face-to-face seat is the distinct floatPts branch: its die and
   feedback both turn, and the score leaves through the physical bottom of
   the die so it remains the player's reading-top edge. Exercise the real
   placement path rather than a private effect hook. */
export async function readFarSeatFeedback(page) {
  return page.evaluate(async () => {
    const k = window.__kb;
    k.S.gen += 1;                 // cancel the near placement's continuation
    k.S.mode = 'duo';
    k.S.seat = 'face';
    k.S.timer = 0;
    k.S.bottom = 1;
    k.S.turn = 0;
    k.S.phase = 'choose';
    k.S.busy = false;
    k.S.die = 4;
    k.S.boards = [[[], [], []], [[], [], []]];
    k.applySides();
    k.setStageDie(4, 0);
    k.showHints();
    await k.place(0, 0);

    const die = document.querySelector('#topBoard .col[data-col="0"] .die');
    const point = document.querySelector('#topBoard .col[data-col="0"] .pts');
    const numeral = die?.querySelector('.num');
    const inkRect = (element) => {
      if (!element) return null;
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect();
    };
    const dieRect = die?.getBoundingClientRect();
    const pointBox = point?.getBoundingClientRect();
    const pointInk = inkRect(point);
    const numeralInk = inkRect(numeral);
    const matrix = point ? new DOMMatrix(getComputedStyle(point).transform) : null;
    return dieRect && pointBox && pointInk && numeralInk && matrix ? {
      text: point.textContent,
      numeralDisplay: getComputedStyle(numeral).display,
      turned: matrix.a < -.99 && matrix.d < -.99,
      inside: pointBox.top >= dieRect.top - .5 && pointBox.bottom <= dieRect.bottom + .5
        && pointBox.left >= dieRect.left - .5 && pointBox.right <= dieRect.right + .5,
      edgeInset: dieRect.bottom - pointBox.bottom,
      halfGap: pointBox.top - (dieRect.top + dieRect.height / 2),
      gap: pointInk.top - numeralInk.bottom,
      centreError: Math.abs((pointInk.left + pointInk.width / 2)
        - (numeralInk.left + numeralInk.width / 2)),
    } : null;
  });
}

/* Minus feedback uses the same numeral header, but it belongs to a real
   victim rather than the last surviving die in that column. Use a stack
   where the matched 5 is not last so a wrong anchor cannot accidentally
   pass the geometry check. */
export async function readDestroyedDieFeedback(page) {
  return page.evaluate(async () => {
    const k = window.__kb;
    k.S.gen += 1;
    k.S.mode = 'duo';
    k.S.seat = 'pass';
    k.S.scoring = 0;
    k.S.timer = 0;
    k.S.bottom = 1;
    k.S.turn = 1;
    k.S.phase = 'choose';
    k.S.busy = false;
    k.S.die = 5;
    k.S.boards = [[[5, 2], [], []], [[], [], []]];
    k.S.charm.wards = [[0, 0, 0], [0, 0, 0]];
    k.applySides();
    k.renderAll(false);
    k.setStageDie(5, 1);
    k.showHints();
    const placement = k.place(1, 0);
    let point = null;
    for (let tick = 0; tick < 60; tick++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      point = [...document.querySelectorAll('#topBoard .pts')]
        .find((node) => node.textContent.startsWith('−'));
      if (point) break;
    }
    const victim = document.querySelector('#topBoard .col[data-col="0"] .slot[data-slot="2"] .die');
    const survivor = document.querySelector('#topBoard .col[data-col="0"] .slot[data-slot="1"] .die');
    const numeral = victim?.querySelector('.num');
    const inkRect = (element) => {
      if (!element) return null;
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect();
    };
    const dieRect = victim?.getBoundingClientRect();
    const survivorRect = survivor?.getBoundingClientRect();
    const pointBox = point?.getBoundingClientRect();
    const pointInk = inkRect(point);
    const numeralInk = inkRect(numeral);
    const result = dieRect && survivorRect && pointBox && pointInk && numeralInk ? {
      text: point.textContent,
      victim: numeral.textContent,
      survivor: survivor.querySelector('.num')?.textContent,
      victimOpacity: getComputedStyle(victim).opacity,
      inside: pointBox.top >= dieRect.top - .5 && pointBox.bottom <= dieRect.bottom + .5
        && pointBox.left >= dieRect.left - .5 && pointBox.right <= dieRect.right + .5,
      edgeInset: pointBox.top - dieRect.top,
      halfGap: dieRect.top + dieRect.height / 2 - pointBox.bottom,
      gap: numeralInk.top - pointInk.bottom,
      victimCentreError: Math.abs((pointInk.left + pointInk.width / 2)
        - (numeralInk.left + numeralInk.width / 2)),
      survivorDistance: Math.hypot(
        (pointInk.left + pointInk.width / 2) - (survivorRect.left + survivorRect.width / 2),
        (pointInk.top + pointInk.height / 2) - (survivorRect.top + survivorRect.height / 2)),
    } : null;
    k.S.gen += 1;
    await placement;
    return result;
  });
}
