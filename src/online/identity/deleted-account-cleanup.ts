import {
  clearProfileCacheForAccount,
  readProfileCache,
} from '../../profile-cache.ts';
import {
  clearRuneCollectionSnapshot,
  readRuneCollectionSnapshot,
} from '../../rune-collection-cache.ts';
import { resetProfileAppIcon } from '../../native/app-icon.ts';
import { invalidateRuneCollectionRefreshes } from '../runes/rune-collection.ts';
import { resetGuestGameCenterLink } from './identity.ts';
import { forgetDeviceAccount, requireGameCenterAssertion } from './session.ts';

/** Finish local cleanup after server deletion without ambient Supabase
 * sign-out. Only A-owned caches are removed; install/account flags and the
 * launcher icon survive when a replacement B presentation is retained. */
export function forgetDeletedAccount(accountId: string, preserveOtherAccount = false): void {
  const expected = accountId.toLowerCase();
  invalidateRuneCollectionRefreshes();
  clearRuneCollectionSnapshot(expected);
  clearProfileCacheForAccount(expected);
  const profileOwner = readProfileCache()?.accountId?.toLowerCase() ?? null;
  const runeOwner = readRuneCollectionSnapshot()?.accountId ?? null;
  const retainingOther = preserveOtherAccount
    || (!!profileOwner && profileOwner !== expected)
    || (!!runeOwner && runeOwner !== expected);
  if (retainingOther) return;
  requireGameCenterAssertion();
  resetGuestGameCenterLink();
  forgetDeviceAccount();
  void resetProfileAppIcon();
}
