// WAIT FOR A CONTROL TO BE REACHABLE, NOT FOR A NUMBER OF MILLISECONDS.
//
// Leaving a game and opening the setup sheet is not instant: the board unwinds
// over a frame or two, and until it has, a `.slot` still sits over the sheet
// and swallows the tap. A fixed wait papers over that on a quiet machine and
// fails on a loaded one — `random-mode-dial` failed exactly this way under the
// release gate's four-way parallelism, having passed standalone minutes before,
// with Playwright reporting `<div class="slot"> … intercepts pointer events`.
//
// Playwright's own actionability check does not save us here: it waits for the
// TARGET to be visible, enabled and stable, which it already is — what is wrong
// is that something else is on top of it. So ask the only question that matches
// the failure: does a hit test at the control's centre actually land on it?
export async function awaitHittable(page, selector, timeout = 30000) {
  try {
    await waitForHit(page, selector, timeout);
  } catch (error) {
    /* A bare "timeout" says nothing about WHY. Name what is actually on top, so
       the next person reads the obstruction instead of re-deriving it. */
    const blocking = await page.evaluate((target) => {
      const el = document.querySelector(target);
      if (!el) return 'the control is not in the DOM';
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      const name = (node) => (node
        ? `${node.tagName.toLowerCase()}${node.id ? '#' + node.id : ''}`
          + `${node.className && typeof node.className === 'string' ? '.' + node.className.trim().split(/\s+/).join('.') : ''}`
        : 'nothing');
      /* These overlays gate on the `.on` CLASS, not the hidden attribute:
         without it .ov is visibility:hidden and pointer-events:none, so the
         board behind takes the hit. Report the class, and the computed values
         it drives, or the reading says nothing. */
      const sheet = document.getElementById('ovPractice');
      const sheetStyle = sheet ? getComputedStyle(sheet) : null;
      return `box ${Math.round(box.width)}x${Math.round(box.height)}, `
        + `top element ${name(hit)}, sheet classes "${sheet?.className ?? '-'}", `
        + `visibility ${sheetStyle?.visibility}, pointer-events ${sheetStyle?.pointerEvents}`;
    }, selector).catch(() => 'page unavailable');
    throw new Error(`${selector} never became hittable (${blocking}) :: ${error.message}`);
  }
}

function waitForHit(page, selector, timeout) {
  return page.waitForFunction((target) => {
    const el = document.querySelector(target);
    if (!el) return false;
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return false;
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return !!hit && el.contains(hit);
  }, selector, { timeout });
}

/**
 * Wait until a game that is STARTING has actually started.
 *
 * Starting one hides the setup sheet (`hide('#ovPractice')` in
 * flow/local-start.ts) as part of the same run that opens the reveal. A test
 * that dismisses the reveal and immediately goes back to the sheet can beat
 * that hide: it reopens the sheet, the pending start lands, and the sheet
 * closes again — leaving a setup control that is never hittable because the
 * board is over it, permanently rather than briefly.
 *
 * It is a race, so it fails only under load. Measured on this suite: three of
 * six concurrent runs, with the sheet reading `class="ov paged"` — no `on`,
 * visibility hidden, pointer-events none — while `S.phase` was already 'roll'.
 *
 * A live phase is the signal that the start has finished doing that.
 */
export async function awaitLiveGame(page, timeout = 15000) {
  await page.waitForFunction(() => {
    const phase = window.__kb?.S?.phase;
    return phase === 'roll' || phase === 'choose' || phase === 'anim';
  }, null, { timeout });
}

/**
 * Open the setup sheet and KEEP it open long enough to use.
 *
 * Waiting for the game to be live is not enough on its own: the close observed
 * here happened with `S.phase` ALREADY 'roll', so the hide came from a start
 * landing while a game was running — this suite deliberately starts twice
 * inside the 650ms opening beat, and under load one of those lands much later.
 *
 * Ordering that from the outside is not possible, so this tolerates it instead:
 * reopen if a late start closed the sheet, and succeed only when the control is
 * genuinely reachable. Bounded, so a sheet that never opens still fails rather
 * than spinning — and the failure names what was on top, as ever.
 */
export async function openSetupSheet(page, control = '#modeSeg button[data-m="cpu"]') {
  await pressOnSetupSheet(page, control, { press: false });
}

/**
 * Reach the setup sheet and press one of its controls, as ONE retried unit.
 *
 * Opening and pressing cannot be separated here. A late start closes the sheet,
 * and it can do so between a wait that saw the control reachable and the click
 * that follows it — which is exactly how this failed after the first fix:
 * `element is not visible`, on a control that had just been verified hittable.
 * Whatever the gap, a start can land in it, so the pair retries together.
 */
export async function pressOnSetupSheet(page, control, { press = true } = {}) {
  await awaitLiveGame(page);
  let last = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.evaluate(() => { window.__kb.goHome(); window.__kb.openPractice(); });
    try {
      await awaitHittable(page, control, 4000);
      if (!press) return;
      await page.click(control, { timeout: 4000 });
      return;
    } catch (error) { last = error; }
  }
  throw last ?? new Error(`${control} never became reachable`);
}
