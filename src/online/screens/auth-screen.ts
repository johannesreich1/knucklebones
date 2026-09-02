import { subscribeLocale, t, translateDom, type LocaleKey } from '../../i18n/index.ts';
import { $, byId } from '../../ui/dom.ts';
import { Sfx } from '../../ui/audio.ts';
import { showSheet, type Sheet } from '../../ui/sheet.ts';
import { refreshLegalUi } from '../../ui/legal.ts';
import { ask } from '../../ui/askcard.ts';
import { availableTaps } from '../identity/identity.ts';
import {
  acknowledgeCurrentAccount,
  currentUser,
  hadRealAccount,
  requireGameCenterAssertion,
  startFreshGuest,
} from '../identity/session.ts';
import type { OneTapRestoreLifecycle } from '../identity/identity-provider.ts';
import { onlineMessage, repaintOnlineMessage } from '../message-copy.ts';
import { AUTH, type AuthMode, type AuthOrigin, type AuthPorts } from './auth-specs.ts';
import {
  routeChangedAttachOwner,
  runOneTapFromAuthSheet,
  type AuthOwnership,
} from './auth-account-ownership.ts';

export type { AuthMode, AuthOrigin, AuthPorts } from './auth-specs.ts';
export { runOneTapFromAuthSheet } from './auth-account-ownership.ts';

let sessionless = false;
let authMessage: string | null = null;
let authViewRevision = 0;
let authOperationRevision = 0;
let authSheet: Sheet | null = null;
let authTitle: LocaleKey<'online'> = 'auth.signInTitle';
let authOrigin: AuthOrigin = 'home';
let activePorts: AuthPorts | null = null;
let authOpener: HTMLElement | null = null;

function authPanel(): HTMLElement {
  return byId('onAuth')!;
}

function setAuthBusy(busy: boolean): void {
  authPanel().querySelectorAll<HTMLButtonElement>('button')
    .forEach((button) => { button.disabled = busy; });
}

function ownsAuthAttempt(view: number, operation: number): boolean {
  return view === authViewRevision && operation === authOperationRevision;
}

function ownsAuthOperation(view: number, operation: number): boolean {
  return ownsAuthAttempt(view, operation)
    && !!authSheet?.ov.isConnected && authSheet.card.contains(authPanel())
    && !authPanel().hidden;
}

const routeIfAttachOwnerChanged = (
  mode: AuthMode,
  expectedAccountId: string | undefined,
  ports: AuthPorts,
  ownership: AuthOwnership,
): Promise<boolean> => routeChangedAttachOwner(
  mode,
  expectedAccountId,
  () => ownsAuthOperation(ownership.view, ownership.operation),
  async () => { closeAuthSheet(false); await ports.showAccount(); },
);

function clearAuthError(): void {
  authMessage = null;
  $('#onAuthErr').textContent = '';
}

function showAuthError(message: string): void {
  authMessage = message;
  $('#onAuthErr').textContent = message;
}

subscribeLocale(() => {
  const panel = byId('onAuth');
  if (!panel || panel.hidden) return;
  if (authMessage) {
    authMessage = repaintOnlineMessage(authMessage);
    $('#onAuthErr').textContent = authMessage;
  }
  $('#onAuthTitle').textContent = t('online', authTitle);
  refreshLegalUi(panel);
});

export function setSessionless(value: boolean): void {
  sessionless = value;
}

function closeAuthSheet(restoreOpener = true): void {
  authSheet?.close(restoreOpener);
}

/** Reclaim AUTH after one of its explicit nested questions and keep the same
 * operation visibly single-flight. The fresh-guest door and native providers
 * share this exact busy-sheet contract. */
function showOwnedBusyAuth(
  mode: AuthMode,
  ports: AuthPorts,
  origin: AuthOrigin,
  expectedAccountId?: string,
): AuthOwnership {
  showAuth(mode, ports, origin, null, expectedAccountId);
  const ownership = { view: authViewRevision, operation: ++authOperationRevision };
  clearAuthError();
  setAuthBusy(true);
  authSheet?.setDismissible(false);
  authSheet?.card.setAttribute('aria-busy', 'true');
  return ownership;
}

function releaseOwnedBusyAuth(): void {
  authSheet?.setDismissible(true);
  authSheet?.card.removeAttribute('aria-busy');
  setAuthBusy(false);
}

