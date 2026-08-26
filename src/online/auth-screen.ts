import { subscribeLocale, t, translateDom, type LocaleKey } from '../i18n/index.ts';
import { $ } from '../ui/dom.ts';
import { Sfx } from '../ui/audio.ts';
import { showSheet, type Sheet } from '../ui/sheet.ts';
import { refreshLegalUi } from '../ui/legal.ts';
import { availableTaps } from './identity.ts';
import {
  acknowledgeCurrentAccount,
  attachEmail,
  currentUser,
  requireGameCenterAssertion,
  signIn,
} from './session.ts';
import type { OneTap } from './identity-provider.ts';
import { onlineMessage, repaintOnlineMessage } from './message-copy.ts';

export type AuthMode = 'attach' | 'restore';
export type AuthOrigin = 'account' | 'home';

export interface AuthPorts {
  entered(): Promise<void>;
  showAccount(): Promise<void>;
  dismiss(origin: AuthOrigin): void;
}

interface AuthSpec {
  title: LocaleKey<'online'>;
  lead: LocaleKey<'online'>;
  tiny: LocaleKey<'online'>;
  acts: {
    label: LocaleKey<'online'>;
    primary?: boolean;
    run(email: string, password: string): Promise<string | null>;
  }[];
  swap?: { label: LocaleKey<'online'>; to: AuthMode };
  fresh?: {
    title: LocaleKey<'online'>;
    lead: LocaleKey<'online'>;
    tiny: LocaleKey<'online'>;
    act: LocaleKey<'online'>;
  };
  after(ports: AuthPorts, origin: AuthOrigin): Promise<void>;
}

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
  return document.getElementById('onAuth')!;
}

function setAuthBusy(busy: boolean): void {
  authPanel().querySelectorAll<HTMLButtonElement>('button')
    .forEach((button) => { button.disabled = busy; });
}

function ownsAuthOperation(view: number, operation: number): boolean {
  return view === authViewRevision && operation === authOperationRevision
    && !!authSheet?.ov.isConnected && authSheet.card.contains(authPanel())
    && !authPanel().hidden;
}

function clearAuthError(): void {
  authMessage = null;
  $('#onAuthErr').textContent = '';
}

function showAuthError(message: string): void {
  authMessage = message;
  $('#onAuthErr').textContent = message;
}

subscribeLocale(() => {
  const panel = document.getElementById('onAuth');
  if (!panel || panel.hidden) return;
  if (authMessage) {
    authMessage = repaintOnlineMessage(authMessage);
    $('#onAuthErr').textContent = authMessage;
  }
  $('#onAuthTitle').textContent = t('online', authTitle);
  refreshLegalUi(panel);
});

const AUTH: Record<AuthMode, AuthSpec> = {
  attach: {
    title: 'auth.keepTitle',
    lead: 'auth.keepLead',
    tiny: 'auth.keepDetail',
    acts: [{ label: 'auth.keepAction', primary: true, run: attachEmail }],
    swap: { label: 'auth.alreadyHaveAccount', to: 'restore' },
    fresh: {
      title: 'auth.createTitle',
      lead: 'auth.rankedLead',
      tiny: 'auth.createDetail',
      act: 'auth.createAction',
    },
    after: async (ports, origin) => {
      if (origin === 'home') {
        sessionless = false;
        await ports.entered();
        return;
      }
      await ports.showAccount();
    },
  },
  restore: {
    title: 'auth.signInTitle',
    lead: 'auth.rankedLead',
    tiny: 'auth.signInDetail',
    acts: [{ label: 'auth.signInAction', primary: true, run: signIn }],
    swap: { label: 'auth.createAction', to: 'attach' },
    after: (ports, origin) => origin === 'account'
      ? ports.showAccount()
      : ports.entered(),
  },
};

export function setSessionless(value: boolean): void {
  sessionless = value;
}

export async function runOneTapFromAuthSheet(
  method: Pick<OneTap, 'id' | 'restore' | 'attach'>,
  mode: AuthMode,
  readCurrentUser: typeof currentUser = currentUser,
): Promise<string | null> {
  /* Home's sessionless CREATE ACCOUNT sheet uses attach copy, but Game Center
     has no account to attach to there. Restore its authenticated native player
     instead; a real guest/account session keeps the explicit attach path. */
  const effectiveMode = method.id === 'gamecenter' && mode === 'attach'
    && !(await readCurrentUser()) ? 'restore' : mode;
  return method[effectiveMode]();
}

function closeAuthSheet(restoreOpener = true): void {
  authSheet?.close(restoreOpener);
}

export function showAuth(
  mode: AuthMode,
  ports: AuthPorts,
  origin: AuthOrigin = 'home',
  notice: string | null = null,
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
        ? document.getElementById(mode === 'restore' ? 'btnHaveAcc' : 'btnKeepAcc')
        : document.getElementById('homeChip');
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
      let message: string | null;
      try {
        message = await action.run(...creds());
      } catch {
        message = onlineMessage('errors.generic');
      }
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
  const swap = $('#btnAuthSwap') as HTMLButtonElement;
  swap.hidden = !spec.swap;
  if (spec.swap) {
    swap.setAttribute('data-i18n', `online:${spec.swap.label}`);
    swap.textContent = t('online', spec.swap.label);
    swap.onclick = () => {
      Sfx.tap();
      showAuth(spec.swap!.to, ports, origin);
    };
  }
  showOneTapRow(mode, ports, viewRevision, origin);
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
      const operation = ++authOperationRevision;
      setAuthBusy(true);
      let message: string | null;
      try {
        message = await runOneTapFromAuthSheet(method, mode);
      } catch {
        message = onlineMessage('errors.generic');
      }
      if (!ownsAuthOperation(viewRevision, operation)) return;
      if (message !== null) {
        setAuthBusy(false);
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
