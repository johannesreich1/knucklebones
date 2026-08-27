/* WHY THIS IS A SHEET AND NOT THE LINE UNDER THE BOX.
   Every ACCOUNT ACCESS control answers one question — can this account gain
   another way back in — and the answer used to land in `#onAccErr`, a small
   orange line pinned near the bottom of a scrolling profile. The player taps a
   button in the middle of the panel and the reply appears somewhere else,
   below the recent matches, sometimes off-screen entirely (user call
   2026-08-26: the position "doesn't make sense. it should be a modal like the
   spells or ladder comparison"). So it comes up the way every other focused
   answer in this game does: the shared sheet, the same one the rune library
   and the ladder face-off ride in, wearing the warning's own amber.

   THE COLOUR IS NOT NEW. `--orange` is the token the error line already used;
   it is handed to the sheet as a TINT, which is the card's existing mechanism
   for being dealt in the colour of what it is about (the frame catches it, a
   glow leaks out, the heading burns with it). No second modal, no second
   palette — the only thing this module owns is which copy goes on the card.

   NOTHING CHANGED is the message's other half: a failure never refreshes the
   account, so the box behind this card is still offering the same tap. That is
   why dismissal returns focus to the control that opened it rather than
   anywhere else — the player's next move is to read the advice and try again. */
import { t } from '../../i18n/index.ts';
import { chromeIcon } from '../../ui/chromeicons.ts';
import { showSheet } from '../../ui/sheet.ts';

const TITLE = (): string => t('online', 'profile.actionFailed');

/**
 * @param render the message, re-read on every locale change (the provider
 *   returns copy as a plain string, so `repaintOnlineMessage` is what keeps
 *   its catalog provenance across a `languagechange` while the card is open).
 * @param opener the control to hand focus back to when the card is gone.
 */
export function showAccountProblem(render: () => string, opener: HTMLElement | null): void {
  /* Caller-owned text is SET, never interpolated: a provider message can carry
     a nickname or a server string, and markup built by concatenation is one
     quote away from being someone else's. */
  const paint = (card: HTMLElement): void => {
    card.querySelector<HTMLElement>('.wstitle')!.textContent = TITLE();
    card.querySelector<HTMLElement>('.wsbody')!.textContent = render();
  };
  const sheet = showSheet({
    cls: 'warnsheet',
    tint: 'var(--orange)',
    label: TITLE,
    body: `<div class="wshead">${chromeIcon('warn', 22)}<span class="wstitle"></span></div>
      <p class="wsbody"></p>`,
    repaintLocale: paint,
    restoreFocus: opener,
  });
  // showSheet mounts synchronously, so the card never paints its empty frame.
  paint(sheet.card);
}
