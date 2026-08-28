/* THE DOORS OF THE FACE-OFF SHEET — the taps themselves, kept apart from what
   they are worth in pixels (faceoff-metrics.mjs). Everything here drives the
   sheet the way a player does: through the ladder row, the grabber and a real
   pointer stream, never by calling the app's own close(). */

/* ONE DOOR IN, used for every reopen the walk makes: tap a row, wait for the
   RPC's digits, then let the 340ms arrival land before anything is measured.
   Every reopen shares this door, so it has to start from a room with no card
   in it. A settled sheet keeps `fofly` (only a drag takes it off) and covers
   inset:0, so a reopen that raced the previous close spent its whole timeout
   clicking a row an OPEN faceoff was swallowing — which a four-worker gate
   reaches and a quiet machine does not. */
export async function openFaceoff(page) {
  await page.waitForFunction(() => !document.querySelector('.faceoff'),
    null, { timeout: 15000 });
  await page.click('#ovOnline .lb .lrow');
  await page.waitForFunction(() =>
    /\d/.test(document.querySelector('.faceoff .fostreak')?.textContent ?? ''), null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const ov = document.querySelector('.faceoff:not(.foout)');
    const card = ov?.querySelector('.focard');
    if (!ov || !card) return false;
    const box = card.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    const transform = getComputedStyle(card).transform;
    const dy = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m42 : 0;
    return box.width > 0 && box.height > 0 && !!hit && ov.contains(hit) && Math.abs(dy) <= 1;
  }, null, { timeout: 3000 });
}

/* Where a finger has to land to take hold of the grabber: the middle of its
   painted box, which is also the point the touch gesture below starts from. */
export function grabCentre(page) {
  return page.evaluate(() => {
    const b = document.querySelector('.fograb').getBoundingClientRect();
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
  });
}

/* A SHORT DRAG IN THE FINGER'S OWN IDIOM: a touch pointer stream dispatched
   page-side from the grabber, and released short of the commit line. It leaves
   the sheet wherever the app put it — the caller reads what happened. */
export function touchDragAndRelease(page, tgrip) {
  return page.evaluate(async ([x, y]) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const fire = (t, cy) => document.elementFromPoint(x, Math.min(cy, innerHeight - 1))
      ?.dispatchEvent(new PointerEvent(t, { pointerId: 7, pointerType: 'touch', isPrimary: true,
        clientX: x, clientY: cy, bubbles: true, cancelable: true }));
    fire('pointerdown', y);
    /* PACED LIKE A FINGER. Dispatched back to back, six 8px steps arrive in
       ~0ms and the velocity rule reads them as a flick — which commits, and
       the card leaves. That is the harness moving impossibly fast, not the
       app being wrong: 8px per 40ms is 0.2px/ms, well under the 0.5 the
       flick asks for. The lift then waits out the 80ms staleness window,
       so this is unambiguously a slow drag released short. */
    for (let i = 1; i <= 6; i++) { await wait(40); fire('pointermove', y + i * 8); }
    await wait(120);
    fire('pointerup', y + 48);
  }, [tgrip.x, tgrip.y]);
}

/* A PLAIN CLICK on the grabber's bar, or 2px under its box on the invisible
   expander that carries the 14px control to 44px — and what the click LANDED
   on, captured before it lands, because the target IS the bug this reports. */
export async function tapGrabAndReport(page, where) {
  const p = await page.evaluate((w) => {
    const b = document.querySelector('.fograb').getBoundingClientRect();
    window.__ct = null;
    document.addEventListener('click', (e) => {
      window.__ct = e.target instanceof Element ? (e.target.className || e.target.tagName) : '?';
    }, { capture: true, once: true });
    return { x: Math.round((b.left + b.right) / 2),
             y: Math.round(w === 'bar' ? (b.top + b.bottom) / 2 : b.bottom + 2) };
  }, where);
  await page.mouse.click(p.x, p.y);
  return page.evaluate(() => window.__ct);
}
