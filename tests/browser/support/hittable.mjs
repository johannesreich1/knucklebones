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
      return `box ${Math.round(box.width)}x${Math.round(box.height)}, `
        + `top element ${name(hit)}, practice sheet hidden=${document.getElementById('ovPractice')?.hidden}`;
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
