/* The profile's Apple control is NOT the guest-upgrade sheet.
   "KEEP ACCOUNT · add an email and this account survives a reinstall" answers
   a question this player already answered: their account is attached, and for
   a repair it is already attached to Apple. The single missing thing is the
   deletion credential, which only a fresh Apple authorization code can supply
   — so the button runs the Apple provider and nothing else. Adding Apple to an
   account that lacks it is that same one step, which is why both labels of
   #btnLinkApple share this implementation instead of forking a second flow.
   #btnKeepAcc keeps the upgrade sheet; it is a different question. */
import { Sfx } from '../../ui/audio.ts';
import { $ } from '../../ui/dom.ts';
import { APPLE, type AppleIdentity } from '../identity/apple-identity.ts';
import { onlineMessage, repaintOnlineMessage } from '../message-copy.ts';

export interface AccountAppleRepairPorts {
  clearError(): void;
  showError(render: () => string): void;
  /* Re-reads identity-status and repaints the provider rows, so a repaired
     account loses its warning (and its button) without a manual reload. */
  refresh(): Promise<unknown>;
  apple?: Pick<AppleIdentity, 'repair'>;
}

export function bindAccountAppleRepair(ports: AccountAppleRepairPorts): void {
  const provider = ports.apple ?? APPLE;
  const button = $('#btnLinkApple') as HTMLButtonElement;
  button.addEventListener('click', async () => {
    Sfx.tap();
    ports.clearError();
    button.disabled = true;
    let message: string | null;
    try {
      message = await provider.repair();
    } catch {
      message = onlineMessage('errors.appleFailed');
    }
    button.disabled = false;
    /* Same contract as the auth sheet's one-tap row: null is success, '' is a
       player-cancelled native sheet with nothing to report, anything else is
       copy the player must read. */
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
