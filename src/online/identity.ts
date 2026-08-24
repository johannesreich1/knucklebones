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
import { supa } from './client.ts';
import { randomUuid } from './random-id.ts';

export interface OneTap {
  id: string;
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

interface GameCenterBridge {
  signIn(): Promise<Record<string, string>>;
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
  unavailable: 'Apple sign-in is not available on this device.',
  configuration: 'Apple sign-in is not configured yet.',
  invalid: 'Apple sign-in could not be verified. Please try again.',
  conflict: 'That Apple account is already linked to another player.',
  failed: 'Apple sign-in failed. Please try again.',
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
    label: 'Continue with Apple',
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
const GAME_CENTER: OneTap = {
  id: 'gamecenter',
  label: 'Continue with Game Center',
  available: () => !!plugins().GameCenter,
  restore: () => gcSession(false),
  attach: () => gcSession(true),
};

async function gcSession(link: boolean): Promise<string | null> {
  const gameCenter = plugins().GameCenter;
  if (!gameCenter) return 'Game Center is not available';
  let signed: Record<string, string>;
  try {
    signed = await gameCenter.signIn();
  } catch (error) {
    return error instanceof Error ? error.message : 'Game Center sign-in failed';
  }
  const { data: { session } } = await supa().auth.getSession();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/gc-auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      ...(link && session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(signed),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.token_hash) return data?.error ?? 'Game Center could not be verified';
  const { error } = await supa().auth.verifyOtp({ token_hash: data.token_hash, type: 'magiclink' });
  return error ? error.message : null;
}

export const ONE_TAP: OneTap[] = [GAME_CENTER, APPLE];
export const availableTaps = (): OneTap[] => ONE_TAP.filter((method) => method.available());
