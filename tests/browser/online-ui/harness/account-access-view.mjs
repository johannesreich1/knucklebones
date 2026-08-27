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

/* THE STANDING WARNING, read as GEOMETRY rather than as document order.
 *
 * "this card, only for this status, should be shown at the bottom before the
 * sign out button, after the match history" (user call 2026-08-27) is a claim
 * about where the player's eye finds it, and a DOM sibling can still paint
 * anywhere — `.accfoot` is pinned with `margin-top:auto`, the mini history
 * above it is trimmed to fit, and a box that ends up below the fold has told
 * nobody anything. So the rects of the three elements are compared directly,
 * and the middle of the box is hit-tested the same way the dealt card is.
 *
 * The other half is that this is NOT the card: no dialog role, no backdrop, no
 * focus taken. A standing element with nothing focusable inside it cannot trap
 * a keyboard player, which is the strongest form of that claim available. */
export const readStandingWarning = (page) => page.evaluate(() => {
  const note = document.querySelector('#accGameCenterBlocked');
  const box = (selector) => {
    const element = document.querySelector(selector);
    if (!element || element.hidden) return null;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      ? { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width } : null;
  };
  if (!note) return { present: false };
  const rect = note.getBoundingClientRect();
  const style = getComputedStyle(note);
  const head = note.querySelector('.wshead');
  const glyph = head?.querySelector('svg')?.getBoundingClientRect();
  const rgba = (value) => (String(value).match(/[\d.]+/g) ?? []).map(Number);
  const middle = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const active = document.activeElement;
  return {
    present: true,
    shown: rect.width > 0 && rect.height > 0 && style.display !== 'none'
      && style.visibility !== 'hidden' && Number(style.opacity) > 0,
    inView: rect.top >= 0 && rect.bottom <= innerHeight,
    hit: !!middle && note.contains(middle),
    title: note.querySelector('.wstitle')?.textContent?.trim() ?? '',
    message: note.querySelector('.wsbody')?.textContent?.trim() ?? '',
    border: rgba(style.borderTopColor),
    borderWidth: style.borderTopWidth,
    headColor: rgba(head ? getComputedStyle(head).color : ''),
    glyph: !!glyph && glyph.width > 0 && glyph.height > 0,
    // it is a panel element, not a second modal
    role: note.getAttribute('role'),
    modal: note.getAttribute('aria-modal'),
    sheets: document.querySelectorAll('.faceoff').length,
    focusables: note.querySelectorAll('a,button,input,select,textarea,[tabindex]').length,
    holdsFocus: !!active && note.contains(active),
    // where it stands, in the only order the player can see
    rect: { top: rect.top, bottom: rect.bottom },
    history: box('#btnHistory'),
    recent: box('#accRecent'),
    signOut: box('#btnSignOut'),
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
