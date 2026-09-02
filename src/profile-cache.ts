// The last online profile this device saw, kept eager and Supabase-free so the
// Home identity chip can paint at boot. Shape validation lives beside the
// shapes; this module remains the single storage and mutation owner.
import {
  ACCOUNT_PROFILE_CACHE_VERSION,
  parseAccountProfile,
  parseProfile,
} from './profile-cache-schema.ts';
import type {
  AccountProfileSnapshot,
  CachedAccountProfile,
  CachedProfile,
  CachedStanding,
} from './profile-cache-schema.ts';

export {
  ACCOUNT_PROFILE_CACHE_VERSION,
  ACCOUNT_PROFILE_REQUIRED_EQUIPMENT_FIELDS,
  ACCOUNT_PROFILE_REQUIRED_FIELDS,
  ACCOUNT_PROFILE_REQUIRED_NESTED_FIELDS,
} from './profile-cache-schema.ts';
export type {
  AccountProfileSnapshot,
  CachedAccountProfile,
  CachedProfile,
  CachedStanding,
} from './profile-cache-schema.ts';

const PROFILE_CACHE = 'knucklebones.online.profile';
export const ACCOUNT_PROFILE_CACHE_KEY = 'knucklebones.online.account-profile';
export type CachedAccountIdentityPatch = Partial<CachedAccountProfile['identity']>;

export function readAccountProfileCache(accountId?: string): CachedAccountProfile | null {
  try {
    const cached = parseAccountProfile(JSON.parse(
      localStorage.getItem(ACCOUNT_PROFILE_CACHE_KEY) || 'null',
    ));
    if (!cached || (accountId !== undefined
        && (typeof accountId !== 'string' || cached.accountId !== accountId.toLowerCase()))) {
      return null;
    }
    return cached;
  } catch { return null; }
}

function storeAccountProfile(value: unknown): boolean {
  const candidate = parseAccountProfile(value);
  if (!candidate) return false;
  try {
    localStorage.setItem(ACCOUNT_PROFILE_CACHE_KEY, JSON.stringify(candidate));
    return true;
  } catch { return false; }
}

export function cacheAccountProfile(snapshot: AccountProfileSnapshot): boolean {
  return storeAccountProfile({
    ...snapshot,
    version: ACCOUNT_PROFILE_CACHE_VERSION,
    verifiedAt: Date.now(),
  });
}

/** Publish a provider mutation before its independent status refresh. The
 * account id is part of the write boundary: a completed A link can never patch
 * whichever complete snapshot happens to belong to B by the time it settles. */
export function cacheAccountIdentity(
  accountId: string,
  patch: CachedAccountIdentityPatch,
): boolean {
  const cached = readAccountProfileCache(accountId);
  if (!cached) return false;
  return storeAccountProfile({
    ...cached,
    verifiedAt: Date.now(),
    identity: { ...cached.identity, ...patch },
  });
}

function patchAccountProfile(
  accountId: string,
  patch: Partial<CachedAccountProfile['profile']>,
): void {
  const cached = readAccountProfileCache(accountId);
  if (!cached) return;
  storeAccountProfile({
    ...cached,
    verifiedAt: Date.now(),
    profile: { ...cached.profile, ...patch },
  });
}

export function readProfileCache(): CachedProfile | null {
  try {
    return parseProfile(JSON.parse(localStorage.getItem(PROFILE_CACHE) || 'null'));
  } catch { return null; /* forgetful host */ }
}

function write(profile: CachedProfile): void {
  try { localStorage.setItem(PROFILE_CACHE, JSON.stringify(profile)); }
  catch { /* forgetful host */ }
}

const accountKey = (accountId: string): string => accountId.toLowerCase();

export function readProfileCacheForAccount(accountId: string): CachedProfile | null {
  if (typeof accountId !== 'string') return null;
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
  const cached = readProfileCacheForAccount(normalized);
  /* A numbered standing is one rank/points settlement. A later profile-row
     mirror may have straddled that settlement, so it can refresh identity
     facts but only another standing may split/replace the tuple. */
  const rating = typeof cached?.rank === 'number' && typeof cached.rating === 'number'
    ? cached.rating : identity.rating;
  write({ ...cached, ...identity, rating, accountId: normalized });
}

/** Publish a successful avatar write immediately without retaining another
    account's name/rating when authentication changed under the picker. */
export function cacheProfileAvatar(accountId: string, avatar: string | null): void {
  const normalized = accountKey(accountId);
  write({ ...readProfileCacheForAccount(normalized), accountId: normalized, avatar });
  patchAccountProfile(normalized, { avatar });
}

/** A successful one-time claim is a complete local fact even when the
    immediately-following profile refresh is unavailable. */
export function cacheProfileClaim(accountId: string, nickname: string): void {
  const normalized = accountKey(accountId);
  const cached = readProfileCacheForAccount(normalized);
  if (cached) write({ ...cached, nickname });
  patchAccountProfile(normalized, { nickname, named_at: new Date().toISOString() });
}

/* When a standing lands anywhere (result, profile), its rank/apex are stashed
   beside the profile so Home can carry the exact rank at next boot. */
export function cacheStanding(
  accountId: string,
  standing: CachedStanding | null,
  apex: boolean,
): void {
  const cached = readProfileCacheForAccount(accountId);
  if (cached) write({
    ...cached,
    rating: standing?.points ?? cached.rating,
    rank: standing?.rank ?? null,
    apex,
  });
  const complete = readAccountProfileCache(accountId);
  if (complete) storeAccountProfile({
    ...complete,
    verifiedAt: Date.now(),
    profile: standing ? { ...complete.profile, rating: standing.points } : complete.profile,
    ladder: standing ? { ...complete.ladder, points: standing.points } : complete.ladder,
    standing: standing ? { ...standing } : null,
    standingKnown: true,
  });
}

export function clearProfileCache(): void {
  try {
    localStorage.removeItem(PROFILE_CACHE);
    localStorage.removeItem(ACCOUNT_PROFILE_CACHE_KEY);
  } catch { /* forgetful host */ }
}

/** Remove only presentation owned by one deleted/signed-out account. A late
 * callback from A must not erase a newly authenticated B snapshot. */
export function clearProfileCacheForAccount(accountId: string): boolean {
  const normalized = accountKey(accountId);
  let removed = false;
  try {
    if (readProfileCache()?.accountId.toLowerCase() === normalized) {
      localStorage.removeItem(PROFILE_CACHE);
      removed = true;
    }
    if (readAccountProfileCache()?.accountId === normalized) {
      localStorage.removeItem(ACCOUNT_PROFILE_CACHE_KEY);
      removed = true;
    }
  } catch { return false; }
  return removed;
}