export function showAuth(
  mode: AuthMode,
  ports: AuthPorts,
  origin: AuthOrigin = 'home',
  notice: string | null = null,
  expectedAccountId?: string,
): void {
  /* A sheet stops intercepting the room as soon as its exit starts. If that
     room immediately opens auth again, retire the old 190ms flight before it
     can repaint and later remove the newly requested form. */
  const reopeningDepartingSheet = !!authSheet?.ov.classList.contains('foout');
  if (reopeningDepartingSheet) authSheet!.close();
  if (!authSheet && !reopeningDepartingSheet) {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const visibleFocused = focused && focused !== document.body
      && focused.isConnected && !!focused.getClientRects().length;
    /* WebKit does not necessarily focus a button when it is tapped. Account
       still has an unambiguous semantic opener, so dismissal returns there
       even when activeElement remained BODY. */
    authOpener = visibleFocused ? focused
      : origin === 'account'
        ? byId(mode === 'restore' ? 'btnHaveAcc' : 'btnKeepAcc')
        : byId('homeChip');
  }
  const viewRevision = ++authViewRevision;
  authOperationRevision++;
  authOrigin = origin;
  activePorts = ports;
  const spec = AUTH[mode];
  const copy = sessionless && spec.fresh ? spec.fresh : spec;
  const panel = authPanel();
  panel.hidden = false;
  setAuthBusy(false);
  authTitle = copy.title;
  $('#onAuthTitle').setAttribute('data-i18n', `online:${copy.title}`);
  $('#onAuthTitle').textContent = t('online', copy.title);
  $('#onAuthLead').setAttribute('data-i18n', `online:${copy.lead}`);
  $('#onAuthTiny').setAttribute('data-i18n-rich', `online:${copy.tiny}`);
  clearAuthError();
  if (notice) showAuthError(notice);
  const acts = $('#onAuthActs');
  acts.innerHTML = '';
  const creds = () => [
    ($('#onEmail') as HTMLInputElement).value.trim(),
    ($('#onPass') as HTMLInputElement).value,
  ] as const;
  for (const action of spec.acts) {
    const button = document.createElement('button');
    button.className = 'btn' + (action.primary ? ' primary' : '');
    const actionKey = sessionless && spec.fresh && action.primary
      ? spec.fresh.act : action.label;
    button.setAttribute('data-i18n', `online:${actionKey}`);
    button.textContent = t('online', actionKey);
    button.addEventListener('click', async () => {
      if (viewRevision !== authViewRevision) return;
      Sfx.tap();
      clearAuthError();
      const operation = ++authOperationRevision;
      setAuthBusy(true);
      const ownership = { view: viewRevision, operation };
      if (await routeIfAttachOwnerChanged(mode, expectedAccountId, ports, ownership)) return;
      let message: string | null;
      try {
        message = await action.run(...creds(), expectedAccountId);
      } catch {
        message = onlineMessage('errors.generic');
      }
      if (await routeIfAttachOwnerChanged(mode, expectedAccountId, ports, ownership)) return;
      if (!ownsAuthOperation(viewRevision, operation)) return;
      if (message) {
        setAuthBusy(false);
        showAuthError(message);
        return;
      }
      /* Authentication is complete. Retire this exact modal before profile
         loading/navigation yields, so Escape, backdrop taps, or a second
         submit cannot dismiss the successful transition or close a later
         auth sheet. The destination owns focus from here. */
      sessionless = false;
      requireGameCenterAssertion();
      closeAuthSheet(false);
      await spec.after(ports, origin);
    });
    acts.appendChild(button);
  }
  /* The guest door appears only on a remembered device with no session. Its
     question changes nothing server-side: signing in still restores the old account. */
  const guest = $('#btnAuthGuest') as HTMLButtonElement;
  const strandedDevice = mode === 'restore' && sessionless && hadRealAccount();
  guest.hidden = !strandedDevice;
  if (strandedDevice) {
    guest.setAttribute('data-i18n', 'online:auth.guestAction');
    guest.textContent = t('online', 'auth.guestAction');
    guest.onclick = async () => {
      Sfx.tap();
      const revision = viewRevision;
      const yes = await ask({
        head: () => t('online', 'auth.guestTitle'),
        body: () => t('online', 'auth.guestBody'),
        confirm: () => t('online', 'auth.guestConfirm'),
        cancel: () => t('common', 'actions.cancel'),
        /* An invitation, not a demolition: nothing of the old account is lost,
           so the yes carries the weight rather than the way out. */
        loud: true,
        restoreFocus: guest,
      });
      if (!yes || revision !== authViewRevision) return;
      /* Recreate AUTH after its question retires the sheet. It stays the busy,
         single-flight owner until Supabase stores the new guest or refuses it. */
      const ownership = showOwnedBusyAuth(mode, ports, origin, expectedAccountId);
      let message: string | null;
      try {
        message = await startFreshGuest();
      } catch {
        message = onlineMessage('errors.generic');
      }
      if (!ownsAuthOperation(ownership.view, ownership.operation)) return;
      if (message) {
        releaseOwnedBusyAuth();
        showAuthError(message);
        return;
      }
      sessionless = false;
      requireGameCenterAssertion();
      closeAuthSheet(false);
      await ports.entered();
    };
  }
  const swap = $('#btnAuthSwap') as HTMLButtonElement;
  swap.hidden = !spec.swap;
  if (spec.swap) {
    swap.setAttribute('data-i18n', `online:${spec.swap.label}`);
    swap.textContent = t('online', spec.swap.label);
    swap.onclick = () => {
      Sfx.tap();
      showAuth(spec.swap!.to, ports, origin, null, expectedAccountId);
    };
  }
  showOneTapRow(mode, ports, viewRevision, origin, expectedAccountId);
  translateDom(panel);
  refreshLegalUi(panel);
  if (!authSheet) {
    let created: Sheet;
    created = showSheet({
      content: panel,
      interactive: true,
      cls: 'authsheet',
      label: () => t('online', authTitle),
      restoreFocus: authOpener,
      repaintLocale: (card) => {
        translateDom(panel);
        refreshLegalUi(card);
      },
      onDismiss: () => {
        authViewRevision++;
        authOperationRevision++;
        activePorts?.dismiss(authOrigin);
      },
      onClose: () => {
        panel.hidden = true;
        if (authSheet === created) authSheet = null;
      },
    });
    authSheet = created;
  } else {
    authSheet.card.setAttribute('aria-label', t('online', authTitle));
  }
}

