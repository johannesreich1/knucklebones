/* What the player is actually looking at in the ACCOUNT ACCESS box.
 *
 * Everything here is read as PAINT — rect plus computed display/visibility —
 * because `hidden` on a row inside .providerbox is a claim about the DOM, and
 * `.providerbox p{display:flex}` outranks the attribute on specificity alone.
 * One reader for both provider scenarios: a row and its control are the same
 * kind of offer whichever provider owns them. */
export const readAccountAccess = (page) => page.evaluate(() => {
  const seen = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const painted = box.width > 0 && box.height > 0
      && style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity) > 0;
    return {
      text: element.textContent?.trim() ?? '',
      shown: painted,
      // A reply the player must scroll to find has not been delivered.
      inView: painted && box.top < innerHeight && box.bottom > 0,
      // Translated provider copy is long; a row that overflows its own box has
      // told the player only as much of the fact as happened to fit.
      clipped: painted && element.scrollWidth > element.clientWidth + 1,
    };
  };
  return {
    box: seen('#accProviders'),
    gameCenter: seen('#accGameCenterState'),
    gameCenterButton: seen('#btnLinkGameCenter'),
    apple: seen('#accAppleState'),
    appleButton: seen('#btnLinkApple'),
    guestCard: seen('#accGuest'),
    error: seen('#onAccErr'),
    authSheets: document.querySelectorAll('.authsheet').length,
    authTitle: document.getElementById('onAuthTitle')?.textContent ?? '',
    accountShown: document.getElementById('onAccount')?.hidden === false,
    appleCalls: globalThis.__appleSignIn?.calls ?? 0,
    gameCenterProofs: globalThis.__gameCenter?.proofs ?? 0,
  };
});
