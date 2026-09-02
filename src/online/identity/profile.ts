// The signed-in player's own profiles row: read it, claim the name once, set
// the avatar. Split from session.ts — that module owns the auth ladder (which
// auth.users row this device is, and how it proves it), this one owns what
// hangs off the row once the ladder has answered. Loaded ONLY via dynamic
// import, like session.ts: supabase-js rides along with it.
import { supa } from '../api/client.ts';
import { onlineMessage } from '../message-copy.ts';
import { currentUser } from './session.ts';
import {
  DEFAULT_AVATAR,
  isProfileAvatar,
  parseAvatar,
  profileAvatar,
  type AvatarHue,
  type ProfileAvatar,
} from '../../profile-avatar.ts';
import {
  cacheProfileAvatar,
  cacheProfileClaim,
  cacheProfileIdentity,
  readProfileCache,
} from '../../profile-cache.ts';
import { S } from '../../state.ts';

export interface Profile { id: string; nickname: string; rating: number; created_at?: string; avatar?: string | null; named_at?: string | null; }

export type ProfileLookup =
  | { readonly ok: true; readonly profile: Profile }
  | { readonly ok: false; readonly reason: 'unavailable' | 'account-mismatch' };

export type ProfileMutationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'account-mismatch' }
  | { readonly ok: false; readonly reason: 'error'; readonly message: string };

export async function myProfileLookup(): Promise<ProfileLookup> {
  const requestedUser = await currentUser();
  if (!requestedUser) return { ok: false, reason: 'unavailable' };
  const { data, error } = await supa().from('profiles')
    .select('id, nickname, rating, created_at, avatar, named_at')
    .eq('id', requestedUser.id).maybeSingle();
  /* A sign-out/restore can replace Supabase's session while this row is in
     flight. Recheck even when the query itself failed: "unavailable" is safe
     stale-cache fallback only while the requester still owns the browser. */
  const activeUser = await currentUser();
  if (activeUser?.id.toLowerCase() !== requestedUser.id.toLowerCase()) {
    return { ok: false, reason: 'account-mismatch' };
  }
  if (error || !data) return { ok: false, reason: 'unavailable' };
  const profile = data as Profile | null;
  if (!profile || profile.id.toLowerCase() !== requestedUser.id.toLowerCase()) {
    return { ok: false, reason: 'account-mismatch' };
  }

  /* Only the account that still owns the browser may repaint Home when its
     row lands. A row whose hue drifted from Settings (this device changed
     "your colour" while offline, or another device wrote the row) is
     realigned in the background; the cached copy is what paints meanwhile. */
  const avatar = profile.avatar ?? DEFAULT_AVATAR;
  cacheProfileIdentity({
    accountId: requestedUser.id,
    nickname: profile.nickname,
    rating: profile.rating,
    avatar,
  });
  if (isProfileAvatar(avatar) && parseAvatar(avatar).hue !== settingsAvatarHue()) {
    void alignAvatarHue();
  }
  return { ok: true, profile: { ...profile, avatar } };
}

export async function myProfile(): Promise<Profile | null> {
  const result = await myProfileLookup();
  return result.ok ? result.profile : null;
}

/* A name is claimed ONCE: the 0026 trigger stamps named_at on the first
   nickname write and refuses every later one, so this can only succeed for a
   profile whose name is still the minted placeholder. The P0001 branch is the
   backstop for a claim raced from two devices — the UI never offers a second. */
export async function claimName(
  accountId: string,
  nickname: string,
): Promise<ProfileMutationResult> {
  const expectedAccountId = accountId.toLowerCase();
  const requestedUser = await currentUser();
  if (requestedUser?.id.toLowerCase() !== expectedAccountId) {
    return { ok: false, reason: 'account-mismatch' };
  }
  const { error } = await supa().from('profiles').update({ nickname })
    .eq('id', expectedAccountId);
  const activeUser = await currentUser();
  if (activeUser?.id.toLowerCase() !== expectedAccountId) {
    return { ok: false, reason: 'account-mismatch' };
  }
  if (error) return { ok: false, reason: 'error', message:
    error.code === '23505' ? onlineMessage('errors.nameTaken')
    : error.code === '23514' ? onlineMessage('profile.nameInvalid')
    : error.code === 'P0001' ? onlineMessage('errors.nameAlreadySet')
    : onlineMessage('errors.generic') };
  cacheProfileClaim(expectedAccountId, nickname);
  return { ok: true };
}

/** The avatar's hue is "your colour" from Settings — the picker offers faces
 * only. Colour-blind mode pins the displayed pair to cyan-vs-gold, and the
 * avatar follows what the player sees. */
export function settingsAvatarHue(): AvatarHue {
  return (S.colorblind ? 'cy' : S.p1Hue) as AvatarHue;
}

/** Keep the persisted avatar's hue equal to Settings' "your colour", so
 * opponents see the colour this player plays in. No-op signed out, when the
 * hue already matches, or when the cached row is not this device's. */
export async function alignAvatarHue(): Promise<void> {
  const cached = readProfileCache();
  if (!cached?.accountId || !isProfileAvatar(cached.avatar)) return;
  const { face, hue } = parseAvatar(cached.avatar);
  const wanted = settingsAvatarHue();
  if (hue === wanted) return;
  await setAvatar(cached.accountId, profileAvatar(face, wanted));
}

/* The avatar is a die face and a hue — "die:5:cy". 42 identities, no storage
   bucket, no moderation, and no user-generated-image obligations at review.
   The string shape is the seam: a later value can be "img:<path>". */
export async function setAvatar(
  accountId: string,
  avatar: ProfileAvatar,
): Promise<ProfileMutationResult> {
  const expectedAccountId = accountId.toLowerCase();
  const requestedUser = await currentUser();
  if (requestedUser?.id.toLowerCase() !== expectedAccountId) {
    return { ok: false, reason: 'account-mismatch' };
  }
  const { error } = await supa().from('profiles').update({ avatar }).eq('id', expectedAccountId);
  const activeUser = await currentUser();
  if (activeUser?.id.toLowerCase() !== expectedAccountId) {
    return { ok: false, reason: 'account-mismatch' };
  }
  if (error) return { ok: false, reason: 'error', message: onlineMessage('errors.generic') };
  cacheProfileAvatar(expectedAccountId, avatar);
  return { ok: true };
}
