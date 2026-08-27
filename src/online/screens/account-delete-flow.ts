import { t } from '../../i18n/index.ts';
import { ask } from '../../ui/askcard.ts';
import { Sfx } from '../../ui/audio.ts';
import { $ } from '../../ui/dom.ts';
import type { AuthMode, AuthOrigin } from './auth-screen.ts';
import { onlineMessage, repaintOnlineMessage } from '../message-copy.ts';
import { deleteAccount } from '../identity/session.ts';
import { refreshHomeChip } from '../../ui/homechip.ts';

interface AccountDeletePorts {
  clearError(): void;
  showError(render: () => string): void;
  showAuth(mode: AuthMode, origin: AuthOrigin, notice?: string | null): void;
}

export function bindAccountDelete(ports: AccountDeletePorts): void {
  $('#btnDeleteAcc').addEventListener('click', async () => {
    Sfx.tap();
    ports.clearError();
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
    const deletion = await deleteAccount();
    if (deletion.error) {
      const returned = deletion.error;
      ports.showError(() => repaintOnlineMessage(returned));
      return;
    }
    ports.clearError();
    refreshHomeChip();
    const notice = deletion.appleRevocation === 'pending'
      ? onlineMessage('errors.appleRevocationPending')
      : deletion.appleRevocation === 'manual-required'
        ? onlineMessage('errors.appleRevocationManual') : null;
    ports.showAuth('restore', 'home', notice);
  });
}
