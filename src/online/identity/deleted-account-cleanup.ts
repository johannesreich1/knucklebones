import {
  clearProfileCacheForAccount,
  readProfileCache,
} from '../../profile-cache.ts';
import {
  clearRuneCollectionSnapshot,
  readRuneCollectionSnapshot,
} from '../../rune-collection-cache.ts';
import { invalidateRuneCollectionRefreshes } from '../runes/rune-collection.ts';
import { resetGuestGameCenterLink } from './identity.ts';
import { forgetDeviceAccount, requireGameCenterAssertion } from './session.ts';

/** Finish local cleanup after server deletion without ambient Supabase
 * sign-out. Only A-owned caches are removed; install/account flags survive
 * when a replacement B presentation is retained. The launcher icon is a
 * device colour setting and never part of an account's cleanup. */
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
}
