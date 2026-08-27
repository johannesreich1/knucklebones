import { readFileSync } from 'node:fs';
import {
  APPLE_IDENTITY_MESSAGES,
  GAME_CENTER_IDENTITY_MESSAGES,
  createAppleIdentity,
  createGameCenterIdentity,
  sha256Hex,
  type AppleIdentityPorts,
  type AppleSignInBridge,
  type GameCenterIdentityPorts,
} from '../src/online/identity/identity.ts';
import { registerAppleAuthorizationCode } from '../src/online/identity/apple-identity.ts';
import { runOneTapFromAuthSheet } from '../src/online/screens/auth-screen.ts';
import { CORS_HEADERS } from '../supabase/functions/_shared/http.ts';
import type { GameCenterProof } from '../src/native/game-center.ts';

const problems: string[] = [];
const check = (condition: boolean, message: string, detail?: unknown) => {
  if (!condition) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};

interface Proof { provider: string; token: string; nonce: string }
interface FakeAuthOptions {
  session?: { access_token: string } | null;
  sessionError?: { code?: string } | null;
  signError?: { code?: string } | null;
  linkError?: { code?: string } | null;
  appleAlreadyLinked?: boolean;
}

function fakeAppleAuth(options: FakeAuthOptions = {}) {
  const calls = { getSession: 0, getUser: 0, signIn: [] as Proof[], link: [] as Proof[] };
  return {
    calls,
    auth: {
      getSession: async () => {
        calls.getSession++;
        return { data: { session: options.session ?? null }, error: options.sessionError ?? null };
      },
      getUser: async () => {
        calls.getUser++;
        return {
          data: { user: { identities: options.appleAlreadyLinked ? [{ provider: 'apple' }] : [] } },
          error: null,
        };
      },
      signInWithIdToken: async (proof: Proof) => {
        calls.signIn.push(proof);
        return { data: {}, error: options.signError ?? null };
      },
      linkIdentity: async (proof: Proof) => {
        calls.link.push(proof);
        return { data: {}, error: options.linkError ?? null };
      },
    },
  };
}

function applePorts(
  platform: string,
  plugin: AppleSignInBridge | undefined,
  auth: ReturnType<typeof fakeAppleAuth>['auth'],
  ids: string[],
  // How the deletion-credential registration answers: stored, refused, or a
  // rejected promise. A refusal is a real outcome, not an absent one.
  registration: boolean | 'throws' = true,
) {
  const registered: string[] = [];
  return {
    registered,
    ports: {
      getPlatform: () => platform,
      getPlugin: () => plugin,
      // The fake returns only the fields the code under test reads; the real
      // supabase-js auth surface is far wider, so widen at this boundary only.
      getAuth: () => auth as unknown as ReturnType<AppleIdentityPorts['getAuth']>,
      randomId: () => {
        const id = ids.shift();
        if (!id) throw new Error('test ran out of deterministic ids');
        return id;
      },
      digest: async (value: string) => `sha256:${value}`,
      registerAuthorizationCode: async (code: string) => {
        registered.push(code);
        if (registration === 'throws') throw new Error('registration transport failed');
        return registration;
      },
    },
  };
}

check(await sha256Hex('nonce')
  === '78377b525757b494427f89014f97d79928f3938d14eb51e20fb5dec9834eb304',
'Apple nonce hashing must be lowercase SHA-256 hex');

const iosOptions: unknown[] = [];
const iosPlugin: AppleSignInBridge = {
  initialize: async () => undefined,
  signIn: async (options) => {
    iosOptions.push(options);
    return { idToken: 'ios-token', authorizationCode: 'single-use-code' };
  },
};
const iosAuth = fakeAppleAuth();
const iosPorts = applePorts('ios', iosPlugin, iosAuth.auth, ['ios-raw']);
const ios = createAppleIdentity(iosPorts.ports);
check(ios.available() && await ios.restore() === null, 'iOS Apple restore did not complete');
check(JSON.stringify(iosOptions) === JSON.stringify([{
  scopes: ['EMAIL'], nonce: 'sha256:ios-raw',
}]), 'iOS requested unnecessary Apple data or used a wrong nonce', iosOptions);
check(iosPorts.registered[0] === 'single-use-code'
  && iosAuth.calls.signIn[0]?.nonce === 'ios-raw',
'the authorization code was not registered after Supabase accepted the raw nonce');

