/* One implementation behind every ACCOUNT ACCESS control.
   Each row in that box is the same shape of offer — run this provider against
   the account the player is already signed into, and repaint the box from a
   fresh identity-status read when it worked. Only three things differ per
   provider: which button, which provider call, and the copy for a call that
   rejects outright. Everything else (the tap sound, clearing the last error,
   the busy state, the null / '' / copy contract, and the refresh) is the same
   promise to the player, so it lives here once. */
import { Sfx } from '../../ui/audio.ts';
import { $ } from '../../ui/dom.ts';
import { repaintOnlineMessage } from '../message-copy.ts';

export interface AccountProviderPorts {
  clearError(): void;
  showError(render: () => string): void;
  /* Re-reads identity-status and repaints the provider rows, so a completed
     link loses its offer (and its button) without a manual reload. */
  refresh(): Promise<unknown>;
}

export interface AccountProviderControl extends AccountProviderPorts {
  /** The control's element id, e.g. '#btnLinkApple'. */
  control: string;
  /** Provider call: null is success, '' is a cancelled native sheet, else copy. */
  run(): Promise<string | null>;
  /** Copy for a provider that rejected instead of answering. */
  rejected(): string;
}

export function bindAccountProviderControl(ports: AccountProviderControl): void {
  const button = $(ports.control) as HTMLButtonElement;
  button.addEventListener('click', async () => {
    Sfx.tap();
    ports.clearError();
    button.disabled = true;
    let message: string | null;
    try {
      message = await ports.run();
    } catch {
      message = ports.rejected();
    }
    button.disabled = false;
    /* Same contract as the auth sheet's one-tap row: null is success, '' is a
       player-cancelled native sheet with nothing to report, anything else is
       copy the player must read. A failure never refreshes: the account is
       unchanged, and repainting it would replace the reply with silence. */
    if (message !== null) {
      if (message) {
        const returned = message;
        ports.showError(() => repaintOnlineMessage(returned));
      }
      return;
    }
    await ports.refresh();
  });
}
