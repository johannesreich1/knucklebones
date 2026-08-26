const target = (page, selector) => page.locator(selector).first();

const scaleOf = async (page, selector) => target(page, selector).evaluate((button) => {
  const transform = getComputedStyle(button).transform;
  if (transform === 'none') return 1;
  return new DOMMatrix(transform).a;
});

/* Browser commands returning does not mean the compositor has painted the end
   of a CSS transition. That distinction is observable on a loaded Linux CI
   runner: sleeping longer than the authored duration can still sample an
   intermediate transform. Synchronize with the element's actual transition
   instead, and explicitly prove that native :active reached (or left) the
   intended hit target before sampling it. */
const settledScale = async (button, active = null) => button.evaluate(async (element, expectedActive) => {
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  if (expectedActive !== null) {
    for (let attempt = 0; attempt < 12 && element.matches(':active') !== expectedActive; attempt++) {
      await frame();
    }
    if (element.matches(':active') !== expectedActive) {
      throw new Error(`native :active did not become ${expectedActive ? 'pressed' : 'released'}`);
    }
  }

  /* A style flush plus a frame makes a newly-created CSSTransition visible to
     getAnimations(). Re-check after completion because a transition may be
     replaced when the active state changes during that first frame. */
  getComputedStyle(element).transform;
  await frame();
  for (let pass = 0; pass < 3; pass++) {
    const running = element.getAnimations().filter((animation) =>
      animation.playState === 'pending' || animation.playState === 'running');
    if (!running.length) {
      await frame();
      if (!element.getAnimations().some((animation) =>
        animation.playState === 'pending' || animation.playState === 'running')) break;
      continue;
    }
    await Promise.allSettled(running.map((animation) => animation.finished));
    await frame();
  }

  const transform = getComputedStyle(element).transform;
  return transform === 'none' ? 1 : new DOMMatrix(transform).a;
}, active);

/* Hold long enough to sample the painted end state, then leave the control
   before release. This proves both the native :active path and cancellation
   without firing the button's action. */
export async function holdAndCancel(page, selector) {
  const button = target(page, selector);
  await button.waitFor({ state: 'visible' });
  /* `visible` includes a partly clipped control. On Linux the History button
     can begin at y=922 in a 932px viewport, putting its box centre below the
     screen; raw mouse coordinates then press nothing and native :active never
     starts. Bring the whole target into view and let Playwright prove the
     current hit stack is stable before taking over with the held press. */
  await button.scrollIntoViewIfNeeded();
  await button.hover();
  const box = await button.boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const resting = await scaleOf(page, selector);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const enabled = await button.isEnabled();
  const held = await settledScale(button, enabled ? true : null);
  await page.mouse.move(1, 1, { steps: 4 });
  await page.mouse.up();
  const released = await settledScale(button, enabled ? false : null);
  return { resting, held, released };
}

export async function pressingClass(page, selector) {
  const button = target(page, selector);
  const resting = await scaleOf(page, selector);
  await button.evaluate((element) => element.classList.add('pressing'));
  const held = await settledScale(button);
  await button.evaluate((element) => element.classList.remove('pressing'));
  const released = await settledScale(button);
  return { resting, held, released };
}
