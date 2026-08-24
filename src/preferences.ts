// Account-backed Settings vocabulary. Local persistence may contain older or
// partial records; the server boundary is deliberately stricter and accepts a
// complete, known-shape value only.
import { DUELHUES, HUE_IDS, S } from './state.ts';
import {
  isLanguageOverride,
  setLanguageOverride,
  type LanguageOverride,
} from './i18n/index.ts';

export type HueId = typeof DUELHUES[number]['id'];

export interface UserPreferences {
  localeOverride: LanguageOverride;
  sound: boolean;
  numerals: boolean;
  p1Hue: HueId;
  p2Hue: HueId;
  colorblind: boolean;
  reducedMotion: boolean | null;
}

const hue = (value: unknown): value is HueId => HUE_IDS.includes(value as HueId);

export function userPreferences(): UserPreferences {
  return {
    localeOverride: S.localeOverride,
    sound: S.sound,
    numerals: S.numerals,
    p1Hue: S.p1Hue as HueId,
    p2Hue: S.p2Hue as HueId,
    colorblind: S.colorblind,
    reducedMotion: S.reducedMotion,
  };
}

export function parseUserPreferences(value: unknown): UserPreferences | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!isLanguageOverride(v.localeOverride)
      || typeof v.sound !== 'boolean' || typeof v.numerals !== 'boolean'
      || !hue(v.p1Hue) || !hue(v.p2Hue) || v.p1Hue === v.p2Hue
      || typeof v.colorblind !== 'boolean'
      || (v.reducedMotion !== null && typeof v.reducedMotion !== 'boolean')) return null;
  return {
    localeOverride: v.localeOverride,
    sound: v.sound,
    numerals: v.numerals,
    p1Hue: v.p1Hue,
    p2Hue: v.p2Hue,
    colorblind: v.colorblind,
    reducedMotion: v.reducedMotion as boolean | null,
  };
}

export function applyUserPreferences(value: UserPreferences): void {
  S.localeOverride = value.localeOverride;
  S.sound = value.sound;
  S.numerals = value.numerals;
  S.p1Hue = value.p1Hue;
  S.p2Hue = value.p2Hue;
  S.colorblind = value.colorblind;
  S.reducedMotion = value.reducedMotion;
  /* Locale listeners repaint several settings-owned surfaces synchronously,
     so publish the language only after the whole remote snapshot is in S. */
  setLanguageOverride(value.localeOverride);
}

/* Account writes are lazy-loaded, so the complete value and its mutation
   revision must be captured at the tap. Reading mutable S when the queued
   network task finally runs can otherwise turn a fresh tap back into the
   remote value that an earlier hydration just applied. */
export interface UserPreferencesSnapshot {
  readonly revision: number;
  readonly value: Readonly<UserPreferences>;
}

let mutationRevision = 0;

export function captureUserPreferences(): UserPreferencesSnapshot {
  const value = Object.freeze(userPreferences());
  return Object.freeze({ revision: ++mutationRevision, value });
}

export function userPreferencesRevision(): number {
  return mutationRevision;
}
