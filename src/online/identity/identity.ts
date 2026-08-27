// One-tap identity providers — the rungs above "guest" that need no typing.
//
// Native providers arrive through the global Capacitor bridge, deliberately
// NOT through imports: web bundles carry no plugin implementation. Each entry
// knows how to RESTORE its account and how to ATTACH to the current guest.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  IDENTITY_GATEWAY_URL,
} from '../../config.ts';
import { t } from '../../i18n/index.ts';
import {
  fetchGameCenterProof,
  gameCenterState,
  waitForGameCenter,
  type GameCenterProof,
} from '../../native/game-center.ts';
import { supa } from '../api/client.ts';
import { onlineMessage } from '../message-copy.ts';
import { APPLE } from './apple-identity.ts';
import type { OneTap } from './identity-provider.ts';
export type { OneTap } from './identity-provider.ts';
export {
  APPLE_IDENTITY_MESSAGES,
  createAppleIdentity,
  sha256Hex,
  type AppleIdentityPorts,
  type AppleSignInBridge,
} from './apple-identity.ts';

type GameCenterAuth = Pick<SupabaseClient['auth'], 'getSession' | 'verifyOtp' | 'refreshSession'>;

interface GameCenterResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export interface GameCenterIdentityPorts {
  available(): boolean;
  getProof(): Promise<GameCenterProof>;
  getAuth(): GameCenterAuth;
  request(input: string, init: RequestInit): Promise<GameCenterResponse>;
}

/* ---- Game Center: the rung with no tap at all ----
   ATTACH sends the current session so the identity lands on the guest already
   playing; RESTORE deliberately does not, so the server answers with its owner. */
export const GAME_CENTER_IDENTITY_MESSAGES = {
  get unavailable(): string { return onlineMessage('errors.gameCenterUnavailable'); },
  get failed(): string { return onlineMessage('errors.gameCenterFailed'); },
  get invalid(): string { return onlineMessage('errors.gameCenterInvalid'); },
  get conflict(): string { return onlineMessage('errors.gameCenterConflict'); },
} as const;

function isGameCenterSession(value: unknown): value is { kind: 'session'; tokenHash: string } {
  return !!value && typeof value === 'object'
    && (value as { kind?: unknown }).kind === 'session'
    && typeof (value as { tokenHash?: unknown }).tokenHash === 'string'
    && !!(value as { tokenHash: string }).tokenHash;
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
    if (!ports.available()) return GAME_CENTER_IDENTITY_MESSAGES.unavailable;

    let signed: GameCenterProof;
    try {
      signed = await ports.getProof();
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

      const response = await ports.request(`${IDENTITY_GATEWAY_URL}/v1/game-center`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ mode: link ? 'attach' : 'sign-in', proof: signed }),
      });
      const data = await response.json();
      if (isGameCenterConflict(response.status, data)) {
        return GAME_CENTER_IDENTITY_MESSAGES.conflict;
      }
      if (!response.ok) {
        return GAME_CENTER_IDENTITY_MESSAGES.invalid;
      }
      if (link) {
        if ((data as { kind?: unknown })?.kind !== 'linked') {
          return GAME_CENTER_IDENTITY_MESSAGES.invalid;
        }
        const { error } = await auth.refreshSession();
        return error ? GAME_CENTER_IDENTITY_MESSAGES.failed : null;
      }
      if (!isGameCenterSession(data)) return GAME_CENTER_IDENTITY_MESSAGES.invalid;
      // A different auth flow may have completed while the proof was being
      // verified. Never replace that newly appeared session with this OTP.
      const { data: current, error: sessionError } = await auth.getSession();
      if (sessionError) return GAME_CENTER_IDENTITY_MESSAGES.failed;
      if (current.session) return null;
      const { error } = await auth.verifyOtp({
        token_hash: data.tokenHash,
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
    available: ports.available,
    restore: () => authenticate(false),
    attach: () => authenticate(true),
  };
}

const GAME_CENTER = createGameCenterIdentity({
  available: () => !!IDENTITY_GATEWAY_URL
    && gameCenterState().status !== 'unavailable',
  getProof: fetchGameCenterProof,
  getAuth: () => supa().auth,
  request: (input, init) => fetch(input, init),
});

export const ONE_TAP: OneTap[] = [GAME_CENTER, APPLE];
export const availableTaps = (): OneTap[] => ONE_TAP.filter((method) => method.available());

export async function restoreGameCenterAutomatically(): Promise<
  'signed-in' | 'unavailable' | 'retry'
> {
  if (!IDENTITY_GATEWAY_URL) return 'unavailable';
  const state = await waitForGameCenter();
  if (state.status !== 'authenticated') {
    return state.status === 'authenticating' ? 'retry' : 'unavailable';
  }
  return await GAME_CENTER.restore() === null ? 'signed-in' : 'retry';
}

export type GameCenterOwnership = 'match' | 'unlinked' | 'other-account' | 'unavailable' | 'retry';

export async function assertCurrentGameCenter(): Promise<GameCenterOwnership> {
  if (!IDENTITY_GATEWAY_URL) return 'unavailable';
  const state = await waitForGameCenter();
  if (state.status !== 'authenticated') {
    return state.status === 'unavailable' ? 'unavailable' : 'retry';
  }
  try {
    const [{ data, error }, proof] = await Promise.all([
      supa().auth.getSession(),
      fetchGameCenterProof(),
    ]);
    const accessToken = data.session?.access_token;
    if (error || !accessToken) return 'retry';
    const response = await fetch(`${IDENTITY_GATEWAY_URL}/v1/game-center`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ mode: 'assert-current', proof }),
    });
    const value = await response.json().catch(() => null) as {
      kind?: unknown;
      status?: unknown;
    } | null;
    return response.ok && value?.kind === 'assertion'
      && (value.status === 'match' || value.status === 'unlinked'
        || value.status === 'other-account')
      ? value.status : 'retry';
  } catch { return 'retry'; }
}
