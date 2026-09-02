// The last online profile this device saw, kept eager and Supabase-free so the
// Home identity chip can paint at boot: a stale rating beats putting a network
// call in the offline game's boot path. One owner for one key — the chip, the
// result screen, the profile screen and the online session all read and write
// this single shape instead of each re-declaring it.

const PROFILE_CACHE = 'knucklebones.online.profile';

/** Everything a screen may paint from the cache before any RPC answers. */
export interface CachedProfile {
  /** The Supabase account this presentation belongs to. Older unscoped cache
      entries remain readable for Home once, but are never merged into a fresh
      account and are not trusted for launcher-icon reconciliation. */
  accountId?: string;
  nickname?: string;
  rating?: number;
  avatar?: string | null;
  /* Rank and apex ride the cache from the last standing that reached the
     client; null is a known "unranked", absent is "never heard". */
  rank?: number | null;
  apex?: boolean;
}

export function readProfileCache(): CachedProfile | null {
  try {
    const cached: unknown = JSON.parse(localStorage.getItem(PROFILE_CACHE) || 'null');
    return cached && typeof cached === 'object' ? cached as CachedProfile : null;
  } catch { return null; /* forgetful host */ }
}

function write(profile: CachedProfile): void {
  try { localStorage.setItem(PROFILE_CACHE, JSON.stringify(profile)); }
  catch { /* forgetful host */ }
}

const accountKey = (accountId: string): string => accountId.toLowerCase();

export function readProfileCacheForAccount(accountId: string): CachedProfile | null {
  const cached = readProfileCache();
  return cached?.accountId?.toLowerCase() === accountKey(accountId) ? cached : null;
}

/* Merged over the old entry, not replaced: rank/apex (cacheStanding) come from
   a different RPC and must survive a profile refetch. */
export function cacheProfileIdentity(
  identity: {
    accountId: string;
    nickname: string;
    rating: number;
    avatar?: string | null;
  },
): void {
  const normalized = accountKey(identity.accountId);
  write({ ...readProfileCacheForAccount(normalized), ...identity, accountId: normalized });
}

/** Publish a successful avatar write immediately without retaining another
    account's name/rating when authentication changed under the picker. */
export function cacheProfileAvatar(accountId: string, avatar: string | null): void {
  const normalized = accountKey(accountId);
  write({ ...readProfileCacheForAccount(normalized), accountId: normalized, avatar });
}

/* When a standing lands anywhere (result, profile), its rank/apex are stashed
   beside the profile so the chip's group pill can carry "BONE · #13" at next
   boot. Only ever beside: a rank with no identity has nothing to label. */
export function cacheStanding(rank: number | null, apex: boolean): void {
  const cached = readProfileCache();
  if (cached) write({ ...cached, rank, apex });
}

export function clearProfileCache(): void {
  try { localStorage.removeItem(PROFILE_CACHE); } catch { /* forgetful host */ }
}
