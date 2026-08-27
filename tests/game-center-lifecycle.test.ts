import type {
  GameCenterAuthState,
  GameCenterBridge,
  GameCenterProof,
  GameCenterProofReason,
} from '../src/native/game-center.ts';
import {
  GAME_CENTER_IDENTITY_MESSAGES,
  createGameCenterIdentity,
  type GameCenterIdentityPorts,
} from '../src/online/identity/identity.ts';
import { gameCenterSessionAction } from '../src/online/identity/session.ts';
import { runGameCenterRecoveryTests } from './support/game-center-recovery.ts';
import { readFileSync } from 'node:fs';

const problems: string[] = [];
const check = (ok: boolean, message: string, detail?: unknown) => {
  if (!ok) problems.push(detail === undefined ? message : `${message} :: ${JSON.stringify(detail)}`);
};

let initializeCalls = 0;
let proofCalls = 0;
let listener: ((state: GameCenterAuthState) => void) | null = null;
// Calling through a function restores the declared type: the assignment in
// addListener below is invisible to control-flow narrowing at the call sites.
const notifyListener = (state: GameCenterAuthState): void => { listener?.(state); };
// Query-string suffixes force a fresh module instance per scenario; resolve
// through a widened specifier so tsc types the module without the suffix.
const importFreshCoordinator = (
  query: string,
): Promise<typeof import('../src/native/game-center.ts')> =>
  import(`../src/native/game-center.ts?${query}`);
const proof: GameCenterProof = {
  publicKeyUrl: 'https://static.gc.apple.com/public-key/gc-prod-12.cer',
  signature: 'signature', salt: 'salt', timestamp: '123', teamPlayerID: 'team-player',
};
const bridge: GameCenterBridge = {
  initialize: async () => {
    initializeCalls++;
    return { status: 'authenticating', revision: 1 };
  },
  getAuthState: async () => ({ status: 'authenticating', revision: 1 }),
  fetchIdentityProof: async () => { proofCalls++; return proof; },
  addListener: async (_event, next) => { listener = next; return { remove() {} }; },
};
(globalThis as typeof globalThis & { Capacitor?: unknown }).Capacitor = {
  getPlatform: () => 'ios', Plugins: { GameCenter: bridge },
};
const coordinator = await importFreshCoordinator('lifecycle-test');
const first = coordinator.initializeGameCenter();
const second = coordinator.initializeGameCenter();
check(first === second, 'Game Center launch initialization is not idempotent');
await first;
check(initializeCalls === 1 && coordinator.gameCenterState().status === 'authenticating',
  'Game Center lifecycle did not publish the bridge initialization state');

const waiting = coordinator.waitForGameCenter(1_000);
notifyListener({ status: 'authenticated', revision: 2 });
check((await waiting).status === 'authenticated',
  'Game Center lifecycle did not wake when native authentication completed');
check((await coordinator.fetchGameCenterProof()).teamPlayerID === 'team-player' && proofCalls === 1,
  'Game Center proof was not gated by the shared authenticated lifecycle state');

notifyListener({ status: 'signed-out', revision: 3 });
let signedOutRejection: unknown = null;
try { await coordinator.fetchGameCenterProof(); } catch (error) { signedOutRejection = error; }
check(!!signedOutRejection && proofCalls === 1,
  'Game Center proof remained available after the native account signed out');
/* The lifecycle's own refusal carries the same remedy the plugin's does — the
   player is not signed in — and names the state that occurred for the log. */
check(coordinator.gameCenterProofReason(signedOutRejection) === 'not-authenticated'
  && /signed-out/.test(signedOutRejection instanceof Error ? signedOutRejection.message : ''),
  'a signed-out lifecycle refusal lost both its remedy and its diagnostic', signedOutRejection);

const swift = readFileSync(
  'native/plugins/gamecenter/ios/Sources/GameCenterPlugin/GameCenterPlugin.swift',
  'utf8',
);
check(/private var playerIdentity: String\?/.test(swift)
  && /next != status \|\| nextIdentity != playerIdentity/.test(swift)
  && /updateStatus\("authenticated", playerIdentity: player\.teamPlayerID\)/.test(swift),
'the native lifecycle revision does not detect an authenticated Game Center account change');

