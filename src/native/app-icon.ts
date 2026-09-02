// Profile-driven launcher icons are a native capability, not a web package.
// Capacitor injects the bridge into native WebViews; ordinary web/PWA/widget
// builds see no plugin and keep the checked-in primary icon without throwing.
import {
  appIconIdForAvatar,
  type AppIconId,
} from '../profile-avatar.ts';

export type { AppIconId } from '../profile-avatar.ts';

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
  syncAvatar(avatar: unknown): Promise<AppIconSyncResult>;
  reset(): Promise<AppIconSyncResult>;
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
 * Serialize native mutations and let only the latest requested profile win.
 * A call already inside the OS cannot be cancelled, so a newer request waits
 * behind it and then restores the final truth (notably sign-out → primary).
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
        // Icon appearance never gates account/profile success. The next
        // cached or remote reconciliation gets a fresh attempt.
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
    syncAvatar: (avatar) => syncIcon(appIconIdForAvatar(avatar)),
    reset: () => syncIcon('primary'),
  };
}

const profileAppIcon = createAppIconSynchronizer();

/** Device/install preference: account preference sync must never opt in a
 * second phone. Absence (including upgrades from the automatic prototype) is
 * OFF; native boot restores the primary icon while OFF. */
export const PROFILE_APP_ICON_ENABLED_KEY = 'knucklebones.native.profile-app-icon.enabled';

function localStore(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; }
  catch { return undefined; }
}

export function profileAppIconEnabled(): boolean {
  try { return localStore()?.getItem(PROFILE_APP_ICON_ENABLED_KEY) === '1'; }
  catch { return false; }
}

export function profileAppIconAvailable(): boolean {
  return globalBridge() !== undefined;
}

function persistProfileAppIconEnabled(enabled: boolean): boolean {
  const storage = localStore();
  if (!storage) return !enabled;
  try {
    if (enabled) storage.setItem(PROFILE_APP_ICON_ENABLED_KEY, '1');
    else storage.removeItem(PROFILE_APP_ICON_ENABLED_KEY);
    return enabled
      ? storage.getItem(PROFILE_APP_ICON_ENABLED_KEY) === '1'
      : storage.getItem(PROFILE_APP_ICON_ENABLED_KEY) !== '1';
  } catch { return false; }
}

export function syncProfileAppIcon(avatar: unknown): Promise<AppIconSyncResult> {
  const icon = appIconIdForAvatar(avatar);
  if (!profileAppIconEnabled()) return Promise.resolve(result('disabled', icon));
  return profileAppIcon.syncAvatar(avatar);
}

export function resetProfileAppIcon(): Promise<AppIconSyncResult> {
  return profileAppIcon.reset();
}

/** The Settings gesture persists first, then joins the latest-wins native
 * queue. OFF deliberately bypasses the sync gate so primary always wins over
 * an alternate request already inside the OS. */
export function setProfileAppIconEnabled(
  enabled: boolean,
  avatar: unknown,
): Promise<AppIconSyncResult> {
  const icon = enabled ? appIconIdForAvatar(avatar) : 'primary';
  if (!persistProfileAppIconEnabled(enabled)) {
    return Promise.resolve(result('failed', icon));
  }
  return enabled ? profileAppIcon.syncAvatar(avatar) : profileAppIcon.reset();
}
