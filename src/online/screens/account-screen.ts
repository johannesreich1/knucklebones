import { inApex } from '../../core/ladder.ts';
import { subscribeLocale, t } from '../../i18n/index.ts';
import { $, byId } from '../../ui/dom.ts';
import { refreshHomeChip } from '../../ui/homechip.ts';
import { appRoot } from '../../ui/embed.ts';
import { whenPageMotionSettled } from '../../ui/page-motion.ts';
import {
  bestStreakLookup,
  matchHistoryLookup,
  myLadderLookup,
  myStandingLookup,
  type HistoryRow,
} from '../api/ladder-api.ts';
import { currentUser, identityStatusLookup } from '../identity/session.ts';
import { persistedAuthAccountId } from '../identity/session-read.ts';
import { myProfileLookup } from '../identity/profile.ts';
import { cacheStanding } from '../../profile-cache.ts';
import { refreshVerifiedRankedCurveVersion } from '../api/ranked-curve-verification.ts';
import {
  acknowledgeRuneReward,
  refreshRuneCollection,
  runeCollectionMatchesActiveAccount,
  type RuneCollectionRefresh,
} from '../runes/rune-collection.ts';
import { firstCollectedRuneReward } from '../runes/rune-reward-presentation.ts';
import { isOnlinePanelCurrent, showOnlineLoading, showOnlinePanel } from './shell.ts';
import { bindAccountScreen } from './account-bindings.ts';
import {
  cancelAccountRuneGuide,
  repaintAccountRuneGuide,
  startAccountRuneGuide,
} from './account-rune-guide.ts';
import {
  cacheAccountView,
  readCachedAccountView,
  retainKnownStandingTuple,
  type CachedAccountView,
  type AccountViewData,
} from './account-profile-cache.ts';
import {
  paintAccountDetails,
  paintAccountFrame,
  resetAccountPresentation,
} from './account-presentation.ts';
import { createAccountActionLock } from './account-action-lock.ts';
import type { PersistedRuneEquipment } from './account-runes.ts';
import type { AccountPorts, AccountScreen, AccountShowOptions } from './account-screen-types.ts';

