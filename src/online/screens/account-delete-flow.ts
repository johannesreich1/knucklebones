import { t } from '../../i18n/index.ts';
import { ask } from '../../ui/askcard.ts';
import { Sfx } from '../../ui/audio.ts';
import { $ } from '../../ui/dom.ts';
import type { AuthMode, AuthOrigin } from './auth-screen.ts';
import { onlineMessage, repaintOnlineMessage } from '../message-copy.ts';
import { deleteAccount } from '../identity/account-deletion.ts';
import { refreshHomeChip } from '../../ui/homechip.ts';
import { showAccountProblem } from './account-problem-sheet.ts';

interface AccountDeletePorts {
  showAuth(mode: AuthMode, origin: AuthOrigin, notice?: string | null): void;
  accountId(): string | null;
  invalidate(accountId: string): void;
}

export function bindAccountDelete(ports: AccountDeletePorts): void {
  $('#btnDeleteAcc').addEventListener('click', async () => {
    Sfx.tap();
    /* The question belongs to the Profile underneath it, even if auth storage
       is replaced while the player is reading the destructive warning. */
    const accountId = ports.accountId()?.toLowerCase() ?? null;
    if (!accountId) return;
    const confirmed = await ask({
      head: () => t('online', 'profile.deleteTitle'),
      body: () => t('online', 'profile.deleteDetail'),
      confirm: () => t('online', 'profile.deleteEverything'),
      cancel: () => t('online', 'profile.keepAccount'),
      danger: true,
      check: () => t('online', 'profile.deleteCheck'),
      restoreFocus: $('#btnDeleteAcc'),
    });
    if (!confirmed) return;
    if (ports.accountId()?.toLowerCase() !== accountId) {
      ports.invalidate(accountId);
      return;
    }
    const deletion = await deleteAccount(accountId);
    if (deletion.accountMismatch) {
      ports.invalidate(accountId);
      return;
    }
    if (deletion.error) {
      /* Same answer shape as a refused provider link — the tap did not happen
         and the account is untouched — so it wears the same warning card
         rather than a second failure surface with its own position. */
      const returned = deletion.error;
      showAccountProblem(() => repaintOnlineMessage(returned), $('#btnDeleteAcc'));
      return;
    }
    refreshHomeChip();
    const notice = deletion.appleRevocation === 'pending'
      ? onlineMessage('errors.appleRevocationPending')
      : deletion.appleRevocation === 'manual-required'
        ? onlineMessage('errors.appleRevocationManual') : null;
    ports.showAuth('restore', 'home', notice);
  });
}
