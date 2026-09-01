// Doors leaving a ranked result. Both the covered-result routes and Next duel
// retire the same result state, but only Next duel must re-verify identity and
// durable rune ownership before matchmaking. This owner keeps those two exits
// together without making the general online router learn result mechanics.
import { $, hide, show } from '../../ui/dom.ts';
import { closeEnd } from '../../ui/endscreen.ts';
import { replayPlates } from '../../ui/endscreen-plates.ts';
import { ensureIdentity, type IdentityEntry } from '../identity/session.ts';
import {
  refreshRuneCollection,
  runeCollectionMatchesActiveAccount,
  type RuneCollectionRefresh,
} from '../runes/rune-collection.ts';
import type { ConnectionIssue } from './connection-sheet.ts';
import { refreshRankedProgressionStatus } from '../api/progression-status-api.ts';
import { verifyRankedEntryContract } from './ranked-entry-contract.ts';

export type OnlineView = 'play' | 'weekly' | 'ladder' | 'account';
type IdentityFailure = Exclude<IdentityEntry, { readonly kind: 'authenticated' }>;

interface ResultEntryPorts<Options> {
  incrementRevision(): number;
  isCurrent(revision: number): boolean;
  closeRuneReward(): void;
  setExit(next: () => void): void;
  goHome(): void;
  showEntryWait(view: OnlineView): void;
  focusOnlineTitle(): void;
  route(view: OnlineView, options?: Options): Promise<void>;
  routeWithRuneReward(
    view: OnlineView,
    collection: RuneCollectionRefresh,
    revision: number,
  ): Promise<void>;
  handleIdentityFailure(view: OnlineView, identity: IdentityFailure): void;
  presentConnectionIssue(view: OnlineView, issue?: ConnectionIssue): void;
}

export interface ResultEntry<Options> {
  nextDuel(entryKind?: 'ordinary' | 'weekly'): void;
  openFromResult(view: OnlineView, onReturn: () => void, options?: Options): void;
}

export function createResultEntry<Options>(ports: ResultEntryPorts<Options>): ResultEntry<Options> {
  function openFromResult(
    view: OnlineView,
    onReturn: () => void,
    options?: Options,
  ): void {
    ports.incrementRevision();
    ports.closeRuneReward();
    $('#ovEnd').inert = true;
    ports.setExit(() => {
      ports.setExit(ports.goHome);
      hide('#ovOnline');
      $('#ovEnd').inert = false;
      replayPlates();
      onReturn();
    });
    show('#ovOnline');
    void ports.route(view, options);
  }

  function nextDuel(entryKind: 'ordinary' | 'weekly' = 'ordinary'): void {
    const view: OnlineView = entryKind === 'weekly' ? 'weekly' : 'play';
    if (navigator.onLine === false) {
      ports.presentConnectionIssue(view, 'offline');
      return;
    }
    const revision = ports.incrementRevision();
    ports.setExit(ports.goHome);
    ports.closeRuneReward();
    closeEnd();
    ports.showEntryWait(view);
    show('#ovOnline');
    ports.focusOnlineTitle();
    /* Verify durable unseen rows again before matchmaking; queueing never
       starts behind a reward that Next duel just covered. */
    void ensureIdentity().then(async (identity) => {
      if (!ports.isCurrent(revision)) return;
      if (identity.kind !== 'authenticated') {
        ports.handleIdentityFailure(view, identity);
        return;
      }
      const [collection, progression] = await Promise.all([
        refreshRuneCollection(identity.user.id),
        refreshRankedProgressionStatus(),
      ]);
      if (!ports.isCurrent(revision)) return;
      /* A weekly replay must name the CURRENT persisted rotation before it
         queues. If the Monday-boundary refresh is uncertain, keep the action
         retryable rather than silently entering a different mode. */
      if (!await verifyRankedEntryContract(view, progression)) {
        if (!ports.isCurrent(revision)) return;
        ports.presentConnectionIssue(view);
        return;
      }
      ports.showEntryWait(view);
      const ownsCollection = await runeCollectionMatchesActiveAccount(collection);
      if (!ports.isCurrent(revision)) return;
      if (!ownsCollection) {
        ports.presentConnectionIssue(view);
        return;
      }
      await ports.routeWithRuneReward(view, collection, revision);
    }).catch(() => {
      if (ports.isCurrent(revision)) ports.presentConnectionIssue(view);
    });
  }

  return { nextDuel, openFromResult };
}
