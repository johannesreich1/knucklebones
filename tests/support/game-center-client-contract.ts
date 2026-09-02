/* WHAT THE GAME CENTER CLIENT DOES WITH EACH ANSWER THE GATEWAY CAN GIVE.
 *
 * Sibling to tests/support/game-center-recovery.ts, and deliberately NOT merged
 * with it. That module wires the client's request port straight into the real
 * gc-auth operation to prove what the SERVER answers, and its provider carries
 * no session on purpose. This one stubs the port to every answer the gateway
 * can give — a status, a body, or a throw at one named stage — and
 * parameterizes the session, to prove what the CLIENT does with them: which
 * mode it asks for, whether it carries the caller's Authorization, a
 * session-preserving attach versus a sessionless verified-OTP restore, and that
 * every stage which can throw still reaches the player as localized copy.
 * Unifying the two harnesses would erase the difference each exists to prove.
 */
import {
  GAME_CENTER_IDENTITY_MESSAGES,
  createGameCenterIdentity,
  type GameCenterIdentityPorts,
} from '../../src/online/identity/identity.ts';
import { runOneTapFromAuthSheet } from '../../src/online/screens/auth-screen.ts';
import type { GameCenterProof } from '../../src/native/game-center.ts';

type Check = (condition: boolean, message: string, detail?: unknown) => void;

const GC_PROOF: GameCenterProof = {
  publicKeyUrl: 'https://static.gc.apple.com/public-key/gc-prod-12.cer',
  signature: 'signed', salt: 'salt', timestamp: '123', teamPlayerID: 'team-player',
};

function gameCenterHarness(options: {
  session?: { access_token: string; user?: { id: string } } | null;
  sessionError?: { code: string } | null;
  status?: number;
  body?: unknown;
  deferProof?: boolean;
  throwAt?: 'proof' | 'request' | 'json' | 'verifyOtp' | 'refreshSession';
} = {}) {
  const calls = {
    getSession: 0,
    requests: [] as Array<{ input: string; init: RequestInit }>,
    verifyOtp: [] as Array<{ token_hash: string; type: string }>,
    refresh: 0,
  };
  let currentSession = options.session ?? null;
  let markProofStarted: (() => void) | undefined;
  let releaseProof: (() => void) | undefined;
  const proofStarted = new Promise<void>((resolve) => { markProofStarted = resolve; });
  const proofRelease = new Promise<void>((resolve) => { releaseProof = resolve; });
  let requestedMode = '';
  const identity = createGameCenterIdentity({
    available: () => true,
    getProof: async () => {
      if (options.throwAt === 'proof') throw new Error('proof failed');
      if (options.deferProof) {
        markProofStarted?.();
        await proofRelease;
      }
      return GC_PROOF;
    },
    // Same boundary widening the Apple fakes use in apple-identity.test.ts: the
    // stub speaks the narrow protocol the identity code exercises, not the full
    // supabase-js types.
    getAuth: () => ({
      getSession: async () => {
        calls.getSession++;
        return { data: { session: currentSession }, error: options.sessionError ?? null };
      },
      verifyOtp: async (params: { token_hash: string; type: string }) => {
        calls.verifyOtp.push(params);
        if (options.throwAt === 'verifyOtp') throw new Error('otp failed');
        return { data: { user: null, session: null }, error: null };
      },
      refreshSession: async () => {
        calls.refresh++;
        if (options.throwAt === 'refreshSession') throw new Error('refresh failed');
        return { data: { user: null, session: null }, error: null };
      },
    }) as unknown as ReturnType<GameCenterIdentityPorts['getAuth']>,
    request: async (input, init) => {
      calls.requests.push({ input, init });
      requestedMode = JSON.parse(String(init.body)).mode;
      if (options.throwAt === 'request') throw new Error('offline');
      const status = options.status ?? 200;
      return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => {
          if (options.throwAt === 'json') throw new Error('bad json');
          return options.body ?? (requestedMode === 'attach'
            ? { kind: 'linked' } : { kind: 'session', tokenHash: 'gc-hash' });
        },
      };
    },
  });
  return {
    identity,
    calls,
    requestedMode: () => requestedMode,
    proofStarted,
    releaseProof: () => releaseProof?.(),
    setSession: (session: typeof currentSession) => { currentSession = session; },
  };
}

