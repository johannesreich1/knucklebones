import type {
  GameCenterAuthState,
  GameCenterBridge,
  GameCenterProof,
} from '../src/native/game-center.ts';

const problems: string[] = [];
const check = (ok: boolean, message: string) => { if (!ok) problems.push(message); };

let initializeCalls = 0;
let proofCalls = 0;
let listener: ((state: GameCenterAuthState) => void) | null = null;
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
const coordinator = await import('../src/native/game-center.ts?lifecycle-test');
const first = coordinator.initializeGameCenter();
const second = coordinator.initializeGameCenter();
check(first === second, 'Game Center launch initialization is not idempotent');
await first;
check(initializeCalls === 1 && coordinator.gameCenterState().status === 'authenticating',
  'Game Center lifecycle did not publish the bridge initialization state');

const waiting = coordinator.waitForGameCenter(1_000);
listener?.({ status: 'authenticated', revision: 2 });
check((await waiting).status === 'authenticated',
  'Game Center lifecycle did not wake when native authentication completed');
check((await coordinator.fetchGameCenterProof()).teamPlayerID === 'team-player' && proofCalls === 1,
  'Game Center proof was not gated by the shared authenticated lifecycle state');

listener?.({ status: 'signed-out', revision: 3 });
let rejected = false;
try { await coordinator.fetchGameCenterProof(); } catch { rejected = true; }
check(rejected && proofCalls === 1,
  'Game Center proof remained available after the native account signed out');

delete (globalThis as typeof globalThis & { Capacitor?: unknown }).Capacitor;
console.log(JSON.stringify({ problems }, null, 2));
process.exit(problems.length ? 1 : 0);