/* ---- WHAT THE DEVICE SAID, AND WHAT THE PLAYER IS THEREFORE TOLD ----
   A refused proof never leaves the phone: no gateway request, no Edge log,
   nothing for anyone to read afterwards. The device is nevertheless precise
   about WHY, and two of its four refusals have a real remedy the player can
   go and perform. Collapsing all four into "sign-in failed, please try
   again" — which is how this shipped, and what a real device answered a real
   owner with — hands the one player who could have fixed it advice that
   cannot work. Every row below is driven end to end: the plugin's actual
   rejection shape in, the reason out, and the copy that reason earns. */
const REFUSALS: ReadonlyArray<{
  why: string;
  code?: string;
  message: string;
  reason: GameCenterProofReason;
  copy: () => string;
}> = [
  { why: 'a local player not signed in to Game Center', code: 'not-authenticated',
    message: 'not signed in to Game Center',
    reason: 'not-authenticated', copy: () => GAME_CENTER_IDENTITY_MESSAGES.signIn },
  { why: 'scoped identifiers GameKit will not vouch for', code: 'identifiers-not-persistent',
    message: 'Game Center identifiers are not persistent',
    reason: 'identifiers-not-persistent', copy: () => GAME_CENTER_IDENTITY_MESSAGES.identifiers },
  /* Apple's own localized text. It is carried for the LOG and never parsed:
     the code beside it is what decides, which is the whole reason the plugin
     sends one. */
  { why: "Apple's own signing failure", code: 'signature-unavailable',
    message: 'This application is not recognized by Game Center.',
    reason: 'signature', copy: () => GAME_CENTER_IDENTITY_MESSAGES.signature },
  { why: 'a signature callback that returned nothing', code: 'signature-unavailable',
    message: 'Game Center returned no signature',
    reason: 'signature', copy: () => GAME_CENTER_IDENTITY_MESSAGES.signature },
  /* A BINARY OLDER THAN THIS PAYLOAD. The plugin is compiled into the app and
     the web layer is not, so a device can run today's bundle against a build
     whose rejections carry no code at all. The three messages this repo writes
     itself still classify; only Apple's own text falls to the signature
     bucket, which is where an unrecognized failure belongs anyway. */
  { why: 'an un-coded rejection from an older installed binary',
    message: 'not signed in to Game Center',
    reason: 'not-authenticated', copy: () => GAME_CENTER_IDENTITY_MESSAGES.signIn },
  { why: 'an un-coded persistence rejection',
    message: 'Game Center identifiers are not persistent',
    reason: 'identifiers-not-persistent', copy: () => GAME_CENTER_IDENTITY_MESSAGES.identifiers },
  { why: 'an un-coded rejection nobody has seen before',
    message: 'something GameKit has never said',
    reason: 'signature', copy: () => GAME_CENTER_IDENTITY_MESSAGES.signature },
];

const authenticatedBridge = (fetchIdentityProof: () => Promise<GameCenterProof>): unknown => ({
  getPlatform: () => 'ios',
  Plugins: {
    GameCenter: {
      initialize: async () => ({ status: 'authenticated', revision: 1 }),
      getAuthState: async () => ({ status: 'authenticated', revision: 1 }),
      addListener: async () => ({ remove() { /* nothing to release */ } }),
      fetchIdentityProof,
    },
  },
});

/* The provider under a refused proof. `request` is a tripwire: a proof that
   never happened may not put anything on the wire, and a rejection there would
   surface as the generic copy instead of the specific one. */
const providerFor = (error: unknown) => createGameCenterIdentity({
  available: () => true,
  getProof: async () => { throw error; },
  getAuth: () => ({
    getSession: async () => ({ data: { session: null }, error: null }),
  }) as unknown as ReturnType<GameCenterIdentityPorts['getAuth']>,
  request: async () => { throw new Error('a refused proof reached the identity gateway'); },
});

for (const [index, refusal] of REFUSALS.entries()) {
  (globalThis as typeof globalThis & { Capacitor?: unknown }).Capacitor =
    authenticatedBridge(async () => {
      const error = new Error(refusal.message) as Error & { code?: string };
      if (refusal.code) error.code = refusal.code;
      throw error;
    });
  const module = await importFreshCoordinator(`refusal-${index}`);
  let thrown: unknown = null;
  try { await module.fetchGameCenterProof(); } catch (error) { thrown = error; }
  const reason = module.gameCenterProofReason(thrown);
  check(reason === refusal.reason,
    `${refusal.why} was not classified as ${refusal.reason}`,
    { reason, message: thrown instanceof Error ? thrown.message : thrown });
  check((thrown instanceof Error ? thrown.message : '').includes(refusal.message),
    `${refusal.why} lost the device's own diagnostic, so nothing can be logged`, thrown);
  const said = await providerFor(thrown).attach();
  check(said === refusal.copy(),
    `${refusal.why} reached the player as the wrong copy`, { reason, said });
}

