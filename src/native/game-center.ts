// Game Center authentication belongs to the native app lifecycle, not to an
// auth button. This tiny coordinator contains no Supabase dependency so the
// offline-first boot can start GameKit without pulling the online chunk in.

export type GameCenterStatus =
  | 'unavailable'
  | 'authenticating'
  | 'authenticated'
  | 'signed-out'
  | 'declined'
  | 'failed';

export interface GameCenterAuthState {
  readonly status: GameCenterStatus;
  readonly revision: number;
}

export interface GameCenterProof {
  readonly publicKeyUrl: string;
  readonly signature: string;
  readonly salt: string;
  readonly timestamp: string;
  readonly teamPlayerID: string;
}

interface ListenerHandle { remove(): Promise<void> | void }

export interface GameCenterBridge {
  initialize(): Promise<GameCenterAuthState>;
  getAuthState(): Promise<GameCenterAuthState>;
  fetchIdentityProof(): Promise<GameCenterProof>;
  addListener?(
    event: 'authStateChanged',
    listener: (state: GameCenterAuthState) => void,
  ): Promise<ListenerHandle> | ListenerHandle;
}

interface CapacitorBridge {
  getPlatform?(): string;
  Plugins?: { GameCenter?: GameCenterBridge };
}

const capacitor = (): CapacitorBridge | undefined =>
  (globalThis as typeof globalThis & { Capacitor?: CapacitorBridge }).Capacitor;

let state: GameCenterAuthState = { status: 'unavailable', revision: 0 };
let started: Promise<GameCenterAuthState> | null = null;
const subscribers = new Set<(state: GameCenterAuthState) => void>();

function publish(next: GameCenterAuthState): void {
  if (next.revision < state.revision) return;
  state = next;
  for (const subscriber of subscribers) subscriber(state);
}

function plugin(): GameCenterBridge | null {
  return capacitor()?.getPlatform?.() === 'ios'
    ? capacitor()?.Plugins?.GameCenter ?? null
    : null;
}

export function initializeGameCenter(): Promise<GameCenterAuthState> {
  if (started) return started;
  const bridge = plugin();
  if (!bridge) return Promise.resolve(state);
  started = (async () => {
    if (bridge.addListener) {
      await bridge.addListener('authStateChanged', publish);
    }
    try {
      const initial = await bridge.initialize();
      publish(initial);
    } catch {
      publish({ status: 'failed', revision: state.revision + 1 });
    }
    return state;
  })();
  return started;
}

export function gameCenterState(): GameCenterAuthState { return state; }

export async function waitForGameCenter(
  timeoutMs = 8_000,
): Promise<GameCenterAuthState> {
  await initializeGameCenter();
  if (state.status !== 'authenticating') return state;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (next: GameCenterAuthState): void => {
      if (settled || next.status === 'authenticating') return;
      settled = true;
      clearTimeout(timer);
      subscribers.delete(finish);
      resolve(next);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      subscribers.delete(finish);
      resolve(state);
    }, timeoutMs);
    subscribers.add(finish);
  });
}

export async function fetchGameCenterProof(): Promise<GameCenterProof> {
  const bridge = plugin();
  if (!bridge) throw new Error('game-center-unavailable');
  const current = await waitForGameCenter();
  if (current.status !== 'authenticated') throw new Error('game-center-not-authenticated');
  return bridge.fetchIdentityProof();
}
