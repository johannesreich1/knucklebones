/* A browser command returning only proves that classes changed; a loaded
   compositor can still hit-test the outgoing overlay. Wait for the authored
   opacity/visibility transitions and the shared page-navigation animations,
   including a replacement transition created while the first one settles. */
export async function waitForOverlayTransitions(page, selector) {
  await page.evaluate(async (overlaySelector) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const overlays = [...document.querySelectorAll(overlaySelector)];
    overlays.forEach((overlay) => {
      getComputedStyle(overlay).opacity;
      getComputedStyle(overlay).visibility;
    });
    await frame();

    for (let pass = 0; pass < 3; pass++) {
      const running = document.getAnimations({ subtree: true })
        .filter((animation) => {
          const target = animation.effect?.target;
          /* A revealed page hands its content a discrete visibility transition
             of its own (reduce-motion's blanket duration, an authored .btn
             one); until that lands the control is neither visible nor
             hit-testable. */
          const inside = overlays.some((overlay) => overlay === target || overlay.contains(target));
          return (animation.id.startsWith('kb-page-')
            || animation.id.startsWith('kb-duel-bracket-')
            || (inside && (animation.transitionProperty === 'visibility'
              || (overlays.includes(target) && animation.transitionProperty === 'opacity'))))
            && (animation.playState === 'pending' || animation.playState === 'running');
        });
      if (!running.length) break;
      await Promise.allSettled(running.map((animation) => animation.finished));
      await frame();
    }
  }, selector);
}
