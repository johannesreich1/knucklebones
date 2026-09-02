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
import {
  bindAccountRuneSheets,
  bindEquippedSeat,
  type PersistedRuneEquipment,
  type RuneEquipmentPersistence,
} from './account-runes.ts';
import { setRuneEquipment, type EquippedRuneSelection } from '../runes/rune-equip.ts';
import { bindAccountAppleRepair } from './account-apple-repair.ts';
import { bindAccountGameCenterLink } from './account-game-center-link.ts';
import { bindAccountDelete } from './account-delete-flow.ts';
import type { AuthMode, AuthOrigin } from './auth-screen.ts';

export interface AccountBindingPorts {
  showAuth(
    mode: AuthMode,
    origin: AuthOrigin,
    notice?: string | null,
    expectedAccountId?: string | null,
  ): void;
  showAvatar(accountId: string): Promise<void>;
  showLadder(): Promise<void>;
  showHistory(): Promise<void>;
  /** Re-read the account and repaint from what came back. */
  refresh(): Promise<unknown>;
  /** Verified Profile account currently backing provider controls. */
  providerAccountId(): string | null;
  /** Cover Profile when a provider result cannot be proved to belong here. */
  providerInvalidated(accountId: string): void;
  /** Publish a confirmed equipment write into the held/cache presentation. */
  equipmentChanged(result: PersistedRuneEquipment): boolean;
  equipmentMismatch(accountId: string): void;
  equipmentSettled(): void;
  /* The name error line is painted by the panel and cleared from several
     places, so its two writers stay with the panel and arrive as ports. */
  clearNickError(): void;
  showNickError(render: () => string): void;
}

export function bindAccountScreen(ports: AccountBindingPorts): void {
  const visibleAccountId = (): string | null =>
    ports.providerAccountId()?.toLowerCase() ?? null;
  const stillOwnsVisibleAccount = async (accountId: string | null): Promise<boolean> => {
    const activeUser = await currentUser();
    if (accountId && activeUser?.id.toLowerCase() === accountId
        && visibleAccountId() === accountId) return true;
    if (accountId) ports.providerInvalidated(accountId);
    return false;
  };
  /* The profile speaks one semantic equipment vocabulary. Persistence may
     retain a fixed fallback under RANDOM for old clients, but neither this
     screen nor its two doors is allowed to mistake that fallback for FIXED. */
  const equipment = {
    accountId: visibleAccountId,
    current: equippedRuneSelection,
    persist: async (
      accountId: string,
      selection: EquippedRuneSelection,
    ): Promise<RuneEquipmentPersistence> => {
      /* The sheet/grid retains the Profile account that opened it. The RPC is
         auth-owned and carries no target id, so session, visible Profile, and
         rune authority must all still name that same account before it fires. */
      const expectedAccountId = accountId.toLowerCase();
      const snapshot = readRuneCollectionSnapshot();
      if (visibleAccountId() !== expectedAccountId
          || snapshot?.accountId !== expectedAccountId) {
        return { kind: 'account-mismatch', accountId: expectedAccountId };
      }
      const requestedUser = await currentUser();
      if (requestedUser?.id.toLowerCase() !== expectedAccountId
          || visibleAccountId() !== expectedAccountId
          || readRuneCollectionSnapshot()?.accountId !== expectedAccountId) {
        return { kind: 'account-mismatch', accountId: expectedAccountId };
      }
      const persisted = await setRuneEquipment(expectedAccountId, selection);
      const activeUser = await currentUser();
      if (activeUser?.id.toLowerCase() !== expectedAccountId
          || visibleAccountId() !== expectedAccountId) {
        return { kind: 'account-mismatch', accountId: expectedAccountId };
      }
      const current = readRuneCollectionSnapshot();
      const matches = current?.accountId === expectedAccountId
        && current.equipment.kind === persisted.kind
        && (persisted.kind !== 'fixed'
          || (current.equipment.kind === 'fixed'
            && current.equipment.runeId === persisted.runeId));
      return matches
        ? { kind: 'confirmed', accountId: expectedAccountId, selection: persisted }
        : { kind: 'refused' };
    },
    changed: ports.equipmentChanged,
    mismatched: ports.equipmentMismatch,
    settled: ports.equipmentSettled,
  };
  /* Every equipment answer repaints the whole panel, so the seat, the grid
     and the semantic mode can never disagree about what is carried. */
  bindAccountRuneSheets();
  bindEquippedSeat(equipment);
  $('#btnKeepAcc').addEventListener('click', async () => {
    Sfx.tap();
    const accountId = visibleAccountId();
    if (!await stillOwnsVisibleAccount(accountId)) return;
    ports.showAuth('attach', 'account', null, accountId);
  });
  /* Restore names no account: the credentials decide which one signs in, and
     the auth sheet's own revision settles any race with an entry still loading
     this Profile. Keep it a plain door; an ownership guard here would refuse
     the tap whenever no account has painted yet. */
  $('#btnHaveAcc').addEventListener('click', () => {
    Sfx.tap();
    ports.showAuth('restore', 'account');
  });
  /* Every ACCOUNT ACCESS control answers on the shared warning card and
     repaints the box from a fresh identity-status read. */
  const provider = {
    accountId: ports.providerAccountId,
    refresh: ports.refresh,
    invalidate: ports.providerInvalidated,
  };
  bindAccountAppleRepair(provider);
  bindAccountGameCenterLink(provider);
  $('#btnClaim').addEventListener('click', async () => {
    Sfx.tap();
    /* This is the owner of the question, retained before the modal wait. */
    const accountId = visibleAccountId();
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
    if (!accountId) return;
    const button = $('#btnClaim') as HTMLButtonElement;
    button.disabled = true;
    const result = await claimName(accountId, name);
    if (!result.ok && result.reason === 'account-mismatch') {
      ports.providerInvalidated(accountId);
      return;
    }
    if (!result.ok) {
      button.disabled = false;
      const returned = result.message;
      ports.showNickError(() => repaintOnlineMessage(returned));
      return;
    }
    if (!await stillOwnsVisibleAccount(accountId)) return;
    ports.clearNickError();
    $('#accClaim').hidden = true;
    $('#accName').textContent = name;
    button.disabled = false;
    await ports.refresh();
    const user = await currentUser();
    if (user?.id.toLowerCase() === accountId && user.guest
        && visibleAccountId() === accountId) {
      const upgrade = await ask({
        head: () => t('online', 'profile.keepNameTitle', { name }),
        body: () => t('online', 'profile.keepNameDetail'),
        confirm: () => t('online', 'auth.createAction'),
        cancel: () => t('online', 'profile.notNow'),
        loud: true,
        restoreFocus: $('#btnKeepAcc'),
      });
      if (upgrade && await stillOwnsVisibleAccount(accountId)) {
        ports.showAuth('attach', 'account', null, accountId);
      }
    }
  });
  $('#btnSignOut').addEventListener('click', async () => {
    Sfx.tap();
    const accountId = visibleAccountId();
    if (!await stillOwnsVisibleAccount(accountId)) return;
    await signOut();
    refreshHomeChip();
    ports.showAuth('restore', 'home');
  });
  $('#btnAvatar').addEventListener('click', () => {
    Sfx.tap();
    const accountId = visibleAccountId();
    if (accountId) void ports.showAvatar(accountId);
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
  bindAccountDelete({
    showAuth: ports.showAuth,
    accountId: visibleAccountId,
    invalidate: ports.providerInvalidated,
  });
}
