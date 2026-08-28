// The signed-in player's own profiles row: read it, claim the name once, set
// the avatar. Split from session.ts — that module owns the auth ladder (which
// auth.users row this device is, and how it proves it), this one owns what
// hangs off the row once the ladder has answered. Loaded ONLY via dynamic
// import, like session.ts: supabase-js rides along with it.
import { supa } from '../api/client.ts';
import { onlineMessage } from '../message-copy.ts';
import { currentUser } from './session.ts';
import { cacheProfileIdentity, clearProfileCache } from '../../profile-cache.ts';

export interface Profile { id: string; nickname: string; rating: number; created_at?: string; avatar?: string; named_at?: string | null; }

export async function myProfile(): Promise<Profile | null> {
  const user = await currentUser();
  if (!user) return null;
  const { data } = await supa().from('profiles').select('id, nickname, rating, created_at, avatar, named_at').eq('id', user.id).maybeSingle();
  if (data) {
    cacheProfileIdentity({ nickname: data.nickname, rating: data.rating, avatar: data.avatar });
  }
  return data as Profile | null;
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

/* The avatar is a die face and a hue — "die:5:cy". 36 identities, no storage
   bucket, no moderation, and no user-generated-image obligations at review.
   The string shape is the seam: a later value can be "img:<path>". */
export async function setAvatar(avatar: string): Promise<string | null> {
  const user = await currentUser();
  if (!user) return onlineMessage('errors.notSignedIn');
  const { error } = await supa().from('profiles').update({ avatar }).eq('id', user.id);
  if (error) return onlineMessage('errors.generic');
  clearProfileCache();
  return null;
}
