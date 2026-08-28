/* WHAT THE FACE-OFF SHEET IS WORTH IN PIXELS, separate from the taps that get
   it there (faceoff-sheet.mjs). Every reading below answers what the PLAYER
   gets rather than what the DOM holds: a card that merely appeared, a control
   with a rect that answers no finger, or a flight nobody can see but everybody
   is blocked by all agree with the DOM perfectly (single-strike-visibility's
   lesson). The arrival frames these fold in are armed by
   support/sheet-card.mjs's armSheetArrival, before the tap that opens the card. */

/* THE CARD AS IT SETTLED: who it names, what it offers, and the flight it took
   to get here — read in one snapshot, because the frames are still growing. */
export function readFaceoffCard(page) {
  return page.evaluate(() => {
    const ov = document.querySelector('.faceoff');
    const rc = ov?.querySelector('.focard')?.getBoundingClientRect();
    /* the pixel test, not the rect test: the card first shipped at z-index
       60 under the board overlay (z 80) — present in the DOM, invisible on
       screen. elementFromPoint answers what the PLAYER gets. */
    const hit = rc ? document.elementFromPoint(rc.x + rc.width / 2, rc.y + rc.height / 2) : null;
    return {
      visible: !!rc && rc.width > 0 && rc.height > 0 && !!ov?.contains(hit),
      solo: !!ov?.classList.contains('solo'),
      vsShown: !!ov?.querySelector('.fovs'),
      name: ov?.querySelector('.fnm')?.textContent,
      streak: ov?.querySelector('.fostreak')?.textContent,
      record: [...(ov?.querySelectorAll('.fost') ?? [])].map((s) => s.textContent?.trim() ?? '')[1] ?? '',
      arrive: window.__fo.arrival(),
      /* nothing anywhere still offers the retired shapes */
      noX: !ov?.querySelector('.foexit') && ![...(ov?.querySelectorAll('button') ?? [])]
        .some((b) => (b.textContent ?? '').includes('✕')),
      bottomBtns: [...(ov?.querySelectorAll('.btn') ?? [])].map((b) => b.textContent?.trim() ?? ''),
      gapLine: !!ov?.querySelector('.fogap'),
      rest: rc ? Math.round(rc.top) : null,
    };
  });
}

/* THE GRABBER, MEASURED AS THE PLAYER MEETS IT (design 30c-foexit-grabber).
   No ✕ lives on this card any more — not in the corner, not in a header,
   not under the stats. What replaces it is a 40×4 bar on the card's top
   EDGE that is also a real, labelled, focusable button, because a gesture
   alone is silent to a screen reader and unreachable from a keyboard.
   ONE measurement, taken at every width this suite tries: the painted box,
   the TIGHTEST distance to anything the card draws below it — reported as
   a number, because a boolean that passes by 0.00px says nothing about how
   close the next change came — and the size of the area that actually
   answers a finger, which only elementFromPoint can see: a 14px control
   carrying an invisible expander and a 14px control without one have the
   same rect and are not the same control. */
