import { subscribeLocale, t, translateDom, type LocaleKey } from '../i18n/index.ts';
import { $ } from '../ui/dom.ts';
import { Sfx } from '../ui/audio.ts';
import { availableTaps } from './identity.ts';
import { attachEmail, signIn } from './session.ts';
import { setOnlinePanelTitle, showOnlinePanel } from './shell.ts';
import { onlineMessage, repaintOnlineMessage } from './message-copy.ts';

export type AuthMode = 'attach' | 'restore';

export interface AuthPorts {
  entered(): Promise<void>;
  showAccount(): Promise<void>;
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
  after(ports: AuthPorts): Promise<void>;
}

let sessionless = false;
let authMessage: string | null = null;
let authViewRevision = 0;
let authOperationRevision = 0;

function setAuthBusy(busy: boolean): void {
  document.getElementById('onAuth')?.querySelectorAll<HTMLButtonElement>('button')
    .forEach((button) => { button.disabled = busy; });
}

function ownsAuthOperation(view: number, operation: number): boolean {
  const panel = document.getElementById('onAuth');
  const overlay = document.getElementById('ovOnline');
  return view === authViewRevision && operation === authOperationRevision
    && !!panel && !panel.hidden && !!overlay?.classList.contains('on');
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
  if (!panel || panel.hidden || !authMessage) return;
  authMessage = repaintOnlineMessage(authMessage);
  $('#onAuthErr').textContent = authMessage;
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
    after: async (ports) => {
      if (sessionless) {
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
    after: (ports) => ports.entered(),
  },
};

export function setSessionless(value: boolean): void {
  sessionless = value;
}

export function showAuth(mode: AuthMode, ports: AuthPorts): void {
  const viewRevision = ++authViewRevision;
  authOperationRevision++;
  const spec = AUTH[mode];
  const copy = sessionless && spec.fresh ? spec.fresh : spec;
  showOnlinePanel('onAuth');
  setAuthBusy(false);
  setOnlinePanelTitle(copy.title);
  $('#onAuthLead').setAttribute('data-i18n', `online:${copy.lead}`);
  $('#onAuthTiny').setAttribute('data-i18n-rich', `online:${copy.tiny}`);
  clearAuthError();
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
      setAuthBusy(false);
      if (message) {
        showAuthError(message);
        return;
      }
      await spec.after(ports);
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
      showAuth(spec.swap!.to, ports);
    };
  }
  showOneTapRow(mode, ports, viewRevision);
  translateDom($('#onAuth'));
}

function showOneTapRow(mode: AuthMode, ports: AuthPorts, viewRevision: number): void {
  const row = $('#onOneTap');
  row.innerHTML = '';
  for (const method of availableTaps()) {
    const button = document.createElement('button');
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
        message = await method[mode]();
      } catch {
        message = onlineMessage('errors.generic');
      }
      if (!ownsAuthOperation(viewRevision, operation)) return;
      setAuthBusy(false);
      if (message !== null) {
        if (message) showAuthError(message);
        return;
      }
      await AUTH[mode].after(ports);
    });
    row.appendChild(button);
  }
}
