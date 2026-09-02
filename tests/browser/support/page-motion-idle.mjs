/* Page navigation has genuinely landed only when the controller's timelines
   are gone AND its temporary paint classes are off the surfaces. A probe that
   samples earlier reads mid-run state as if it were the landing. Shared by
   every scenario that drives more than one navigation, so the definition of
   "idle" cannot drift between them. */
export const PAGE_MOTION_TRANSIENTS = '.page-motion-source,.page-motion-target,'
  + '.page-motion-stage,.page-motion-cleanup,.page-motion-panel-layer,.page-motion-within';

export async function waitForMotionIdle(page, timeout = 1600) {
  await page.waitForFunction((transients) => {
    const managed = document.getAnimations({ subtree: true })
      .filter((animation) => /^(kb-page-|kb-duel-bracket-)/.test(animation.id));
    return !document.getElementById('kbroot')?.classList.contains('page-motion-active')
      && managed.length === 0
      && !document.querySelector(transients);
  }, PAGE_MOTION_TRANSIENTS, { timeout });
}
