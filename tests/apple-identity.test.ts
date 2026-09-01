import { readFileSync } from 'node:fs';
import {
  APPLE_IDENTITY_MESSAGES,
  createAppleIdentity,
  sha256Hex,
  type AppleIdentityPorts,
  type AppleSignInBridge,
} from '../src/online/identity/identity.ts';
import { registerAppleAuthorizationCode } from '../src/online/identity/apple-identity.ts';
import { CORS_HEADERS } from '../supabase/functions/_shared/http.ts';
import { runAccountProviderOfferTests } from './support/account-provider-offers.ts';
import { runGameCenterClientContractTests } from './support/game-center-client-contract.ts';
import { emitReport } from './support/emit-report.mjs';

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
  /* The session on this device belongs to a guest, so signing in REPLACES a run
     that has rating, runes and history in it. */
  guest?: boolean;
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
          data: { user: {
            is_anonymous: !!options.guest,
            identities: options.appleAlreadyLinked ? [{ provider: 'apple' }] : [],
          } },
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
  /* Answered YES by default, so every case written before this port existed
     behaves exactly as it did. The cases that care pass their own answer. */
  confirmGuest: boolean | null = true,
) {
  const registered: string[] = [];
  const asked: number[] = [];
  return {
    registered,
    asked,
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
      confirmGuestReplacement: async () => {
        asked.push(1);
        return confirmGuest;
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
  session: { access_token: 'guest' }, linkError: { code: 'identity_already_exists' } });
const conflictPorts = applePorts('ios', iosPlugin, conflict.auth, ['conflict-raw']);
check(await createAppleIdentity(conflictPorts.ports).attach() === APPLE_IDENTITY_MESSAGES.conflict,
'an Apple identity owned elsewhere did not fail closed');

/* An account re-authorizing the Apple identity it already owns. */
const relinking = () => fakeAppleAuth({ session: { access_token: 'account' },
  linkError: { code: 'identity_already_exists' }, appleAlreadyLinked: true });
const ours = relinking();
const oursPorts = applePorts('ios', iosPlugin, ours.auth, ['ours-raw']);
check(await createAppleIdentity(oursPorts.ports).attach() === null
  && oursPorts.registered[0] === 'single-use-code',
'an already-linked Apple identity could not repair its revocation credential');

/* The credential is the WHOLE point of the repair, and Apple hands out the
   single-use code once. A refused registration that reports success leaves the
   player tapping REPAIR APPLE ACCESS forever against an unchanged warning —
   which is exactly how this shipped broken. It must reach them as copy. */
const refusedPorts = applePorts('ios', iosPlugin, relinking().auth, ['refused-raw'], false);
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

/* The two neighbouring identity contracts this suite also decides live in
   their own modules; both run on injected ports, so they are safely after
   the globalThis.fetch swap above has been restored. */
await runGameCenterClientContractTests(check);
runAccountProviderOfferTests(check);

const identitySource = readFileSync('src/online/identity/identity.ts', 'utf8');
check(!/from\s+['"]@(?:capacitor|capawesome)\//.test(identitySource),
'web identity code imports a native plugin');
check(!/result\.(?:user|email|givenName|familyName|realUserStatus)\b/.test(identitySource)
  && !/decodeJwt/.test(identitySource),
'client-decoded Apple claims are being trusted');

/* ---- A GUEST IS ASKED BEFORE THEY ARE REPLACED ----
   `restore` signs in with the token outright, which swaps the session rather
   than merging it — so a player who has been playing as a guest loses that run
   the moment the token is accepted, including when the Apple identity already
   belongs to another account of theirs. Requested 2026-08-30 as a modal to
   confirm; the module asks through a port so it keeps no DOM. */
{
  const guestAuth = fakeAppleAuth({ guest: true });
  const declined = applePorts('ios', iosPlugin, guestAuth.auth, ['n1'], true, false);
  const declinedSettled: boolean[] = [];
  const cancelled = await createAppleIdentity(declined.ports).restore({
    nestedSheetSettled: (accepted) => declinedSettled.push(accepted),
  });
  check(cancelled === '' && declined.asked.length === 1
    && declinedSettled.join(',') === 'false' && guestAuth.calls.signIn.length === 0,
  'a guest declining the warning was signed in anyway, losing the run they kept');

  const guestAuth2 = fakeAppleAuth({ guest: true });
  const accepted = applePorts('ios', iosPlugin, guestAuth2.auth, ['n2'], true, true);
  const acceptedSettled: boolean[] = [];
  await createAppleIdentity(accepted.ports).restore({
    nestedSheetSettled: (answer) => acceptedSettled.push(answer),
  });
  check(accepted.asked.length === 1 && acceptedSettled.join(',') === 'true'
    && guestAuth2.calls.signIn.length === 1,
    'a guest who accepted the warning was not signed in');

  const guestAuth3 = fakeAppleAuth({ guest: true });
  const replaced = applePorts('ios', iosPlugin, guestAuth3.auth, ['n-replaced'], true, null);
  const replacedSettled: boolean[] = [];
  const abandoned = await createAppleIdentity(replaced.ports).restore({
    nestedSheetSettled: (answer) => replacedSettled.push(answer),
  });
  check(abandoned === '' && replacedSettled.length === 0
    && guestAuth3.calls.signIn.length === 0,
  'a replaced guest warning continued or asked AUTH to reclaim the newer sheet');

  /* A REAL ACCOUNT IS NOT QUESTIONED. There is nothing to lose signing back
     into the account you already are, and a question there would read as a
     threat to the very progress it is protecting. */
  const memberAuth = fakeAppleAuth();
  const member = applePorts('ios', iosPlugin, memberAuth.auth, ['n3']);
  const memberSettled: boolean[] = [];
  await createAppleIdentity(member.ports).restore({
    nestedSheetSettled: (answer) => memberSettled.push(answer),
  });
  check(member.asked.length === 0 && memberSettled.length === 0
    && memberAuth.calls.signIn.length === 1,
    'a returning account was warned about losing a guest run it does not have');
}

emitReport({ iosOptions, problems }, problems.length);