const androidAuth = fakeAppleAuth();
const androidPorts = applePorts('android', iosPlugin, androidAuth.auth, ['unused']);
const android = createAppleIdentity(androidPorts.ports);
check(!android.available() && await android.restore() === APPLE_IDENTITY_MESSAGES.unavailable
  && androidAuth.calls.signIn.length === 0,
'Android Apple identity was exposed in the iOS-first release');

const missing = applePorts('ios', {
  initialize: async () => undefined,
  signIn: async () => ({ idToken: '' }),
}, fakeAppleAuth().auth, ['empty']);
check(await createAppleIdentity(missing.ports).restore() === APPLE_IDENTITY_MESSAGES.invalid,
'an empty Apple token reached Supabase');

const guest = fakeAppleAuth({ session: { access_token: 'guest' } });
const guestPorts = applePorts('ios', iosPlugin, guest.auth, ['guest-raw']);
check(await createAppleIdentity(guestPorts.ports).attach() === null
  && guest.calls.link.length === 1 && guest.calls.signIn.length === 0,
'Apple attach replaced the current guest');

const conflict = fakeAppleAuth({
  session: { access_token: 'guest' },
  linkError: { code: 'identity_already_exists' },
});
const conflictPorts = applePorts('ios', iosPlugin, conflict.auth, ['conflict-raw']);
check(await createAppleIdentity(conflictPorts.ports).attach() === APPLE_IDENTITY_MESSAGES.conflict,
'an Apple identity owned elsewhere did not fail closed');

const ours = fakeAppleAuth({
  session: { access_token: 'account' },
  linkError: { code: 'identity_already_exists' },
  appleAlreadyLinked: true,
});
const oursPorts = applePorts('ios', iosPlugin, ours.auth, ['ours-raw']);
check(await createAppleIdentity(oursPorts.ports).attach() === null
  && oursPorts.registered[0] === 'single-use-code',
'an already-linked Apple identity could not repair its revocation credential');

/* The credential is the WHOLE point of the repair, and Apple hands out the
   single-use code once. A refused registration that reports success leaves the
   player tapping REPAIR APPLE ACCESS forever against an unchanged warning —
   which is exactly how this shipped broken. It must reach them as copy. */
const refused = fakeAppleAuth({
  session: { access_token: 'account' },
  linkError: { code: 'identity_already_exists' },
  appleAlreadyLinked: true,
});
const refusedPorts = applePorts('ios', iosPlugin, refused.auth, ['refused-raw'], false);
check(await createAppleIdentity(refusedPorts.ports).repair()
  === APPLE_IDENTITY_MESSAGES.revocationSetup
  && refusedPorts.registered[0] === 'single-use-code',
'a refused deletion-credential registration was reported to the player as a repair');

const threwPorts = applePorts('ios', iosPlugin, fakeAppleAuth().auth, ['threw-raw'], 'throws');
check(await createAppleIdentity(threwPorts.ports).repair()
  === APPLE_IDENTITY_MESSAGES.revocationSetup,
'a rejected registration was reported when the player asked for a repair');

/* Signing in and upgrading promise an IDENTITY, and Supabase has already
   granted it by this point. A credential that will not store must not hold the
   sheet open over an account that now exists — the profile's standing "deletion
   access needs repair" row carries it, and REPAIR is where it is answered.
   Without this, a server-side Apple misconfiguration would trap every sign-in. */
const signInPorts = applePorts('ios', iosPlugin, fakeAppleAuth().auth, ['signin-raw'], false);
check(await createAppleIdentity(signInPorts.ports).restore() === null
  && signInPorts.registered[0] === 'single-use-code',
'a refused registration blocked a sign-in that had already succeeded');

const upgradePorts = applePorts('ios', iosPlugin, fakeAppleAuth({
  session: { access_token: 'account' },
}).auth, ['upgrade-raw'], 'throws');
check(await createAppleIdentity(upgradePorts.ports).attach() === null,
'a rejected registration blocked an account upgrade that had already succeeded');

