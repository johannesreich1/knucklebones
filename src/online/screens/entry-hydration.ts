// Shared pre-destination account hydration. Profile can skip its duplicate
// profile-row read because its own screen owns the coherent refresh, but its
// first rune discovery stays ahead of the confirmation/fallback boundary.
import { myProfile } from '../identity/profile.ts';
import { syncAccountPreferences } from '../preferences.ts';
import {
  refreshRuneCollection,
  runeCollectionMatchesActiveAccount,
  type RuneCollectionRefresh,
} from '../runes/rune-collection.ts';

export async function hydrateOnlineEntry(
  accountId?: string,
  refreshProfile = true,
): Promise<RuneCollectionRefresh | null> {
  const [, collection] = await Promise.all([
    syncAccountPreferences(),
    refreshRuneCollection(accountId),
    refreshProfile ? myProfile() : Promise.resolve(null),
  ]);
  if (!collection.accountId
      || (accountId && collection.accountId.toLowerCase() !== accountId.toLowerCase())) return null;
  return await runeCollectionMatchesActiveAccount(collection) ? collection : null;
}