function showOneTapRow(
  mode: AuthMode,
  ports: AuthPorts,
  viewRevision: number,
  origin: AuthOrigin,
  expectedAccountId?: string,
): void {
  const row = $('#onOneTap');
  row.innerHTML = '';
  for (const method of availableTaps()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn tap ' + method.id;
    button.setAttribute('data-i18n', `online:${method.labelKey}`);
    button.textContent = t('online', method.labelKey);
    button.addEventListener('click', async () => {
      if (viewRevision !== authViewRevision) return;
      Sfx.tap();
      clearAuthError();
      let ownership = { view: viewRevision, operation: ++authOperationRevision };
      setAuthBusy(true);
      if (await routeIfAttachOwnerChanged(mode, expectedAccountId, ports, ownership)) return;
      let message: string | null;
      const lifecycle: OneTapRestoreLifecycle = {
        nestedSheetSettled: (accepted) => {
          if (!ownsAuthAttempt(ownership.view, ownership.operation)) return;
          if (accepted) {
            /* Reclaim inert AUTH before token exchange so stale Profile stays covered. */
            ownership = showOwnedBusyAuth(mode, ports, origin, expectedAccountId);
          } else {
            /* Provider cancellation may reclaim AUTH; unrelated replacement cannot. */
            showAuth(mode, ports, origin, null, expectedAccountId);
            ownership = { view: authViewRevision, operation: authOperationRevision };
          }
        },
      };
      try {
        message = await runOneTapFromAuthSheet(
          method, mode, currentUser, lifecycle, expectedAccountId,
        );
      } catch {
        message = onlineMessage('errors.generic');
      }
      if (await routeIfAttachOwnerChanged(mode, expectedAccountId, ports, ownership)) return;
      /* Only this operation's still-mounted sheet may navigate on success. */
      if (!ownsAuthOperation(ownership.view, ownership.operation)) return;
      if (message !== null) {
        releaseOwnedBusyAuth();
        if (message) showAuthError(message);
        return;
      }
      sessionless = false;
      if (method.id === 'gamecenter') acknowledgeCurrentAccount();
      else requireGameCenterAssertion();
      closeAuthSheet(false);
      await AUTH[mode].after(ports, origin);
    });
    row.appendChild(button);
  }
}
