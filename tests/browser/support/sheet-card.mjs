/* THE ui/sheet CARD, CLOCKED AND DRAGGED IN ONE PLACE.
   The ladder's face-off (design 30c) and the card a HUD badge chip deals (user
   call 2026-08-23) are the SAME component, so the arrival clock, the finger
   that pulls the card down and the confirmation that it left are owned here
   rather than hand-copied per suite — online-ui's faceoff probe and
   hud-settings' badge-cards walk both guard these very numbers, and a second
   copy of them is a second implementation of the sheet.
   What is NOT here: which control opens the sheet, and what the card says once
   it is up. Those differ per surface and stay with the suite that reads them. */

/* THE ARRIVAL, sampled frame by frame — armed BEFORE the tap that opens the
   sheet, because the flight is 340ms and the interesting part is its first
   frame. One custom property drives the card's transform and the wash's alpha,
   so both are read here: if they ever disagree, the fade lands somewhere the
   card is not. */
export function armSheetArrival(page) {
  return page.evaluate(() => {
    window.__fo = {
      vh: window.innerHeight,
      frames: [],
      /* IT CAME UP FROM THE BOTTOM. Not "a class was added": the card's own
         box started far below where it settled and climbed, and the wash was
         thinner then than it is now. The first sample is whatever frame the
         rAF caught, so the assertion is about DISTANCE TRAVELLED, not about
         catching frame zero.
         Called from inside the reader's OWN evaluate, so the flight is folded
         into the same snapshot as everything else it reads about the card —
         and left to throw when nobody armed the sampler, because a silent null
         reads as "the card never travelled", which is a different bug. */
      arrival() {
        const f = this.frames;
        return f.length ? { first: f[0].top, last: f[f.length - 1].top, vh: this.vh,
                            washFirst: f[0].a, washLast: f[f.length - 1].a,
                            rose: f.every((s, i) => i === 0 || s.top <= f[i - 1].top + 1) } : null;
      },
    };
    const alpha = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c || '');
      if (!m) return 1;
      const p = m[1].split(',');
      return p.length > 3 ? parseFloat(p[3]) : 1;
    };
    const tick = () => {
      const c = document.querySelector('.focard'), ov = document.querySelector('.faceoff');
      if (c && ov) window.__fo.frames.push({ top: Math.round(c.getBoundingClientRect().top),
                                             a: alpha(getComputedStyle(ov).backgroundColor) });
      if (window.__fo.frames.length < 36) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/* Did the sheet leave? Answers FALSE instead of throwing, so a door that
   stopped answering is reported as that door rather than as a timeout on some
   later step that inherited the sheet still standing over the screen. */
export function sheetGone(page) {
  return page.waitForFunction(() => !document.querySelector('.faceoff'),
                              null, { timeout: 4000 }).then(() => true, () => false);
}

/* A DRAG SYNTHESISED ON THE CARD — AND THE FINGER IS STILL DOWN when this
   resolves. The caller owns the pause and the lift on purpose: a helper that
   released by itself would turn every short drag into a flick and quietly move
   the assertion from the DISTANCE rule to the velocity one.
   `pace` is how long the finger rests between steps (0 throws it); `onStep`
   receives each step's distance after the move and before that rest, for a
   caller that samples the card mid-gesture rather than only after it. */
export async function dragSheetAndHold(page, grip, dist,
                                       { steps = 8, pace = 16, onStep = null } = {}) {
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const distance = Math.round((dist * i) / steps);
    await page.mouse.move(grip.x, grip.y + distance);
    if (onStep) await onStep(distance);
    if (pace) await page.waitForTimeout(pace);
  }
}
