// The profile avatar code is shared by eager Home/native startup and the lazy
// online profile flow, so its vocabulary stays pure and DOM/Supabase-free.
// Every valid profile value is one of six faces in the single duel-hue roster.
import { HUE_IDS } from './state.ts';

export const AVATAR_FACES = [1, 2, 3, 4, 5, 6] as const;
export type AvatarFace = typeof AVATAR_FACES[number];
export type AvatarHue = typeof HUE_IDS[number];
export const AVATAR_HUES: readonly AvatarHue[] = Object.freeze([...HUE_IDS]);
export type ProfileAvatar = `die:${AvatarFace}:${AvatarHue}`;
type ProfileAppIconName = `die-${AvatarFace}-${AvatarHue}`;
export type AlternateAppIcon = Exclude<ProfileAppIconName, 'die-5-cy'>;
export type AppIconId = 'primary' | AlternateAppIcon;

export interface ParsedAvatar {
  readonly face: AvatarFace;
  readonly hue: AvatarHue;
}

export const DEFAULT_AVATAR: ProfileAvatar = 'die:5:cy';
const FACE_SET = new Set<number>(AVATAR_FACES);
const HUE_SET = new Set<string>(AVATAR_HUES);

export const PROFILE_AVATARS: readonly ProfileAvatar[] = Object.freeze(
  AVATAR_FACES.flatMap((face) => AVATAR_HUES.map((hue) => `die:${face}:${hue}` as ProfileAvatar)),
);

/** Strict recognition for persistence and native reconciliation boundaries. */
export function isProfileAvatar(value: unknown): value is ProfileAvatar {
  if (typeof value !== 'string') return false;
  const match = /^die:([1-6]):([a-z]+)$/.exec(value);
  return !!match && FACE_SET.has(Number(match[1])) && HUE_SET.has(match[2]);
}

/** Canonicalize an untrusted server/cache value to the player-visible default. */
export function canonicalProfileAvatar(value: unknown): ProfileAvatar {
  return isProfileAvatar(value) ? value : DEFAULT_AVATAR;
}

/** The one face/hue parser used by rendering and launcher selection. */
export function parseAvatar(value: unknown): ParsedAvatar {
  const avatar = canonicalProfileAvatar(value);
  const [, face, hue] = /^die:([1-6]):([a-z]+)$/.exec(avatar)!;
  return { face: Number(face) as AvatarFace, hue: hue as AvatarHue };
}

export function profileAvatar(face: AvatarFace, hue: AvatarHue): ProfileAvatar {
  return `die:${face}:${hue}`;
}

/**
 * The cyan five is compiled as the primary icon. Every other profile avatar
 * names one pre-bundled alternate; unknown/future avatar kinds stay primary.
 */
export function alternateAppIconForAvatar(value: unknown): AlternateAppIcon | null {
  const avatar = canonicalProfileAvatar(value);
  if (avatar === DEFAULT_AVATAR) return null;
  const { face, hue } = parseAvatar(avatar);
  return `die-${face}-${hue}` as AlternateAppIcon;
}

/** Capacitor's cross-platform bridge spells the native null/default as primary. */
export function appIconIdForAvatar(value: unknown): AppIconId {
  return alternateAppIconForAvatar(value) ?? 'primary';
}
