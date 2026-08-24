// One-tap identity providers — the rungs above "guest" that need no typing.
//
// Native providers arrive through the global Capacitor bridge, deliberately
// NOT through imports: web bundles carry no plugin implementation. Each entry
// knows how to RESTORE its account and how to ATTACH to the current guest.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  APPLE_OAUTH_REDIRECT_URL,
  APPLE_SERVICE_ID,
  SUPABASE_KEY,
  SUPABASE_URL,
} from '../config.ts';
import { t, type LocaleKey } from '../i18n/index.ts';
import { supa } from './client.ts';
import { onlineMessage } from './message-copy.ts';
import { randomUuid } from './random-id.ts';

export interface OneTap {
  id: string;
  labelKey: LocaleKey<'online'>;
  label: string;
  available(): boolean;
  restore(): Promise<string | null>;   // null = signed in
  attach(): Promise<string | null>;    // null = linked to the current user
}

type ApplePlatform = 'ios' | 'android';
type AppleAuth = Pick<SupabaseClient['auth'],
  'getSession' | 'linkIdentity' | 'signInWithIdToken'>;

interface AppleSignInOptions {
  redirectUrl?: string;
  scopes?: Array<'EMAIL' | 'FULL_NAME'>;
  nonce?: string;
  state?: string;
}

interface AppleSignInResult {
  idToken: string;
  state?: string;
  // The plugin decodes other claims client-side on Android. They are
  // intentionally not represented or consumed here; Supabase verifies JWTs.
}

export interface AppleSignInBridge {
  initialize(options: { clientId: string }): Promise<void>;
  signIn(options?: AppleSignInOptions): Promise<AppleSignInResult>;
}

export interface GameCenterBridge {
  signIn(): Promise<Record<string, string>>;
}

type GameCenterAuth = Pick<SupabaseClient['auth'], 'getSession' | 'verifyOtp'>;

interface GameCenterResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export interface GameCenterIdentityPorts {
  getPlugin(): GameCenterBridge | undefined;
  getAuth(): GameCenterAuth;
  request(input: string, init: RequestInit): Promise<GameCenterResponse>;
}

interface CapacitorBridge {
  getPlatform?(): string;
  Plugins?: {
    AppleSignIn?: AppleSignInBridge;
    GameCenter?: GameCenterBridge;
  };
}

const capacitor = (): CapacitorBridge | undefined =>
  (globalThis as typeof globalThis & { Capacitor?: CapacitorBridge }).Capacitor;
const plugins = () => capacitor()?.Plugins ?? {};

export const APPLE_IDENTITY_MESSAGES = {
  get unavailable(): string { return onlineMessage('errors.appleUnavailable'); },
  get configuration(): string { return onlineMessage('errors.appleConfiguration'); },
  get invalid(): string { return onlineMessage('errors.appleInvalid'); },
  get conflict(): string { return onlineMessage('errors.appleConflict'); },
  get failed(): string { return onlineMessage('errors.appleFailed'); },
} as const;

export async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface AppleIdentityPorts {
  getPlatform(): string;
  getPlugin(): AppleSignInBridge | undefined;
  getAuth(): AppleAuth;
  randomId(): string;
  digest(value: string): Promise<string>;
}

type AppleCredential = { token: string; rawNonce: string };
type AppleCredentialResult = AppleCredential | string;

function isApplePlatform(value: string): value is ApplePlatform {
  return value === 'ios' || value === 'android';
}

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
    || error.code === 'oauth_provider_not_supported') {
    return APPLE_IDENTITY_MESSAGES.configuration;
  }
  return APPLE_IDENTITY_MESSAGES.failed;
}

async function requestAppleCredential(ports: AppleIdentityPorts): Promise<AppleCredentialResult> {
  const plugin = ports.getPlugin();
  const platform = ports.getPlatform();
  if (!plugin || !isApplePlatform(platform)) return APPLE_IDENTITY_MESSAGES.unavailable;

  // Both values are new for every sheet. Apple receives only the nonce digest;
  // Supabase receives the raw value after the returned token/state are checked.
  const rawNonce = ports.randomId();
  const expectedState = ports.randomId();
  let result: AppleSignInResult;
  try {
    const nonce = await ports.digest(rawNonce);
    if (platform === 'android') {
      try {
        await plugin.initialize({ clientId: APPLE_SERVICE_ID });
      } catch {
        return APPLE_IDENTITY_MESSAGES.configuration;
      }
      result = await plugin.signIn({
        redirectUrl: APPLE_OAUTH_REDIRECT_URL,
        scopes: ['EMAIL', 'FULL_NAME'],
        nonce,
        state: expectedState,
      });
    } else {
      result = await plugin.signIn({
        scopes: ['EMAIL', 'FULL_NAME'],
        nonce,
      });
    }
  } catch (error) {
    return errorCode(error) === 'SIGN_IN_CANCELED'
      ? '' : APPLE_IDENTITY_MESSAGES.failed;
  }

  if (platform === 'android' && result.state !== expectedState) {
    return APPLE_IDENTITY_MESSAGES.invalid;
  }
  if (typeof result.idToken !== 'string' || !result.idToken.trim()) {
    return APPLE_IDENTITY_MESSAGES.invalid;
  }
  return { token: result.idToken, rawNonce };
}

