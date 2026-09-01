// Account-stamped eager caches that survive outside the lazy online bundle.
// Session changes reconcile them together so one account cannot lend durable
// runes, outcome access, weekly marks or medals to the next account.
import {
  clearRuneCollectionSnapshot,
  readRuneCollectionSnapshot,
} from '../../rune-collection-cache.ts';
import {
  clearProgressionStatusSnapshot,
  readProgressionStatusSnapshot,
} from '../../progression-status-cache.ts';
import { invalidateRuneCollectionRefreshes } from '../runes/rune-collection.ts';

export function clearSessionSnapshots(): void {
  invalidateRuneCollectionRefreshes();
  clearRuneCollectionSnapshot();
  clearProgressionStatusSnapshot();
}

export function reconcileSessionSnapshots(accountId: string | null): void {
  const normalized = accountId?.toLowerCase() ?? null;
  const runes = readRuneCollectionSnapshot();
  if (!normalized || (runes && runes.accountId !== normalized)) {
    invalidateRuneCollectionRefreshes();
    clearRuneCollectionSnapshot();
  }
  const progression = readProgressionStatusSnapshot();
  if (!normalized || (progression && progression.accountId !== normalized)) {
    clearProgressionStatusSnapshot();
  }
}