check(APPLE_IDENTITY_MESSAGES.revocationSetup !== APPLE_IDENTITY_MESSAGES.failed
  && !!APPLE_IDENTITY_MESSAGES.revocationSetup.trim(),
'the credential failure borrows sign-in copy, so the player is told the wrong thing');

/* The bug itself: supabase-js's functions.invoke() adds x-client-info, the
   allow-list did not name it, and the browser answered a 200 preflight by
   never sending the POST. Drive the REAL registration path and prove every
   header it sends is one the shared Edge allow-list permits. */
const requests: Array<{ url: string; init: RequestInit }> = [];
const liveFetch = globalThis.fetch;
let registerStatus = 200;
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  requests.push({ url: String(input), init });
  return { status: registerStatus, json: async () => ({ registered: registerStatus === 200 }) };
}) as unknown as typeof fetch;
let storedCode: boolean;
let refusedCode: boolean;
try {
  storedCode = await registerAppleAuthorizationCode('single-use-code');
  registerStatus = 502;
  refusedCode = await registerAppleAuthorizationCode('single-use-code');
} finally {
  globalThis.fetch = liveFetch;
}
const registerPosts = requests
  .filter((request) => request.url.endsWith('/functions/v1/apple-token-register'));
check(storedCode === true && refusedCode === false && registerPosts.length === 2,
'the Apple authorization code does not reach apple-token-register through the shared seam',
requests.map((request) => request.url));
check(registerPosts[0]?.init.method === 'POST'
  && String(registerPosts[0]?.init.body) === JSON.stringify({ authorizationCode: 'single-use-code' }),
'the registration POST did not carry the single-use authorization code', registerPosts[0]?.init);
const allowedHeaders = new Set(CORS_HEADERS['Access-Control-Allow-Headers']
  .split(',').map((name) => name.trim().toLowerCase()));
const sentHeaders = Object.keys(registerPosts[0]?.init.headers ?? {})
  .map((name) => name.toLowerCase());
check(sentHeaders.length > 0 && sentHeaders.every((name) => allowedHeaders.has(name)),
'the registration POST sends a header the Edge CORS allow-list does not name; the browser '
  + 'passes the preflight and then drops the request entirely',
{ sentHeaders, allowed: [...allowedHeaders] });

const GC_PROOF: GameCenterProof = {
  publicKeyUrl: 'https://static.gc.apple.com/public-key/gc-prod-12.cer',
  signature: 'signed', salt: 'salt', timestamp: '123', teamPlayerID: 'team-player',
};

function gameCenterHarness(options: {
  session?: { access_token: string } | null;
  sessionError?: { code: string } | null;
  status?: number;
  body?: unknown;
  throwAt?: 'proof' | 'request' | 'json' | 'verifyOtp' | 'refreshSession';
} = {}) {
  const calls = {
    getSession: 0,
    requests: [] as Array<{ input: string; init: RequestInit }>,
    verifyOtp: [] as Array<{ token_hash: string; type: string }>,
    refresh: 0,
  };
  let requestedMode = '';
  const identity = createGameCenterIdentity({
    available: () => true,
    getProof: async () => {
      if (options.throwAt === 'proof') throw new Error('proof failed');
      return GC_PROOF;
    },
    // Same boundary widening as the Apple fake: the stub speaks the narrow
    // protocol the identity code exercises, not the full supabase-js types.
    getAuth: () => ({
      getSession: async () => {
        calls.getSession++;
        return { data: { session: options.session ?? null }, error: options.sessionError ?? null };
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
  return { identity, calls, requestedMode: () => requestedMode };
}

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

const identitySource = readFileSync('src/online/identity/identity.ts', 'utf8');
check(!/from\s+['"]@(?:capacitor|capawesome)\//.test(identitySource),
'web identity code imports a native plugin');
check(!/result\.(?:user|email|givenName|familyName|realUserStatus)\b/.test(identitySource)
  && !/decodeJwt/.test(identitySource),
'client-decoded Apple claims are being trusted');

console.log(JSON.stringify({ iosOptions, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