export type { AccountScreen, AccountShowOptions } from './account-screen-types.ts';
export function createAccountScreen(ports: AccountPorts): AccountScreen {
  let lastAccount: AccountViewData | null = null;
  let lastRecent: HistoryRow[] = [];
  let rankPending = false;
  let nickError: (() => string) | null = null;
  let showRevision = 0;
  const accountActions = createAccountActionLock();

  /* The profile's ONE remaining inline error line, and it is the only kind
     that belongs inline: nickname validation answers a field the player is
     still typing in, directly beneath it. Everything the ACCOUNT ACCESS box
     can refuse — a provider link, a deletion — is dealt as a warning card
     instead (account-problem-sheet.ts), because that answer arrived from
     somewhere else and has to be READ, not noticed. */
  const clearNickError = (): void => {
    nickError = null;
    $('#onNickErr').textContent = '';
  };
  const showNickError = (render: () => string): void => {
    nickError = render;
    $('#onNickErr').textContent = render();
  };
  const repaintAccount = (): void => {
    if (lastAccount) paintAccountDetails(lastAccount, lastRecent, rankPending);
    accountActions.repaint();
  };
  const repaintFrame = (): void => {
    if (lastAccount) paintAccountFrame(lastAccount, lastRecent, rankPending, clearNickError);
    accountActions.repaint();
  };

  subscribeLocale(() => {
    const panel = byId('onAccount');
    if (!panel || panel.hidden) return;
    repaintAccount();
    repaintAccountRuneGuide();
    if (nickError) $('#onNickErr').textContent = nickError();
  });

  const beginPresentation = (cachedView: CachedAccountView | null): void => {
    /* ONE SWEEP PER ARRIVAL. A single tap on Profile reaches this three times:
       the entry door paints the cached snapshot, ui.ts restates that same wait
       once hydration returns, and the authenticated route then begins its own
       run. Emptying the ring on each of them restarted its 850ms fill, so the
       player watched the circle sweep, snap back to nothing, and sweep again
       (reported from a device 2026-09-03). An arrival is a panel that is not
       already wearing this account — read before lastAccount is replaced. */
    const arriving = !isOnlinePanelCurrent('onAccount')
      || (cachedView?.account.user.id.toLowerCase() ?? null)
        !== (lastAccount?.user.id.toLowerCase() ?? null);
    accountActions.reset();
    accountActions.setRuneSeatAvailable(false);
    rankPending = true;
    lastAccount = cachedView?.account ?? null;
    lastRecent = cachedView?.recent ?? [];
    resetAccountPresentation(cachedView, clearNickError, arriving);
  };
  const invalidatePresentation = (): void => {
    showRevision++;
    beginPresentation(null);
    accountActions.lock();
    if (isOnlinePanelCurrent('onAccount')) showOnlineLoading('onAccount');
  };

  function showCached(accountId: string): boolean {
    const cachedView = readCachedAccountView(accountId);
    if (!cachedView) return false;
    /* Invalidate an older Profile refresh before this new door becomes the
       active presentation. Its verified identity will start a fresh run. */
    showRevision++;
    cancelAccountRuneGuide();
    beginPresentation(cachedView);
    /* This is a presentation preview, not yet an authenticated account door.
       Back remains outside the panel; every account action waits until the
       session has proved it owns this snapshot. */
    accountActions.lock();
    showOnlinePanel('onAccount');
    return true;
  }
  async function show(options: AccountShowOptions = {}):
  Promise<RuneCollectionRefresh | 'cached' | null> {
    const run = ++showRevision;
    const ownsRun = (): boolean => run === showRevision && isOnlinePanelCurrent('onAccount');
    const rejectPresentation = (): null => {
      /* A session can be replaced while Profile's independent reads are in
         flight. Remove the preceding account before the covered route exits;
         otherwise that private snapshot remains the mounted panel and can
         flash when the online overlay is opened again. */
      if (ownsRun()) {
        invalidatePresentation();
      }
      return null;
    };
    cancelAccountRuneGuide();
    /* Bind the cached paint to the synchronously persisted session, as the
       entry door already does (entry-wait.ts). A restore that replaced the
       account must never repaint the previous owner's snapshot: unbound, that
       stale view was painted, rejected against the new session, and the run
       exited to Home instead of painting the account that just signed in. */
    const cacheOwnerId = options.expectedAccountId ?? persistedAuthAccountId();
    const cachedView = cacheOwnerId ? readCachedAccountView(cacheOwnerId) : null;
    beginPresentation(cachedView);
    accountActions.lock();
    if (cachedView) {
      showOnlinePanel('onAccount');
    } else {
      showOnlineLoading('onAccount');
    }
    /* Standing is the one independently visible wait. It owns the exact rank
       and positional NEON state; every other fact arrives as one refresh. */
    const standingState: { result: Awaited<ReturnType<typeof myStandingLookup>> | null } = {
      result: null,
    };
    const applyStanding = (): void => {
      const standingResult = standingState.result;
      if (!standingResult || !lastAccount || !ownsRun()) return;
      if (!standingResult.ok && standingResult.reason === 'account-mismatch') {
        rejectPresentation(); return;
      }
      if (standingResult.ok
          && standingResult.accountId !== lastAccount.user.id.toLowerCase()) return;
      if (standingResult.ok) {
        rankPending = false;
        lastAccount = {
          ...lastAccount,
          profile: standingResult.standing
            ? { ...lastAccount.profile, rating: standingResult.standing.points }
            : lastAccount.profile,
          ladder: standingResult.standing
            ? { ...lastAccount.ladder, points: standingResult.standing.points }
            : lastAccount.ladder,
          standing: standingResult.standing,
          standingKnown: true,
        };
        const apex = standingResult.standing
          ? inApex(lastAccount.ladder.points, standingResult.standing.rank,
            standingResult.standing.population)
          : false;
        cacheStanding(standingResult.accountId, standingResult.standing, apex);
        cacheAccountView(lastAccount, lastRecent, true);
        refreshHomeChip();
      } else {
        /* An outage is not a confirmed "unranked" answer. A snapshot that
           has never learned its standing keeps the inline die until a later
           successful read; a known cached rank remains useful meanwhile, but
           only with the points from that same confirmed standing tuple. */
        rankPending = !lastAccount.standingKnown;
        lastAccount = retainKnownStandingTuple(lastAccount);
      }
      repaintFrame();
    };
    void myStandingLookup().then((result) => {
      standingState.result = result;
      applyStanding();
    }).catch(() => {
      standingState.result = { ok: false, reason: 'unavailable' };
      applyStanding();
    });
    const curveVersionRefresh = refreshVerifiedRankedCurveVersion();
    const [profileResult, user, ladderResult, streakResult, recentResult,
      identityResult, refreshedRunes]
      = await Promise.all([
      myProfileLookup(),
      currentUser(),
      myLadderLookup(),
      bestStreakLookup(),
      matchHistoryLookup(3),
      identityStatusLookup(),
      refreshRuneCollection(),
    ]);
    let runeCollection = refreshedRunes;
    const fallback = options.verifiedRuneFallback;
    if (!runeCollection.verified && fallback?.verified && fallback.accountId
        && user?.id.toLowerCase() === fallback.accountId.toLowerCase()
        && await runeCollectionMatchesActiveAccount(fallback)) {
      runeCollection = fallback;
    }
    const collectionAccountId = runeCollection.accountId?.toLowerCase() ?? null;
    if (!ownsRun()) return null;
    /* A v2 rating may never be classified through cached v1 floors. An older
       server answers no status at all and myLadderLookup keeps its public v1
       fallback; an unresolved curve leaves the cached view standing. */
    const curveVersion = await curveVersionRefresh;
    if (!ownsRun() || curveVersion === null) return null;
    /* A verified session loss or account mismatch invalidates the local view.
       A same-account refresh outage leaves the complete cached presentation
       standing, which is exactly what made it renderable in the first place. */
    if (!profileResult.ok && profileResult.reason === 'account-mismatch') {
      return rejectPresentation();
    }
    if (!user) return rejectPresentation();
    const activeAccountId = user.id.toLowerCase();
    const cachedAccountId = cachedView?.account.user.id.toLowerCase() ?? null;
    if ((cachedAccountId && cachedAccountId !== activeAccountId)
        || (collectionAccountId && collectionAccountId !== activeAccountId)
        || (ladderResult.ok && ladderResult.accountId !== activeAccountId)
        || (streakResult.ok && streakResult.accountId !== activeAccountId)
        || (recentResult.ok && recentResult.accountId !== activeAccountId)
        || (identityResult.ok && identityResult.accountId !== activeAccountId)
        || (standingState.result?.ok === false
          && standingState.result.reason === 'account-mismatch')
        || (standingState.result?.ok
          && standingState.result.accountId !== activeAccountId)
        || (options.expectedAccountId
          && options.expectedAccountId.toLowerCase() !== activeAccountId)) {
      return rejectPresentation();
    }
    /* Parallel snapshots can all still name A while the stored session changes
       to B. This is the eventual interaction/cache boundary, so verify once
       more even when an individual request was merely unavailable. */
    const boundaryUser = await currentUser();
    if (!ownsRun()) return null;
    if (boundaryUser?.id.toLowerCase() !== activeAccountId) {
      return rejectPresentation();
    }
    if (collectionAccountId) {
      const ownsCollection = await runeCollectionMatchesActiveAccount(runeCollection);
      if (!ownsRun()) return null;
      if (!ownsCollection) return rejectPresentation();
    }
    const cachedAccount = cachedAccountId === activeAccountId ? cachedView?.account ?? null : null;
    const profile = profileResult.ok ? profileResult.profile : cachedAccount?.profile ?? null;
    const ladder = ladderResult.ok ? ladderResult.ladder : cachedAccount?.ladder ?? null;
    const streak = streakResult.ok ? streakResult.streak : cachedAccount?.streak ?? null;
    const recent = recentResult.ok ? recentResult.rows : cachedView?.recent ?? null;
    if (!profile || profile.id.toLowerCase() !== activeAccountId || !ladder
        || streak === null || !recent) return cachedView ? rejectPresentation() : null;
    const cachedRunes = cachedAccount;
    /* The entry's collection is a same-turn backup for REWARD discovery, not
       authority over this screen. Rune facts and the equipment door follow
       Profile's own verified read; anything else leaves the cached facts as
       presentation and the seat locked. */
    const ownRunes = refreshedRunes.verified
      && refreshedRunes.accountId?.toLowerCase() === activeAccountId;
    if (!ownRunes && !cachedRunes) return null;
    const resolvedIdentity = identityResult.ok
      ? identityResult.identity
      : cachedView?.account.identity ?? null;
    if (!resolvedIdentity) return null;
    lastAccount = {
      profile,
      user,
      ladder,
      standing: standingState.result?.ok
          && standingState.result.accountId === activeAccountId
        ? standingState.result.standing
        : cachedView?.account.standing ?? null,
      standingKnown: standingState.result?.ok
        ? true : cachedView?.account.standingKnown ?? false,
      /* Stamp the curve this refresh resolved, so the snapshot stays readable
         on its own terms after a later cutover. */
      curveVersion,
      streak,
      identity: resolvedIdentity,
      runes: ownRunes ? refreshedRunes.collected : cachedRunes!.runes,
      runeRows: ownRunes ? refreshedRunes.rows : cachedRunes!.runeRows,
      equipment: ownRunes ? refreshedRunes.equipment : cachedRunes!.equipment,
    };
    lastRecent = recent;
    rankPending = standingState.result === null;
    if (standingState.result) {
      applyStanding();
      if (!ownsRun()) return null;
      if (!standingState.result.ok && lastAccount) cacheAccountView(lastAccount, lastRecent);
    } else {
      repaintFrame();
      if (lastAccount) cacheAccountView(lastAccount, lastRecent);
    }
    refreshHomeChip();
    accountActions.setRuneSeatAvailable(ownRunes);
    accountActions.unlock();
    /* A cached Profile supplies the destination CONTENT, not the navigation.
       An entry from the result still wipes into this shell, and sheets and
       focus guides owe that wipe either way. */
    const presented = cachedView
      ? whenPageMotionSettled(appRoot()) : showOnlinePanel('onAccount');
    const firstUnseenRune = firstCollectedRuneReward(runeCollection);
    const guidedReward = options.deferredRuneReward ?? firstUnseenRune;
    const requestedGuide = options.runeGuide ?? (firstUnseenRune ? {
      complete: () => undefined,
      cancel: () => undefined,
    } : undefined);
    const guideRequest = requestedGuide && guidedReward ? {
      complete: () => {
        /* The tutorial is mandatory through the real seat, not merely through
           the arrival animation. Only this tap consumes the durable reward. */
        void acknowledgeRuneReward(guidedReward.accountId, guidedReward.rune.id);
        requestedGuide.complete();
      },
      cancel: () => requestedGuide.cancel(),
    } : requestedGuide;
    const beginGuide = (): void => {
      if (!guideRequest || !ownsRun()) return;
      if (!runeCollection.collected.length) {
        guideRequest.cancel();
        return;
      }
      startAccountRuneGuide(runeCollection.collected, guideRequest);
    };
    const handedOffReward = options.deferredRuneReward
      && firstUnseenRune?.rune.id === options.deferredRuneReward.rune.id;
    /* A fast response is already fully laid out beneath the pinned loading
       die, but reward sheets and focus guides begin only once that one entry
       wipe has actually presented Profile. */
    await presented;
    if (!ownsRun()) return null;
    const rewardShown = handedOffReward ? false : ports.presentRuneReward(
      runeCollection,
      ownsRun,
      beginGuide,
      firstUnseenRune ? () => t('online', 'profile.equipRune') : undefined,
      !!firstUnseenRune,
    );
    if (!rewardShown) beginGuide();
    return runeCollection;
  }
  const equipmentChanged = (result: PersistedRuneEquipment): boolean => {
    if (!lastAccount
        || lastAccount.user.id.toLowerCase() !== result.accountId.toLowerCase()) return false;
    lastAccount = { ...lastAccount, equipment: result.selection };
    cacheAccountView(lastAccount, lastRecent);
    repaintAccount();
    return true;
  };
  const equipmentMismatch = (accountId: string): void => {
    if (lastAccount?.user.id.toLowerCase() === accountId.toLowerCase()) {
      invalidatePresentation();
    }
  };
  const bind = (): void => bindAccountScreen({
    showAuth: ports.showAuth,
    showAvatar: ports.showAvatar,
    showLadder: () => ports.showLadder(),
    showHistory: () => ports.showHistory(),
    refresh: show,
    providerAccountId: () => lastAccount?.user.id.toLowerCase() ?? null,
    providerInvalidated: equipmentMismatch,
    equipmentChanged,
    equipmentMismatch,
    equipmentSettled: accountActions.repaint,
    clearNickError,
    showNickError,
  });

  return { bind, showCached, show };
}
