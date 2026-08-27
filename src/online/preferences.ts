// Cross-device Settings sync. The absent row is the initialization marker:
// the first signed-in device inserts its already-local choices; every later
// device reads that row. Writes serialize behind initialization so a slow
// first fetch can never overwrite a tap made while it was in flight.
import {
  applyUserPreferences,
  parseUserPreferences,
  userPreferences,
  userPreferencesRevision,
  type UserPreferences,
  type UserPreferencesSnapshot,
} from '../preferences.ts';
import { saveStats } from '../persist.ts';
import { syncSettingsUI } from '../flow/menu.ts';
import { updateRecord } from '../ui/game/hud.ts';
import { supa } from './api/client.ts';
import { currentUser } from './identity/session.ts';

interface SettingsRow {
  user_id: string;
  locale: string | null;
  sound: boolean;
  numerals: boolean;
  p1_hue: string;
  p2_hue: string;
  colorblind: boolean;
  reduced_motion: boolean | null;
}

const COLUMNS = 'user_id, locale, sound, numerals, p1_hue, p2_hue, colorblind, reduced_motion';

function row(userId: string, value: Readonly<UserPreferences>): SettingsRow {
  return {
    user_id: userId,
    locale: value.localeOverride,
    sound: value.sound,
    numerals: value.numerals,
    p1_hue: value.p1Hue,
    p2_hue: value.p2Hue,
    colorblind: value.colorblind,
    reduced_motion: value.reducedMotion,
  };
}

function preferences(value: SettingsRow): UserPreferences | null {
  return parseUserPreferences({
    localeOverride: value.locale,
    sound: value.sound,
    numerals: value.numerals,
    p1Hue: value.p1_hue,
    p2Hue: value.p2_hue,
    colorblind: value.colorblind,
    reducedMotion: value.reduced_motion,
  });
}

interface PreferenceUser { id: string }

export interface AccountPreferenceSyncPorts {
  currentUser: () => Promise<PreferenceUser | null>;
  readLocal: () => UserPreferences;
  currentRevision: () => number;
  seed: (userId: string, value: Readonly<UserPreferences>) => Promise<boolean>;
  load: (userId: string) => Promise<UserPreferences | null>;
  write: (userId: string, value: Readonly<UserPreferences>) => Promise<void>;
  apply: (value: UserPreferences) => void;
}

/* One coordinator owns initialization and writes. A hydration remembers the
   local mutation revision from when it began; if a tap happens while its read
   is in flight, that stale remote value is not allowed to repaint the tap.
   Writes receive the immutable value captured at the tap and never inspect S
   after waiting behind hydration. */
export function createAccountPreferenceSync(ports: AccountPreferenceSyncPorts): {
  sync: (startedRevision?: number) => Promise<void>;
  save: (snapshot: UserPreferencesSnapshot) => Promise<void>;
} {
  let pending: Promise<void> = Promise.resolve();
  const serial = (task: () => Promise<void>): Promise<void> => {
    pending = pending.then(task, task);
    return pending;
  };

  const sync = (startedRevision = ports.currentRevision()): Promise<void> => {
    const initialLocal = ports.readLocal();
    return serial(async () => {
      const user = await ports.currentUser();
      if (!user || !await ports.seed(user.id, initialLocal)) return;
      const saved = await ports.load(user.id);
      const activeUser = await ports.currentUser();
      if (!saved || activeUser?.id.toLowerCase() !== user.id.toLowerCase()
          || ports.currentRevision() !== startedRevision) return;
      ports.apply(saved);
    });
  };

  const save = (snapshot: UserPreferencesSnapshot): Promise<void> => serial(async () => {
    const user = await ports.currentUser();
    if (!user) return;
    await ports.write(user.id, snapshot.value);
  });

  return { sync, save };
}

const accountPreferences = createAccountPreferenceSync({
  currentUser,
  readLocal: userPreferences,
  currentRevision: userPreferencesRevision,
  seed: async (userId, value) => {
    const { error } = await supa().from('player_settings').upsert(
      row(userId, value),
      { onConflict: 'user_id', ignoreDuplicates: true },
    );
    return !error;
  },
  load: async (userId) => {
    const { data, error } = await supa().from('player_settings')
      .select(COLUMNS).eq('user_id', userId).maybeSingle();
    return error || !data ? null : preferences(data as SettingsRow);
  },
  write: async (userId, value) => {
    await supa().from('player_settings').upsert(row(userId, value), { onConflict: 'user_id' });
  },
  apply: (saved) => {
    applyUserPreferences(saved);
    saveStats();
    syncSettingsUI();
    updateRecord();
  },
});

export function syncAccountPreferences(startedRevision?: number): Promise<void> {
  return accountPreferences.sync(startedRevision);
}

export function saveAccountPreferences(snapshot: UserPreferencesSnapshot): Promise<void> {
  return accountPreferences.save(snapshot);
}
