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

/* WHY A REASON AND NOT A MESSAGE.
   GameKit refuses a proof for four genuinely different things, and two of them
   the player can FIX: sign in to Game Center in iOS Settings, or lift whatever
   is keeping the scoped identifiers from persisting. The other two — no plugin
   at all, and a signature Apple would not produce — have no user remedy, and
   telling that player to "try again" is a lie the app repeats forever. The
   device already knows which it is; this type is how that fact survives the
   trip to the copy layer instead of being flattened into one catch. */
export type GameCenterProofReason =
  | 'unavailable'
  | 'not-authenticated'
  | 'identifiers-not-persistent'
  | 'signature';

const REASONS = new Set<GameCenterProofReason>([
  'unavailable', 'not-authenticated', 'identifiers-not-persistent', 'signature',
]);

/** The reason a proof attempt failed, or null for a rejection from elsewhere. */
export function gameCenterProofReason(error: unknown): GameCenterProofReason | null {
  const reason = (error as { gameCenterProof?: unknown } | null)?.gameCenterProof;
  return typeof reason === 'string' && REASONS.has(reason as GameCenterProofReason)
    ? reason as GameCenterProofReason : null;
}

/* Duck-typed rather than an `instanceof` class: the coordinator is imported
   with a cache-busting query in tests and could exist twice, and a reason that
   only survives one module instance is exactly the diagnosis being lost. */
function proofFailure(reason: GameCenterProofReason, detail: string): Error {
  const error = new Error(`game-center-${reason}: ${detail}`) as Error
    & { gameCenterProof: GameCenterProofReason };
  error.gameCenterProof = reason;
  return error;
}

/* The plugin rejects with a STABLE CODE (GameCenterPlugin.swift); the message
   beside it is a human diagnostic and, for Apple's own failure, localized —
   so it is carried for the log and never parsed for meaning. The literal
   fallbacks below read the three messages this repo writes itself, so a web
   payload newer than the installed binary still classifies rather than
   collapsing every refusal into the signature bucket. */
const NATIVE_REASONS: Record<string, GameCenterProofReason> = {
  'not-authenticated': 'not-authenticated',
  'identifiers-not-persistent': 'identifiers-not-persistent',
  'signature-unavailable': 'signature',
};
function classifyNative(error: unknown): Error {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message
    : typeof error === 'string' ? error : String((error as { message?: unknown })?.message ?? '');
  const reason = (typeof code === 'string' ? NATIVE_REASONS[code] : undefined)
    ?? (/not signed in to Game Center/i.test(message) ? 'not-authenticated'
      : /identifiers are not persistent/i.test(message) ? 'identifiers-not-persistent'
        : 'signature');
  return proofFailure(reason, message || (typeof code === 'string' ? code : 'no detail'));
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
    try {
      if (bridge.addListener) {
        await bridge.addListener('authStateChanged', publish);
      }
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
  if (!bridge) throw proofFailure('unavailable', 'no GameCenter plugin on this platform');
  const current = await waitForGameCenter();
  /* Every lifecycle state short of authenticated points the player at the same
     place — Game Center in iOS Settings — so they share one remedy, while the
     state that actually occurred rides along as the detail the log prints. */
  if (current.status !== 'authenticated') {
    throw proofFailure('not-authenticated', `lifecycle status ${current.status}`);
  }
  try {
    return await bridge.fetchIdentityProof();
  } catch (error) { throw classifyNative(error); }
}
