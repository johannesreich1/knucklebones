import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n/index.ts';
import { supa } from './client.ts';
import { onlineMessage } from './message-copy.ts';
import { randomUuid } from './random-id.ts';
import type { OneTap } from './identity-provider.ts';

type AppleAuth = Pick<SupabaseClient['auth'],
  'getSession' | 'getUser' | 'linkIdentity' | 'signInWithIdToken'>;
interface AppleSignInOptions {
  scopes?: Array<'EMAIL' | 'FULL_NAME'>;
  nonce?: string;
}
interface AppleSignInResult {
  idToken: string;
  authorizationCode?: string;
}
export interface AppleSignInBridge {
  initialize(options: { clientId: string }): Promise<void>;
  signIn(options?: AppleSignInOptions): Promise<AppleSignInResult>;
}
interface CapacitorBridge {
  getPlatform?(): string;
  Plugins?: { AppleSignIn?: AppleSignInBridge };
}
const capacitor = (): CapacitorBridge | undefined =>
  (globalThis as typeof globalThis & { Capacitor?: CapacitorBridge }).Capacitor;

export const APPLE_IDENTITY_MESSAGES = {
  get unavailable(): string { return onlineMessage('errors.appleUnavailable'); },
  get configuration(): string { return onlineMessage('errors.appleConfiguration'); },
  get invalid(): string { return onlineMessage('errors.appleInvalid'); },
  get conflict(): string { return onlineMessage('errors.appleConflict'); },
  get failed(): string { return onlineMessage('errors.appleFailed'); },
} as const;

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface AppleIdentityPorts {
  getPlatform(): string;
  getPlugin(): AppleSignInBridge | undefined;
  getAuth(): AppleAuth;
  randomId(): string;
  digest(value: string): Promise<string>;
  registerAuthorizationCode(code: string): Promise<void>;
}

type AppleCredential = { token: string; rawNonce: string; authorizationCode?: string };

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : undefined;
}

function authErrorMessage(error: { code?: string } | null): string | null {
  if (!error) return null;
  if (error.code === 'identity_already_exists') return APPLE_IDENTITY_MESSAGES.conflict;
  if (error.code === 'manual_linking_disabled'
    || error.code === 'provider_disabled'
    || error.code === 'oauth_provider_not_supported') return APPLE_IDENTITY_MESSAGES.configuration;
  return APPLE_IDENTITY_MESSAGES.failed;
}

async function requestAppleCredential(ports: AppleIdentityPorts): Promise<AppleCredential | string> {
  const plugin = ports.getPlugin();
  if (!plugin || ports.getPlatform() !== 'ios') return APPLE_IDENTITY_MESSAGES.unavailable;
  const rawNonce = ports.randomId();
  let result: AppleSignInResult;
  try {
    result = await plugin.signIn({ scopes: ['EMAIL'], nonce: await ports.digest(rawNonce) });
  } catch (error) {
    return errorCode(error) === 'SIGN_IN_CANCELED' ? '' : APPLE_IDENTITY_MESSAGES.failed;
  }
  if (typeof result.idToken !== 'string' || !result.idToken.trim()) {
    return APPLE_IDENTITY_MESSAGES.invalid;
  }
  return {
    token: result.idToken,
    rawNonce,
    authorizationCode: typeof result.authorizationCode === 'string'
      ? result.authorizationCode : undefined,
  };
}

export function createAppleIdentity(ports: AppleIdentityPorts): OneTap {
  const authenticate = async (mode: 'restore' | 'attach'): Promise<string | null> => {
    const credential = await requestAppleCredential(ports);
    if (typeof credential === 'string') return credential;
    const auth = ports.getAuth();
    const proof = { provider: 'apple' as const, token: credential.token, nonce: credential.rawNonce };
    try {
      let error: { code?: string } | null = null;
      if (mode === 'restore') ({ error } = await auth.signInWithIdToken(proof));
      else {
        const { data, error: sessionError } = await auth.getSession();
        if (sessionError) return APPLE_IDENTITY_MESSAGES.failed;
        if (!data.session) ({ error } = await auth.signInWithIdToken(proof));
        else ({ error } = await auth.linkIdentity(proof));
      }
      if (error?.code === 'identity_already_exists') {
        const { data } = await auth.getUser();
        if (!(data.user?.identities ?? []).some((identity) => identity.provider === 'apple')) {
          return APPLE_IDENTITY_MESSAGES.conflict;
        }
        error = null;
      }
      const message = authErrorMessage(error);
      if (message) return message;
      if (credential.authorizationCode) {
        await ports.registerAuthorizationCode(credential.authorizationCode).catch(() => undefined);
      }
      return null;
    } catch { return APPLE_IDENTITY_MESSAGES.failed; }
  };
  return {
    id: 'apple', labelKey: 'auth.continueApple',
    get label(): string { return t('online', 'auth.continueApple'); },
    available: () => !!ports.getPlugin() && ports.getPlatform() === 'ios',
    restore: () => authenticate('restore'), attach: () => authenticate('attach'),
  };
}

export const APPLE = createAppleIdentity({
  getPlatform: () => capacitor()?.getPlatform?.() ?? 'web',
  getPlugin: () => capacitor()?.Plugins?.AppleSignIn,
  getAuth: () => supa().auth,
  randomId: randomUuid,
  digest: sha256Hex,
  registerAuthorizationCode: async (authorizationCode) => {
    const { error } = await supa().functions.invoke('apple-token-register', {
      body: { authorizationCode },
    });
    if (error) throw error;
  },
});
