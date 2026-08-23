import { $ } from '../ui/dom.ts';
import { Sfx } from '../ui/audio.ts';
import { availableTaps } from './identity.ts';
import { attachEmail, signIn } from './session.ts';
import { showOnlinePanel } from './shell.ts';

export type AuthMode = 'attach' | 'restore';

export interface AuthPorts {
  entered(): Promise<void>;
  showAccount(): Promise<void>;
}

interface AuthSpec {
  title: string;
  lead: string;
  tiny: string;
  acts: {
    label: string;
    primary?: boolean;
    run(email: string, password: string): Promise<string | null>;
  }[];
  swap?: { label: string; to: AuthMode };
  fresh?: { title: string; lead: string; tiny: string; act: string };
  after(ports: AuthPorts): Promise<void>;
}

let sessionless = false;

const AUTH: Record<AuthMode, AuthSpec> = {
  attach: {
    title: 'KEEP ACCOUNT',
    lead: 'Add an email and this account survives a reinstall',
    tiny: 'Same account, same rating, same record —<br>you just gain a way back into it.',
    acts: [{ label: 'Keep this account', primary: true, run: attachEmail }],
    swap: { label: 'I already have an account', to: 'restore' },
    fresh: {
      title: 'CREATE ACCOUNT',
      lead: 'Play ranked, climb the ladder',
      tiny: 'Your rating and record live in this account —<br>the address is how you get back to it.',
      act: 'Create account',
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
    title: 'SIGN IN',
    lead: 'Play ranked, climb the ladder',
    tiny: 'New accounts get a nickname like BoldRaven482 —<br>claim your own once in Account',
    acts: [{ label: 'Sign in', primary: true, run: signIn }],
    swap: { label: 'Create account', to: 'attach' },
    after: (ports) => ports.entered(),
  },
};

export function setSessionless(value: boolean): void {
  sessionless = value;
}

export function showAuth(mode: AuthMode, ports: AuthPorts): void {
  const spec = AUTH[mode];
  const copy = sessionless && spec.fresh ? spec.fresh : spec;
  showOnlinePanel('onAuth');
  $('#onTitle').textContent = copy.title;
  $('#onAuthLead').textContent = copy.lead;
  $('#onAuthTiny').innerHTML = copy.tiny;
  $('#onAuthErr').textContent = '';
  const acts = $('#onAuthActs');
  acts.innerHTML = '';
  const creds = () => [
    ($('#onEmail') as HTMLInputElement).value.trim(),
    ($('#onPass') as HTMLInputElement).value,
  ] as const;
  for (const action of spec.acts) {
    const button = document.createElement('button');
    button.className = 'btn' + (action.primary ? ' primary' : '');
    button.textContent = sessionless && spec.fresh && action.primary
      ? spec.fresh.act : action.label;
    button.addEventListener('click', async () => {
      Sfx.tap();
      $('#onAuthErr').textContent = '';
      button.disabled = true;
      const message = await action.run(...creds());
      button.disabled = false;
      if (message) {
        $('#onAuthErr').textContent = message;
        return;
      }
      await spec.after(ports);
    });
    acts.appendChild(button);
  }
  const swap = $('#btnAuthSwap') as HTMLButtonElement;
  swap.hidden = !spec.swap;
  if (spec.swap) {
    swap.textContent = spec.swap.label;
    swap.onclick = () => {
      Sfx.tap();
      showAuth(spec.swap!.to, ports);
    };
  }
  showOneTapRow(mode, ports);
}

function showOneTapRow(mode: AuthMode, ports: AuthPorts): void {
  const row = $('#onOneTap');
  row.innerHTML = '';
  for (const method of availableTaps()) {
    const button = document.createElement('button');
    button.className = 'btn tap ' + method.id;
    button.textContent = method.label;
    button.addEventListener('click', async () => {
      Sfx.tap();
      $('#onAuthErr').textContent = '';
      button.disabled = true;
      const message = await method[mode]();
      button.disabled = false;
      if (message) {
        $('#onAuthErr').textContent = message;
        return;
      }
      await AUTH[mode].after(ports);
    });
    row.appendChild(button);
  }
}
