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
        .filter((animation) => ((overlays.includes(animation.effect?.target)
          && (animation.transitionProperty === 'opacity'
            || animation.transitionProperty === 'visibility'))
          || animation.id.startsWith('kb-page-')
          || animation.id.startsWith('kb-duel-bracket-'))
          && (animation.playState === 'pending' || animation.playState === 'running'));
      if (!running.length) break;
      await Promise.allSettled(running.map((animation) => animation.finished));
      await frame();
    }
  }, selector);
}