export function readGrabMetrics(page) {
  return page.evaluate(() => {
    const ov = document.querySelector('.faceoff');
    const b = ov?.querySelector('.fograb'), bar = ov?.querySelector('.fobar');
    const cb = ov?.querySelector('.focard')?.getBoundingClientRect();
    const bb = b?.getBoundingClientRect(), rb = bar?.getBoundingClientRect();
    if (!b || !bb || !cb) return null;
    const bits = [...ov.querySelectorAll('.focols .av,.focols .fnm,.focols .gpill,.focols .fovs')]
      .map((el) => el.getBoundingClientRect());
    // how far two boxes stand apart along the axis that separates them,
    // negative where they overlap — so a regression states HOW far it went
    const apart = (q) => Math.max(q.left - bb.right, bb.left - q.right,
                                  q.top - bb.bottom, bb.top - q.bottom);
    /* the hit band, walked outward from the middle of the bar one pixel at a
       time. It counts the points that ANSWER, and a box owns its top-left
       edge but not its bottom-right one, so the outermost answering points
       span exactly one pixel less than the box they belong to — hence the
       +1 below, which makes these the box's own numbers again. */
    const mine = (x, y) => { const el = document.elementFromPoint(x, y); return !!el && (el === b || b.contains(el)); };
    const cx = (bb.left + bb.right) / 2, cy = (bb.top + bb.bottom) / 2;
    let top = cy, bot = cy, left = cx, right = cx;
    while (top > 1 && mine(cx, top - 1)) top--;
    while (bot < window.innerHeight - 1 && mine(cx, bot + 1)) bot++;
    while (left > 1 && mine(left - 1, cy)) left--;
    while (right < window.innerWidth - 1 && mine(right + 1, cy)) right++;
    return {
      tag: b.tagName, label: b.getAttribute('aria-label') ?? '',
      focusable: b.tabIndex >= 0 && !b.disabled,
      bar: rb ? { w: Math.round(rb.width), h: Math.round(rb.height) } : null,
      /* centred on the card, and standing on its top edge */
      centred: Math.abs(cx - (cb.left + cb.right) / 2) < 1,
      fromTop: Math.round(bb.top - cb.top),
      /* and it costs the card NO width: the 46px avatars and the
         130px-capped nickname keep the whole card */
      clearBy: bits.length ? Math.round(Math.min(...bits.map(apart)) * 10) / 10 : null,
      // what a FINGER gets, which is not what is drawn
      tap: { w: Math.round(right - left) + 1, h: Math.round(bot - top) + 1 },
      avatar: Math.round(ov.querySelector('.focol .av')?.getBoundingClientRect().width ?? 0),
    };
  });
}

/* THE EXIT FLIGHT Escape starts, sampled frame by frame like the arrival. The
   wash is at alpha 0 about 40% of the way down, but the overlay covers inset:0
   until it is removed, so for the rest of the flight a sheet nobody can see is
   still between the finger and the ladder. Read at the middle of the screen,
   every frame: while the card rests there the sheet must answer, and from the
   moment it starts leaving it must not.
   The key press belongs to this measurement rather than to the doors, because
   the sampler has to be running before it and the frames it produces are only
   readable against the index it was pressed at. */
export async function sampleEscapeExitFlight(page) {
  await page.evaluate(() => {
    window.__exit = { pressed: -1, f: [] };
    const tick = () => {
      const ov = document.querySelector('.faceoff');
      if (!ov) return;
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      window.__exit.f.push({ top: ov.querySelector('.focard').getBoundingClientRect().top,
                             hit: !!(el && (el === ov || ov.contains(el))) });
      if (window.__exit.f.length < 60) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  /* Do not press Escape until the renderer has actually painted the
     resting hit stack. A fixed sleep can expire without a single rAF on
     a contended Linux runner, producing `rested: 0` without exercising
     either side of the pointer-events contract. The assertion over this
     still requires every captured resting frame to belong to the sheet. */
  await page.waitForFunction(() => window.__exit.f.length >= 2,
                             null, { timeout: 3000 });
  await page.evaluate(() => { window.__exit.pressed = window.__exit.f.length; });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(320);
  return page.evaluate(() => {
    const { f, pressed } = window.__exit, rest = f.length ? f[0].top : 0;
    /* "leaving" is not a class here, it is the card being visibly lower
       than it rested. The frames between the last one that is certainly
       BEFORE the press and the first one that has certainly MOVED are the
       key's own flight time and belong to neither side. */
    const at = f.slice(0, Math.max(0, pressed));
    const off = f.slice(f.findIndex((s) => s.top > rest + 2));
    return { rested: at.length, restedHit: at.filter((s) => s.hit).length,
             leaving: off.length, leavingHit: off.filter((s) => s.hit).length };
  });
}
