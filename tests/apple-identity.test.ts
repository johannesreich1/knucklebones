import { readFileSync } from 'node:fs';
import {
  APPLE_IDENTITY_MESSAGES,
  createAppleIdentity,
  sha256Hex,
  type AppleSignInBridge,
} from '../src/online/identity.ts';
import {
  APPLE_OAUTH_REDIRECT_URL,
  APPLE_SERVICE_ID,
  SUPABASE_URL,
} from '../src/config.ts';

const problems: string[] = [];
const check = (condition: boolean, message: string, detail?: unknown) => {
  if (!condition) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};

interface Proof {
  provider: string;
  token: string;
  nonce: string;
}

interface FakeAuthOptions {
  session?: object | null;
  sessionError?: { code?: string } | null;
  signError?: { code?: string } | null;
  linkError?: { code?: string } | null;
}

function fakeAuth(options: FakeAuthOptions = {}) {
  const calls = {
    getSession: 0,
    signIn: [] as Proof[],
    link: [] as Proof[],
  };
  const auth = {
    getSession: async () => {
      calls.getSession++;
      return {
        data: { session: options.session ?? null },
        error: options.sessionError ?? null,
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
  };
  return { auth, calls };
}

function identityPorts(
  platform: string,
  plugin: AppleSignInBridge | undefined,
  auth: ReturnType<typeof fakeAuth>['auth'],
  ids: string[],
  onGetAuth: () => void = () => undefined,
) {
  return {
    getPlatform: () => platform,
    getPlugin: () => plugin,
    getAuth: () => { onGetAuth(); return auth; },
    randomId: () => {
      const id = ids.shift();
      if (!id) throw new Error('test ran out of deterministic ids');
      return id;
    },
    digest: async (value: string) => `sha256:${value}`,
  };
}

check(await sha256Hex('nonce')
  === '78377b525757b494427f89014f97d79928f3938d14eb51e20fb5dec9834eb304',
'Apple nonce hashing must be lowercase SHA-256 hex');
check(APPLE_SERVICE_ID === 'com.appavaria.knucklebones.web'
  && APPLE_OAUTH_REDIRECT_URL === `${SUPABASE_URL}/auth/v1/callback`,
'Apple web identity constants are not canonical/derived', {
  serviceId: APPLE_SERVICE_ID,
  redirect: APPLE_OAUTH_REDIRECT_URL,
});

/* iOS uses native AuthenticationServices: no Services ID initialization,
   redirect URL, or WebView state is sent. Supabase still gets the raw nonce. */
const iosOptions: unknown[] = [];
let iosInitializes = 0;
const iosPlugin: AppleSignInBridge = {
  initialize: async () => { iosInitializes++; },
  signIn: async (options) => {
    iosOptions.push(options);
    return { idToken: 'ios-token' };
  },
};
const iosAuth = fakeAuth();
const iosIds = ['ios-raw', 'ios-state'];
const ios = createAppleIdentity(identityPorts('ios', iosPlugin, iosAuth.auth, iosIds));
check(ios.available() && await ios.restore() === null,
  'iOS Apple restore did not complete');
check(iosInitializes === 0 && JSON.stringify(iosOptions) === JSON.stringify([{
  scopes: ['EMAIL', 'FULL_NAME'],
  nonce: 'sha256:ios-raw',
}]), 'iOS received Android/web-only Apple arguments', iosOptions);
check(JSON.stringify(iosAuth.calls.signIn) === JSON.stringify([{
  provider: 'apple', token: 'ios-token', nonce: 'ios-raw',
}]) && iosIds.length === 0,
'iOS did not hash the nonce for Apple and retain the fresh raw nonce for Supabase',
{ calls: iosAuth.calls, remainingIds: iosIds });

/* Android initializes the Services ID and validates an exact, fresh state
   before the ID token can cross the Supabase boundary. */
const androidInitializes: unknown[] = [];
const androidOptions: Array<Record<string, unknown> | undefined> = [];
const androidPlugin: AppleSignInBridge = {
  initialize: async (options) => { androidInitializes.push(options); },
  signIn: async (options) => {
    androidOptions.push(options);
    return { idToken: `android-token-${androidOptions.length}`, state: options?.state };
  },
};
const androidAuth = fakeAuth();
const androidIds = ['raw-1', 'state-1', 'raw-2', 'state-2'];
const android = createAppleIdentity(identityPorts(
  'android', androidPlugin, androidAuth.auth, androidIds,
));
check(await android.restore() === null && await android.restore() === null,
  'Android Apple restore failed');
check(JSON.stringify(androidInitializes) === JSON.stringify([
  { clientId: APPLE_SERVICE_ID }, { clientId: APPLE_SERVICE_ID },
]), 'Android did not initialize Apple with the Services ID on each attempt', androidInitializes);
check(androidOptions.every((options, index) =>
  options?.redirectUrl === APPLE_OAUTH_REDIRECT_URL
  && options?.nonce === `sha256:raw-${index + 1}`
  && options?.state === `state-${index + 1}`
  && JSON.stringify(options?.scopes) === JSON.stringify(['EMAIL', 'FULL_NAME'])),
'Android Apple arguments or fresh nonce/state values are wrong', androidOptions);
check(androidAuth.calls.signIn[0]?.nonce === 'raw-1'
  && androidAuth.calls.signIn[1]?.nonce === 'raw-2' && androidIds.length === 0,
'Android did not send each raw nonce to Supabase', androidAuth.calls.signIn);

let invalidAuthReads = 0;
const invalidAuth = fakeAuth();
const mismatched = createAppleIdentity(identityPorts('android', {
  initialize: async () => undefined,
  signIn: async () => ({ idToken: 'forged-token', state: 'attacker-state' }),
}, invalidAuth.auth, ['raw-bad', 'expected-state'], () => { invalidAuthReads++; }));
check(await mismatched.restore() === APPLE_IDENTITY_MESSAGES.invalid
  && invalidAuthReads === 0 && invalidAuth.calls.signIn.length === 0,
'an Android state mismatch reached Supabase', invalidAuth.calls);

const missingToken = createAppleIdentity(identityPorts('ios', {
  initialize: async () => undefined,
  signIn: async () => ({ idToken: '' }),
}, invalidAuth.auth, ['raw-empty', 'state-empty'], () => { invalidAuthReads++; }));
check(await missingToken.restore() === APPLE_IDENTITY_MESSAGES.invalid
  && invalidAuthReads === 0,
'a missing Apple ID token reached Supabase', { invalidAuthReads });

const canceled = createAppleIdentity(identityPorts('ios', {
  initialize: async () => undefined,
  signIn: async () => { throw Object.assign(new Error('localized text'), {
    code: 'SIGN_IN_CANCELED',
  }); },
}, invalidAuth.auth, ['raw-cancel', 'state-cancel'], () => { invalidAuthReads++; }));
check(await canceled.restore() === '' && invalidAuthReads === 0,
'Apple cancellation was surfaced or reached Supabase');

let configSignInCalls = 0;
const misconfigured = createAppleIdentity(identityPorts('android', {
  initialize: async () => { throw new Error('redirect is not registered'); },
  signIn: async () => { configSignInCalls++; return { idToken: 'never' }; },
}, invalidAuth.auth, ['raw-config', 'state-config'], () => { invalidAuthReads++; }));
check(await misconfigured.restore() === APPLE_IDENTITY_MESSAGES.configuration
  && configSignInCalls === 0 && invalidAuthReads === 0,
'Android initialization did not fail closed with a stable configuration error');

/* A signed-in guest is linked in place. Even when Apple belongs to another
   account, there is no restore fallback that could replace the guest session. */
const guestSession = { access_token: 'guest-session' };
const conflictAuth = fakeAuth({
  session: guestSession,
  linkError: { code: 'identity_already_exists' },
});
const conflictPlugin: AppleSignInBridge = {
  initialize: async () => undefined,
  signIn: async () => ({ idToken: 'owned-token' }),
};
const conflict = createAppleIdentity(identityPorts(
  'ios', conflictPlugin, conflictAuth.auth, ['raw-conflict', 'state-conflict'],
));
check(await conflict.attach() === APPLE_IDENTITY_MESSAGES.conflict
  && conflictAuth.calls.getSession === 1
  && conflictAuth.calls.link.length === 1
  && conflictAuth.calls.signIn.length === 0,
'an Apple identity conflict replaced or signed out the current guest', conflictAuth.calls);

const sessionlessAuth = fakeAuth({ session: null });
const sessionless = createAppleIdentity(identityPorts(
  'ios', conflictPlugin, sessionlessAuth.auth, ['raw-fresh', 'state-fresh'],
));
check(await sessionless.attach() === null
  && sessionlessAuth.calls.signIn.length === 1
  && sessionlessAuth.calls.link.length === 0,
'sessionless account creation did not use signInWithIdToken', sessionlessAuth.calls);

const brokenSessionAuth = fakeAuth({ sessionError: { code: 'session_read_failed' } });
const brokenSession = createAppleIdentity(identityPorts(
  'ios', conflictPlugin, brokenSessionAuth.auth, ['raw-session', 'state-session'],
));
check(await brokenSession.attach() === APPLE_IDENTITY_MESSAGES.failed
  && brokenSessionAuth.calls.signIn.length === 0
  && brokenSessionAuth.calls.link.length === 0,
'a failed session read was mistaken for sessionless account creation', brokenSessionAuth.calls);

const linkingOffAuth = fakeAuth({
  session: guestSession,
  linkError: { code: 'manual_linking_disabled' },
});
const linkingOff = createAppleIdentity(identityPorts(
  'ios', conflictPlugin, linkingOffAuth.auth, ['raw-linking', 'state-linking'],
));
check(await linkingOff.attach() === APPLE_IDENTITY_MESSAGES.configuration,
'manual-linking dashboard configuration did not return a stable error');

const identitySource = readFileSync('src/online/identity.ts', 'utf8');
check(!/from\s+['"]@(?:capacitor|capawesome)\//.test(identitySource),
'web identity code imports a native plugin');
check(!/result\.(?:user|email|givenName|familyName|realUserStatus)\b/.test(identitySource)
  && !/decodeJwt/.test(identitySource),
'client-decoded Apple claims are being trusted by web identity code');

const authScreenSource = readFileSync('src/online/auth-screen.ts', 'utf8');
const oneTapHandler = authScreenSource.slice(authScreenSource.indexOf('function showOneTapRow'));
const cancelGuardAt = oneTapHandler.indexOf('if (message !== null)');
const successAt = oneTapHandler.indexOf('await AUTH[mode].after(ports)');
check(cancelGuardAt >= 0 && successAt > cancelGuardAt
  && oneTapHandler.slice(cancelGuardAt, successAt).includes('return;'),
'silent Apple cancellation falls through to the authenticated success transition');

console.log(JSON.stringify({
  serviceId: APPLE_SERVICE_ID,
  redirectUrl: APPLE_OAUTH_REDIRECT_URL,
  iosOptions,
  androidOptions,
  problems,
}, null, 2));
process.exit(problems.length ? 1 : 0);
