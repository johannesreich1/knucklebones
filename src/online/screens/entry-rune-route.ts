// Routing after a verified rune collection: either expose the first-rune
// guide or continue to the originally requested online destination.
import { t } from '../../i18n/index.ts';
import { show } from '../../ui/dom.ts';
import type { RuneCollectionRefresh } from '../runes/rune-collection.ts';
import { firstCollectedRuneReward } from '../runes/rune-reward-presentation.ts';
import type { AccountShowOptions } from './account-screen.ts';
import type { EntryRuneRewardPresenter } from './entry-rune-reward.ts';
import type { OnlineView } from './result-entry.ts';

interface EntryRuneRoutePorts {
  currentRevision(revision: number): boolean;
  ownsOverlay(revision: number): boolean;
  routeAccount(options: AccountShowOptions): Promise<void>;
  route(view: OnlineView, options?: AccountShowOptions): Promise<void>;
}

export function createEntryRuneRewardRouter(
  presenter: EntryRuneRewardPresenter,
  ports: EntryRuneRoutePorts,
) {
  return async (
    view: OnlineView,
    collection: RuneCollectionRefresh,
    revision: number,
  ): Promise<void> => {
    if (view === 'account') {
      /* Profile paints one coherent account. Bind the fallback to the account
         that produced it so a swap mid-entry cannot attribute it elsewhere. */
      await ports.routeAccount({
        verifiedRuneFallback: collection,
        ...(collection.accountId ? { expectedAccountId: collection.accountId } : {}),
      });
      return;
    }
    const firstRune = firstCollectedRuneReward(collection);
    const guide: AccountShowOptions = {
      runeGuide: { complete: () => undefined, cancel: () => undefined },
      ...(firstRune ? { expectedAccountId: firstRune.accountId } : {}),
      ...(firstRune ? { deferredRuneReward: firstRune } : {}),
    };
    const resume = (): void => {
      if (!ports.currentRevision(revision)) return;
      show('#ovOnline');
      void ports.route(firstRune ? 'account' : view, firstRune ? guide : undefined);
    };
    if (presenter.present(
      collection,
      () => ports.ownsOverlay(revision),
      resume,
      firstRune ? () => t('online', 'profile.equipRune') : undefined,
      !!firstRune,
    )) return;
    await ports.route(view);
  };
}
