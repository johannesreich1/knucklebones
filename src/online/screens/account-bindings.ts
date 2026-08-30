// EVERY CONTROL ON THE PROFILE, AND WHAT IT DOES.
//
// The panel already delegates its narrower doors — the rune sheets, the
// equipped seat, Apple repair, Game Center linking, account deletion — to their
// own bind* modules. This is the rest of them, gathered in the same shape, so
// account-screen.ts is left owning what the profile SAYS rather than what its
// buttons do.
import { formatNumber, t } from '../../i18n/index.ts';
import { ask } from '../../ui/askcard.ts';
import { Sfx } from '../../ui/audio.ts';
import { $ } from '../../ui/dom.ts';
import { refreshHomeChip } from '../../ui/homechip.ts';
import {
  equippedRuneSelection,
  readRuneCollectionSnapshot,
} from '../../rune-collection-cache.ts';
import { currentUser, signOut } from '../identity/session.ts';
import { claimName } from '../identity/profile.ts';
import { repaintOnlineMessage } from '../message-copy.ts';
import { bindAccountRuneSheets, bindEquippedSeat } from './account-runes.ts';
import { setRuneEquipment, type EquippedRuneSelection } from '../runes/rune-equip.ts';
import { bindAccountAppleRepair } from './account-apple-repair.ts';
import { bindAccountGameCenterLink } from './account-game-center-link.ts';
import { bindAccountDelete } from './account-delete-flow.ts';
import type { AuthMode, AuthOrigin } from './auth-screen.ts';

export interface AccountBindingPorts {
  showAuth(mode: AuthMode, origin: AuthOrigin, notice?: string | null): void;
  showAvatar(): Promise<void>;
  showLadder(): Promise<void>;
  showHistory(): Promise<void>;
  /** Re-read the account and repaint from what came back. */
  refresh(): Promise<unknown>;
  /** Repaint from what is already held — no fetch. */
  repaint(): void;
  /* The name error line is painted by the panel and cleared from several
     places, so its two writers stay with the panel and arrive as ports. */
  clearNickError(): void;
  showNickError(render: () => string): void;
}

export function bindAccountScreen(ports: AccountBindingPorts): void {
  /* The profile speaks one semantic equipment vocabulary. Persistence may
     retain a fixed fallback under RANDOM for old clients, but neither this
     screen nor its two doors is allowed to mistake that fallback for FIXED. */
  const equipment = {
    current: equippedRuneSelection,
    persist: async (selection: EquippedRuneSelection): Promise<EquippedRuneSelection> => {
      /* Read the session-bound account at the moment of the write. A sign-out
         between opening the sheet and answering it must write nothing. */
      const accountId = readRuneCollectionSnapshot()?.accountId ?? null;
      return accountId ? setRuneEquipment(accountId, selection) : equippedRuneSelection();
    },
    changed: () => ports.repaint(),
  };
  /* Every equipment answer repaints the whole panel, so the seat, the grid
     and the semantic mode can never disagree about what is carried. */
  bindAccountRuneSheets();
  bindEquippedSeat(equipment);
  $('#btnKeepAcc').addEventListener('click', () => {
    Sfx.tap();
    ports.showAuth('attach', 'account');
  });
  $('#btnHaveAcc').addEventListener('click', () => {
    Sfx.tap();
    ports.showAuth('restore', 'account');
  });
  /* Every ACCOUNT ACCESS control answers on the shared warning card and
     repaints the box from a fresh identity-status read. */
  const provider = { refresh: ports.refresh };
  bindAccountAppleRepair(provider);
  bindAccountGameCenterLink(provider);
  $('#btnClaim').addEventListener('click', async () => {
    Sfx.tap();
    ports.clearNickError();
    const name = ($('#onNick') as HTMLInputElement).value.trim();
    if (name.length > 16) {
      ports.showNickError(() => t('online', 'profile.nameTooLong', {
        count: formatNumber(name.length),
      }));
      return;
    }
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
      ports.showNickError(() => t('online', 'profile.nameInvalid'));
      return;
    }
    const confirmed = await ask({
      head: () => t('online', 'profile.claimQuestion', { name }),
      body: () => t('online', 'profile.claimWarning'),
      confirm: () => t('online', 'profile.claimIt'),
      cancel: () => t('online', 'profile.notYet'),
      loud: true,
      restoreFocus: $('#btnClaim'),
    });
    if (!confirmed) return;
    const button = $('#btnClaim') as HTMLButtonElement;
    button.disabled = true;
    const error = await claimName(name);
    if (error) {
      button.disabled = false;
      const returned = error;
      ports.showNickError(() => repaintOnlineMessage(returned));
      return;
    }
    ports.clearNickError();
    $('#accClaim').hidden = true;
    $('#accName').textContent = name;
    button.disabled = false;
    await ports.refresh();
    const user = await currentUser();
    if (user?.guest) {
      const upgrade = await ask({
        head: () => t('online', 'profile.keepNameTitle', { name }),
        body: () => t('online', 'profile.keepNameDetail'),
        confirm: () => t('online', 'auth.createAction'),
        cancel: () => t('online', 'profile.notNow'),
        loud: true,
        restoreFocus: $('#btnKeepAcc'),
      });
      if (upgrade) ports.showAuth('attach', 'account');
    }
  });
  $('#btnSignOut').addEventListener('click', async () => {
    Sfx.tap();
    await signOut();
    refreshHomeChip();
    ports.showAuth('restore', 'home');
  });
  $('#btnAvatar').addEventListener('click', () => {
    Sfx.tap();
    void ports.showAvatar();
  });
  $('#btnHistory').addEventListener('click', () => {
    Sfx.tap();
    void ports.showHistory();
  });
  const openLadder = (): void => {
    Sfx.tap();
    void ports.showLadder();
  };
  $('#btnLadder').addEventListener('click', openLadder);
  $('#btnRank').addEventListener('click', openLadder);
  bindAccountDelete({ showAuth: ports.showAuth });
}
