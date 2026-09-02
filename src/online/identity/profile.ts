// The signed-in player's own profiles row: read it, claim the name once, set
// the avatar. Split from session.ts — that module owns the auth ladder (which
// auth.users row this device is, and how it proves it), this one owns what
// hangs off the row once the ladder has answered. Loaded ONLY via dynamic
// import, like session.ts: supabase-js rides along with it.
import { supa } from '../api/client.ts';
import { onlineMessage } from '../message-copy.ts';
import { currentUser } from './session.ts';
import { DEFAULT_AVATAR, type ProfileAvatar } from '../../profile-avatar.ts';
import { syncProfileAppIcon } from '../../native/app-icon.ts';
import { cacheProfileAvatar, cacheProfileIdentity } from '../../profile-cache.ts';

export interface Profile { id: string; nickname: string; rating: number; created_at?: string; avatar?: string | null; named_at?: string | null; }

export async function myProfile(): Promise<Profile | null> {
  const requestedUser = await currentUser();
  if (!requestedUser) return null;
  const { data } = await supa().from('profiles')
    .select('id, nickname, rating, created_at, avatar, named_at')
    .eq('id', requestedUser.id).maybeSingle();
  const profile = data as Profile | null;
  if (!profile || profile.id.toLowerCase() !== requestedUser.id.toLowerCase()) return null;

  /* A sign-out/restore can replace Supabase's session while this row is in
     flight. Only the account that still owns the browser may repaint Home or
     the device launcher when the response lands. */
  const activeUser = await currentUser();
  if (activeUser?.id.toLowerCase() !== requestedUser.id.toLowerCase()) return null;
  const avatar = profile.avatar ?? DEFAULT_AVATAR;
  cacheProfileIdentity({
    accountId: requestedUser.id,
    nickname: profile.nickname,
    rating: profile.rating,
    avatar,
  });
  void syncProfileAppIcon(avatar);
  return { ...profile, avatar };
}

/* A name is claimed ONCE: the 0026 trigger stamps named_at on the first
   nickname write and refuses every later one, so this can only succeed for a
   profile whose name is still the minted placeholder. The P0001 branch is the
   backstop for a claim raced from two devices — the UI never offers a second. */
export async function claimName(nickname: string): Promise<string | null> {
  const user = await currentUser();
  if (!user) return onlineMessage('errors.notSignedIn');
  const { error } = await supa().from('profiles').update({ nickname }).eq('id', user.id);
  if (!error) return null;
  return error.code === '23505' ? onlineMessage('errors.nameTaken')
    : error.code === '23514' ? onlineMessage('profile.nameInvalid')
    : error.code === 'P0001' ? onlineMessage('errors.nameAlreadySet')
    : onlineMessage('errors.generic');
}

/* The avatar is a die face and a hue — "die:5:cy". 42 identities, no storage
   bucket, no moderation, and no user-generated-image obligations at review.
   The string shape is the seam: a later value can be "img:<path>". */
export async function setAvatar(avatar: ProfileAvatar): Promise<string | null> {
  const requestedUser = await currentUser();
  if (!requestedUser) return onlineMessage('errors.notSignedIn');
  const { error } = await supa().from('profiles').update({ avatar }).eq('id', requestedUser.id);
  if (error) return onlineMessage('errors.generic');
  const activeUser = await currentUser();
  if (activeUser?.id.toLowerCase() === requestedUser.id.toLowerCase()) {
    cacheProfileAvatar(requestedUser.id, avatar);
    void syncProfileAppIcon(avatar);
  }
  return null;
}
