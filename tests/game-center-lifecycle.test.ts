import type {
  GameCenterAuthState,
  GameCenterBridge,
  GameCenterProof,
} from '../src/native/game-center.ts';
import { gameCenterSessionAction } from '../src/online/session.ts';
import { readFileSync } from 'node:fs';

const problems: string[] = [];
const check = (ok: boolean, message: string) => { if (!ok) problems.push(message); };

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
let rejected = false;
try { await coordinator.fetchGameCenterProof(); } catch { rejected = true; }
check(rejected && proofCalls === 1,
  'Game Center proof remained available after the native account signed out');

const swift = readFileSync(
  'native/plugins/gamecenter/ios/Sources/GameCenterPlugin/GameCenterPlugin.swift',
  'utf8',
);
check(/private var playerIdentity: String\?/.test(swift)
  && /next != status \|\| nextIdentity != playerIdentity/.test(swift)
  && /updateStatus\("authenticated", playerIdentity: player\.teamPlayerID\)/.test(swift),
'the native lifecycle revision does not detect an authenticated Game Center account change');

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
console.log(JSON.stringify({ problems }, null, 2));
process.exit(problems.length ? 1 : 0);
