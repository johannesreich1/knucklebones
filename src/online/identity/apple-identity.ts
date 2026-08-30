import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../../i18n/index.ts';
import { callFunction, supa } from '../api/client.ts';
import { ask } from '../../ui/askcard.ts';
import { onlineMessage } from '../message-copy.ts';
import { randomUuid } from '../api/random-id.ts';
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
  get revocationSetup(): string { return onlineMessage('errors.appleRevocationSetup'); },
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
  /* Resolves true only when the deletion credential is stored. Apple requires
     the app to revoke its own access at account deletion, and the single-use
     authorization code is the ONLY moment that credential can be obtained —
     so a refusal here is the player's business, never a swallowed detail. */
  registerAuthorizationCode(code: string): Promise<boolean>;
  /* ASKED BEFORE A GUEST IS REPLACED, and only then. Signing in with Apple
     REPLACES the session rather than merging it, so a player who has been
     playing as a guest loses that run's rating, runes and history the moment
     the token is accepted — including when the Apple identity already belongs
     to another account of theirs, which is the case that prompted this
     (requested 2026-08-30, as a modal to confirm).
     A port rather than a call, so this module keeps no DOM and its owner test
     goes on building it headlessly. Resolving false abandons the sign-in with
     nothing changed. */
  confirmGuestReplacement(): Promise<boolean>;
}

type AppleCredential = { token: string; rawNonce: string; authorizationCode?: string };

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : undefined;
}

/* Apple's own refusals ARE already separated where a separation is real: the
   plugin resolves a user cancel to SIGN_IN_CANCELED (its AppleSignIn.swift maps
   ASAuthorizationError.canceled itself), and Supabase's linking errors carry
   codes this maps to conflict/configuration copy. What was thrown away is the
   REASON behind everything else — an ASAuthorizationError raw code, or a
   Supabase code nobody has seen yet — which then reaches support as the same
   six words as every other failure. There is no honest remedy to print for
   those, so the copy stays general and the code is logged instead of invented
   into advice. */
function authErrorMessage(error: { code?: string } | null): string | null {
  if (!error) return null;
  if (error.code === 'identity_already_exists') return APPLE_IDENTITY_MESSAGES.conflict;
  if (error.code === 'manual_linking_disabled'
    || error.code === 'provider_disabled'
    || error.code === 'oauth_provider_not_supported') return APPLE_IDENTITY_MESSAGES.configuration;
  console.error('[apple] identity link refused', error.code ?? 'no code');
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
    const code = errorCode(error);
    if (code === 'SIGN_IN_CANCELED') return '';
    /* An ASAuthorizationError raw value (1000 unknown … 1005 notInteractive)
       or nothing at all. None of them maps to a step the player can take, so
       the code goes to the log and the copy stays the one honest sentence. */
    console.error('[apple] sign-in rejected', code ?? 'no code',
      error instanceof Error ? error.message : String(error));
    return APPLE_IDENTITY_MESSAGES.failed;
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

/* Apple is the one provider that owns a server-side credential beyond the
   identity, so it answers a wider contract than OneTap: `repair` re-runs the
   authorization for the credential alone. */
export interface AppleIdentity extends OneTap {
  repair(): Promise<string | null>;
}

export function createAppleIdentity(ports: AppleIdentityPorts): AppleIdentity {
  /* `reportRegistration` separates two different promises to the player. A
     sign-in or an upgrade promises an identity: once Supabase has linked it,
     the player IS signed in, so a failed deletion-credential write must not
     hold the sheet open on an account that already exists — the profile's
     "deletion access needs repair" row is that failure's standing surface.
     Repair promises the credential itself, so there the failure is the answer
     and the profile reports it inline. */
  const authenticate = async (
    mode: 'restore' | 'attach',
    reportRegistration = false,
  ): Promise<string | null> => {
    const credential = await requestAppleCredential(ports);
    if (typeof credential === 'string') return credential;
    const auth = ports.getAuth();
    const proof = { provider: 'apple' as const, token: credential.token, nonce: credential.rawNonce };
    try {
      let error: { code?: string } | null = null;
      if (mode === 'restore') {
        /* A GUEST HAS SOMETHING TO LOSE HERE. `restore` signs in with the token
           outright, which swaps the session — so ask first, and only when there
           is a guest run standing. A signed-out device answers no user and is
           never questioned; neither is a real account signing back in. */
        const { data: who } = await auth.getUser();
        if (who.user?.is_anonymous && !(await ports.confirmGuestReplacement())) {
          /* Cancelled is not an error: the sheet stays as it was. */
          return null;
        }
        ({ error } = await auth.signInWithIdToken(proof));
      }
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
        const stored = await ports.registerAuthorizationCode(credential.authorizationCode)
          .catch(() => false);
        if (!stored && reportRegistration) return APPLE_IDENTITY_MESSAGES.revocationSetup;
      }
      return null;
    } catch { return APPLE_IDENTITY_MESSAGES.failed; }
  };
  return {
    id: 'apple', labelKey: 'auth.continueApple',
    get label(): string { return t('online', 'auth.continueApple'); },
    available: () => !!ports.getPlugin() && ports.getPlatform() === 'ios',
    restore: () => authenticate('restore'), attach: () => authenticate('attach'),
    repair: () => authenticate('attach', true),
  };
}

/* The shared Edge seam, NOT supabase-js functions.invoke(): its
   FunctionsClient attaches an x-client-info header, and a request header the
   server's CORS allow-list does not name makes the browser pass the preflight
   and then never send the POST — a total, silent failure. callFunction sends
   only allow-listed headers and reports status 0 for its own timeout/abort,
   which is a failed registration exactly like any non-2xx answer. */
export async function registerAppleAuthorizationCode(code: string): Promise<boolean> {
  const { status } = await callFunction('apple-token-register', { authorizationCode: code });
  return status >= 200 && status < 300;
}

export const APPLE = createAppleIdentity({
  getPlatform: () => capacitor()?.getPlatform?.() ?? 'web',
  getPlugin: () => capacitor()?.Plugins?.AppleSignIn,
  getAuth: () => supa().auth,
  randomId: randomUuid,
  digest: sha256Hex,
  registerAuthorizationCode: registerAppleAuthorizationCode,
  /* The one place this module meets the DOM, and it meets it through the app's
     own question card rather than a confirm() the styling never reaches. */
  confirmGuestReplacement: () => ask({
    head: () => t('online', 'auth.replaceGuestTitle'),
    body: () => t('online', 'auth.replaceGuestBody'),
    confirm: () => t('online', 'auth.replaceGuestConfirm'),
    cancel: () => t('common', 'actions.cancel'),
    /* This one really does destroy something, so the way OUT keeps the weight. */
    danger: true,
  }),
});
