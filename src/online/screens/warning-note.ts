/* ONE AMBER WARNING, TWO PLACES IT CAN STAND.
   The profile says the same kind of thing in two postures, and they must read
   as one language rather than as two designs that happen to be orange:

     DEALT    a refusal that ANSWERS A TAP, on the shared sheet over the panel
              (account-problem-sheet.ts). It arrives, it is read, it goes.
     STANDING a fact that is true before anything is tapped and stays true —
              today, Game Center refusing to identify this player, painted in
              the account panel where the control it replaces would have been.

   Only the posture differs, so only the frame differs (styles/account.css
   roots the type at both). The glyph, the heading and the sentence are this
   module, and neither caller owns a private copy of them. */
import { chromeIcon } from '../../ui/chromeicons.ts';

/** Glyph, heading and sentence — the whole body of an amber warning. */
export const WARNING_NOTE_MARKUP = `<div class="wshead">${chromeIcon('warn', 22)}`
  + `<span class="wstitle"></span></div><p class="wsbody"></p>`;

/* Caller-owned text is SET, never interpolated: this copy can carry a nickname
   or a server string, and markup built by concatenation is one quote away from
   being someone else's. */
export function paintWarningNote(host: HTMLElement, title: string, body: string): void {
  host.querySelector<HTMLElement>('.wstitle')!.textContent = title;
  host.querySelector<HTMLElement>('.wsbody')!.textContent = body;
}
