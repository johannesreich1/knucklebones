// Cross-device Settings sync. The absent row is the initialization marker:
// the first signed-in device inserts its already-local choices; every later
// device reads that row. Writes serialize behind initialization so a slow
// first fetch can never overwrite a tap made while it was in flight.
import { applyUserPreferences, parseUserPreferences, userPreferences, type UserPreferences } from '../preferences.ts';
import { saveStats } from '../persist.ts';
import { syncSettingsUI } from '../flow/menu.ts';
import { updateRecord } from '../ui/game/hud.ts';
import { supa } from './client.ts';
import { currentUser } from './session.ts';

interface SettingsRow {
  user_id: string;
  sound: boolean;
  numerals: boolean;
  p1_hue: string;
  p2_hue: string;
  colorblind: boolean;
  reduced_motion: boolean | null;
}

const COLUMNS = 'user_id, sound, numerals, p1_hue, p2_hue, colorblind, reduced_motion';

function row(userId: string, value: UserPreferences): SettingsRow {
  return {
    user_id: userId,
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
    sound: value.sound,
    numerals: value.numerals,
    p1Hue: value.p1_hue,
    p2Hue: value.p2_hue,
    colorblind: value.colorblind,
    reducedMotion: value.reduced_motion,
  });
}

let pending: Promise<void> = Promise.resolve();
function serial(task: () => Promise<void>): Promise<void> {
  pending = pending.then(task, task);
  return pending;
}

export function syncAccountPreferences(): Promise<void> {
  return serial(async () => {
    const user = await currentUser();
    if (!user) return;
    const { error: seedError } = await supa().from('player_settings').upsert(
      row(user.id, userPreferences()),
      { onConflict: 'user_id', ignoreDuplicates: true },
    );
    if (seedError) return;

    const { data, error } = await supa().from('player_settings')
      .select(COLUMNS).eq('user_id', user.id).maybeSingle();
    if (error || !data) return;
    const saved = preferences(data as SettingsRow);
    if (!saved) return;
    applyUserPreferences(saved);
    saveStats();
    syncSettingsUI();
    updateRecord();
  });
}

export function saveAccountPreferences(): Promise<void> {
  return serial(async () => {
    const user = await currentUser();
    if (!user) return;
    await supa().from('player_settings').upsert(row(user.id, userPreferences()), { onConflict: 'user_id' });
  });
}
