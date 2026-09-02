// Profile's complete stale-while-refresh presentation. The eager storage
// owner stays Supabase-free in src/profile-cache.ts; this adapter maps its
// plain JSON shape to the online screen's typed rows.
import {
  cacheAccountProfile,
  readAccountProfileCache,
} from '../../profile-cache.ts';
import type { HistoryRow, Ladder, Standing } from '../api/ladder-api.ts';
import type { IdentityStatus, Me } from '../identity/session.ts';
import type { Profile } from '../identity/profile.ts';
import type { RuneCollectionRefresh } from '../runes/rune-collection.ts';
import type { EquippedRuneSelection } from '../../rune-collection-cache.ts';

export interface AccountViewData {
  profile: Profile;
  user: Me;
  ladder: Ladder;
  standing: Standing | null;
  standingKnown: boolean;
  streak: number;
  identity: IdentityStatus | null;
  runes: readonly string[];
  runeRows: RuneCollectionRefresh['rows'];
  equipment: EquippedRuneSelection;
}

export interface CachedAccountView {
  account: AccountViewData;
  recent: HistoryRow[];
}

/** A failed standing refresh must not pair the cached rank with newer profile
 * points. Reuse the last confirmed standing as one indivisible tuple. */
export function retainKnownStandingTuple(account: AccountViewData): AccountViewData {
  if (!account.standing || !account.standingKnown) return account;
  const points = account.standing.points;
  return {
    ...account,
    profile: { ...account.profile, rating: points },
    ladder: { ...account.ladder, points },
  };
}

export function readCachedAccountView(accountId?: string): CachedAccountView | null {
  const cached = readAccountProfileCache(accountId);
  if (!cached) return null;
  return {
    account: {
      profile: { ...cached.profile,
        created_at: cached.profile.created_at ?? undefined,
        named_at: cached.profile.named_at },
      user: { ...cached.user },
      ladder: { ...cached.ladder },
      standing: cached.standing ? { ...cached.standing } : null,
      standingKnown: cached.standingKnown,
      streak: cached.streak,
      identity: { ...cached.identity },
      runes: [...cached.runes],
      runeRows: cached.runeRows.map((row) => ({ ...row })),
      equipment: { ...cached.equipment },
    },
    recent: cached.recent.map((row) => ({ ...row })),
  };
}

export function cacheAccountView(
  account: AccountViewData,
  recent: readonly HistoryRow[],
  replaceStanding = false,
): boolean {
  if (!account.identity) return false;
  const existing = replaceStanding ? null : readAccountProfileCache(account.user.id);
  const standing = existing ? existing.standing : account.standing;
  const standingKnown = existing ? existing.standingKnown : account.standingKnown;
  /* A standing tuple is one authoritative settlement. Preserve all of it
     across unrelated/non-rank writes, including its mirrored point value. */
  const points = existing?.standing ? existing.standing.points : account.ladder.points;
  return cacheAccountProfile({
    accountId: account.user.id,
    profile: {
      id: account.profile.id,
      nickname: account.profile.nickname,
      rating: existing?.standing ? points : account.profile.rating,
      created_at: account.profile.created_at ?? null,
      avatar: account.profile.avatar ?? null,
      named_at: account.profile.named_at ?? null,
    },
    user: { ...account.user },
    ladder: { ...account.ladder, points },
    standing: standing ? { ...standing } : null,
    standingKnown,
    streak: account.streak,
    recent: recent.slice(0, 3).map((row) => ({ ...row })),
    identity: { ...account.identity },
    runes: [...account.runes],
    runeRows: account.runeRows.map((row) => ({ ...row })),
    equipment: { ...account.equipment },
  });
}
