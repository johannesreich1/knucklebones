// Doors leaving a ranked result. Both the covered-result routes and Next duel
// retire the same result state, but only Next duel must re-verify identity and
// durable rune ownership before matchmaking. This owner keeps those two exits
// together without making the general online router learn result mechanics.
import { $, hide, show } from '../../ui/dom.ts';
import { closeEnd } from '../../ui/endscreen.ts';
import { replayPlates } from '../../ui/endscreen-plates.ts';
import { makeInert, type InertSnapshot } from '../../ui/modal-background.ts';
import { ensureIdentity, type IdentityEntry } from '../identity/session.ts';
import {
  refreshRuneCollection,
  runeCollectionMatchesActiveAccount,
  type RuneCollectionRefresh,
} from '../runes/rune-collection.ts';
import type { ConnectionIssue } from './connection-sheet.ts';

export type OnlineView = 'play' | 'ladder' | 'account';
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
  nextDuel(): void;
  openFromResult(view: OnlineView, onReturn: () => void, options?: Options): void;
  releaseCover(): void;
}

export function createResultEntry<Options>(ports: ResultEntryPorts<Options>): ResultEntry<Options> {
  let resultCover: InertSnapshot | null = null;
  const releaseCover = (): void => {
    resultCover?.release();
    resultCover = null;
  };

  function openFromResult(
    view: OnlineView,
    onReturn: () => void,
    options?: Options,
  ): void {
    ports.incrementRevision();
    ports.closeRuneReward();
    releaseCover();
    resultCover = makeInert($('#ovEnd'));
    ports.setExit(() => {
      ports.setExit(ports.goHome);
      hide('#ovOnline');
      releaseCover();
      replayPlates();
      onReturn();
    });
    /* The same complete loading view used from Home is also the destination
       from a result. route() may restate it, which the shared motion seam
       treats as content paint rather than a second transition. */
    ports.showEntryWait(view);
    show('#ovOnline');
    void ports.route(view, options);
  }

  function nextDuel(): void {
    if (navigator.onLine === false) {
      ports.presentConnectionIssue('play', 'offline');
      return;
    }
    const revision = ports.incrementRevision();
    releaseCover();
    ports.setExit(ports.goHome);
    ports.closeRuneReward();
    closeEnd();
    ports.showEntryWait('play');
    show('#ovOnline');
    ports.focusOnlineTitle();
    /* Verify durable unseen rows again before matchmaking; queueing never
       starts behind a reward that Next duel just covered. */
    void ensureIdentity().then(async (identity) => {
      if (!ports.isCurrent(revision)) return;
      if (identity.kind !== 'authenticated') {
        ports.handleIdentityFailure('play', identity);
        return;
      }
      const collection = await refreshRuneCollection(identity.user.id);
      if (!ports.isCurrent(revision)) return;
      const ownsCollection = await runeCollectionMatchesActiveAccount(collection);
      if (!ports.isCurrent(revision)) return;
      if (!ownsCollection) {
        ports.presentConnectionIssue('play');
        return;
      }
      await ports.routeWithRuneReward('play', collection, revision);
    }).catch(() => {
      if (ports.isCurrent(revision)) ports.presentConnectionIssue('play');
    });
  }

  return { nextDuel, openFromResult, releaseCover };
}
