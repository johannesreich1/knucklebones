import type { LocaleKey } from '../../i18n/index.ts';
import { attachEmail, signIn } from '../identity/session.ts';

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
    run(
      email: string,
      password: string,
      expectedAccountId?: string,
    ): Promise<string | null>;
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

/** Copy, credential action and destination for each rung of the auth sheet. */
export const AUTH: Record<AuthMode, AuthSpec> = {
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
    after: (ports, origin) => origin === 'home'
      ? ports.entered()
      : ports.showAccount(),
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
