// The launcher icon is a native capability, not a web package. Capacitor
// injects the bridge into native WebViews; ordinary web/PWA/widget builds see
// no plugin and keep the compiled primary icon without throwing.
//
// The icon follows the DEVICE's Settings colour pair, never the account: the
// default split die is cyan-and-magenta for everyone, and a device that opts
// in shows the same die in its own "your colour" / "opponent colour" pair
// (app-icon-registry.ts owns that vocabulary and the 42 bundled variants).
import {
  appIconIdForPair,
  displayedIconPair,
  type AppIconId,
  type IconPair,
} from '../app-icon-registry.ts';

export type { AppIconId } from '../app-icon-registry.ts';

export interface AppIconState {
  readonly supported: boolean;
  readonly icon: string;
}

export interface AppIconSetResult extends AppIconState {
  readonly changed: boolean;
}

export interface AppIconBridge {
  getState(): Promise<AppIconState>;
  setIcon(options: { icon: AppIconId }): Promise<AppIconSetResult>;
}

interface CapacitorAppIconBridge {
  Plugins?: { AppIcon?: AppIconBridge };
}

export type AppIconSyncStatus =
  | 'changed'
  | 'unchanged'
  | 'disabled'
  | 'unavailable'
  | 'superseded'
  | 'failed';

export interface AppIconSyncResult {
  readonly status: AppIconSyncStatus;
  readonly icon: AppIconId;
}

export interface AppIconSynchronizer {
  syncPair(pair: IconPair): Promise<AppIconSyncResult>;
  reset(): Promise<AppIconSyncResult>;
}

/** The three Settings facts the icon reads: the two picks and whether the
 * colour-blind palette is pinned over them. `S` satisfies this directly. */
export interface IconColourSettings {
  readonly p1Hue: string;
  readonly p2Hue: string;
  readonly colorblind: boolean;
}

export type ReadAppIconBridge = () => AppIconBridge | undefined;

const globalBridge: ReadAppIconBridge = () => {
  try {
    const capacitor = (globalThis as typeof globalThis & {
      Capacitor?: CapacitorAppIconBridge;
    }).Capacitor;
    const bridge = capacitor?.Plugins?.AppIcon;
    return bridge && typeof bridge.getState === 'function' && typeof bridge.setIcon === 'function'
      ? bridge : undefined;
  } catch { return undefined; }
};

function result(status: AppIconSyncStatus, icon: AppIconId): AppIconSyncResult {
  return { status, icon };
}

/**
 * Serialize native mutations and let only the latest requested pair win.
 * A call already inside the OS cannot be cancelled, so a newer request waits
 * behind it and then restores the final truth (notably OFF -> primary).
 */
export function createAppIconSynchronizer(
  readBridge: ReadAppIconBridge = globalBridge,
): AppIconSynchronizer {
  let revision = 0;
  let tail: Promise<void> = Promise.resolve();

  const syncIcon = (icon: AppIconId): Promise<AppIconSyncResult> => {
    const ownRevision = ++revision;
    let settle!: (value: AppIconSyncResult) => void;
    const answer = new Promise<AppIconSyncResult>((resolve) => { settle = resolve; });

    tail = tail.then(async () => {
      if (ownRevision !== revision) {
        settle(result('superseded', icon));
        return;
      }
      try {
        const bridge = readBridge();
        if (!bridge) {
          settle(result('unavailable', icon));
          return;
        }
        const current = await bridge.getState();
        if (ownRevision !== revision) {
          settle(result('superseded', icon));
          return;
        }
        if (!current || current.supported !== true) {
          settle(result('unavailable', icon));
          return;
        }
        if (current.icon === icon) {
          settle(result('unchanged', icon));
          return;
        }
        const applied = await bridge.setIcon({ icon });
        if (ownRevision !== revision) {
          settle(result('superseded', icon));
          return;
        }
        if (!applied || applied.supported !== true) {
          settle(result('unavailable', icon));
          return;
        }
        if (applied.icon !== icon) {
          settle(result('failed', icon));
          return;
        }
        settle(result(applied.changed ? 'changed' : 'unchanged', icon));
      } catch {
        // Icon appearance never gates a Settings change. The next colour
        // change or boot gets a fresh attempt.
        settle(result('failed', icon));
      }
    }, () => {
      // `tail` is kept fulfilled below, but retain a recovery branch so a
      // future internal change cannot permanently poison the coordinator.
      settle(result('failed', icon));
    });
    tail = tail.catch(() => undefined);
    return answer;
  };

  return {
    syncPair: (pair) => syncIcon(appIconIdForPair(pair)),
    reset: () => syncIcon('primary'),
  };
}

const launcherIcon = createAppIconSynchronizer();

/** Device/install preference: account preference sync must never opt in a
 * second phone. Absence is OFF; native boot restores the primary icon while
 * OFF. (The profile-driven key it replaces was never migrated: that icon
 * followed the avatar, this one follows the device's colours.) */
export const APP_ICON_COLOURS_ENABLED_KEY = 'knucklebones.native.app-icon-colours.enabled';

function localStore(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; }
  catch { return undefined; }
}

export function appIconColoursEnabled(): boolean {
  try { return localStore()?.getItem(APP_ICON_COLOURS_ENABLED_KEY) === '1'; }
  catch { return false; }
}

export function appIconAvailable(): boolean {
  return globalBridge() !== undefined;
}

function persistAppIconColoursEnabled(enabled: boolean): boolean {
  const storage = localStore();
  if (!storage) return !enabled;
  try {
    if (enabled) storage.setItem(APP_ICON_COLOURS_ENABLED_KEY, '1');
    else storage.removeItem(APP_ICON_COLOURS_ENABLED_KEY);
    return enabled
      ? storage.getItem(APP_ICON_COLOURS_ENABLED_KEY) === '1'
      : storage.getItem(APP_ICON_COLOURS_ENABLED_KEY) !== '1';
  } catch { return false; }
}

const pairOf = (settings: IconColourSettings): IconPair =>
  displayedIconPair(settings.p1Hue, settings.p2Hue, settings.colorblind);

/** Point the launcher at the pair the player sees, if the device opted in. */
export function syncAppIconColours(settings: IconColourSettings): Promise<AppIconSyncResult> {
  const pair = pairOf(settings);
  if (!appIconColoursEnabled()) return Promise.resolve(result('disabled', appIconIdForPair(pair)));
  return launcherIcon.syncPair(pair);
}

export function resetAppIcon(): Promise<AppIconSyncResult> {
  return launcherIcon.reset();
}

/** The Settings gesture persists first, then joins the latest-wins native
 * queue. OFF deliberately bypasses the sync gate so primary always wins over
 * a colour request already inside the OS. */
export function setAppIconColoursEnabled(
  enabled: boolean,
  settings: IconColourSettings,
): Promise<AppIconSyncResult> {
  const pair = pairOf(settings);
  if (!persistAppIconColoursEnabled(enabled)) {
    return Promise.resolve(result('failed', enabled ? appIconIdForPair(pair) : 'primary'));
  }
  return enabled ? launcherIcon.syncPair(pair) : launcherIcon.reset();
}