export async function runGameCenterClientContractTests(check: Check): Promise<void> {
  const linked = gameCenterHarness({ session: { access_token: 'guest-access' } });
  check(await linked.identity.attach() === null && linked.requestedMode() === 'attach'
    && (linked.calls.requests[0].init.headers as Record<string, string>).Authorization
      === 'Bearer guest-access'
    && linked.calls.refresh === 1 && linked.calls.verifyOtp.length === 0,
  'Game Center attach did not preserve and refresh the current account', linked.calls);

  const restored = gameCenterHarness();
  check(await restored.identity.restore() === null && restored.requestedMode() === 'sign-in'
    && restored.calls.verifyOtp[0]?.token_hash === 'gc-hash'
    && !('Authorization' in (restored.calls.requests[0].init.headers as Record<string, string>)),
  'Game Center restore was not a sessionless verified OTP exchange', restored.calls);

  const sessionlessSheet = gameCenterHarness();
  check(await runOneTapFromAuthSheet(
    sessionlessSheet.identity,
    'attach',
    async () => null,
  ) === null && sessionlessSheet.requestedMode() === 'sign-in'
    && sessionlessSheet.calls.verifyOtp[0]?.token_hash === 'gc-hash',
  'the sessionless CREATE ACCOUNT sheet did not restore the Game Center player',
  sessionlessSheet.calls);

  const attachedSheet = gameCenterHarness({ session: { access_token: 'guest-access' } });
  check(await runOneTapFromAuthSheet(
    attachedSheet.identity,
    'attach',
    async () => ({ id: 'guest', guest: true, email: null }),
  ) === null && attachedSheet.requestedMode() === 'attach'
    && (attachedSheet.calls.requests[0].init.headers as Record<string, string>).Authorization
      === 'Bearer guest-access',
  'the account sheet did not preserve Game Center attach for its current session',
  attachedSheet.calls);

  const appeared = gameCenterHarness({ session: { access_token: 'appeared-during-proof' } });
  check(await appeared.identity.restore() === null && appeared.calls.verifyOtp.length === 0,
  'Game Center OTP replaced a session that appeared during verification');

  const switchedBeforeAttach = gameCenterHarness({
    session: { access_token: 'account-a', user: { id: 'account-a' } },
    deferProof: true,
  });
  const attaching = switchedBeforeAttach.identity.attach('account-a');
  await switchedBeforeAttach.proofStarted;
  switchedBeforeAttach.setSession({
    access_token: 'account-b', user: { id: 'account-b' },
  });
  switchedBeforeAttach.releaseProof();
  check(await attaching
    === GAME_CENTER_IDENTITY_MESSAGES.failed
    && switchedBeforeAttach.calls.requests.length === 0
    && switchedBeforeAttach.calls.refresh === 0,
  'a Game Center proof opened by account A mutated account B after the native wait',
  switchedBeforeAttach.calls);

  const gcConflict = gameCenterHarness({
    session: { access_token: 'guest' }, status: 409,
    body: { error: 'identity-already-linked' },
  });
  check(await gcConflict.identity.attach() === GAME_CENTER_IDENTITY_MESSAGES.conflict,
  'Game Center ownership conflict was not localized');

  for (const throwAt of ['proof', 'request', 'json', 'verifyOtp'] as const) {
    const harness = gameCenterHarness({ throwAt });
    check(await harness.identity.restore() === GAME_CENTER_IDENTITY_MESSAGES.failed,
      `a thrown Game Center ${throwAt} escaped the localized boundary`);
  }
}