export function createAppleIdentity(ports: AppleIdentityPorts): OneTap {
  const authenticate = async (mode: 'restore' | 'attach'): Promise<string | null> => {
    const credential = await requestAppleCredential(ports);
    if (typeof credential === 'string') return credential;
    const auth = ports.getAuth();
    const proof = {
      provider: 'apple' as const,
      token: credential.token,
      nonce: credential.rawNonce,
    };
    try {
      if (mode === 'restore') {
        const { error } = await auth.signInWithIdToken(proof);
        return authErrorMessage(error);
      }

      const { data, error: sessionError } = await auth.getSession();
      // A failed session read must not be treated as sessionless: signing in
      // could otherwise replace a guest whose local session merely hiccupped.
      if (sessionError) return APPLE_IDENTITY_MESSAGES.failed;
      if (!data.session) {
        const { error } = await auth.signInWithIdToken(proof);
        return authErrorMessage(error);
      }
      const { error } = await auth.linkIdentity(proof);
      return authErrorMessage(error);
    } catch {
      return APPLE_IDENTITY_MESSAGES.failed;
    }
  };

  return {
    id: 'apple',
    labelKey: 'auth.continueApple',
    get label(): string { return t('online', 'auth.continueApple'); },
    available: () => !!ports.getPlugin() && isApplePlatform(ports.getPlatform()),
    restore: () => authenticate('restore'),
    attach: () => authenticate('attach'),
  };
}

const APPLE = createAppleIdentity({
  getPlatform: () => capacitor()?.getPlatform?.() ?? 'web',
  getPlugin: () => plugins().AppleSignIn,
  getAuth: () => supa().auth,
  randomId: randomUuid,
  digest: sha256Hex,
});

/* ---- Game Center: the rung with no tap at all ----
   ATTACH sends the current session so the identity lands on the guest already
   playing; RESTORE deliberately does not, so the server answers with its owner. */
export const GAME_CENTER_IDENTITY_MESSAGES = {
  get unavailable(): string { return onlineMessage('errors.gameCenterUnavailable'); },
  get failed(): string { return onlineMessage('errors.gameCenterFailed'); },
  get invalid(): string { return onlineMessage('errors.gameCenterInvalid'); },
  get conflict(): string { return onlineMessage('errors.gameCenterConflict'); },
} as const;

function gameCenterPlugin(): GameCenterBridge | undefined {
  const gameCenter = plugins().GameCenter;
  return gameCenter;
}

function isGameCenterPayload(value: unknown): value is { token_hash: string } {
  return !!value && typeof value === 'object'
    && 'token_hash' in value
    && typeof (value as { token_hash?: unknown }).token_hash === 'string'
    && !!(value as { token_hash: string }).token_hash;
}

function isGameCenterConflict(status: number, value: unknown): boolean {
  return status === 409
    && !!value
    && typeof value === 'object'
    && 'error' in value
    && (value as { error?: unknown }).error === 'identity-already-linked';
}

export function createGameCenterIdentity(ports: GameCenterIdentityPorts): OneTap {
  const authenticate = async (link: boolean): Promise<string | null> => {
    const gameCenter = ports.getPlugin();
    if (!gameCenter) return GAME_CENTER_IDENTITY_MESSAGES.unavailable;

    let signed: Record<string, string>;
    try {
      signed = await gameCenter.signIn();
    } catch {
      return GAME_CENTER_IDENTITY_MESSAGES.failed;
    }

    try {
      const auth = ports.getAuth();
      let accessToken: string | undefined;
      if (link) {
        const { data, error } = await auth.getSession();
        // A failed read is not the same as a missing session. Sending the
        // assertion without the guest JWT could restore a different owner.
        if (error) return GAME_CENTER_IDENTITY_MESSAGES.failed;
        accessToken = data.session?.access_token;
      }

      const response = await ports.request(`${SUPABASE_URL}/functions/v1/gc-auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(signed),
      });
      const data = await response.json();
      if (isGameCenterConflict(response.status, data)) {
        return GAME_CENTER_IDENTITY_MESSAGES.conflict;
      }
      if (!response.ok || !isGameCenterPayload(data)) {
        return GAME_CENTER_IDENTITY_MESSAGES.invalid;
      }
      const { error } = await auth.verifyOtp({
        token_hash: data.token_hash,
        type: 'magiclink',
      });
      return error ? GAME_CENTER_IDENTITY_MESSAGES.invalid : null;
    } catch {
      // Supabase session reads, fetch, body decoding, and OTP verification can
      // all reject. Provider methods return copy rather than leaking a rejected
      // promise, so the one-tap UI always reaches its re-enable path.
      return GAME_CENTER_IDENTITY_MESSAGES.failed;
    }
  };

  return {
    id: 'gamecenter',
    labelKey: 'auth.continueGameCenter',
    get label(): string { return t('online', 'auth.continueGameCenter'); },
    available: () => !!ports.getPlugin(),
    restore: () => authenticate(false),
    attach: () => authenticate(true),
  };
}

const GAME_CENTER = createGameCenterIdentity({
  getPlugin: gameCenterPlugin,
  getAuth: () => supa().auth,
  request: (input, init) => fetch(input, init),
});

export const ONE_TAP: OneTap[] = [GAME_CENTER, APPLE];
export const availableTaps = (): OneTap[] => ONE_TAP.filter((method) => method.available());
