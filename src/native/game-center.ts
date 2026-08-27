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

/* WHY PERSISTENCE IS A FLAG ON THE STATE AND NOT A SEVENTH STATUS.
   `status` answers one question — what did GameKit's authentication of the
   LOCAL PLAYER come to — and for this device it came to `authenticated`: iOS
   showed its banner and greeted the player by name. What GameKit additionally
   refuses is to vouch for a stable identifier for them (Screen Time's
   multiplayer limit is the usual cause), and spelling that as a status value
   would make every `status === 'authenticated'` test in this app answer "no".
   Two of those tests are load-bearing: fetchGameCenterProof would refuse with
   `not-authenticated`, telling a signed-in player to go and sign in, and
   ensureIdentity would stop distinguishing a device with no GameKit from one
   whose player it simply may not bind.

   `null` is not `false`. The plugin is compiled into the app and this payload
   is not, so a device can run today's bundle against a binary that predates
   the reading — and a profile that stood a refusal the device never made would
   withdraw a control that works. Only an explicit `false` is a refusal. */
export interface GameCenterAuthState {
  readonly status: GameCenterStatus;
  readonly revision: number;
  /* Whether GameKit will vouch for a stable id. OPTIONAL because this is the
     shape the native plugin sends and an older installed binary sends two
     fields, not three; absent and null both mean "did not say", and only an
     explicit `false` is a refusal anyone may act on. */
  readonly persistentIdentity?: boolean | null;
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

let state: GameCenterAuthState = { status: 'unavailable', revision: 0, persistentIdentity: null };
let started: Promise<GameCenterAuthState> | null = null;
const subscribers = new Set<(state: GameCenterAuthState) => void>();

/* Read at the native boundary rather than trusted verbatim: an older installed
   binary sends two fields where this one expects three, and an absent flag is
   UNKNOWN. The plugin still enforces persistence at proof time either way, so
   nothing about binding relaxes — only the standing copy stays unspoken. */
function readState(next: GameCenterAuthState): GameCenterAuthState {
  return {
    status: next.status,
    revision: next.revision,
    persistentIdentity: typeof next.persistentIdentity === 'boolean'
      ? next.persistentIdentity : null,
  };
}

/* An EQUAL revision is accepted, and that is the contract the native side
   depends on: GameKit re-publishes at the same revision when only persistence
   changed, because the player did not. Only a revision that has gone backwards
   is a late listener overwriting a newer read. */
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
        await bridge.addListener('authStateChanged', (next) => publish(readState(next)));
      }
      const initial = await bridge.initialize();
      publish(readState(initial));
    } catch {
      publish({ status: 'failed', revision: state.revision + 1, persistentIdentity: null });
    }
    return state;
  })();
  return started;
}

export function gameCenterState(): GameCenterAuthState { return state; }

/* THE ONE STATE THAT IS NEITHER A YES NOR A RETRY.
   GameKit authenticated this player and then said it will not vouch for a
   stable identifier for them, so every offer to LINK Game Center to an account
   is known to fail before it is made — and binding anyway would weld an
   account to an identifier that rotates. Nothing about playing is affected;
   this only decides what the app may offer. */
export function gameCenterCannotIdentify(current: GameCenterAuthState = state): boolean {
  return current.status === 'authenticated' && current.persistentIdentity === false;
}

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
