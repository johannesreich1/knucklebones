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
  gameCenterProofReason,
  gameCenterState,
  waitForGameCenter,
  type GameCenterAuthState,
  type GameCenterProof,
  type GameCenterProofReason,
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
  /* The two the player can act on, and the one they cannot. GameKit knows
     which of these it refused for; before this map every one of them reached
     the player as "sign-in failed, please try again" — advice that cannot work
     for a device that is simply not signed in to Game Center. */
  get signIn(): string { return onlineMessage('errors.gameCenterSignIn'); },
  get identifiers(): string { return onlineMessage('errors.gameCenterIdentifiers'); },
  get signature(): string { return onlineMessage('errors.gameCenterSignature'); },
} as const;

const PROOF_COPY: Record<GameCenterProofReason, () => string> = {
  'unavailable': () => GAME_CENTER_IDENTITY_MESSAGES.unavailable,
  'not-authenticated': () => GAME_CENTER_IDENTITY_MESSAGES.signIn,
  'identifiers-not-persistent': () => GAME_CENTER_IDENTITY_MESSAGES.identifiers,
  'signature': () => GAME_CENTER_IDENTITY_MESSAGES.signature,
};

/* The device's own words are the only diagnosis anyone gets: a proof that
   never leaves the phone leaves NOTHING in the gateway or Edge logs, which is
   exactly how a real refusal on a real device came back as four words that
   named none of it. These are GameKit diagnostics, not credentials, so they
   are printed rather than swallowed. */
function reportProofFailure(error: unknown): string {
  const reason = gameCenterProofReason(error);
  console.error('[game-center] identity proof refused',
    reason ?? 'unknown',
    error instanceof Error ? error.message : String(error));
  return reason ? PROOF_COPY[reason]() : GAME_CENTER_IDENTITY_MESSAGES.failed;
}

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
    } catch (error) {
      return reportProofFailure(error);
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
    } catch (error) {
      // Supabase session reads, fetch, body decoding, and OTP verification can
      // all reject. Provider methods return copy rather than leaking a rejected
      // promise, so the one-tap UI always reaches its re-enable path — but the
      // rejection itself is printed, or the generic copy is all anyone ever has.
      console.error('[game-center] identity exchange failed',
        error instanceof Error ? error.message : String(error));
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

export const GAME_CENTER = createGameCenterIdentity({
  available: () => !!IDENTITY_GATEWAY_URL
    && gameCenterState().status !== 'unavailable',
  getProof: fetchGameCenterProof,
  getAuth: () => supa().auth,
  request: (input, init) => fetch(input, init),
});

export const ONE_TAP: OneTap[] = [GAME_CENTER, APPLE];
export const availableTaps = (): OneTap[] => ONE_TAP.filter((method) => method.available());

/* There is deliberately NO "this Game Center player has no account yet"
   failure to distinguish here. gc-auth answers `sign-in` for an unknown player
   by PROVISIONING one and returning a session (functions/gc-auth/operation.ts,
   the branch with neither a mapping nor a caller), so a first-time player is
   signed in rather than refused — nothing about being unlinked can reach the
   sign-in panel. 'retry' therefore only ever means a genuinely unresolved
   answer: a lifecycle still authenticating, or restore copy from a network,
   verification or session failure. Every state GameKit reports as not
   authenticated is 'unavailable' and falls through to the silent guest. */
export interface GameCenterRestorePorts {
  configured(): boolean;
  waitForState(): Promise<GameCenterAuthState>;
  restore(): Promise<string | null>;
}

const RESTORE_PORTS: GameCenterRestorePorts = {
  configured: () => !!IDENTITY_GATEWAY_URL,
  waitForState: () => waitForGameCenter(),
  restore: () => GAME_CENTER.restore(),
};

export async function restoreGameCenterAutomatically(
  ports: GameCenterRestorePorts = RESTORE_PORTS,
): Promise<'signed-in' | 'unavailable' | 'retry'> {
  if (!ports.configured()) return 'unavailable';
  const state = await ports.waitForState();
  if (state.status !== 'authenticated') {
    return state.status === 'authenticating' ? 'retry' : 'unavailable';
  }
  return await ports.restore() === null ? 'signed-in' : 'retry';
}

/* ---- the guest's lifeline ----
   A guest's entire claim to their rating, streak, history and runes is the
   token in this device's storage, and a reinstall destroys it. Nothing on the
   server can then be shown to be theirs: the next launch finds no mapping for
   this Game Center player, restoreGameCenterAutomatically has gc-auth
   provision a BRAND NEW account, and the old row is stranded with nobody able
   to prove they own it. So a guest — and ONLY a guest — attaches the
   authenticated local player automatically, while the device still holds the
   session proving that account is theirs. It is the recovery identity a guest
   otherwise entirely lacks.

   An account already carrying Apple or email is deliberately EXCLUDED: it
   survives a reinstall already, so a silent bind buys it nothing, while on a
   shared or family device the Game Center player signed in at launch is often
   not the person holding the phone — and a bind is permanent. Those accounts
   keep the explicit one-tap control (screens/account-game-center-link.ts).

   'other-account' is refused rather than resolved, for the same reason in the
   other direction: the guest has local progress and that Game Center player
   already owns an account carrying its own, so silently picking either
   strands the other. The explicit control reports that conflict; this must
   never pre-empt it. And nothing here may block play — every refusal, failure
   and rejection leaves the guest exactly as they were. */
export interface GuestGameCenterPorts {
  assert(): Promise<GameCenterOwnership>;
  attach(): Promise<string | null>;
  acknowledge(): void;
}

/** Named, so the two account facts behind the decision cannot be transposed. */
export interface GuestGameCenterAccount {
  readonly guest: boolean;
  /** null when identity-status could not be read: never assume "unlinked". */
  readonly gameCenterLinked: boolean | null;
}

/* One attempt per app run, spent even when it fails: a guest still stranded is
   recovered by the NEXT launch, never by retrying the gateway from inside
   ranked entry. signOut() hands the account after it its own attempt. */
let guestGameCenterAttempted = false;
export function resetGuestGameCenterLink(): void { guestGameCenterAttempted = false; }

export async function linkGuestGameCenter(
  account: GuestGameCenterAccount,
  native: GameCenterAuthState,
  ports: GuestGameCenterPorts,
): Promise<boolean> {
  if (guestGameCenterAttempted || !account.guest || account.gameCenterLinked !== false
    || native.status !== 'authenticated') return false;
  guestGameCenterAttempted = true;
  try {
    if (await ports.assert() !== 'unlinked') return false;
    if (await ports.attach() !== null) return false;
    ports.acknowledge();
    return true;
  } catch { return false; }
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