/* The two refusals the coordinator itself owns, before the plugin is asked. */
delete (globalThis as typeof globalThis & { Capacitor?: unknown }).Capacitor;
const bridgeless = await importFreshCoordinator('no-bridge');
let bridgelessError: unknown = null;
try { await bridgeless.fetchGameCenterProof(); } catch (error) { bridgelessError = error; }
check(bridgeless.gameCenterProofReason(bridgelessError) === 'unavailable'
  && await providerFor(bridgelessError).attach() === GAME_CENTER_IDENTITY_MESSAGES.unavailable,
'a device with no GameKit at all was told to try again');

/* Every distinct refusal must READ distinctly. A map that compiles while two
   of its rows resolve to the same sentence is the original bug wearing types. */
const COPIES = [
  GAME_CENTER_IDENTITY_MESSAGES.unavailable,
  GAME_CENTER_IDENTITY_MESSAGES.signIn,
  GAME_CENTER_IDENTITY_MESSAGES.identifiers,
  GAME_CENTER_IDENTITY_MESSAGES.signature,
  GAME_CENTER_IDENTITY_MESSAGES.failed,
  GAME_CENTER_IDENTITY_MESSAGES.invalid,
  GAME_CENTER_IDENTITY_MESSAGES.conflict,
];
check(new Set(COPIES).size === COPIES.length && COPIES.every((copy) => !!copy.trim()),
'two Game Center refusals share one sentence, so the player cannot tell them apart', COPIES);
/* The remedy is the point: the two fixable refusals must name where to go. */
check(/Settings/.test(GAME_CENTER_IDENTITY_MESSAGES.signIn)
  && /Settings/.test(GAME_CENTER_IDENTITY_MESSAGES.identifiers),
'a refusal the player could fix does not tell them where to fix it');

check(/call\.reject\("not signed in to Game Center", "not-authenticated"\)/.test(swift)
  && /call\.reject\("Game Center identifiers are not persistent", "identifiers-not-persistent"\)/.test(swift)
  && /call\.reject\(error\.localizedDescription, "signature-unavailable", error\)/.test(swift)
  && /call\.reject\("Game Center returned no signature", "signature-unavailable"\)/.test(swift),
'a native proof refusal ships without the stable code the web layer classifies on');

delete (globalThis as typeof globalThis & { Capacitor?: unknown }).Capacitor;

(globalThis as typeof globalThis & { Capacitor?: unknown }).Capacitor = {
  getPlatform: () => 'ios',
  Plugins: {
    GameCenter: {
      ...bridge,
      addListener: async () => { throw new Error('listener unavailable'); },
    },
  },
};
const listenerFailure = await importFreshCoordinator('listener-failure-test');
check((await listenerFailure.initializeGameCenter()).status === 'failed',
  'Game Center launch leaked a rejected native-listener setup');

const linkedStatus = {
  gameCenterLinked: true,
  appleLinked: false,
  appleRevocationReady: false,
};
check(gameCenterSessionAction(null, 2, 3) === 'retry',
  'an unknown identity-status read allowed a changed Game Center account to continue');
check(gameCenterSessionAction({ ...linkedStatus, gameCenterLinked: false }, 2, 3) === 'continue',
  'a confirmed unlinked account was incorrectly blocked by Game Center reassertion');
check(gameCenterSessionAction(linkedStatus, 2, 3) === 'assert'
  && gameCenterSessionAction(linkedStatus, 3, 3) === 'continue',
  'a linked account did not reassert exactly when the native Game Center revision changed');

delete (globalThis as typeof globalThis & { Capacitor?: unknown }).Capacitor;

/* What the same lifecycle means for a player who cannot yet prove who they
   are: arriving with no account, and reinstalling with only a guest token. */
await runGameCenterRecoveryTests(check);

console.log(JSON.stringify({ problems }, null, 2));
process.exit(problems.length ? 1 : 0);
