/* A wall-clock sleep does not guarantee that a loaded compositor painted the
   end of an authored animation. Wait for the selected elements' own motion,
   then require their measured boxes to hold for three consecutive frames. */
export async function waitForStableGeometry(page, selectors) {
  await page.evaluate(async (targets) => {
    const elements = targets.flatMap((selector) =>
      [...document.querySelectorAll(selector)]);
    if (!elements.length) throw new Error(`no geometry targets for ${targets.join(', ')}`);

    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const moving = () => elements.flatMap((element) => element.getAnimations())
      .filter((animation) => animation.playState === 'pending'
        || animation.playState === 'running');

    /* Flush style before the first frame so newly-created transitions and
       animations are visible to getAnimations(). Re-check after completion:
       a resize or seating handoff can replace one during that first paint. */
    elements.forEach((element) => element.getBoundingClientRect());
    await frame();
    for (let pass = 0; pass < 4; pass++) {
      const running = moving();
      if (!running.length) {
        await frame();
        if (!moving().length) break;
        continue;
      }
      await Promise.allSettled(running.map((animation) => animation.finished));
      await frame();
    }

    let previous = '';
    let stableFrames = 0;
    for (let attempt = 0; stableFrames < 3 && attempt < 120; attempt++) {
      await frame();
      const signature = elements.map((element) => {
        const box = element.getBoundingClientRect();
        return [box.x, box.y, box.width, box.height]
          .map((value) => value.toFixed(3)).join(':');
      }).join('|');
      stableFrames = signature === previous ? stableFrames + 1 : 0;
      previous = signature;
    }
    if (stableFrames < 3) throw new Error(`geometry did not settle for ${targets.join(', ')}`);
  }, selectors);
}
