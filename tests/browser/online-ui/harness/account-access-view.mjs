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
    /* The profile has no error LINE any more: every refusal it can produce is
       dealt as the shared warning card (readAccountProblem below). Kept as a
       reading so a resurrected line fails loudly instead of quietly splitting
       the answer across two places again. */
    error: seen('#onAccErr'),
    problemSheets: document.querySelectorAll('.faceoff.warnsheet').length,
    authSheets: document.querySelectorAll('.authsheet').length,
    authTitle: document.getElementById('onAuthTitle')?.textContent ?? '',
    accountShown: document.getElementById('onAccount')?.hidden === false,
    appleCalls: globalThis.__appleSignIn?.calls ?? 0,
    gameCenterProofs: globalThis.__gameCenter?.proofs ?? 0,
  };
});

/* THE WARNING CARD, read as paint rather than as DOM.
 *
 * A `.warnsheet` in the document proves nothing: the sheet arrives from below
 * the fold on a 340ms flight, so a card that is present can still be entirely
 * off-screen, and the amber frame it is supposed to wear is a computed
 * `color-mix` of a token that could silently resolve to nothing. So this reads
 * the rect, the computed border, the heading's colour, whether the glyph has
 * any box at all, and whether the card is what a finger would actually hit in
 * its own middle. */
export const readAccountProblem = (page) => page.evaluate(() => {
  const overlay = document.querySelector('.faceoff.warnsheet');
  const card = overlay?.querySelector('.focard');
  if (!overlay || !card) return { open: false, count: 0 };
  const box = card.getBoundingClientRect();
  const style = getComputedStyle(card);
  const head = card.querySelector('.wshead');
  const glyph = head?.querySelector('svg')?.getBoundingClientRect();
  const rgba = (value) => (String(value).match(/[\d.]+/g) ?? []).map(Number);
  const middle = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return {
    open: box.width > 0 && box.height > 0 && style.display !== 'none'
      && style.visibility !== 'hidden' && Number(style.opacity) > 0,
    // A card the player has to scroll to is not an answer they were given.
    inView: box.top >= 0 && box.bottom <= innerHeight,
    // The card is what a tap in its own middle reaches, not a ghost under one.
    hit: !!middle && card.contains(middle),
    role: card.getAttribute('role'),
    modal: card.getAttribute('aria-modal'),
    label: card.getAttribute('aria-label') ?? '',
    title: card.querySelector('.wstitle')?.textContent?.trim() ?? '',
    message: card.querySelector('.wsbody')?.textContent?.trim() ?? '',
    border: rgba(style.borderTopColor),
    borderWidth: style.borderTopWidth,
    headColor: rgba(head ? getComputedStyle(head).color : ''),
    glyph: !!glyph && glyph.width > 0 && glyph.height > 0,
    // the announceable way out every sheet in this game wears
    grabber: !!card.querySelector('.fograb'),
    count: document.querySelectorAll('.faceoff.warnsheet').length,
    focused: document.activeElement?.id ?? '',
  };
});
